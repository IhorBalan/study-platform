# Order event fan-out

One SNS topic for order events, one SQS queue per consumer. Read the task brief, then finish `src/order-events.ts`.

```sh
pnpm lab up aws                        # from the platform repo, if it is not running
export AWS_ENDPOINT_URL=http://localhost:4566
export AWS_REGION=us-east-1 AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test
export AWS_RESOURCE_PREFIX=dev-
npm install
npm run demo                           # provisions, publishes four events, prints each queue, cleans up
npm run typecheck
```

## Notes

TODO: why each consumer has its own queue instead of subscribing the consumers to the topic directly.

TODO: where the filters match (message attributes or body), and what that asks of every publisher.

TODO: which of these resources belong in infrastructure as code in a real project, and why the app should not create them at start-up.

TODO: how you would build the same routing with EventBridge, and one reason to choose it over SNS here (or not).
