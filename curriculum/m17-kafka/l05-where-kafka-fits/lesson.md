---
title: "Where Kafka fits: Kafka, SQS, BullMQ or Postgres"
skills: [kafka-vs-queues]
---

"Kafka vs SQS vs BullMQ: when would you choose each?" is one of the standard backend interview questions, and at a small company it is also a real decision with real costs. The honest answer is that most early products do not need Kafka, and the ones that do can say exactly why. This lesson gives you the deciding questions, the managed options, and a way to practise on your own machine.

## Four tools, four models

| | Postgres as a queue | BullMQ (Valkey/Redis) | SQS (+ SNS) | Kafka |
|---|---|---|---|---|
| Model | Rows claimed with `FOR UPDATE SKIP LOCKED` | Job queue | Managed message queue (+ fan-out) | Partitioned log |
| Best at | Jobs that must commit with your data | Background jobs in a Node app | Decoupling services on AWS with zero ops | Event streams many systems read and replay |
| Retries, delays, priorities | You build them (or pg-boss, Graphile Worker) | Built in | Visibility timeout, redrive to a DLQ, delay | You build them (retry and dead-letter topics) |
| Ordering | Whatever your query says | Per queue, loosely | None (standard), per message group (FIFO) | Per partition |
| Several independent readers | No | No | Via SNS fan-out to several queues | Yes, one group each |
| Replay | No | No | No | Yes, within retention |
| What you operate | Nothing new | A Valkey instance | Nothing | A cluster, or a paid managed service |
| Throughput | Moderate; jobs compete with your app's queries | High for jobs | Very high, scales without you | Very high and sustained, through batching |

### Choose Postgres when

The job must be atomic with your data ("create the invoice and queue its PDF" in one transaction), volume is modest, and you want no new moving parts. The outbox table from lesson 4 is this pattern.

### Choose BullMQ when

You have a Node backend that needs **background jobs**: emails, image processing, webhooks out, scheduled and repeatable tasks, with retries, backoff, delays, priorities, rate limits and a dashboard. You probably already run Valkey for caching. One worker per job is exactly what you want.

### Choose SQS (with SNS) when

You are on AWS, want a queue with **no servers at all**, and pay per request. Use SNS in front of several SQS queues when more than one service must react to the same message. FIFO queues give ordering per message group and deduplicate within a 5-minute window. What you do not get is replay: once a message is deleted, it is gone, and retention tops out at 14 days.

### Choose Kafka when

Several of these are true at once:

- **Many independent consumers** need the same stream: billing, search, analytics, notifications, a data warehouse.
- **Replay** matters: rebuilding a read model, backfilling a new service, recovering from a consumer bug.
- **Per-entity ordering** at high volume: all events for an account in order, across millions of accounts.
- **Sustained high throughput**: clickstreams, IoT telemetry, logs, payment events at scale.
- **CDC**: streaming database changes into other systems with Debezium.
- **Stream processing**: windowed aggregations, joins between streams (Kafka Streams, Flink).

If your reason is "we might need it later" or "it is what big companies use", it is not a reason yet.

### A quick way to decide

1. Is it a job that one worker must do? Use a job queue (BullMQ, SQS, or Postgres).
2. Is it a fact that several systems want, now or later, and might need to replay? Use a log (Kafka).
3. Is volume low and the team small? Start with Postgres and an outbox; you can add Kafka behind the outbox later without changing the code that writes events.

Many real systems use both: Kafka carries `OrderPaid` to everyone interested, and the email service turns that event into a BullMQ job to send the receipt with retries.

## Queues inside Kafka: share groups

Kafka now has a queue mode as well. **Share groups** (KIP-932, "Queues for Kafka") let many consumers read the same partitions at once and acknowledge **individual records**: accept, release for another attempt, or reject. Each record has a delivery count, and records that keep failing stop being redelivered. Kafka 4.2 (February 2026) declared share groups production-ready, and Kafka 4.4 (October 2026) added dead-letter queue support for them.

The trade-off: a share group gives up ordering. That makes it useful when you already run Kafka and want job-style consumption with more consumers than partitions. It does not make Kafka a replacement for BullMQ's delays, priorities and scheduling, and client support varies, so check your client library before planning on it.

## Managed Kafka

Running Kafka yourself means brokers, controllers, disks, upgrades, rebalancing partitions across brokers, monitoring under-replicated partitions, security (TLS, SASL, ACLs) and capacity planning. For a small team, that is a part-time job. The common managed options:

- **Confluent Cloud**: from the company founded by Kafka's creators; also runs Schema Registry, connectors (including Debezium) and Flink.
- **Amazon MSK**: Kafka inside your AWS account, in provisioned and serverless forms, with IAM authentication.
- **Aiven for Apache Kafka**: managed Kafka on several clouds.
- **Redpanda**: a Kafka-API-compatible broker written in C++ without the JVM, available as a product and as a cloud service. Your Kafka clients connect to it unchanged.

Even managed, Kafka has costs that a queue does not: a minimum monthly bill whether or not traffic flows, partitions and retention to size, consumer lag to monitor, schemas to govern, and a mental model every engineer on the team must learn. Moving from SQS to Kafka also changes your failure modes (rebalances, poison messages blocking partitions) more than your code.

## When a startup should not use Kafka

Be ready to say this in an interview, because interviewers at small companies check for it:

- **One consumer per message type.** That is a queue. Use BullMQ or SQS.
- **Low volume.** A few hundred events a minute fit in Postgres or SQS with room to spare.
- **No replay need.** If nobody will ever re-read old events, the log's main advantage is unused.
- **No one to own it.** A cluster without an owner fails on a weekend.
- **You need per-job retries, delays, priorities or cron.** Kafka makes you build all of them.

A good answer sounds like: "Today, Postgres plus an outbox and BullMQ for jobs. When we have several consumers that need the same events, or need replay, put the outbox relay in front of a managed Kafka and keep the producers unchanged."

## Practise on your own

Optional. This needs Docker and Node 24 (the client ships prebuilt binaries for current LTS versions; check its README for your platform).

Start a single-node KRaft broker (it is broker and controller in one container):

```sh
docker run -d --name kafka -p 9092:9092 apache/kafka:4.4.0
docker exec kafka /opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 \
  --create --topic orders.events --partitions 3
```

Set up a project and copy the producer from lesson 2 and the consumer from lesson 1 into `producer.ts` and `consumer.ts`:

```sh
mkdir kafka-practice && cd kafka-practice
npm init -y && npm pkg set type=module
npm install @confluentinc/kafka-javascript
node consumer.ts   # Node 24 runs TypeScript files directly
node producer.ts   # in a second terminal
```

Then try these, and predict the result before you run each one:

1. Produce ten events with three different keys. Check that each key always lands in the same partition.
2. Start two consumers in the same group. Stop one and watch its partitions move to the other.
3. Start a consumer with a new `group.id`. Does it see the old events?
4. Make the handler throw for one specific offset. What happens to that partition and to the lag?
   ```sh
   docker exec kafka /opt/kafka/bin/kafka-consumer-groups.sh \
     --bootstrap-server localhost:9092 --describe --group email-service
   ```
5. Stop the consumers and replay from the start:
   ```sh
   docker exec kafka /opt/kafka/bin/kafka-consumer-groups.sh --bootstrap-server localhost:9092 \
     --reset-offsets --to-earliest --group email-service --topic orders.events --execute
   ```
6. Try a share group. In two terminals run the command below, then produce events and compare with step 2:
   ```sh
   docker exec kafka /opt/kafka/bin/kafka-console-share-consumer.sh \
     --bootstrap-server localhost:9092 --topic orders.events --group jobs
   ```

Remove the broker with `docker rm -f kafka` when you are done.

## Common mistakes

- Adopting Kafka for a single consumer per message, then rebuilding retries and delays that BullMQ or SQS already provide.
- Running a self-managed cluster with no one assigned to operate it.
- Expecting SQS to replay messages it has already delivered and deleted.
- Writing events straight from request handlers to Kafka instead of through an outbox, making a later move between brokers harder.
- Treating share groups as ordered. They are not.

## Go deeper

- [KIP-932: Queues for Kafka](https://cwiki.apache.org/confluence/display/KAFKA/KIP-932%3A+Queues+for+Kafka): the design of share groups, acknowledgements and delivery counts.
- [Amazon SQS Developer Guide](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/welcome.html): standard and FIFO queues, visibility timeout and dead-letter queues.
- [What is BullMQ](https://docs.bullmq.io/): the job-queue features Kafka does not give you.
- [Kafka quickstart](https://kafka.apache.org/quickstart): the official local setup, including the Docker image.
- [Apache Kafka documentation](https://kafka.apache.org/documentation/): operations and configuration, to see what self-hosting involves.
