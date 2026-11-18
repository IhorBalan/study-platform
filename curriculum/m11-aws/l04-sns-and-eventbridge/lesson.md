---
title: Fan-out with SNS and EventBridge
skills: [aws-fan-out]
---

A queue connects one producer to one kind of consumer. Real events have several audiences: when an order is paid, the email service sends a receipt, the warehouse reserves stock and analytics counts revenue. The producer should not know that list, and adding a fourth audience should not mean redeploying checkout. SNS and EventBridge solve this by **publish-subscribe**: the producer publishes once, and the service delivers a copy to everyone who subscribed. This lesson covers both, how to combine them with SQS, and how to pick one.

## SNS: topics and subscriptions

An SNS **topic** is a named fan-out point. **Subscriptions** attach endpoints to it: SQS queues, Lambda functions, HTTPS endpoints, email, SMS, mobile push. A publish delivers a copy to every subscription whose filter matches.

```ts
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';

const sns = new SNSClient({});
await sns.send(new PublishCommand({
  TopicArn: process.env.ORDER_EVENTS_TOPIC_ARN,
  Message: JSON.stringify({ type: 'order.paid', orderId: 'o_42', totalCents: 129_00, country: 'DE' }),
  MessageAttributes: {
    type: { DataType: 'String', StringValue: 'order.paid' },
    totalCents: { DataType: 'Number', StringValue: '12900' },
  },
}));
```

SNS does not store messages. If a subscriber is down, SNS retries for a while, and then the message is gone for that subscriber unless you configured a dead-letter queue on the subscription. That is why the standard pattern puts a queue behind each subscriber.

## SNS to SQS: the fan-out pattern

Give each consumer its own SQS queue and subscribe each queue to the topic:

```text
                    ┌──> SQS email-receipts ──> email worker
checkout ──> SNS ───┼──> SQS warehouse      ──> warehouse worker
   order-events     └──> SQS analytics      ──> analytics worker
```

Each consumer gets its own buffer, its own retries, its own DLQ and its own pace. A slow warehouse does not delay receipts. Adding a consumer is a new queue and a new subscription, with no change to checkout.

Two settings make it work:

- **The queue policy.** SNS is a separate service, so the queue's resource policy must allow `sqs:SendMessage` from the principal `sns.amazonaws.com`, limited with an `aws:SourceArn` condition to your topic (lesson 2). Without the policy, real AWS silently drops the deliveries. The local emulator does not check this, which is exactly how such a bug reaches production.
- **Raw message delivery.** By default SNS wraps your message in a JSON envelope (`Type`, `MessageId`, `TopicArn`, `Message` as a string, signature fields). With `RawMessageDelivery: 'true'` on the subscription, the SQS body is your message exactly as published, and message attributes become SQS message attributes. Turn it on unless a consumer needs the envelope.

```ts
await sns.send(new SubscribeCommand({
  TopicArn: topicArn,
  Protocol: 'sqs',
  Endpoint: emailQueueArn,              // the queue's ARN, not its URL
  Attributes: { RawMessageDelivery: 'true' },
  ReturnSubscriptionArn: true,
}));
```

`CreateTopic`, `CreateQueue` and `Subscribe` with the same arguments are idempotent: calling them again returns the existing resource. That makes setup code safe to rerun. `Subscribe` with the same endpoint but **different** attributes fails instead, so change an existing subscription with `SetSubscriptionAttributes`.

## Filter policies

Without a filter, every subscriber gets every message and throws most of them away. A **filter policy** on the subscription lets SNS drop them for you, and you pay nothing for deliveries that were filtered out.

```json
{
  "type": ["order.paid", "order.refunded"],
  "totalCents": [{ "numeric": [">=", 100000] }],
  "country": [{ "anything-but": ["US"] }]
}
```

Keys are combined with AND, values in a list with OR. Besides exact strings there are `prefix`, `suffix`, `anything-but`, `numeric` ranges, `exists` and others. By default (`FilterPolicyScope: MessageAttributes`) the policy matches **message attributes**, so the publisher must set them; a missing attribute never matches. With `FilterPolicyScope: MessageBody` it matches fields of a JSON body instead, including nested ones, and the publisher does not need to duplicate data into attributes.

Filtering at the subscription is also a contract: the subscription states in one place which events a consumer wants.

## EventBridge: an event router

EventBridge is a different shape of the same idea. Producers put **events** on an **event bus**. **Rules** on the bus match events with **patterns** and send them to up to five **targets** each: SQS, Lambda, Step Functions, API destinations (any HTTPS API), another bus, and more.

Events have a fixed envelope. You supply `source`, `detail-type` and a JSON `detail`; EventBridge adds `id`, `time`, `account` and `region`.

```ts
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

const eb = new EventBridgeClient({});
const res = await eb.send(new PutEventsCommand({
  Entries: [{
    EventBusName: 'shop',
    Source: 'shop.orders',
    DetailType: 'OrderPaid',
    Detail: JSON.stringify({ orderId: 'o_42', totalCents: 129_00 }),
  }],
}));
if (res.FailedEntryCount) throw new Error('some events were not accepted');
```

Like SQS batches, `PutEvents` can partly fail without throwing. Check `FailedEntryCount`.

A rule's pattern uses the same matching language as SNS body filters, applied to the whole envelope:

```json
{
  "source": ["shop.orders"],
  "detail-type": ["OrderPaid"],
  "detail": { "totalCents": [{ "numeric": [">=", 100000] }] }
}
```

The target receives the full event envelope, with your data under `detail`. An **input transformer** on the target can reshape it if a consumer needs something else.

What EventBridge adds over SNS:

- **Routing by content, centrally.** Rules live on the bus, so you can see in one place which consumer receives which event.
- **AWS and SaaS events.** The default bus receives events from AWS services (an ECS task stopped, an S3 object created) and partner sources such as Stripe or Auth0 can deliver to a partner bus.
- **Archive and replay.** Keep events and replay a time range into the bus, for example after fixing a consumer.
- **A schema registry** that can discover event shapes and generate types.
- **Schedules.** EventBridge Scheduler runs one-off or cron schedules that call a target, which replaces "a server with a cron job" for things like "send a reminder in three days".

What it costs you: per-event pricing that is higher than SNS, at most five targets per rule, a soft limit on `PutEvents` throughput per region, and typically somewhat higher latency than SNS. For a high-volume internal stream SNS is cheaper; for a moderate number of business events that many teams consume, EventBridge is easier to govern.

Targets need permission too: for an SQS target, the queue policy must allow `events.amazonaws.com`, again with `aws:SourceArn` set to the rule's ARN.

## When to use which

| Need | Use |
|---|---|
| One producer, one kind of worker, buffer and retry | SQS |
| Same message to several consumers, high volume, low cost | SNS, with an SQS queue per consumer |
| Route by content across teams, react to AWS or SaaS events, replay | EventBridge, with SQS targets for consumers that need buffering |
| Run something at a time or on a schedule | EventBridge Scheduler |
| Ordered stream that consumers re-read, long retention | Kafka or Kinesis (module 17) |

The common interview answer compresses this: **SQS is a queue (one consumer group pulls), SNS is a broadcast (push to many subscribers), EventBridge is a router (rules decide who gets which event).** Most production designs end with SQS in front of every worker, whichever of the other two does the fanning out.

Ordering and duplicates do not improve on the way through. Standard SNS and EventBridge deliver at least once and without a guaranteed order, so the idempotent consumer from the last lesson is still required. SNS FIFO topics paired with SQS FIFO queues exist for the cases where per-group order is the point.

Finally, combine fan-out with the outbox from module 8: write the event to the outbox in the order transaction, and let the relay call `Publish` or `PutEvents`. Publishing straight from the request handler brings the dual-write problem back.

## Common mistakes

- Subscribing a queue without a queue policy for `sns.amazonaws.com`, so real AWS drops every delivery.
- Forgetting `RawMessageDelivery`, then parsing an SNS envelope in every consumer.
- A filter on message attributes that the publisher never sets.
- Subscribing a Lambda or HTTPS endpoint directly to a busy topic, with no buffer when the consumer is slow or down.
- Ignoring `FailedEntryCount` from `PutEvents`.
- Publishing from the request handler instead of from an outbox relay.

## Go deeper

- [SNS message filtering](https://docs.aws.amazon.com/sns/latest/dg/sns-message-filtering.html): filter policy syntax, scopes and operators.
- [Fan-out to SQS queues](https://docs.aws.amazon.com/sns/latest/dg/sns-sqs-as-subscriber.html): subscriptions, queue policies and raw delivery.
- [EventBridge event patterns](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-event-patterns.html): the matching language for rules.
- [EventBridge Scheduler](https://docs.aws.amazon.com/scheduler/latest/UserGuide/what-is-scheduler.html): one-off and recurring schedules with targets.
