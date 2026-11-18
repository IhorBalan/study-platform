---
title: Asynchronous architecture
skills: [sd-async-architecture]
---

Modules 7 and 8 taught the parts: BullMQ queues and workers, retries with backoff, idempotency keys, the transactional outbox. This lesson is about putting them together in a design: deciding what is asynchronous, chaining the steps so that nothing is lost or done twice, keeping queues from growing without bound, and running scheduled work for many tenants.

## Sync or async: the one question

For each step of an operation, ask: **does the caller need the result of this step to continue?**

- Checking the user's permission, validating input, writing the order row: yes. These stay in the request.
- Sending the confirmation email, generating the PDF, notifying the supplier, updating the search index: no. The caller needs to know they *will* happen, not that they *have*.

Everything in the second group becomes a job or an event. The request records the intent durably and returns. This gives you three things: the response time no longer depends on slow or flaky third parties, failures are retried instead of shown as a 500, and bursts are absorbed by the queue instead of by your API.

It costs you a status the user can see ("PDF generating..."), a worker to run and monitor, and the need to make every step safe to run twice.

## Commands and events

Two shapes of message travel through a design:

- A **command** (a job) says "do this": `send-invoice-email { invoiceId }`. It has one consumer. A queue such as BullMQ or SQS fits.
- An **event** says "this happened": `invoice.finalised { invoiceId }`. Any number of consumers may react, and the producer does not know them. Pub/sub (SNS, EventBridge, module 11) or a log (Kafka, module 17) fits.

In a modular monolith, events are often just rows in an outbox table that a relay turns into jobs for each interested module. You do not need a broker to think in events.

## The reliable chain

Here is the full path of an asynchronous side effect, with the guarantee at each hop:

```text
Request
  └─ one Postgres transaction:
       insert order            ← the business change
       insert outbox row       ← the intent, committed atomically with it
Relay (polls outbox, or listens)
  └─ enqueue job with jobId = outbox row id    ← duplicates collapse
Worker
  └─ handler, idempotent:
       check "already done?" (unique constraint or status)
       call the provider with an idempotency key
       record "done"
```

Each arrow can fail and be retried, so each receiver must tolerate duplicates. That is the whole trick. Writing to the database and then calling `queue.add()` without the outbox is the dual-write bug from module 8: a crash between the two loses the job, and the order exists without its email. The outbox makes the intent part of the transaction.

Delivery between hops is at least once. You get the effect of "exactly once" only by making the handler idempotent: a unique constraint on `(order_id, kind)` in a `sent_emails` table, a status column that moves forward only, or an idempotency key the provider honours.

## What if a worker crashes halfway?

A worker that dies mid-job leaves the job locked. BullMQ notices the lock has expired and marks it stalled, then runs it again; SQS makes the message visible again after the visibility timeout. So the question becomes: is it safe to run the first half again?

Design jobs so that it is:

- **Small jobs.** "Email 5,000 users" becomes one fan-out job that enqueues 5,000 small jobs, each idempotent. A crash repeats one email, not 2,500.
- **Checkpoints.** A long export writes its progress (`last_processed_id`) and resumes from it.
- **Side effects last, and keyed.** Compute everything first, then perform the external call with an idempotency key, then record completion.

## Backpressure: keep queues bounded

A queue hides a slow consumer until it does not. If 100 jobs arrive per second and workers finish 80, the queue grows by 1,200 jobs a minute forever. Little's law tells you what that means for users: the wait in a queue is the number of jobs in it divided by the throughput. 30,000 waiting jobs at 80 per second is a six-minute delay for the newest one.

Backpressure means slowing the producer instead of letting the queue grow:

- **Measure the queue:** depth, and more importantly the **age of the oldest job**. Alert on age; it is what users feel.
- **Limit concurrency per dependency.** If the email provider accepts 50 requests a second, set a rate limit on that worker (BullMQ's `limiter` is global across all workers of a queue).
- **Push back at the edge.** When a queue passes a threshold, the API returns `429` or `503` with `Retry-After` for non-urgent work, or degrades a feature, instead of accepting work it cannot finish today.
- **Shed or merge.** Ten "rebuild search index for workspace 7" jobs can be one job, using a fixed `jobId` per workspace.
- **Isolate.** One queue per kind of work, so slow PDF generation cannot delay password-reset emails.

### One noisy tenant

In a shared queue, a tenant who imports 200,000 rows enqueues 200,000 jobs and everyone else waits behind them. Fairness options, from simple to elaborate:

- A separate queue (and worker pool) for bulk work.
- A per-tenant cap on jobs in flight, checked when enqueueing; excess work waits in a per-tenant table and is moved to the queue as capacity frees up.
- Round-robin: enqueue each tenant's work in small batches, alternating between tenants.

The same idea applies to outbound webhooks (module 10, lesson 7): one customer's endpoint that times out for 30 seconds must not slow deliveries to every other customer. Give deliveries a per-endpoint concurrency limit and short timeouts, and pause endpoints that keep failing.

## Scheduled work

Recurring work ("every night at 03:00", "the first of the month in the customer's time zone") has traps that a plain `setInterval` in the API walks into.

- **One scheduler, not N.** A cron library inside the API runs once per instance. Use a scheduler with a single source of truth: BullMQ job schedulers (`queue.upsertJobScheduler`), a platform cron that calls an endpoint, or a database table.
- **Schedule, then fan out.** The scheduled job should be tiny: "find the tenants due now and enqueue one job each". The heavy work runs as normal, retried, idempotent jobs.
- **Idempotent per period.** A key like `digest:{tenantId}:2026-11-18` means a re-run, a retry or a duplicate trigger produces one digest.
- **Time zones and daylight saving.** Store the schedule and the zone (`Europe/Berlin`), compute the next run in UTC, and decide what happens to a 02:30 run on the night the clocks skip it.
- **Catch-up.** After an outage, do you run every missed occurrence, only the latest, or none? Decide per job.
- **Thundering top of the hour.** Thousands of schedules at `0 * * * *` all fire at once. Add a per-tenant offset, or let the fan-out enqueue over a window.

When schedules are customer-defined and numerous, a Postgres table is often the clearest scheduler:

```sql
-- each worker claims due schedules without blocking the others
with due as (
  select id from schedules
  where next_run_at <= now() and paused = false
  order by next_run_at
  limit 100
  for update skip locked
)
update schedules s
set next_run_at = s.next_run_at + s.run_interval, last_enqueued_at = now()
from due where s.id = due.id
returning s.id, s.tenant_id;
```

`for update skip locked` lets several workers poll the same table: each row is claimed by exactly one of them, and nobody waits for anybody's lock. Real schedules use cron expressions rather than a fixed interval, so the next run is computed in code, but the claiming pattern is the same.

For long, multi-step processes with waits ("trial ends in 14 days, then email, then downgrade"), a durable workflow engine (module 7, lesson 7) may be clearer than a chain of jobs.

## Common mistakes

- Writing to the database and the queue separately, without an outbox.
- Non-idempotent handlers on an at-least-once queue.
- Monitoring queue depth but not the age of the oldest job.
- One shared queue for everything, so bulk work delays urgent work.
- A cron schedule inside every API instance.
- Large jobs that cannot resume, so a crash or deploy restarts hours of work.

## Go deeper

- [BullMQ: Job Schedulers](https://docs.bullmq.io/guide/job-schedulers): repeatable work with one source of truth.
- [BullMQ: Rate limiting](https://docs.bullmq.io/guide/rate-limiting): the global limiter for protecting a downstream.
- [PostgreSQL: SELECT, the locking clause](https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE): `FOR UPDATE SKIP LOCKED` and its guarantees.
- [Google SRE book: Addressing Cascading Failures](https://sre.google/sre-book/addressing-cascading-failures/): load shedding, queue management and retries.
