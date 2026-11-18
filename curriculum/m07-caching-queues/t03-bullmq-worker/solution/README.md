# Receipt worker

```sh
export VALKEY_URL=redis://localhost:56379 VALKEY_KEY_PREFIX=dev:
npm install && npm test && npm run typecheck
```

## Notes

**One email per order.** The job id `receipt-<orderId>` stops most duplicates at enqueue time, but BullMQ delivers at least once: a worker can crash after sending and before the job is marked complete, and the job runs again. So the handler checks a `receipt-sent:<orderId>` key first, claims the order with `SET NX PX` so two jobs running at once do not both send, and records the send with a 30-day TTL. A window remains: a crash between `send()` and recording it. The retry then sends again, and the provider drops it because the idempotency key is the same. Without a provider key, that window is the price of at-least-once.

**Errors.** Errors are retried unless the mailer marks them `retryable: false`, which become `UnrecoverableError`. Nothing is caught and ignored.

**Retention.** Completed jobs are kept for a day: long enough to inspect, and the jobId dedupe only works while the old job exists. Failed jobs are kept until someone looks: in BullMQ the failed set is the dead-letter queue, and it should be on a dashboard and an alert.

**NestJS.** With `@nestjs/bullmq`, the queue is registered with `BullModule.registerQueue` and the handler is a `WorkerHost` class decorated with `@Processor('receipts')`. Without it, a provider creates the worker in `onModuleInit` and calls `close()` in `onApplicationShutdown`; `app.enableShutdownHooks()` makes Nest run that on SIGTERM. Run workers as a separate process (same code, different entry point), so a burst of jobs cannot slow the API.

**Another platform?** BullMQ is right for a single retried step with Redis already in the stack. If receipts became a multi-step flow (charge, wait for the warehouse, wait three days, send a review request) with state across steps, a durable workflow engine fits better: Inngest or Trigger.dev if we want it hosted and serverless-friendly, Temporal if we need long-running workflows under our own control and can run (or pay for) its cluster.
