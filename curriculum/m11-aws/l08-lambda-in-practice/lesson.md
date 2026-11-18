---
title: Lambda in practice
skills: [aws-lambda]
---

This lesson is optional: the lab has no Lambda environment, so it comes with cards but no hands-on task. Read it if you expect to write functions soon or want to answer Lambda questions in an interview.

Lesson 7 placed Lambda among the compute options. Here is what writing one involves: the handler and its lifecycle, cold starts, the three triggers you will use most, how timeouts and retries behave for each, how to package TypeScript, and why idempotency matters even more here than in a container.

## The handler and its lifecycle

A Node.js function is a module that exports an async handler. Lambda calls it once per event:

```ts
// src/handler.ts
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

// Init phase: runs once per execution environment, before the first event.
const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const table = process.env.TABLE_NAME!;

type ThumbnailRequested = { imageId: string; width: number };

export const handler = async (event: ThumbnailRequested) => {
  await doc.send(new PutCommand({ TableName: table, Item: { pk: `IMG#${event.imageId}`, sk: 'THUMB', width: event.width } }));
  return { ok: true };
};
```

An **execution environment** is a small micro-VM with your code loaded. Its life has three phases:

1. **Init**: the runtime starts, imports your module and runs top-level code. Create SDK clients, read configuration and open connections here.
2. **Invoke**: the handler runs for one event. The environment handles **one event at a time**; concurrent events get separate environments.
3. **Shutdown**: after a period idle, Lambda discards the environment.

Between invocations the environment is frozen, not destroyed, so module-level state (clients, caches) survives to the next event in the same environment. Treat it as an optimisation, never as storage: you cannot know which environment handles the next event, and timers or promises left running after the handler returns are frozen mid-flight. Await everything before returning.

Current Node runtimes support async handlers only; the old callback style is gone from the newest runtime. Types for events come from the `@types/aws-lambda` package.

## Cold starts

A **cold start** is an invocation that has to wait for the init phase: no idle environment was available, because the function is new, was idle, or traffic grew. For a small, bundled Node function it is typically a few hundred milliseconds. It grows with bundle size, the number of modules imported at start-up, and any network calls in init.

To keep it small:

- Bundle and tree-shake (below), and import only the SDK clients you use.
- Avoid heavy frameworks at start-up. A full NestJS app initialises every module before the first event.
- Do lazy work lazily if only some invocations need it.
- More memory also means more CPU, which shortens init and the invocation itself, often at similar cost.
- If latency at the first request matters, **provisioned concurrency** keeps a number of environments initialised, for a fee.

For queue consumers and scheduled jobs cold starts rarely matter. They matter for user-facing HTTP.

## Triggers

### SQS

An **event source mapping** polls the queue for you (long polling, as in lesson 3) and invokes the function with a batch of up to 10 messages by default, more with a batching window. If the function returns normally, Lambda deletes the whole batch. If it throws, **the whole batch** returns to the queue after the visibility timeout, including messages that succeeded.

Fix that with partial batch responses: enable `ReportBatchItemFailures` on the mapping and return the ids that failed.

```ts
import type { SQSEvent, SQSBatchResponse } from 'aws-lambda';

export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const batchItemFailures: { itemIdentifier: string }[] = [];
  for (const record of event.Records) {
    try {
      await processOrder(JSON.parse(record.body));
    } catch (error) {
      console.error('failed', record.messageId, error);
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
};
```

Set the queue's visibility timeout well above the function timeout (AWS suggests at least six times), keep the redrive policy and DLQ on the queue, and use the mapping's **maximum concurrency** to stop the function from opening more database connections than Postgres allows.

### EventBridge (rules and schedules)

EventBridge invokes the function **asynchronously**: Lambda queues the event internally and returns at once. If the handler throws, Lambda retries it twice by default with delays between attempts, then gives up. Configure an **on-failure destination** (an SQS queue or SNS topic) so the event is kept, and set a maximum event age that suits the job. Scheduled functions (cron or rate expressions through EventBridge Scheduler) use the same path.

### HTTP: API Gateway or function URLs

For HTTP, a **function URL** gives the function its own HTTPS endpoint with no extra service. **API Gateway** (HTTP APIs or REST APIs) adds routing across many functions, authorisers, throttling, custom domains and usage plans. Both invoke the function **synchronously**: the caller waits for the result, and nothing is retried for you. A thrown error becomes a 5xx to the client. API Gateway also enforces its own integration timeout of about half a minute by default, well below Lambda's 15 minutes, so long work belongs behind a queue.

## Timeouts and retries

The function timeout is yours to set, from 1 second up to 15 minutes; the default is short (3 seconds). Set it from the real worst case plus margin, and make the handler's own outbound calls time out earlier, so a slow dependency produces a clean error rather than a killed invocation. `context.getRemainingTimeInMillis()` tells you how much is left.

Who retries depends on the trigger:

| Invocation | Example triggers | Retries |
|---|---|---|
| Synchronous | API Gateway, function URL, SDK `Invoke` | None by Lambda; the caller decides |
| Asynchronous | EventBridge, SNS, S3 | Two retries by Lambda, then the on-failure destination |
| Event source mapping | SQS, Kinesis, DynamoDB Streams | Until success, the record expires, or the queue's DLQ takes it |

## Packaging a TypeScript function

Lambda runs JavaScript, so compile and bundle first. A bundler such as esbuild produces one file with only the code you import:

```sh
npx esbuild src/handler.ts --bundle --platform=node --target=node24 \
  --format=esm --outfile=dist/index.mjs --minify --sourcemap
cd dist && zip -r ../function.zip index.mjs index.mjs.map
```

With the handler setting `index.handler`, Lambda imports `index.mjs` and calls `handler`. The Node runtimes include an AWS SDK v3, so you can mark `@aws-sdk/*` as external to shrink the bundle, but bundling your own pinned version means a runtime update cannot change your SDK under you. Set `NODE_OPTIONS=--enable-source-maps` so stack traces point at your TypeScript.

In practice an IaC tool does the packaging: AWS CDK's `NodejsFunction`, AWS SAM, the Serverless Framework, or OpenTofu with an archive step. Container images up to 10 GB are an alternative for large dependencies.

## Idempotency

Every asynchronous and queue trigger is at least once: Lambda retries on errors, SQS redelivers, EventBridge can deliver twice. A handler that charges a card or sends an email must therefore detect repeats, exactly as in lesson 3. The common Lambda approach is a DynamoDB record per idempotency key, created with `attribute_not_exists` before the work and completed after it, with a TTL. **Powertools for AWS Lambda (TypeScript)** ships an idempotency utility that does this, plus structured logging, metrics and tracing helpers worth adopting in any function.

## Common mistakes

- Creating SDK clients inside the handler, paying the set-up cost on every invocation.
- Leaving promises running after the handler returns; they freeze and may never finish.
- Throwing for one bad message in an SQS batch without `ReportBatchItemFailures`, so the whole batch is retried.
- A queue visibility timeout shorter than the function timeout, causing duplicate processing.
- Keeping the 3-second default timeout, or setting 15 minutes behind API Gateway.
- No on-failure destination for asynchronous invocations, so failed events vanish after two retries.

## Go deeper

- [Building Lambda functions with TypeScript](https://docs.aws.amazon.com/lambda/latest/dg/lambda-typescript.html): handlers, types and packaging.
- [Using Lambda with Amazon SQS](https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html): event source mappings, batching and partial failures.
- [Asynchronous invocation](https://docs.aws.amazon.com/lambda/latest/dg/invocation-async.html): retries, event age and destinations.
- [Powertools for AWS Lambda (TypeScript)](https://docs.powertools.aws.dev/lambda/typescript/latest/): idempotency, logging, metrics and tracing utilities.
