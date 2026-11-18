---
title: Hosted jobs and durable workflows compared
skills: [durable-workflows, background-jobs]
---

BullMQ runs one step well: take a job, run a handler, retry it if it fails. Real processes often have several steps with waits between them. "After a trial starts: send a welcome email, wait 3 days, send tips if the user has not created a project, wait until day 14, charge the card, and if that fails, retry over a week and then downgrade." You can build this from jobs that enqueue the next job, but you end up writing a state machine by hand, storing its state, and debugging it across ten job types. A class of tools exists to remove that work. This lesson places them next to the queues you know, so that you can choose with reasons.

## The options

### A queue on Redis or Valkey: BullMQ

You run Valkey and the workers. Jobs are single steps, with retries, delays, schedules, priorities, rate limits and parent-child flows. It is fast, cheap and well understood, and the earlier lessons cover it. Multi-step state lives in your database and your code.

### A queue in Postgres: pg-boss and friends

pg-boss stores jobs in tables in the PostgreSQL you already run and takes them with `SELECT ... FOR UPDATE SKIP LOCKED`, which lets many workers pick different rows without blocking each other. The big advantage is transactions: you can insert the order and enqueue its receipt job in **the same transaction**, so either both happen or neither does. With BullMQ that same pair is a dual write that can half-fail (module 8's outbox pattern exists for exactly that). The costs: throughput is lower than Valkey's (comfortably thousands of jobs a minute, not tens of thousands a second), and job traffic adds load and vacuum work to your main database.

```ts
import { PgBoss } from 'pg-boss';

const boss = new PgBoss(process.env.DATABASE_URL!);
boss.on('error', console.error);
await boss.start();
await boss.createQueue('receipts');
await boss.send('receipts', { orderId: 'o1' });
await boss.work('receipts', async ([job]) => {
  console.log('sending receipt for', job.data);
});
```

For a small team that already runs Postgres and does not run Redis, "just use Postgres" is often the right first answer.

### Hosted durable functions: Inngest and Trigger.dev

You write functions in your own codebase; a hosted service stores their state, schedules them, retries them and shows every run in a dashboard. Both have a local dev server, and both can be self-hosted, but most teams use the cloud service.

- **Inngest** functions are triggered by events and made of **steps**. Each `step.run` result is saved; when the function resumes after a sleep or a failure, finished steps are not run again, their saved results are returned. Inngest calls your app over HTTP, so functions can live in a serverless app.

```ts
import { Inngest } from 'inngest';

export const inngest = new Inngest({ id: 'shop' });

export const trialFlow = inngest.createFunction(
  { id: 'trial-flow', triggers: { event: 'app/trial.started' } },
  async ({ event, step }) => {
    await step.run('send-welcome', () => sendWelcome(event.data.userId));
    await step.sleep('wait-for-tips', '3d');
    await step.run('send-tips', () => sendTipsIfIdle(event.data.userId));
  },
);
```

- **Trigger.dev** (v4) defines **tasks** with `task({ id, retry, run })` and runs them on its own machines, not inside your serverless function, so long tasks are not cut off by a function timeout. `wait.for({ days: 3 })` pauses a run without using compute.

The appeal is speed: no queue infrastructure, retries and schedules by configuration, and a UI for every run that you would otherwise build. The costs are a vendor in your critical path, pricing per run or step, your data passing through their service, and a dependency on their uptime.

### Self-run or managed durable execution: Temporal

Temporal is the heavyweight. You write **workflows** (orchestration code) and **activities** (the side effects: HTTP calls, database writes). Activities get timeouts and retry policies; workflows can sleep for months, wait for signals and survive any number of worker crashes. Temporal records every event in a workflow's history and rebuilds its state by **replaying** the workflow code against that history. That is why workflow code must be deterministic: no `Date.now()`, no random numbers, no direct I/O, only calls through the SDK (the TypeScript SDK runs workflows in a deterministic sandbox).

```ts
import { proxyActivities, sleep } from '@temporalio/workflow';
import type * as activities from './activities.ts';

const { sendWelcome, chargeCard } = proxyActivities<typeof activities>({
  startToCloseTimeout: '30s',
  retry: { initialInterval: '10s', maximumAttempts: 5 },
});

export async function trialWorkflow(userId: string): Promise<void> {
  await sendWelcome(userId);
  await sleep('14 days');
  await chargeCard(userId);
}
```

A client starts it with ``client.workflow.start(trialWorkflow, { taskQueue: 'trials', workflowId: `trial-${userId}`, args: [userId] })``; the workflow id makes the start idempotent. You run workers; the Temporal service itself is either self-hosted (a real cluster with its own database to operate) or Temporal Cloud. The power is real, and so is the learning curve and the operational weight.

## How to choose

| Need | Good fit |
| --- | --- |
| Single-step background work, Redis or Valkey already running | BullMQ |
| Single-step work, only Postgres, and jobs must commit with your data | pg-boss |
| Multi-step flows with waits, small team, fine with a vendor | Inngest or Trigger.dev |
| Long-running, business-critical workflows, many services, strict control | Temporal (Cloud, or self-hosted with a platform team) |
| Serverless app without long-running workers | Inngest, Trigger.dev or a cloud queue (SQS, module 11) |
| Very high event volume, many consumers of the same stream | A log such as Kafka (module 17), not a job queue |

Questions that decide it:

1. **How many steps, and how long between them?** One step: a queue. Several, with days in between and state to carry: a workflow engine starts paying for itself.
2. **What do you already operate?** Adding Valkey just for jobs, or a Temporal cluster for three workflows, is cost you carry every day.
3. **Must the job commit with your data?** Then a Postgres queue, or an outbox in front of whichever queue you use.
4. **Where may your data go?** Hosted services see job payloads. Pass ids, not personal data.
5. **What does it cost at 10 times the volume?** Per-step pricing and self-hosted infrastructure grow differently.

None of these make your side effects exactly-once. Every option here retries, so every activity, step and job handler still needs to be idempotent, with the same techniques as in the BullMQ lesson.

## Common mistakes

- Building a multi-step state machine out of chained BullMQ jobs, without stored state or a way to see where each instance is.
- Adopting Temporal for a handful of emails, and spending more time operating it than on the product.
- Non-deterministic code in a Temporal workflow (`Date.now()`, `Math.random()`, `fetch`), which breaks replay.
- Side effects outside `step.run` in Inngest, which run again every time the function resumes.
- Putting personal data in job payloads sent to a hosted service.
- Assuming a workflow engine removes the need for idempotent side effects.

## Go deeper

- [BullMQ documentation](https://docs.bullmq.io/): flows, schedulers and the production guide.
- [pg-boss](https://github.com/timgit/pg-boss): the README covers queues, retries and `SKIP LOCKED`.
- [Inngest documentation](https://www.inngest.com/docs): steps, sleeps, events and the dev server.
- [Trigger.dev documentation](https://trigger.dev/docs): tasks, retries, waits and self-hosting.
- [Temporal documentation](https://docs.temporal.io/): workflows, activities, determinism and Temporal Cloud.
