Checkout publishes order events. Three consumers want them, each a different subset: analytics wants everything, the email service wants paid and cancelled orders, and fraud review wants only large paid orders. Build the fan-out with one SNS topic and one SQS queue per consumer, so that SNS does the routing and no consumer has to throw events away.

## Requirements

Edit `src/order-events.ts`. Keep its exported types and names. Import only `@aws-sdk/client-sns`, `@aws-sdk/client-sqs` and Node built-ins, and call AWS only through the clients you are given.

**`provisionOrderEvents({ sns, sqs }, prefix)`** creates, and returns as `{ topicArn, queues: { analytics, email, fraud } }` (each queue as `{ url, arn }`):

- the topic `<prefix>order-events`;
- the queues `<prefix>analytics`, `<prefix>email` and `<prefix>fraud`;
- for each queue, an access policy that allows `sqs:SendMessage` from the service principal `sns.amazonaws.com` on that queue, with an `aws:SourceArn` condition naming the topic;
- one subscription per queue, with raw message delivery and these filters:

| Queue | Receives |
| --- | --- |
| analytics | every event |
| email | `order.paid` and `order.cancelled` |
| fraud | `order.paid` with `totalCents` of at least 100000 |

Running it twice must return the same resources and leave exactly three subscriptions.

**`publishOrderEvent(sns, topicArn, event)`** publishes the event as JSON. The body that arrives in a queue must be exactly that JSON. Set whatever your filters need.

**`destroyOrderEvents({ sns, sqs }, prefix)`** deletes the subscriptions, the topic and the three queues. Calling it when they are already gone must not throw.

The checks pass a prefix that starts with `AWS_RESOURCE_PREFIX`. The SDK reads `AWS_ENDPOINT_URL`, `AWS_REGION`, `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` from the environment; create the SQS client with `useQueueUrlAsEndpoint: false`. `npm run demo` shows the routing against the emulator.

## Submission

`src/`, `package.json`, `tsconfig.json` and `README.md`, without `node_modules`. Answer the four notes in `README.md`.

## What is checked

The checks run `tsc`, provision with a fresh prefix, read back names, subscriptions and queue policies, publish five events (including one at exactly 100000 cents and a large `order.placed`) and read every queue, provision a second time, and finally provision and destroy a separate set. The review reads where the routing lives, the queue policy and your notes.
