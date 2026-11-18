After checkout the API sends a receipt email inside the request. When the email provider is slow, checkout is slow; when it is down, receipts are lost. Move the email to a BullMQ job that retries, gives up on errors that can never succeed, and sends each receipt once even when a job runs twice.

## Requirements

Edit `src/receipts.ts`. Keep its exports and types. Import only `bullmq`, `ioredis` and Node built-ins.

**`createReceiptQueue({ redisUrl, prefix, backoffDelayMs? })`** returns a BullMQ `Queue` named `receipts` with BullMQ's `prefix` option set to `` `${prefix}bull` ``. Every job gets 5 attempts and exponential backoff with base delay `backoffDelayMs` (default 1000). Keep completed jobs for at least an hour, and failed jobs until someone removes them.

**`enqueueReceipt(queue, data, { sendAt? })`** adds a job named `receipt` with the id `receipt-<orderId>`, so the same order enqueued twice is one job. With `sendAt`, the job waits until that time.

**`startReceiptWorker({ redisUrl, prefix, mailer, backoffDelayMs?, concurrency? })`** starts a `Worker` (same prefix) and returns `{ worker, close }`. For each job it calls `mailer.send({ to, subject, text, idempotencyKey })` with `idempotencyKey` set to `receipt-<orderId>`.

- `send` rejects: the job fails and BullMQ retries it with backoff.
- `send` rejects with an error whose `retryable` is `false`: the job goes to failed at once, without retries.
- The same order may arrive in several jobs, one after another or at the same time. Exactly one email is sent, and every job completes. Any keys you need start with `prefix` and expire.
- `close()` stops taking new jobs, waits for the running ones to finish, then closes your connections.

## Tests

Write tests in `test/*.test.ts` with `node:test` against the lab Valkey (`VALKEY_URL`, keys under `VALKEY_KEY_PREFIX`), using a fake mailer. They must pass, and fail against a worker that sends every receipt twice and one that treats a failed send as success.

## Submission

`src/`, `test/`, `package.json`, `tsconfig.json` and `README.md`, without `node_modules`.

## What is checked

The checks run `tsc`, then use your queue and worker with a scripted fake mailer: job ids and options, a delayed job, two failures then success (with the gaps between attempts), a mailer that always fails, a permanent error, three jobs for one order, and `close()` during a slow send. Then they run your tests against your code and two broken copies.
