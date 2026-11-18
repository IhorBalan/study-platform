---
title: "RabbitMQ: a broker with routing"
skills: [rabbitmq-basics]
---

Lesson 5 compared Kafka with SQS, BullMQ and Postgres. RabbitMQ is the other name that comes up in that interview question, and it sits between them. Like BullMQ and SQS it is a **queue**: a message is delivered to one consumer and deleted once acknowledged. Unlike them, the producer never writes to a queue directly. It publishes to an **exchange**, and rules called **bindings** decide which queues get a copy. That routing layer is what RabbitMQ is good at.

## The AMQP 0-9-1 model

RabbitMQ's classic protocol is AMQP 0-9-1, and its model has five parts. (RabbitMQ 4 also speaks AMQP 1.0 as a core protocol; most Node code still uses 0-9-1.)

```text
producer --publish(exchange, routingKey)--> [exchange] --bindings--> [queue] --> consumer
```

- A **producer** publishes a message to an exchange, with a **routing key** such as `order.eu.paid`.
- An **exchange** stores nothing. It looks at the routing key (or headers) and copies the message to every matching queue.
- A **binding** links a queue to an exchange, with a pattern.
- A **queue** stores messages until a consumer acknowledges them.
- A **consumer** subscribes to a queue. Several consumers on one queue are **competing consumers**: each message goes to one of them.

Fan-out to several services is a binding per service, decided by whoever owns the queue. The producer does not change. That is SNS plus SQS in one broker.

## Exchange types

- **direct**: delivers to queues whose binding key equals the routing key exactly.
- **fanout**: ignores the key and delivers to every bound queue.
- **topic**: keys are dot-separated words; in a binding, `*` matches exactly one word and `#` matches zero or more.
- **headers**: matches on message headers instead of the key, with `x-match` set to `all` or `any`.

A topic exchange `orders` with three queues:

| Binding | `order.eu.paid` | `order.us.paid` | `order.eu.refunded` |
|---|---|---|---|
| `email.orders` bound with `order.*.paid` | yes | yes | no |
| `eu.reports` bound with `order.eu.#` | yes | no | yes |
| `audit` bound with `#` | yes | yes | yes |

There is also the **default exchange**: a direct exchange with an empty name, to which every queue is bound automatically by its own name. Publishing to `''` with routing key `email.orders` lands in that queue. That is what `sendToQueue` does, and why "hello world" tutorials seem to skip exchanges.

A message that matches no binding is **dropped silently**, unless you publish with `mandatory: true` (the broker returns it) or give the exchange an alternate exchange.

## Acknowledgements and prefetch

With manual acknowledgement, the broker keeps a delivered message as "unacked" until the consumer answers:

- `ack`: done, delete it.
- `nack` with requeue: put it back to be delivered again (with the `redelivered` flag set).
- `nack` without requeue (or `reject`): drop it, or **dead-letter** it if the queue has a dead-letter exchange.

If the channel or connection closes with messages unacked, they all go back to the queue. That is RabbitMQ's version of BullMQ's stalled jobs or SQS's visibility timeout.

**Prefetch** limits how many unacked messages a consumer may hold. It is your back-pressure: with `prefetch(20)` a slow consumer stops receiving once it has 20 in flight, and the rest wait in the queue for other consumers. Without a prefetch, the broker pushes as fast as the network allows, and one consumer can buffer thousands of messages in memory. Auto-ack mode (`noAck: true`) removes the safety net entirely: a message counts as delivered as soon as it is sent.

## Durability needs three things

To survive a broker restart, you need all of these:

1. A **durable queue** (the queue definition survives).
2. A **persistent message** (`persistent: true`, delivery mode 2), so the message is written to disk.
3. **Publisher confirms**, so the producer knows the broker has taken responsibility. Without them, a message lost in transit or during a crash looks exactly like a sent one.

A confirm channel tells you, per message, when the broker has accepted it, which for a persistent message on a durable queue means it is on disk (or replicated, for quorum queues). On a quorum queue every message is written to disk whatever `persistent` says, so point 2 matters for classic queues; set it anyway, so the code does not depend on the queue type.

Confirms say nothing about routing: an unroutable message is still confirmed, which is another reason to use `mandatory`.

## Dead letters and retry with delay

A queue declared with a **dead-letter exchange** (DLX) republishes a message there when it is rejected without requeue, when its TTL expires, when the queue exceeds its length limit, or when a quorum queue's delivery limit is reached. The broker adds an `x-death` header recording why and how many times.

RabbitMQ has no built-in "retry in 30 seconds". The common pattern combines TTL and DLX:

```text
email.orders  --nack, no requeue--> DLX --> email.orders.retry (x-message-ttl 30000)
email.orders.retry --TTL expires--> its DLX: '' (default exchange), key email.orders --> email.orders
```

The consumer reads the `x-death` count, and after a few rounds publishes the message to a parking queue instead. Use a fixed TTL per retry queue rather than a TTL per message: messages expire only when they reach the head of the queue, so one long delay holds up shorter ones behind it. The community **delayed message exchange** plugin adds an exchange type with a per-message `x-delay` header; its delays are held on one node and are not replicated, and it is not built for large numbers of delayed messages, so read its README before you rely on it.

## Queue types

- **Classic queues** live on one node. Fine for transient or rebuildable data.
- **Quorum queues** replicate each queue across nodes with the Raft protocol and are the recommended choice for data you cannot lose. They are always durable, and they count deliveries: with a delivery limit (RabbitMQ 4 sets one by default), a poison message that keeps being requeued is dead-lettered, or dropped, instead of looping forever. Declare with `arguments: { 'x-queue-type': 'quorum' }`. Classic queue mirroring, the old way to replicate, is gone in RabbitMQ 4.
- **Streams** are an append-only log inside RabbitMQ: reads do not remove messages, and consumers choose an offset to start from and can replay. They are RabbitMQ's answer to the Kafka use case, with less ecosystem around them.

## Delivery and ordering

Delivery is **at least once**. A consumer that crashes after its side effect but before `ack` gets the message again, and so does another consumer after a requeue. Make handlers idempotent, as in module 7: a `messageId` set by the producer, a unique constraint, or an idempotency key at the provider.

A queue is FIFO, but processing order is not. With competing consumers, message 2 can finish before message 1. A requeued message is delivered again after newer ones may already have been processed. If order per entity matters, use a single consumer (a queue can enforce one with `x-single-active-consumer`) or partition by key into several queues, which is the problem Kafka's partitions already solve.

## In Node with amqplib

`amqplib` is the standard Node client for AMQP 0-9-1 and ships its own types. Declaring topology from code is normal; `assert*` calls are idempotent but fail if an existing queue has different arguments.

A broker restart or a network blip closes the connection and every channel on it. Consumers then stop without any error in your handler, and a connection with no `'error'` listener ends the Node process. amqplib 2 has opt-in **recovery**: pass a `recovery` option to `connect` and it reconnects with backoff, then calls your `setup` function after every successful connect. Put everything that lives on a channel in `setup`: topology, consumers and the publisher's channel.

```ts
import {
  connect,
  type Channel,
  type ChannelModel,
  type ConfirmChannel,
  type ConsumeMessage,
} from 'amqplib';

const MAX_ROUNDS = 3;
let pub: ConfirmChannel; // replaced after every reconnect

const conn = await connect(process.env.AMQP_URL ?? 'amqp://localhost', {
  recovery: {
    async setup(model: ChannelModel) {
      const ch = await model.createChannel();
      await ch.assertExchange('orders', 'topic', { durable: true });
      await ch.assertExchange('orders.dlx', 'fanout', { durable: true });
      await ch.assertQueue('email.orders', {
        durable: true,
        deadLetterExchange: 'orders.dlx',
        arguments: { 'x-queue-type': 'quorum' },
      });
      await ch.assertQueue('email.orders.parked', {
        durable: true,
        arguments: { 'x-queue-type': 'quorum' },
      });
      await ch.bindQueue('email.orders', 'orders', 'order.*.paid');

      await ch.prefetch(20);
      await ch.consume('email.orders', (msg) => {
        if (msg) void handle(ch, msg); // null: the broker cancelled this consumer
      });

      pub = await model.createConfirmChannel();
    },
  },
});
conn.on('disconnect', (err) => console.warn('RabbitMQ disconnected', err.message));
```

The retry queue from the previous section (`email.orders.retry`, bound to `orders.dlx`) is declared the same way. The handler acknowledges, retries or parks:

```ts
async function handle(ch: Channel, msg: ConsumeMessage) {
  try {
    const event = JSON.parse(msg.content.toString());
    await sendReceipt(event.orderId, msg.properties.messageId); // idempotent
    ch.ack(msg);
  } catch {
    const rounds = Number(msg.properties.headers?.['x-death']?.[0]?.count ?? 0);
    if (rounds >= MAX_ROUNDS) {
      // Give up: keep the message where a person can look at it, then remove it here.
      ch.sendToQueue('email.orders.parked', msg.content, { ...msg.properties, persistent: true });
      ch.ack(msg);
    } else {
      ch.nack(msg, false, false); // no requeue: dead-letter it into the retry loop
    }
  }
}
```

Publishing uses the confirm channel:

```ts
const event = { type: 'OrderPaid', orderId: 'order-1042' };
pub.publish('orders', 'order.eu.paid', Buffer.from(JSON.stringify(event)), {
  persistent: true,
  messageId: 'order-1042-paid',
  contentType: 'application/json',
});
await pub.waitForConfirms(); // rejects if the broker nacked a message
```

`publish` returns `false` when the client's write buffer is full; wait for the channel's `drain` event before publishing more. A message published but not yet confirmed when the connection drops may or may not have arrived: publish it again after the reconnect and let the consumer's idempotency absorb the duplicate.

## RabbitMQ, Kafka, BullMQ or SQS

| | RabbitMQ | Kafka | BullMQ / pg-boss | SQS (+ SNS) |
|---|---|---|---|---|
| Model | Broker with exchanges and queues | Partitioned log | Job queue in Valkey / Postgres | Managed queue (+ fan-out) |
| After ack | Deleted (except streams) | Retained; replay by offset | Deleted or trimmed | Deleted |
| Routing | Rich: direct, topic, headers, fanout | By topic and key only | By queue name | SNS filter policies |
| Retries and delays | DLX, TTL, plugins | You build them | Built in | Visibility timeout, DLQ, delay |
| Throughput | High; one queue caps out, so spread load over several | Highest, sustained | High for jobs; pg-boss moderate | Scales without you |
| Operations | A cluster, or Amazon MQ / CloudAMQP | A cluster, or a managed service | Valkey or Postgres you already run | None |

Choose RabbitMQ when messages need **flexible routing** to many queues, you want a broker that is not tied to one cloud, and you do not need long retention or replay. It also suits teams with mixed languages, since AMQP clients exist everywhere. Choose Kafka when several systems read the same stream and replay matters (lesson 5). Choose BullMQ or pg-boss for background jobs in a Node app with delays, priorities and schedules. Choose SQS and SNS on AWS when you want no servers at all.

## Common mistakes

- Durable queue but non-persistent messages, or persistent messages without publisher confirms.
- No prefetch, so one consumer hoards the queue and runs out of memory.
- Requeueing on every error, so a poison message loops forever (use a quorum queue's delivery limit or a DLX).
- Publishing with a routing key nobody binds and never noticing the messages are dropped.
- Assuming queue order means processing order with several consumers.
- No reconnect handling: after a broker restart the consumer is gone and nothing in your code notices.
- Dead-lettering every failure into a retry loop without counting rounds, so a broken message circles forever.
- Changing a queue's arguments in code and expecting the broker to update the existing queue.

## Go deeper

- [RabbitMQ documentation](https://www.rabbitmq.com/docs): the reference, including exchanges, queues and the AMQP 0-9-1 model.
- [Consumer acknowledgements and publisher confirms](https://www.rabbitmq.com/docs/confirms): what ack, nack and confirms guarantee.
- [Quorum queues](https://www.rabbitmq.com/docs/quorum-queues): replication, delivery limits and when to use them.
- [Dead letter exchanges](https://www.rabbitmq.com/docs/dlx): every reason a message is dead-lettered.
- [RabbitMQ tutorials](https://www.rabbitmq.com/tutorials): the routing patterns step by step, with JavaScript examples using amqplib.
