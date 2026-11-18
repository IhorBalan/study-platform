---
title: Structured logging with pino
skills: [structured-logging]
---

Logs are the signal you reach for first when a customer says "it broke at 14:07". They are only useful if you can find the lines for that customer's request among millions, and if they do not contain anything you would be embarrassed to see leaked. This lesson builds a logger that writes JSON, ties every line to a request without passing ids around, and keeps secrets out.

## Why pino

`console.log` writes text, has no levels worth the name, and formats synchronously on the main thread. **pino** writes one JSON object per line, is designed to be cheap (it does as little as possible in the process and leaves pretty-printing and shipping to other tools), and is the logger behind Fastify and the common NestJS integrations. Winston is the other popular choice; it is more configurable and slower. The ideas here apply to both.

```ts
import { pino } from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'orders-api' },
});

logger.info({ orderId: 'o_81', amount: 4200 }, 'order created');
// {"level":30,"time":1795016483748,"service":"orders-api","orderId":"o_81","amount":4200,"msg":"order created"}
```

The first argument holds the fields, the second the message. Keep messages constant ("order created", not "order o_81 created") so you can count them, and put the variable parts in fields.

In development, pipe the output through `pino-pretty` for readable colours. In production, write JSON to stdout and let the platform collect it. A container should not manage log files; Docker, Kubernetes, Fly or Railway already capture stdout and ship it.

## Levels

pino's levels are numbers: `trace` 10, `debug` 20, `info` 30, `warn` 40, `error` 50, `fatal` 60. A logger at `info` drops everything below 30 before it is formatted, so `logger.debug(...)` costs almost nothing in production.

Use them consistently, because alerts and filters depend on it:

- **error**: something failed and someone may need to act. An unhandled exception, a payment that could not be recorded.
- **warn**: something unexpected that the code handled. A retry, a 4xx caused by a client, a deprecated route being used.
- **info**: business events and one summary line per request.
- **debug**: detail for diagnosing a problem, off by default.

A good request summary uses the status: `info` for 2xx and 3xx, `warn` for 4xx, `error` for 5xx. Then "show me all errors" is a filter on `level >= 50`.

## Errors

Pass errors under the `err` key. pino's default serializer turns them into `type`, `message` and `stack`, plus any extra properties:

```ts
try {
  await db.query(sql);
} catch (err) {
  logger.error({ err, orderId }, 'order query failed');
  throw err;
}
```

`logger.error(err.message)` loses the stack. `logger.error({ error: err })` under another key serialises to `{}`, because an `Error`'s properties are not enumerable.

## Child loggers

`logger.child(fields)` returns a logger that adds those fields to every line. Use it for things that do not change within a scope: a component name, a job id inside a worker.

```ts
const log = logger.child({ component: 'payments' });
log.warn({ provider: 'stripe', status: 502 }, 'payment failed');
// {"level":40,...,"component":"payments","provider":"stripe","status":502,"msg":"payment failed"}
```

## Request ids and AsyncLocalStorage

To find all lines of one request, every line needs the request's id. Passing a child logger through every function signature works but spreads plumbing everywhere. Node's `AsyncLocalStorage` gives you request-scoped context instead, the backend equivalent of React context: set a value at the top, read it anywhere below, across `await`s, without threading it through props.

```ts
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import { pino } from 'pino';

const context = new AsyncLocalStorage<{ reqId: string }>();

export const logger = pino({
  // Called for every line; its result is merged into the line.
  mixin: () => ({ reqId: context.getStore()?.reqId }),
});

const SAFE_ID = /^[A-Za-z0-9._:-]{1,64}$/;

export const requestContext: RequestHandler = (req, res, next) => {
  const incoming = req.get('x-request-id');
  const reqId = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader('x-request-id', reqId);
  const started = performance.now();
  res.on('finish', () => {
    const status = res.statusCode;
    const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
    logger[level](
      { reqId, method: req.method, route: req.route?.path ?? 'unmatched', status, durationMs: performance.now() - started },
      'request completed',
    );
  });
  context.run({ reqId }, next);
};
```

Three details matter here:

- `context.run(store, next)` runs the rest of the middleware chain inside the store. Any code that the chain awaits or schedules later sees the same store, even when requests interleave.
- The `finish` event fires from the socket, outside that context, so the summary line passes `reqId` itself.
- The incoming id is **validated**. A client controls that header, and it is copied into every log line. Without a check, a client can inject newlines and fake JSON lines, or send a megabyte that you then store a thousand times.

Reusing an incoming `x-request-id` lets a load balancer or the frontend set the id, and lets support ask a customer for it. Many teams send the id back in the response and show it on error pages ("Reference: 3f2a…"). Once you add tracing (lesson 4), log the trace id as well, which plays the same role across services.

## Redaction and what not to log

Logs are copied to several systems, kept for weeks, and read by more people than your database. Treat them as semi-public.

Never log:

- passwords, password hashes, one-time codes;
- session cookies, bearer tokens, API keys, webhook secrets;
- full card numbers or bank details;
- whole request or response bodies, because they contain whatever a form collects;
- personal data you do not need. An email address in logs is personal data under GDPR, with all the deletion obligations that brings. Log the user id instead.

The first defence is at the call site: pass the fields you need, not `req.body` or `req.headers`. The second is pino's `redact` option, a safety net for the mistake someone makes later:

```ts
const logger = pino({
  redact: {
    paths: ['password', '*.password', 'req.headers.authorization', 'req.headers.cookie'],
    censor: '[Redacted]',
  },
});

logger.info({ user: { email: 'a@example.com', password: 'hunter2' } }, 'signup');
// ..."user":{"email":"a@example.com","password":"[Redacted]"},"msg":"signup"
```

Paths are exact, and `*` matches one level. `*.password` does not reach `body.user.password`. That is why redaction cannot be the only defence.

## Logging in NestJS

NestJS has its own `Logger` class, used by the framework for start-up messages and unhandled exceptions. You have three options:

1. **Nest's built-in JSON mode.** `new ConsoleLogger({ json: true })` passed as the `logger` option to `NestFactory.create` makes Nest write JSON lines. Simple, but you add request context yourself.
2. **pino behind Nest's logger interface.** Write a small class that implements `LoggerService` and forwards to pino, and pass it to `app.useLogger()`. Create the app with `bufferLogs: true` so early framework messages are not lost before your logger is ready.
3. **A community integration** such as `nestjs-pino`, which combines `pino-http` (request logging) with a Nest module and request-scoped context. Check that its current release supports your Nest version.

Whichever you choose, the request middleware above works unchanged in Nest: register it with `app.use()` or in a module's `configure(consumer)`. Put it first, so even requests that a guard rejects get a summary line. An interceptor would miss them, because guards run before interceptors.

## Common mistakes

- Variable data in the message (`"order ${id} created"`) instead of in fields, so lines cannot be counted.
- Logging an error as `err.message`, or under a key other than `err`, and losing the stack.
- Storing the request id in a module-level variable. Concurrent requests overwrite each other.
- Trusting an incoming request id without checking its length and characters.
- Logging `req.body` or `req.headers` "for debugging" and relying on redaction to catch everything.
- Writing log files inside a container instead of stdout.

## Go deeper

- [pino documentation](https://getpino.io/): options, child loggers, redaction and transports.
- [Node.js: AsyncLocalStorage](https://nodejs.org/api/async_context.html): the API behind request context.
- [NestJS: Logger](https://docs.nestjs.com/techniques/logger): JSON mode, custom loggers and `bufferLogs`.
- [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html): what to log, what to exclude, and log injection.
