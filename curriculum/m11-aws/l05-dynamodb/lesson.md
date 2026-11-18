---
title: "DynamoDB: design for your queries"
skills: [aws-dynamodb]
---

DynamoDB is AWS's serverless key-value and document database. It answers single-digit-millisecond reads at any scale, needs no connection pool, has no server to patch, and costs nothing when idle on on-demand pricing. The price is that it answers only the questions you designed the table for. In Postgres you model the data and write any query later; in DynamoDB you list the queries first and shape the keys to serve them. This lesson covers keys, queries, indexes, conditional writes, TTL and capacity, and ends with an honest look at when Postgres is the better choice.

## Tables, items and keys

A **table** holds **items**, which are JSON-like maps of attributes up to 400 KB each. There is no schema apart from the **primary key**, which takes one of two forms:

- A **partition key** alone (`userId`). Each value identifies one item.
- A **partition key plus a sort key** (`pk`, `sk`). Items with the same partition key form an **item collection**, stored together and sorted by the sort key.

The partition key is hashed to decide which physical partition stores the item. That is how DynamoDB scales: more partitions, each handling a slice of the keys. It also means a single hot key value (every write to `pk = 'GLOBAL'`) is limited to one partition's throughput, roughly 1,000 writes and 3,000 reads per second. Spread writes over many key values.

## Query, not scan

There are three ways to read:

- `GetItem` with the full primary key returns one item.
- `Query` takes **one partition key value** and optionally a condition on the sort key (`=`, `<`, `between`, `begins_with`), and returns matching items in sort-key order, forwards or backwards.
- `Scan` reads the **whole table** and filters afterwards.

Design so that every request in your app is a `GetItem` or a `Query`. A `Scan` reads, and bills, every item, so its cost grows with the table, not with the answer. A `FilterExpression` does not change that: it removes items **after** they were read and billed. Scans are for exports and one-off migrations.

Results come back in pages of at most 1 MB, or `Limit` items. When more exist, the response has `LastEvaluatedKey`; pass it as `ExclusiveStartKey` to get the next page. This is cursor pagination by design. Encode the key (for example as base64url JSON) to make it an opaque cursor for your API. There is no `OFFSET` and no cheap `COUNT`.

## Designing keys from access patterns

Start with the list of questions. For a small project tracker:

1. Get a project by id.
2. List a project's tasks, newest first, paginated.
3. Get one task.
4. List a user's open tasks across projects, by due date.

Then choose generic key attribute names (`pk`, `sk`) and encode the entity type in the values:

| Item | `pk` | `sk` |
|---|---|---|
| Project | `PROJECT#p1` | `META` |
| Task | `PROJECT#p1` | `TASK#01JC9Z...` (a ULID, so it sorts by time) |

Patterns 1 to 3 are now `GetItem` and `Query`:

```ts
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const page = await doc.send(new QueryCommand({
  TableName: 'tracker',
  KeyConditionExpression: 'pk = :pk AND begins_with(sk, :task)',
  ExpressionAttributeValues: { ':pk': 'PROJECT#p1', ':task': 'TASK#' },
  ScanIndexForward: false,      // newest first
  Limit: 20,
  ExclusiveStartKey: cursor,    // undefined on the first page
}));
```

`DynamoDBDocumentClient` from `@aws-sdk/lib-dynamodb` converts between plain JS values and DynamoDB's typed format (`{ S: 'x' }`, `{ N: '1' }`). Use it unless you have a reason not to.

Storing several entity types in one table, as above, is **single-table design**. Its real benefit is that related items share a partition key, so one `Query` returns a project and its tasks together. Use it in moderation: put things in one table when you read them together, and do not contort unrelated data into one table to follow a rule. Two or three tables are fine.

## Secondary indexes

Pattern 4 needs a different key: by user, sorted by due date. A **global secondary index** (GSI) is a second key on the same table, maintained by DynamoDB:

| Item | `gsi1pk` | `gsi1sk` |
|---|---|---|
| Open task | `USER#u7#OPEN` | `2026-12-01#01JC9Z...` |

Query it with `IndexName: 'gsi1'`. Items without the GSI key attributes are simply not in the index (a **sparse index**), so removing `gsi1pk` when a task is closed takes it out of "open tasks". Keep in mind:

- GSIs are **eventually consistent**: a write shows up in the index shortly after, not at once.
- Each GSI costs write capacity on every write that touches it.
- When the indexed value changes (a status, a due date), **your code** must update the GSI key attributes in the same write. DynamoDB only indexes what you store.
- A **local secondary index** shares the partition key but adds another sort key; it must be created with the table. GSIs are the usual choice.

## Conditional writes

DynamoDB has no foreign keys and no unique constraints except the primary key, but every write can carry a **condition**, checked atomically on the item:

```ts
await doc.send(new PutCommand({
  TableName: 'tracker',
  Item: { pk: 'PROJECT#p1', sk: 'META', name: 'Launch', version: 1 },
  ConditionExpression: 'attribute_not_exists(pk)',   // create, never overwrite
}));
```

A plain `PutItem` **replaces** an existing item with the same key. Without the condition, creating "a new project" with a reused id silently destroys the old one. When the condition fails, the SDK throws `ConditionalCheckFailedException`.

The same mechanism gives **optimistic locking**, as in module 8: store a `version`, and require it to be unchanged when you write.

```ts
await doc.send(new UpdateCommand({
  TableName: 'tracker',
  Key: { pk: 'PROJECT#p1', sk: 'META' },
  UpdateExpression: 'SET #name = :name, version = version + :one',
  ConditionExpression: 'version = :expected',
  ExpressionAttributeNames: { '#name': 'name' },             // "name" is a reserved word
  ExpressionAttributeValues: { ':name': 'Launch v2', ':expected': 3, ':one': 1 },
  ReturnValues: 'ALL_NEW',
  ReturnValuesOnConditionCheckFailure: 'ALL_OLD',
}));
```

`ReturnValuesOnConditionCheckFailure: 'ALL_OLD'` puts the current item on the error (`error.Item`), so you can tell "someone else changed it" (item present, other version) from "it does not exist" (no item). The item on the error is in DynamoDB's typed format (`{ version: { N: '4' } }`), even when you use the document client. Also note that `UpdateItem` **creates** an item when none exists unless a condition says otherwise; add `attribute_exists(pk)` when updating must not create.

For several items at once, `TransactWriteItems` applies up to 100 puts, updates, deletes and condition checks atomically. It costs twice as much as single writes, so use it where atomicity matters, such as "create the user and claim the email address" with a separate `EMAIL#...` item as a uniqueness guard.

## TTL

Set **Time to Live** on an attribute holding a Unix timestamp in **seconds**. DynamoDB deletes expired items in the background for free. The deletion is lazy: it usually happens within a few days of expiry, not at the second. Until then the item is still returned by reads, so filter expired items yourself when it matters (`expiresAt > :now` or a check in code). TTL is ideal for sessions, idempotency records and short-lived carts.

## Capacity modes

- **On-demand**: pay per request, no planning, scales instantly from zero. The default for new and spiky workloads.
- **Provisioned**: you set read and write capacity units, optionally with auto scaling. Cheaper for steady, predictable traffic.

Reads are **eventually consistent** by default and half the price; pass `ConsistentRead: true` on `GetItem` or `Query` (not on a GSI) when you must read your own write.

## When Postgres is the better choice

Choose DynamoDB when the access patterns are known and stable, the data is naturally keyed (sessions, carts, idempotency keys, device state, per-tenant event logs), and you want no database to operate at very high or very spiky load.

Choose Postgres when:

- The queries are not known yet, which is the normal state of a young product.
- You need ad-hoc filters, sorting by arbitrary columns, joins, aggregates or reporting.
- Relationships and constraints carry the business rules (foreign keys, uniqueness on several columns).
- The team already knows SQL and your scale fits one well-sized instance, which covers most startups for years.

A frequent, sensible setup is both: Postgres for the core domain, DynamoDB for a narrow high-volume piece where its model is a natural fit.

## Common mistakes

- Starting with the entities instead of the access patterns.
- Using `Scan` with a filter for a request path.
- A low-cardinality partition key (`status`, `date`, `tenant` for one huge tenant) that creates a hot partition.
- `PutItem` without `attribute_not_exists` when creating, which overwrites silently.
- Changing a status without updating the GSI key attributes that depend on it.
- Expecting TTL to remove items at the exact second, or storing it in milliseconds.

## Go deeper

- [Best practices for designing with DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/best-practices.html): keys, partitions, indexes and item size.
- [Condition expressions](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.ConditionExpressions.html): conditional writes and their functions.
- [Querying tables](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Query.html): key conditions, pagination and limits.
- [Time to Live](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html): how expiry and deletion work.
- [Read/write capacity modes](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/capacity-mode.html): on-demand vs provisioned.
