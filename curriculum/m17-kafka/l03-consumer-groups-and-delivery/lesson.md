---
title: "Consumer groups and delivery guarantees"
skills: [kafka-consumer-groups]
---

Producing is the easy half. The hard questions in Kafka are on the reading side: how several instances of a service share a topic, what happens when one of them dies halfway through a batch, and whether a record can be processed twice or not at all. The answers all come down to one number per partition, the **committed offset**, and to when you move it.

## Consumer groups share partitions

Consumers that use the same `group.id` form a **consumer group**. The group's **coordinator** (a broker) assigns each partition of the subscribed topics to exactly one member.

```text
orders.events, 6 partitions, group "billing"
  3 instances:  A -> p0, p1    B -> p2, p3    C -> p4, p5
  C crashes:    A -> p0, p1, p4    B -> p2, p3, p5
  7 instances:  six get one partition each, one is idle
```

Two consequences:

- **The partition count caps a group's parallelism.** To scale beyond it, add partitions (with the key caveat from lesson 2) or process faster per partition.
- **Order is preserved per partition**, because only one member reads a partition at a time, and the client hands you its records one at a time unless you ask for concurrency across partitions.

## Rebalancing

When a member joins, leaves or is presumed dead, the group **rebalances**: partitions move to other members. A member is presumed dead when it stops sending heartbeats for `session.timeout.ms` (45 s by default in librdkafka) or when it does not ask for new records within `max.poll.interval.ms` (5 minutes by default). The second one bites Node developers: an `eachMessage` handler that waits a long time on a slow API can get its consumer thrown out of the group, and its partitions are handed to someone else while it is still working.

The original ("classic") protocol stops the whole group during a rebalance. Kafka 4.0 made a new consumer protocol (KIP-848) generally available: the broker computes assignments and moves only the partitions that need to move, so the rest of the group keeps working. In `@confluentinc/kafka-javascript`, opt in with `'group.protocol': 'consumer'` against a Kafka 4 cluster; the default is still `classic`.

Rebalances are normal during deploys. They become a problem when they never stop (a "rebalance storm"), usually because handlers exceed the poll interval or instances keep restarting.

## Committing offsets

A consumer **commits** the offset of the *next* record it wants, per partition. After a restart or a rebalance, whoever owns the partition resumes from the committed offset. Everything between the last commit and the crash is read again.

So the delivery guarantee depends on the order of two steps.

### At-most-once: commit, then process

If you commit first and crash during processing, that record is skipped forever. Acceptable for metrics you can afford to lose, rarely for anything else.

### At-least-once: process, then commit

If you crash after processing but before committing, the records since the last commit are processed **again**. Nothing is lost, but duplicates happen. This is the default you should design for.

This client's auto-commit is at-least-once: every 5 seconds (`auto.commit.interval.ms`) it commits the offset after the last message whose `eachMessage` **finished**. A crash can replay up to 5 seconds of work. For tighter control, turn auto-commit off and commit yourself:

```ts
import { KafkaJS } from '@confluentinc/kafka-javascript';

const { Kafka } = KafkaJS;

const consumer = new Kafka().consumer({
  'bootstrap.servers': 'localhost:9092',
  'group.id': 'billing',
  'enable.auto.commit': false,
});
await consumer.connect();
await consumer.subscribe({ topics: ['orders.events'] });

await consumer.run({
  eachMessage: async ({ topic, partition, message }) => {
    await handle(JSON.parse(message.value!.toString()));
    // Commit the NEXT offset to read, not the one just processed.
    await consumer.commitOffsets([
      { topic, partition, offset: (BigInt(message.offset) + 1n).toString() },
    ]);
  },
});
```

Committing after every record is the simplest at-least-once loop, and also the slowest. Committing every N records or every few seconds is faster and replays more after a crash. Either way, duplicates are possible.

### "Exactly-once": transactions inside Kafka

Kafka offers **transactions**: a producer with a `transactional.id` can write records to several partitions *and* commit the consumer's offsets in one atomic step. Consumers with `isolation.level: read_committed` (librdkafka's default) never see records from aborted transactions.

```ts
const producer = new Kafka().producer({
  'bootstrap.servers': 'localhost:9092',
  'transactional.id': 'order-enricher-1', // unique per producer instance
});
await producer.connect();

await consumer.run({
  eachMessage: async ({ topic, partition, message }) => {
    const tx = await producer.transaction();
    try {
      await tx.send({ topic: 'orders.enriched', messages: [{ key: message.key, value: enrich(message.value) }] });
      await tx.sendOffsets({
        consumer,
        topics: [{ topic, partitions: [{ partition, offset: (BigInt(message.offset) + 1n).toString() }] }],
      });
      await tx.commit();
    } catch (err) {
      await tx.abort();
      throw err;
    }
  },
});
```

Read the fine print: this is exactly-once for **Kafka-to-Kafka** processing (read a topic, write a topic, commit offsets). The moment your handler writes to Postgres, charges a card through Stripe or sends an email, Kafka's transaction does not cover that side effect. A crash after the email but before the commit sends it again on replay. So "exactly-once" in practice means **at-least-once delivery plus idempotent processing**.

## Make the consumer idempotent

An idempotent consumer gives the same result whether it sees an event once or five times. Common ways:

- **Deduplicate on an event ID.** Every event carries a unique ID (the `event-id` header from lesson 2). Record processed IDs in the same database transaction as the side effect:

```sql
CREATE TABLE processed_events (
  consumer text NOT NULL,
  event_id uuid NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer, event_id)
);
-- In the handler's transaction:
-- INSERT INTO processed_events (consumer, event_id) VALUES ('billing', $1) ON CONFLICT DO NOTHING;
-- If no row was inserted, the event was already handled: skip the side effect and commit.
```

- **Write state, not deltas.** "Set order 1042 status to paid" is safe to repeat; "add 49.99 to the balance" is not.
- **Pass an idempotency key downstream.** Stripe and many APIs accept one, so a replayed charge request returns the first result.

## Poison messages and dead-letter topics

A **poison message** is a record your handler can never process: malformed JSON, a schema it does not know, a reference to a row that does not exist. With this client, throwing from `eachMessage` makes the consumer seek back and deliver **the same record again**. If the error is permanent, that partition is stuck forever while lag grows behind it, because ordering means the consumer will not skip ahead on its own.

The usual fix:

1. Retry **transient** errors (timeouts, 503s) a few times with backoff, inside the handler or via `pause()` and `resume()`.
2. Send records that still fail, or fail permanently, to a **dead-letter topic** such as `orders.events.billing.dlt`, with headers for the error, the source partition and offset.
3. Commit and move on. Alert on the dead-letter topic and replay it after fixing the bug.

Note the cost: a record moved to the dead-letter topic is now out of order with its key's later events. For a key whose order matters, some teams instead pause the partition and page someone.

## Lag: the number to watch

**Consumer lag** is, per partition, the log-end offset minus the group's committed offset: how many records are waiting. Steady lag near zero is healthy. Lag that grows means the group consumes slower than producers write, or is stuck.

```sh
kafka-consumer-groups.sh --bootstrap-server localhost:9092 --describe --group billing
# GROUP    TOPIC          PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG
# billing  orders.events  0          1200            1200            0
# billing  orders.events  2          5871            9120            3249
```

Lag on one partition only points at a poison message or a hot key. Lag on all partitions points at slow processing or too few consumers. Alert on lag (or on time lag, how old the oldest unread record is), not on CPU.

To process faster without more partitions, `run({ partitionsConsumedConcurrently: 3, eachMessage })` handles several partitions at once in one process while still keeping each partition in order.

## Common mistakes

- Committing `message.offset` instead of `message.offset + 1`, so the last record is replayed after every restart.
- Believing "exactly-once" covers database writes, emails or HTTP calls made by the handler.
- Writing handlers that are not idempotent, then discovering duplicates after the first deploy-time rebalance.
- Letting one bad record block a partition because the handler rethrows forever.
- Slow handlers that exceed `max.poll.interval.ms`, causing rebalances that cause more replays.
- Running more consumers than partitions and wondering why some are idle.

## Go deeper

- [Kafka consumer design](https://docs.confluent.io/kafka/design/consumer-design.html): groups, offsets and the coordinator.
- [Kafka delivery guarantees](https://docs.confluent.io/kafka/design/delivery-semantics.html): at-most-once, at-least-once and exactly-once, from Confluent's docs.
- [confluent-kafka-javascript on GitHub](https://github.com/confluentinc/confluent-kafka-javascript): committing offsets, `eachBatch`, pausing and transactions in this client.
- [Apache Kafka documentation](https://kafka.apache.org/documentation/): consumer configuration reference and the operations guide to monitoring groups.
