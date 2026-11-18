# SQS worker

A worker loop for SQS with long polling, a heartbeat, retry delays and a graceful stop.

```sh
pnpm lab up aws
export AWS_ENDPOINT_URL=http://localhost:4566
export AWS_REGION=us-east-1 AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test
export AWS_RESOURCE_PREFIX=dev-
npm install
npm test
npm run typecheck
```

## Notes

**Visibility, heartbeat and retry delay.** A received message is hidden for the queue's visibility timeout. While the handler runs, a timer calls `ChangeMessageVisibility` every half timeout to push the deadline out again, so a slow message is never handed to a second worker. On success the message is deleted. On failure it is not: its visibility is set to `retryBaseSeconds * 2^(receiveCount - 1)`, capped at `maxRetryDelaySeconds`, so it returns after a growing delay. The queue's redrive policy moves it to the DLQ after `maxReceiveCount` receives; the worker never deletes a failed message.

**SIGKILL halfway.** The message is neither deleted nor extended. When the visibility timeout runs out it is delivered again, possibly after part of the work happened (a row written, an email sent). The same is true when the delete call fails after a success. So the handler must be idempotent: key its effects on a business id from the body (not `MessageId`), with a conditional write or a unique constraint in the same transaction as the effect.

**Next to a NestJS API.** Run the worker as its own process from the same image (a second ECS service with `node dist/worker.js` as the command), so it scales on queue depth and a slow batch never competes with HTTP requests. Inside Nest, create it in a provider's `onApplicationBootstrap` and call `stop()` in `onApplicationShutdown`, with `app.enableShutdownHooks()` so SIGTERM reaches it. The ECS stop timeout must be longer than the slowest handler.

**When Lambda's SQS trigger is better.** When the work is short and bursty, or the queue is idle most of the day: the event source mapping does the polling, batching, deleting and scaling, and costs nothing when idle. With `ReportBatchItemFailures` it retries only failed messages. A container loop is better for steady load, long handlers, or when the handler needs a warm connection pool.

**Limitation.** A batch is processed in parallel and the next receive waits for the whole batch, so one slow message delays the others in its batch. A fixed-size pool of in-flight messages would fix that.
