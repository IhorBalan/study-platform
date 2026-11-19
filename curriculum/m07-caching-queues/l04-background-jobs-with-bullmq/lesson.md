---
title: Background jobs with BullMQ
skills: [background-jobs]
---

Some work does not belong inside an HTTP request: sending email, resizing images, calling a slow partner API, generating a report. The user should not wait for it, and a failure should be retried rather than shown as a 500. A job queue lets the request record "this needs doing" and return, while separate workers do the work, retry it and report it. In a Node stack the default queue is BullMQ, which stores its queues in Redis or Valkey.

## When to move work into a job

Move work out of the request when any of these hold:

- It is **slow** compared with the response time you want (anything over a few hundred milliseconds).
- It **calls something unreliable** that you would retry: email, SMS, webhooks, third-party APIs.
- It is **bursty**: 10,000 thumbnails after one upload of a ZIP should be worked through at a steady rate, not all at once.
- It is **scheduled**: every night, or 3 days after sign-up.

The cost is real: the result is no longer available in the response, failures happen out of sight, and you now run and monitor workers. Do not queue work that takes 20 ms and must succeed for the response to make sense.

## Queues, jobs and workers

A **queue** is a named list of jobs in Valkey. A **job** has a name, JSON data and options. A **worker** is a process that takes jobs from the queue and runs your handler. Producers and workers share only Valkey, so they can be the same app or different deployments.

```ts
import { Queue, UnrecoverableError, Worker } from 'bullmq';

const connection = { url: process.env.VALKEY_URL ?? 'redis://localhost:56379' };
const prefix = `${process.env.VALKEY_KEY_PREFIX ?? 'dev:'}bull`;

type ResizeJob = { imageId: string; width: number };

export const images = new Queue<ResizeJob>('images', {
  connection,
  prefix,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 1000, jitter: 0.5 },
    removeOnComplete: { age: 24 * 3600, count: 1000 },
    removeOnFail: false,
  },
});

// In a request handler: record the work and return 202.
await images.add('resize', { imageId: 'img_1', width: 640 }, { jobId: 'resize-img_1-640' });
```

```ts
const worker = new Worker<ResizeJob>(
  'images',
  async (job) => {
    if (job.data.width <= 0) throw new UnrecoverableError('invalid width');
    await job.updateProgress(50);
    return { url: `https://cdn.example.com/${job.data.imageId}-${job.data.width}.webp` };
  },
  { connection, prefix, concurrency: 10 },
);
worker.on('error', (error) => console.error(error)); // an unhandled 'error' event would crash the process
```

The handler's return value is stored on the job. A thrown error marks the attempt as failed. `concurrency` is how many jobs one worker runs at a time; for I/O-bound work, 10 to 50 is normal. CPU-heavy handlers block the event loop for every job in that process, so run them in sandboxed processors (a separate file) or with low concurrency.

If you pass your own ioredis instance instead of `{ url }`, a worker's connection needs `maxRetriesPerRequest: null`, and BullMQ warns when it is missing. The Valkey instance needs `maxmemory-policy noeviction` and, for anything you cannot lose, AOF persistence.

## Retries and backoff

`attempts: 5` means one try and up to four retries. Between them, `backoff` waits: `fixed` waits the same delay each time, `exponential` waits `delay × 2^(n-1)`: 1 s, 2 s, 4 s, 8 s here. `jitter: 0.5` picks a random delay between 50% and 100% of that, so that 1,000 jobs that failed together during an outage do not all retry in the same second.

Not every error deserves a retry. A 503 from the email provider will probably pass; "mailbox does not exist" never will. Throw `UnrecoverableError` for those, and the job goes straight to failed. Decide this in one place, by error type or status code.

## Delayed, scheduled and deduplicated jobs

- `delay: 60_000` runs a job no earlier than a minute from now. Use it for "send a reminder in 3 days".
- **Job schedulers** create jobs on a cron pattern or interval. `upsertJobScheduler` is idempotent, so every instance can call it at start-up and there is still one schedule:

```ts
await images.upsertJobScheduler('nightly-cleanup', { pattern: '0 3 * * *' }, { name: 'cleanup' });
```

- A custom `jobId` makes `add` a no-op while a job with that id exists (custom ids may not contain `:`). The `deduplication` option does the same with a TTL, without fixing the id.

## Delivery is at least once

A worker holds a **lock** on each active job and renews it while the handler runs. If the process dies, or blocks its event loop for longer than `lockDuration` (30 s by default), the lock expires, the job is declared **stalled**, and another worker runs it again. A crash after your handler sent the email but before BullMQ recorded completion has the same effect. So BullMQ, like SQS and almost every queue, delivers **at least once**. "Exactly once" in practice means **at least once plus an idempotent handler**.

An idempotent handler gives the same outcome when it runs twice:

- Use a natural key: `INSERT ... ON CONFLICT (order_id) DO NOTHING`, or an upsert.
- Record what you did with `SET sent:<orderId> 1 NX EX <days>`, and know what the position of that line means. Recorded **before** the side effect, a crash or a failed send after the `SET` loses the email for good (at most once). Recorded **after**, two runs that overlap can both send (at least once). The usual pattern uses both: take a short claim key with a TTL before sending and release it if the send fails, write the `sent` marker after, and rely on the next point to cover a crash between the two.
- Pass an idempotency key to the provider (Stripe, most email APIs accept one), so a repeat call is dropped on their side.
- Prefer "set the state to X" over "add 1".

## Dead letters

When a job runs out of attempts it moves to the **failed** set with its error and stack trace, and with `removeOnFail: false` it stays there. That set is your dead-letter queue: put it on a dashboard (Bull Board or Taskforce.sh), alert when it grows, and give operators a way to retry (`job.retry()`) after a fix. If another system must handle permanent failures, add them to a separate queue from the worker's `failed` event when `job.attemptsMade` has reached `job.opts.attempts`.

## Graceful shutdown

On a deploy the platform sends `SIGTERM`. `worker.close()` stops taking new jobs and waits for the running ones to finish; `worker.close(true)` does not wait, and those jobs come back later as stalled. Close the worker before your own connections, and keep handlers shorter than the platform's grace period (often 30 s).

```ts
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await worker.close();
    await images.close();
    process.exit(0);
  });
}
```

## Using it from NestJS

The `@nestjs/bullmq` package wires this into Nest's modules. `BullModule.forRoot({ connection, prefix })` sets the shared options, `BullModule.registerQueue({ name: 'images' })` registers a queue, `@InjectQueue('images')` gives a service the `Queue`, and a consumer is a provider decorated with `@Processor('images')` that extends `WorkerHost` and implements `process(job)`. Call `app.enableShutdownHooks()` in `main.ts` so Nest closes the workers on `SIGTERM`.

Run consumers in a separate process from the API: the same codebase with a second entry point (for example `NestFactory.createApplicationContext(WorkerModule)`, which starts no HTTP server). Then a burst of jobs cannot slow down requests, and you scale the two separately.

## Common mistakes

- No `attempts` (the default is 1), so a single network blip loses the job.
- Retrying errors that can never succeed, or swallowing errors so BullMQ thinks the job worked.
- Handlers that are not idempotent, under a queue that delivers at least once.
- `removeOnFail: true`, so failed jobs disappear without anyone seeing them.
- Blocking the event loop in a handler until locks expire and jobs run twice.
- Running BullMQ on a Valkey with LRU eviction or no persistence.

## Go deeper

- [BullMQ documentation](https://docs.bullmq.io/): the guide, from queues to flows.
- [BullMQ: retrying failing jobs](https://docs.bullmq.io/guide/retrying-failing-jobs): attempts, backoff strategies and custom backoff.
- [BullMQ: going to production](https://docs.bullmq.io/guide/going-to-production): persistence, eviction, connections and shutdown.
- [BullMQ: graceful shutdown](https://docs.bullmq.io/guide/workers/graceful-shutdown): what `close()` waits for.
- [NestJS: queues](https://docs.nestjs.com/techniques/queues): `@nestjs/bullmq`, processors and queue injection.
