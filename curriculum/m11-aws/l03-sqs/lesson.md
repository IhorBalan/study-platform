---
title: "SQS: queues and reliable consumers"
skills: [aws-sqs]
---

Amazon SQS is the queue you get on AWS without running anything: no Redis to size, no broker to patch, practically unlimited throughput, and you pay per request. Module 7 taught queues with BullMQ and module 8 the outbox that feeds them. The ideas carry over (at-least-once delivery, retries, dead letters, idempotent handlers), but SQS has its own mechanics, and a worker that ignores them processes messages twice or loses them. This lesson covers those mechanics and builds a worker loop in Node.

## How a message moves through a queue

A producer calls `SendMessage`. A consumer calls `ReceiveMessage` and gets up to 10 messages. SQS does **not** remove them. It hides them for the queue's **visibility timeout** (30 seconds by default) and hands the consumer a **receipt handle** for each. Then:

- The consumer finishes and calls `DeleteMessage` with the receipt handle. The message is gone.
- The consumer crashes, or throws, or takes longer than the timeout. The message becomes visible again and another receive gets it. Its `ApproximateReceiveCount` goes up by one.

That is the whole reliability model: **a message is deleted only by an explicit delete after success**. Nothing is ever acknowledged automatically. It is also why delivery is **at least once**: if your handler finishes but the delete fails, or the timeout runs out a moment before the delete, the message comes back and runs again. Standard queues can also, rarely, deliver a message twice on their own.

## Standard vs FIFO

| | Standard | FIFO (`name.fifo`) |
|---|---|---|
| Order | Best effort | Strict within a **message group** |
| Duplicates | Occasional | Deduplicated within a 5-minute window |
| Throughput | Practically unlimited | Limited per queue (higher with high-throughput mode) |

FIFO queues need a `MessageGroupId` on each message. Messages in one group are delivered in order, one batch at a time; different groups are processed in parallel. Use the entity id (`orderId`, `accountId`) as the group, so events for one order stay in order while thousands of orders proceed at once. A deduplication id (or content-based deduplication) drops a repeated send within five minutes.

FIFO does **not** give you exactly-once processing. A consumer can still crash after doing the work and before the delete. Your handler must be idempotent either way, so most systems use standard queues and make the handler tolerate duplicates and reordering, keeping FIFO for the cases where order is the point.

## Long polling

`ReceiveMessage` with `WaitTimeSeconds: 0` (short polling) returns at once, often empty, and queries only a subset of SQS's servers, so it can even return nothing when messages exist. A loop of empty short polls is a stream of billed requests that do nothing.

Set `WaitTimeSeconds` to 20, the maximum. The call waits until a message arrives or 20 seconds pass, checks every server, and costs one request per 20 idle seconds. You can set it per call or as the queue's `ReceiveMessageWaitTimeSeconds`.

## Visibility timeout, done properly

Choose the visibility timeout from your handler's worst case, not its average. If processing normally takes 2 seconds and sometimes 90, a 30-second timeout means the slow message is redelivered while it is still being processed, and two workers run it at once.

For handlers whose duration varies, extend the timeout while you work: a **heartbeat** calls `ChangeMessageVisibility` every half timeout for each message in progress.

```ts
const beat = setInterval(() => {
  sqs.send(new ChangeMessageVisibilityCommand({ QueueUrl, ReceiptHandle, VisibilityTimeout: 30 }))
    .catch(() => undefined);
}, 15_000);
try { await handle(message); } finally { clearInterval(beat); }
```

The same call lets you choose **when a failed message comes back**. Instead of waiting for the full timeout, set the visibility of a failed message to a backoff delay, for example `base * 2 ** (receiveCount - 1)` seconds, capped. Setting it to `0` releases the message immediately, which is what you want on shutdown for a message you never started.

## Dead-letter queues and redrive

A message that fails every time (a bug, a malformed body, a deleted customer) would cycle forever. A **redrive policy** on the source queue moves it to a **dead-letter queue** after `maxReceiveCount` receives:

```ts
await sqs.send(new SetQueueAttributesCommand({
  QueueUrl: ordersUrl,
  Attributes: {
    RedrivePolicy: JSON.stringify({ deadLetterTargetArn: ordersDlqArn, maxReceiveCount: 5 }),
  },
}));
```

The move happens inside SQS. Your worker's only job is to **not delete** failed messages. Then alarm on the DLQ's `ApproximateNumberOfMessagesVisible` being above zero; a DLQ nobody watches is a slow data loss. Once the bug is fixed, **redrive** moves the messages back to the source queue (the console's "Start DLQ redrive", or `StartMessageMoveTask` in the API). Keep the DLQ's retention longer than the source queue's, because a message's age carries over.

Be careful with a low `maxReceiveCount`: a heartbeat that fails, or a short outage of a dependency, can push healthy messages into the DLQ. Five is a reasonable start.

## Idempotent consumers

Because delivery is at least once, the handler must produce the same effect when it runs twice. The techniques from module 8 apply directly:

- **Natural idempotency**: `SET status = 'shipped'` is safe to repeat; `balance = balance + 10` is not.
- **A processed-messages record** keyed by a business id from the body (`orderId`, an event id), written in the same transaction as the effect, or claimed with a conditional write.
- **Idempotency keys passed downstream**, such as Stripe's `Idempotency-Key`, so a repeated call to an external API is ignored by the provider.

Key the record on a business id, not on the SQS `MessageId`: a producer that retries a send creates a second message with a new `MessageId` and the same content.

## Batching

Batch APIs cut requests, and therefore cost and latency, by up to ten times: `SendMessageBatch`, `DeleteMessageBatch`, `ChangeMessageVisibilityBatch`, each with up to 10 entries. A batch call can **partly fail**: it returns `Successful` and `Failed` lists rather than throwing. Check `Failed` and retry or log those entries; a delete that silently failed is a duplicate later.

## A worker loop with graceful shutdown

```ts
import {
  SQSClient, ReceiveMessageCommand, DeleteMessageCommand, type Message,
} from '@aws-sdk/client-sqs';

const sqs = new SQSClient({ useQueueUrlAsEndpoint: false });
const queueUrl = process.env.ORDERS_QUEUE_URL!;
const abort = new AbortController();
let stopping = false;

async function handle(message: Message) {
  const event = JSON.parse(message.Body ?? '');
  console.log('processing', event.orderId);
}

async function run() {
  while (!stopping) {
    let messages: Message[] = [];
    try {
      const res = await sqs.send(new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 20,
        MessageSystemAttributeNames: ['ApproximateReceiveCount'],
      }), { abortSignal: abort.signal });
      messages = res.Messages ?? [];
    } catch (error) {
      if (stopping) break;                       // the long poll was aborted on purpose
      console.error('receive failed', error);
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }
    await Promise.all(messages.map(async (m) => {
      try {
        await handle(m);
        await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: m.ReceiptHandle }));
      } catch (error) {
        console.error('message failed, leaving it for redelivery', m.MessageId, error);
      }
    }));
  }
}

const done = run();
process.once('SIGTERM', async () => {
  stopping = true;
  abort.abort();          // end the 20-second long poll now
  await done;             // let messages in progress finish and be deleted
  process.exit(0);
});
```

Three details make this correct. The delete happens only after the handler succeeds. A failure is logged and left alone, so SQS redelivers it and eventually dead-letters it. And `SIGTERM` (what ECS and Kubernetes send before killing a container) stops new receives, aborts the long poll so the process does not hang for 20 seconds, and waits for work in progress. Your platform's stop timeout (30 seconds by default on ECS) must be longer than your slowest handler.

What this loop still lacks, and the practice task adds: a heartbeat for slow messages, a backoff for failures, and a way to stop that the test can call.

If you would rather not write the loop, Lambda's SQS trigger runs it for you (lesson 8), and libraries such as `sqs-consumer` wrap it for long-running services.

## Common mistakes

- Deleting the message before the work is done, or in a `finally`, so failures are lost.
- A visibility timeout shorter than the slowest handler, causing parallel duplicate processing.
- Short polling in a loop: empty, billed responses.
- No redrive policy, so a poison message is retried forever; or a DLQ with no alarm.
- Ignoring the `Failed` list of a batch call.
- Treating FIFO as exactly-once and skipping idempotency.
- Using `MessageId` as the idempotency key when producers can resend.

## Go deeper

- [Visibility timeout](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html): in-flight messages, limits and extending the timeout.
- [Short and long polling](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-short-and-long-polling.html): why `WaitTimeSeconds` matters.
- [Dead-letter queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html): redrive policies, retention and redrive back to the source.
- [FIFO queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-fifo-queues.html): message groups, deduplication and throughput.
