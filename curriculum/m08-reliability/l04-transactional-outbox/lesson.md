---
title: The dual-write problem and the transactional outbox
skills: [transactional-outbox]
---

Sooner or later a write in your database has to be announced to somebody else: an order was placed, so send the confirmation email, tell the warehouse, update the search index. The obvious code writes the row and then publishes a message. It works in every test and loses messages in production. This lesson explains why, and shows the pattern that fixes it with nothing more than a table and a loop.

## The dual-write problem

```ts
await db.query('insert into orders (customer_id, total_cents) values ($1, $2)', [customerId, total]);
await queue.add('order.placed', { customerId, total });   // a second, separate system
```

Two systems, two writes, no transaction spanning both. Every ordering fails somewhere:

- **Database first, then queue.** The process dies, or the queue is unreachable, after the commit. The order exists and nobody hears about it. No email, no shipment.
- **Queue first, then database.** The insert fails (a constraint, a timeout, a deploy). The warehouse ships an order that does not exist.
- **Publish inside the transaction, before commit.** The consumer may receive the message before the commit is visible and find no order. And if the commit then fails, the message is already out.

Retrying the publish does not fix it, because the process that would retry is the one that died. You might think "Postgres and the queue each support transactions, so use a distributed transaction". Two-phase commit (XA) across a database and a broker exists in theory, but most brokers and every HTTP API do not support it, and where it exists it couples the availability of both systems. In practice, nobody building a Node backend uses it.

## The outbox

The fix is to stop doing two writes. Write the message **into the same database, in the same transaction** as the data. A separate process, the **relay**, reads the outbox table and publishes what it finds.

```sql
create table outbox (
  id            bigserial   primary key,
  topic         text        not null,
  payload       jsonb       not null,
  created_at    timestamptz not null default now(),
  published_at  timestamptz,
  attempts      int         not null default 0,
  last_error    text
);
create index outbox_pending on outbox (id) where published_at is null;
```

```ts
await tx(pool, async (client) => {
  const { rows } = await client.query(
    'insert into orders (customer_id, total_cents) values ($1, $2) returning id',
    [customerId, totalCents],
  );
  await client.query(
    'insert into outbox (topic, payload) values ($1, $2)',
    ['order.placed', { orderId: rows[0].id, customerId, totalCents }],
  );
});
```

Now the order and its message commit together or not at all. Postgres gives you the atomicity that two systems could not.

The partial index keeps the relay's query fast when the table holds millions of published rows. Delete or archive published rows on a schedule anyway.

## The relay

The relay is a loop: claim some pending rows, publish them, mark them published.

```ts
export async function relayOnce(pool: pg.Pool, publish: (m: OutboxMessage) => Promise<void>): Promise<number> {
  return tx(pool, async (client) => {
    const { rows } = await client.query<OutboxMessage>(
      `select id, topic, payload from outbox
        where published_at is null
        order by id
        limit 50
        for update skip locked`,
    );
    let sent = 0;
    for (const message of rows) {
      try {
        await publish(message);
        await client.query('update outbox set published_at = now() where id = $1', [message.id]);
        sent++;
      } catch (error) {
        await client.query(
          'update outbox set attempts = attempts + 1, last_error = $2 where id = $1',
          [message.id, String(error)],
        );
        break;   // keep the rest in order for the next round
      }
    }
    return sent;
  });
}
```

Run it on a timer (every few hundred milliseconds), or wake it with Postgres `LISTEN`/`NOTIFY`: a `notify outbox` in the placing transaction is delivered only on commit, so the relay never wakes for a message that does not exist.

### Two relays at once

You will run more than one instance of your service, so more than one relay. Without care, both read the same pending row and both publish it. `for update` alone would make the second relay wait for the first to commit, which is correct but serial. `for update skip locked` makes each relay **skip rows another transaction has locked** and take the next ones. Module 3 introduced it as the way to turn a table into a job queue; this is that use.

Two costs to know. The relay holds its transaction, and so its locks and one pooled connection, while it publishes. Keep batches small and publishing fast, with a timeout on `publish`. And `skip locked` gives up global ordering: relay A may publish message 11 while relay B is still on message 10. If consumers need order per entity, publish with a partition or group key (an order id) and let the broker preserve order within it, or run one relay.

### Why delivery is at least once

Look at the loop again. If `publish` succeeds and the process dies before the transaction commits, the update to `published_at` is lost and the row is still pending. The next relay publishes it again. There is no way to close that window, because publishing and committing are, once more, two systems. The outbox turns "maybe never" into "at least once". Duplicates are now the consumer's problem, and that is a problem with a clean answer.

## The inbox on the consumer side

The consumer records each message id it has processed, **in the same transaction** as the work the message triggers:

```sql
create table inbox (
  message_id    text        primary key,
  processed_at  timestamptz not null default now()
);
```

```ts
export async function consume(pool: pg.Pool, message: Message, apply: (c: pg.PoolClient) => Promise<void>) {
  return tx(pool, async (client) => {
    const { rowCount } = await client.query(
      'insert into inbox (message_id) values ($1) on conflict do nothing',
      [message.id],
    );
    if (rowCount === 0) return 'duplicate';
    await apply(client);           // the handler's writes, on the same client
    return 'processed';
  });
}
```

If `apply` throws, the transaction rolls back, the inbox row disappears with it, and the redelivered message is processed properly. If two copies arrive at the same time, the second `insert` waits on the primary key until the first commits, then does nothing. This is lesson 3's natural idempotency, applied to messages. Message ids must be stable across redeliveries: use the outbox row's id (prefixed with the producing service), never an id generated at publish time.

The inbox only covers effects inside the consumer's database. If the handler sends an email or calls an API, that step needs its own idempotency key, derived from the message id.

## Alternatives

- **Change data capture.** Tools such as Debezium read the database's write-ahead log and publish changes, so you skip the polling relay. More infrastructure, less latency.
- **A job table in the same database.** If the consumer is your own worker, the outbox row can simply be the job, claimed with `skip locked` by the worker itself. Libraries like `pg-boss` and Graphile Worker do this.
- **Durable workflow engines.** Temporal, Inngest and others persist each step for you, which module 7 compares.

## Common mistakes

- Writing to the database and the queue in sequence and hoping nothing crashes between.
- Publishing from inside the transaction before the commit.
- A relay without `skip locked` or another claim, so two instances publish each message twice in parallel.
- Assuming the outbox gives exactly-once delivery, and writing consumers that are not idempotent.
- Generating message ids at publish time, so a re-publish looks like a new message.
- Never cleaning up published rows.

## Go deeper

- [microservices.io: Transactional outbox](https://microservices.io/patterns/data/transactional-outbox.html): the pattern and its variants.
- [PostgreSQL: SELECT, the locking clause](https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE): what `skip locked` and `nowait` do.
- [PostgreSQL: NOTIFY](https://www.postgresql.org/docs/current/sql-notify.html): why notifications are delivered only on commit.
- [Debezium: Outbox event router](https://debezium.io/documentation/reference/stable/transformations/outbox-event-router.html): the change data capture version.
