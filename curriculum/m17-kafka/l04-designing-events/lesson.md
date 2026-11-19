---
title: "Designing events: schemas, compaction and the outbox"
skills: [kafka-event-design]
---

A topic is a public API. Once three teams read `orders.events`, the shape of those records is a contract you cannot change on a whim, and the hardest bug is not a slow consumer but an event that was never published because the database commit and the Kafka write disagreed. This lesson covers what to put in an event, how to evolve its schema safely, when to compact a topic, and how events should leave Postgres.

## Events and commands are different things

- An **event** states a fact in the past tense: `OrderPlaced`, `PaymentFailed`. The producer does not know or care who listens. Consumers decide what to do.
- A **command** asks someone to do something: `SendReceiptEmail`, `ChargeCard`. It has one intended handler, and the sender usually cares whether it succeeded.

Kafka is at its best carrying events. Commands fit a job queue better (lesson 5): they need one worker, retries per job and often a result. Mixing the two in one topic produces confusing contracts, such as an "event" that only one service may handle.

## What goes in an event

Use a small, consistent envelope, plus the payload:

```json
{
  "eventId": "6f1c1a2e-3b0e-4c8e-9d61-0f8f7f0d2a11",
  "type": "OrderPaid",
  "version": 2,
  "occurredAt": "2026-11-18T10:15:00Z",
  "orderId": "order-1042",
  "customerId": "cus_88",
  "amount": { "value": 4999, "currency": "EUR" }
}
```

- `eventId` makes deduplication possible (lesson 3).
- `occurredAt` is business time, which differs from Kafka's append timestamp when events are replayed or delayed.
- The Kafka **key** is `orderId`, so all events of an order stay in order.

A design choice to make deliberately: **thin** events ("order 1042 changed, go look") force every consumer to call back into your API, which couples them to it and to its uptime. **Fat** events carry the data consumers need, so they can work on their own. Most teams lean towards fat events, minus anything sensitive that not every reader should see.

## Schemas and compatibility

JSON with no schema works until someone renames `amount` to `total` and four consumers break at 2 a.m. The cure is a schema per topic and a rule for how it may change.

The common tool is a **Schema Registry** (Confluent's is the best known; other vendors ship compatible ones). Producers register the schema of what they write; the registry assigns it an ID that travels with each record; consumers fetch the schema by ID to decode. Supported formats are **Avro**, **Protobuf** and **JSON Schema**. Avro and Protobuf are compact binary formats; JSON Schema keeps payloads readable at the cost of size.

The registry refuses a new schema version that breaks the topic's **compatibility mode**. The default is **BACKWARD**:

| Mode | Guarantee | Safe changes | Who upgrades first |
|---|---|---|---|
| BACKWARD (default) | New schema can read data written with the previous one | Delete a field, add an optional field (with a default) | Consumers |
| FORWARD | Old schema can read data written with the new one | Add a field, delete an optional field | Producers |
| FULL | Both | Add or delete optional fields only | Either |

Each mode also has a `_TRANSITIVE` variant that checks against all earlier versions, not only the last. That matters on topics with long retention, where a replay can meet a very old record.

The rules of thumb that keep you out of trouble in every mode: **add fields as optional with defaults, never rename, never change a type, never reuse a removed field's name**. For a breaking change, publish a new event type or a new topic (`orders.events.v2`) and run both until consumers move.

In Node, Confluent's `@confluentinc/schemaregistry` package works with `@confluentinc/kafka-javascript` to serialise Avro, Protobuf and JSON Schema payloads. Even without a registry, validating events with a shared zod schema in a package that producer and consumers import is far better than nothing.

## Compaction: a topic as a table

Normal topics delete records by age. A topic with `cleanup.policy=compact` instead keeps **at least the latest record for every key** and removes older ones in the background. The topic then behaves like a table you can replay: read it from the start and you get the current value for every key.

Uses:

- **Current state for each entity**, such as `customers.profile` keyed by customer ID, so a new service can load every customer without calling an API.
- **Kafka's own internals**: committed consumer offsets live in a compacted topic.

To delete a key, write a **tombstone**: a record with that key and a `null` value. Compaction eventually removes the key entirely.

Compaction suits state ("the profile is now X"). It is wrong for events where every step matters (`OrderPlaced` then `OrderPaid`), because compaction would keep only the last one.

## The dual-write problem

Module 8, lesson 4 covered this bug. With Kafka it is the most common first integration:

```ts
await db.insert(orders).values(order);      // 1. commit to Postgres
await producer.send({ topic: 'orders.events', messages: [event] }); // 2. publish
```

If the process dies between 1 and 2, or Kafka is unreachable, the order exists and the event never does, and reversing the two is no better.

## The outbox pattern

The fix is the same outbox as in module 8: write the event to a table **in the same database transaction** as the change, and let a separate process publish it. What is new here is the shape of the table, which uses the column names Debezium's outbox router expects, and the question of how rows reach Kafka in order.

```sql
CREATE TABLE outbox (
  id uuid PRIMARY KEY,
  seq bigint GENERATED ALWAYS AS IDENTITY, -- the relay's order
  aggregatetype text NOT NULL,      -- 'order'
  aggregateid text NOT NULL,        -- 'order-1042', used as the Kafka key
  type text NOT NULL,               -- 'OrderPaid'
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz          -- used by a polling relay; Debezium does not need it
);

BEGIN;
UPDATE orders SET status = 'paid' WHERE id = 'order-1042';
INSERT INTO outbox (id, aggregatetype, aggregateid, type, payload)
VALUES (gen_random_uuid(), 'order', 'order-1042', 'OrderPaid', '{"amount": 4999}');
COMMIT;
```

Either both rows are written or neither is. Getting the outbox rows to Kafka has two common forms.

### A polling relay

A worker in your app reads unpublished rows in order, publishes them, and marks them sent:

```sql
SELECT * FROM outbox WHERE published_at IS NULL
ORDER BY seq LIMIT 100 FOR UPDATE SKIP LOCKED;
```

Simple and needs no extra infrastructure. It adds polling latency and load on the database, and if it crashes after publishing but before marking a row, the row is published again. That is fine because consumers are idempotent on `eventId` (the row's `id`).

The query hides an ordering trap. Lesson 2 relies on per-key order (fulfilment must never see `OrderCancelled` before `OrderPaid`), and this relay can break it in two ways. With two relay instances, `SKIP LOCKED` lets the second one take and publish later rows while the first still holds earlier ones. And no column follows commit order by itself: `seq` is drawn when the row is inserted, so a transaction that inserts first and commits late becomes visible after a higher `seq` was already sent (`created_at` is worse, because `now()` is the time the transaction started). To keep order per key, run a single relay (or one per hash of the key), stop the batch at the first failed publish instead of skipping it, and have every transaction lock or update its aggregate row (the order) before it inserts into the outbox. Two transactions for the same key then cannot overlap, so for that key `seq` order is commit order. Debezium reads the log in commit order, so it does not have this problem.

### CDC with Debezium

**Debezium** is a Kafka Connect connector that reads Postgres's write-ahead log through logical replication (the built-in `pgoutput` plugin and a replication slot) and turns row changes into Kafka records. Its **outbox event router** is made for this table: it uses `aggregatetype` to choose the topic, `aggregateid` as the record key, `payload` as the value and `id` as a header for deduplication. No polling, and no change to your app beyond the insert.

The price is infrastructure: a Kafka Connect cluster to run, a replication slot to monitor (an abandoned slot makes Postgres keep WAL forever and fills the disk), and one more thing to upgrade. Managed Kafka offerings often run connectors for you.

Either way, delete or archive old outbox rows on a schedule, or the table grows without limit.

## Common mistakes

- Publishing to Kafka directly after a database commit (the dual write), then finding missing or phantom events.
- Renaming or retyping fields in a shared event without a compatibility check.
- Thin events that force every consumer to call your API, coupling them to its availability.
- Putting commands ("send this email") on a shared event topic.
- Compacting a topic of history events and losing all but the last step of each entity.
- Leaving a Debezium replication slot behind after removing the connector, so Postgres retains WAL until the disk fills.

## Go deeper

- [Schema evolution and compatibility](https://docs.confluent.io/platform/current/schema-registry/fundamentals/schema-evolution.html): every compatibility mode with examples of allowed changes.
- [Kafka log compaction](https://docs.confluent.io/kafka/design/log_compaction.html): how compaction and tombstones work.
- [Pattern: Transactional outbox](https://microservices.io/patterns/data/transactional-outbox.html): the pattern, its forces and alternatives.
- [Debezium outbox event router](https://debezium.io/documentation/reference/stable/transformations/outbox-event-router.html): the table layout it expects and its routing options.
- [Debezium connector for PostgreSQL](https://debezium.io/documentation/reference/stable/connectors/postgresql.html): logical decoding, `pgoutput` and replication slots.
