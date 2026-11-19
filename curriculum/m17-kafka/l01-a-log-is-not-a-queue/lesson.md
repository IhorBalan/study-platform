---
title: A log is not a queue
skills: [kafka-log-model]
---

Kafka is often described as "a message queue", and that description causes most of the confusion about it. Kafka is a distributed, append-only **log**. A queue hands each message to one worker and forgets it. A log keeps every record in order for a set time, and each reader keeps its own bookmark. Once that difference is clear, partitions, consumer groups and offsets all follow from it.

## What a job queue does

You have met job queues already: BullMQ on Valkey, or Amazon SQS. Their model is simple.

1. A producer adds a job.
2. One worker takes it. While it works, nobody else sees the job (BullMQ holds a lock, SQS hides the message for its visibility timeout).
3. The worker acknowledges it, and the job is deleted (or moved to a "completed" list that gets trimmed).
4. If the worker crashes, the lock or timeout expires, and another worker gets the job.

The queue tracks the state of **each message**: waiting, active, done, failed. Its job is to get work done once, by someone. After that the message is gone. If a second team wants to react to the same jobs, you need a second queue and the producer has to write to both, or you put a fan-out service in front (SNS in front of several SQS queues is exactly that).

## What a log does

A Kafka **topic** is a log: an ordered sequence of records that only ever grows at the end. Every record gets an **offset**, its position in the log (0, 1, 2, ...). Writing never changes earlier records. Reading never removes anything.

```text
orders.events (one partition)
offset:   0            1            2              3
        [Placed 1042][Paid 1042]  [Placed 1043]  [Shipped 1042]   <- producers append here
                          ^                            ^
              analytics is here (offset 1)   email is here (offset 3)
```

A reader, called a **consumer**, keeps a bookmark: "the next offset I will read is 2". The broker stores that bookmark per **consumer group** (lesson 3), but the records themselves do not care who has read them. So the log tracks one number per reader per partition, not a state per message. That is why Kafka is cheap to read many times and can keep a very large history.

If you know React, a log is closer to a Redux action history than to a to-do list. The actions stay; each reducer replays them into its own state.

## Retention: records expire by time or size, not by reading

Records leave a topic only when the topic's **retention** says so:

- **Time-based**, `retention.ms` (the broker default is 7 days).
- **Size-based**, `retention.bytes` per partition.
- **Compaction**, where Kafka keeps only the newest record for each key (lesson 4).

A consumer that is three hours behind loses nothing. A consumer that is eight days behind on a 7-day topic does lose data: its bookmark points at records that were deleted, and `auto.offset.reset` decides whether it jumps to the oldest or the newest remaining record.

## What the log model enables

### Many independent readers

The billing service, the email service and the analytics pipeline all read `orders.events` at their own pace, each with its own group. The producer does not know they exist. Adding a fourth reader next month is a deploy of that reader, nothing else. With a queue, that change touches the producer or the fan-out.

### Replay

Because records stay, a consumer can move its bookmark back and read again. Typical uses:

- A bug in the search indexer wrote bad documents for two days. Fix the code, reset the group's offsets to two days ago, and let it rebuild.
- A new service needs history. It starts with `auto.offset.reset: earliest` and reads the whole retained topic to build its own view.

A job queue cannot do this. Once a job is acknowledged, it is gone.

### Event sourcing and state rebuilt from events

If the log holds every change to an order ("placed", "paid", "shipped"), the current state of the order is a fold over its events. Some systems make the log the source of truth and treat tables as caches rebuilt from it. That is **event sourcing**. It is powerful and also a big commitment; most startups use Kafka to *publish* changes, not as their main database.

### Change data capture (CDC)

A database already has a log: Postgres writes every change to its write-ahead log (WAL). Tools such as Debezium read that log and publish each row change to a Kafka topic. Other systems (search, a warehouse, a cache) then follow the database without the application writing to them. Lesson 4 shows how this powers the outbox pattern.

## A first look at the code

The examples in this module use Confluent's official Node client, `@confluentinc/kafka-javascript`. It wraps librdkafka (the C client) and offers a promise-based API that follows the shape of the older KafkaJS library. Configuration keys use librdkafka's dotted names. Many tutorials and older codebases still use KafkaJS itself. It has had no release since early 2023, so new projects should not start on it; the similar API makes moving off it a small job.

Publish an event:

```ts
import { KafkaJS } from '@confluentinc/kafka-javascript';

const { Kafka } = KafkaJS;

const producer = new Kafka().producer({ 'bootstrap.servers': 'localhost:9092' });
await producer.connect();

await producer.send({
  topic: 'orders.events',
  messages: [
    { key: 'order-1042', value: JSON.stringify({ type: 'OrderPlaced', orderId: 'order-1042' }) },
  ],
});

await producer.disconnect();
```

Read it from the start of the topic, as the `email-service` group:

```ts
import { KafkaJS } from '@confluentinc/kafka-javascript';

const { Kafka } = KafkaJS;

const consumer = new Kafka().consumer({
  'bootstrap.servers': 'localhost:9092',
  'group.id': 'email-service',
  'auto.offset.reset': 'earliest',
});
await consumer.connect();
await consumer.subscribe({ topics: ['orders.events'] });

await consumer.run({
  eachMessage: async ({ partition, message }) => {
    const event = JSON.parse(message.value!.toString());
    console.log(partition, message.offset, event.type);
  },
});
```

Start a second copy of the consumer with `'group.id': 'analytics'` and it receives every record too, from offset 0. Start a second copy with the same `email-service` group and the two share the work instead (lesson 3). Same topic, two very different behaviours, chosen by the reader.

## Queue vs log, side by side

| | Job queue (BullMQ, SQS) | Log (Kafka) |
|---|---|---|
| Unit of state | Each message: waiting, active, done | One offset per group per partition |
| After processing | Message deleted | Record stays until retention removes it |
| Second consumer | Needs its own queue or a fan-out | Just another group |
| Replay | Not possible | Move the offset back |
| Per-message retry, delay, priority | Built in | You build it (retry topics, lesson 3) |
| Ordering | None (or per group in SQS FIFO) | Strict within a partition |

The last two rows matter as much as the first four. Queues are better at **jobs**: "resize this image", "send this email", with retries, delays and priorities per job. Logs are better at **facts other systems want to know about**: "order 1042 was paid". Since Kafka 4.2, Kafka also offers queue-style **share groups** (lesson 5), but the log model is still what Kafka is built around.

## Common mistakes

- Calling Kafka a queue and expecting a record to disappear once it is read.
- Using Kafka for work items that need per-job retries, delays or priorities, then rebuilding BullMQ badly on top of it.
- Setting a short retention "to save disk" and losing the ability to replay or to let a slow consumer catch up.
- Assuming every consumer sees every record. Consumers in the *same* group split the records; only different groups each see all of them.
- Treating event sourcing as the default. Publishing events is common; making the log your source of truth is a separate, much larger decision.

## Go deeper

- [Apache Kafka documentation](https://kafka.apache.org/documentation/): the "Design" section explains why Kafka is built as a log on disk.
- [Kafka quickstart](https://kafka.apache.org/quickstart): start a broker and write your first events.
- [confluent-kafka-javascript on GitHub](https://github.com/confluentinc/confluent-kafka-javascript): the Node client used in this module, with its introduction and examples.
- [What is BullMQ](https://docs.bullmq.io/): the job-queue model to compare against.
