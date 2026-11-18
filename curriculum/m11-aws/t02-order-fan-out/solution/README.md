# Order event fan-out

One SNS topic for order events, one SQS queue per consumer, routed by filter policies.

```sh
pnpm lab up aws
export AWS_ENDPOINT_URL=http://localhost:4566
export AWS_REGION=us-east-1 AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test
export AWS_RESOURCE_PREFIX=dev-
npm install
npm run demo
npm run typecheck
```

## Notes

**A queue per consumer.** SNS does not store messages. A consumer subscribed directly loses events while it is down or slow, and its failures would be retried by SNS on SNS's schedule. With its own queue, each consumer has a buffer, its own retries and DLQ, and its own pace: a slow fraud check never delays receipts, and adding a consumer touches nothing that exists.

**Where the filters match.** On message attributes (the default scope). `publishOrderEvent` therefore always sets `type` (String) and `totalCents` (Number). A publisher that forgets them sends events that match no filter, so email and fraud would silently get nothing. The alternative, `FilterPolicyScope: MessageBody`, matches the JSON body and removes that duty from publishers; I kept attributes because they are visible without parsing and the filter does not depend on the body's shape.

**Infrastructure as code.** The topic, queues, policies, subscriptions and DLQs belong in OpenTofu or CDK: reviewed, the same in staging and production, and created with an admin role in the pipeline. If the app created them at start-up, its runtime role would need `sns:CreateTopic`, `sqs:CreateQueue` and `sqs:SetQueueAttributes`, which is far more than publishing needs, and two versions of the app could fight over filter policies during a deploy. Here `provisionOrderEvents` exists so tests and the demo can build a disposable copy.

**With EventBridge.** A custom bus `shop`, events with `source: shop.orders` and `detail-type` set to the event type, and one rule per consumer: analytics matches `source` only, email matches `detail-type: [OrderPaid, OrderCancelled]`, fraud matches `OrderPaid` with `detail.totalCents: [{ numeric: [">=", 100000] }]`. Each rule targets the consumer's queue, whose policy allows `events.amazonaws.com` for that rule's ARN. EventBridge would win if other teams consume these events, if we want archive and replay, or if AWS or SaaS events join the same routing. For three internal consumers at high volume, SNS is cheaper and simpler.
