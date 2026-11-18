---
title: "Topics, partitions and producers"
skills: [kafka-partitions]
---

A single log on a single machine would be simple and slow. Kafka splits each topic into **partitions** so that writes and reads spread across machines, and copies each partition to several machines so that one failure loses nothing. This lesson covers how records find their partition, what ordering you actually get, how replication keeps data safe, and which producer settings decide whether a write can be lost or duplicated.

## Topics are split into partitions

A topic is a name plus a number of partitions. Each partition is its own append-only log with its own offsets, stored on one broker as the leader (more on that below).

```text
orders.events
  partition 0: [0][1][2][3][4]
  partition 1: [0][1][2]
  partition 2: [0][1][2][3]
```

Offsets are per partition. "Offset 3" means nothing without "of partition 2". There is no global order across partitions.

Partitions are the unit of everything in Kafka:

- **Parallelism.** Within one consumer group, each partition is read by at most one consumer. Six partitions means at most six busy consumers in a group; a seventh sits idle.
- **Ordering.** Kafka guarantees order only inside one partition.
- **Storage and load.** Partitions are spread over brokers, so a topic can be larger and busier than any one machine.

## Keys decide the partition, and the partition decides the order

When a producer sends a record with a **key**, the client hashes the key and picks a partition from the hash. Same key, same partition, as long as the partition count does not change. Records without a key are spread across partitions for balance.

That gives you the rule that most Kafka designs rest on:

> All records with the same key land in the same partition, so they are read in the order they were written.

Choose the key from the thing whose events must stay in order. For order events, the key is the order ID: `Placed`, `Paid`, `Shipped` for order 1042 stay in that order. Events of different orders may interleave, which is fine because nobody needs order 1042 to be processed before order 1043.

Three traps follow from the hashing:

- **Adding partitions later moves keys.** The hash is taken modulo the partition count, so after going from 6 to 12 partitions, new events for order 1042 may land in a different partition from its old ones. Ordering for that key breaks around the change. You also cannot reduce the count. Pick a generous number up front (for a small product, 6 to 12 is common) rather than starting at 1.
- **Hot keys.** If one tenant produces half the traffic and you key by tenant, one partition (and one consumer) does half the work. Key by something finer, such as the order or the user, when per-tenant order is not really needed.
- **Different clients, different hashes.** Kafka clients do not all use the same hash function by default. If a Java service and a Node service produce to the same topic with the same keys, check that they use the same partitioner, or the same key can end up in two partitions.

## Replication, leaders and the ISR

Each partition is stored on several brokers; the **replication factor** (usually 3 in production) says how many. One copy is the **leader**: producers write to it and consumers read from it. The others are **followers** that copy the leader's log.

Followers that are caught up form the **in-sync replica set (ISR)**. A follower that falls too far behind, or stops responding, is dropped from the ISR until it catches up. If the leader's broker dies, the cluster picks a new leader from the ISR, so no acknowledged write is lost. By default Kafka will not elect an out-of-date replica as leader ("unclean" election is off), because that would silently drop records.

Two settings decide how safe a write is:

- **`acks` on the producer.** `0`: do not wait at all. `1`: wait for the leader only. `all` (also written `-1`): wait until every replica in the ISR has the record.
- **`min.insync.replicas` on the topic or broker.** With `acks=all`, the leader refuses writes when fewer than this many replicas are in sync.

The standard production combination is **replication factor 3, `min.insync.replicas=2`, `acks=all`**. One broker can be down for maintenance and writes still succeed with two copies; if two are down, producers get errors rather than a false "saved". `acks=1` is faster, but if the leader dies before a follower copies the record, the record is gone even though the producer was told it was written.

## KRaft: no more ZooKeeper

Older Kafka clusters needed a separate ZooKeeper ensemble to store metadata: which brokers exist, which partitions they hold, who leads what. Kafka replaced that with **KRaft**, a built-in metadata log managed by a small quorum of **controller** nodes using the Raft consensus protocol. Kafka 4.0 (March 2025) removed ZooKeeper support completely, and every current release (4.4 as of October 2026) runs in KRaft mode only.

What this means for you: one system to run instead of two, faster failover, and simpler local setups. A single container can act as both broker and controller, which is what you will use for practice. Old tutorials with a `zookeeper` service in their Compose file are out of date.

## Producers: batching, retries and idempotence

The producer client does more than send a request per record. It buffers records per partition and sends them in **batches**, which is where Kafka's throughput comes from.

- **`linger.ms`**: how long to wait for more records before sending a batch. Higher means bigger batches and better compression, at the cost of latency.
- **`compression.codec`** (`zstd`, `lz4`, `gzip`, `snappy`): compresses whole batches. JSON events compress very well.
- **Retries**: on a network error or a leader change, the client retries automatically.

Retries create a problem. If the broker wrote the batch but the acknowledgement was lost, the retry writes it again: a **duplicate**. With several requests in flight, a retry can also land after a later batch: **reordering**.

The **idempotent producer** fixes both. The broker gives the producer an ID, the producer numbers each batch per partition, and the broker drops any batch whose sequence number it has already seen. Turn it on with `enable.idempotence: true`; it also forces `acks=all`. The Java client has made it the default since Kafka 3.0, but librdkafka, which this Node client wraps, still defaults to `false`, so set it yourself.

```ts
import { KafkaJS } from '@confluentinc/kafka-javascript';

const { Kafka } = KafkaJS;

const producer = new Kafka().producer({
  'bootstrap.servers': 'localhost:9092',
  'enable.idempotence': true, // no duplicates or reordering from retries; implies acks=all
  'linger.ms': 10,
  'compression.codec': 'zstd',
});
await producer.connect();

const [report] = await producer.send({
  topic: 'orders.events',
  messages: [
    {
      key: 'order-1042',
      value: JSON.stringify({ type: 'OrderPaid', orderId: 'order-1042', amount: 4999 }),
      headers: { 'event-id': crypto.randomUUID() },
    },
  ],
});
console.log(report.partition, report.baseOffset);
```

Know the limit of idempotence: it removes duplicates caused by the **client's own retries** within one producer session. If your code calls `send` twice for the same business event (say, an HTTP handler retried by the user), Kafka sees two different records. That is why the event carries an `event-id` header that consumers can deduplicate on (lesson 3).

One more client detail: awaiting each `send` one by one limits a batch to the records in that call. For high throughput, start many sends and await them together, or call `producer.flush()`.

Topics can be created by an admin client, a CLI, or infrastructure code. Do it explicitly rather than relying on auto-creation, so the partition count and replication are chosen, not defaulted:

```ts
const admin = new Kafka().admin({ 'bootstrap.servers': 'localhost:9092' });
await admin.connect();
await admin.createTopics({
  topics: [{ topic: 'orders.events', numPartitions: 6, replicationFactor: 3 }],
});
await admin.disconnect();
```

## Common mistakes

- Expecting order across a whole topic. Order exists only within a partition, so only within a key.
- Keying by something too coarse (tenant, country) and creating one hot partition.
- Adding partitions to a keyed topic without planning for the change in key placement.
- Producing with `acks=1` or with idempotence off and assuming no record is ever lost or duplicated.
- Running replication factor 3 with `min.insync.replicas=1`, so a write can be acknowledged by one broker that then dies.
- Following a tutorial that starts ZooKeeper. Current Kafka runs only in KRaft mode.

## Go deeper

- [Kafka replication and committed messages](https://docs.confluent.io/kafka/design/replication.html): ISR, `min.insync.replicas` and leader election in detail.
- [Apache Kafka documentation](https://kafka.apache.org/documentation/): the "Design" and "Operations" sections cover partitions, producers and KRaft.
- [confluent-kafka-javascript on GitHub](https://github.com/confluentinc/confluent-kafka-javascript): its INTRODUCTION covers batching, flushing and the idempotent producer.
- [Kafka delivery guarantees](https://docs.confluent.io/kafka/design/delivery-semantics.html): how `acks` and idempotence fit into the bigger picture of lesson 3.
