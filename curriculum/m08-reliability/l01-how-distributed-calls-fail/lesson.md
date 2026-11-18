---
title: How distributed calls fail
skills: [failure-handling]
---

In a browser, a failed `fetch` is usually someone else's problem: show a toast, let the user click again. On the server, the caller is your own code, the user is waiting behind it, and a request that hangs holds memory, a socket and often a database connection. This module is about making failure predictable. It starts with the fact that changes everything: across a network, you often cannot know whether a call failed.

## Partial failure

Inside one process, a function call either returns or throws. Across a network there is a third outcome: nothing comes back. When your service calls a payment provider and the call times out, any of these may be true:

1. The request never reached the provider.
2. The provider received it and crashed before doing the work.
3. The provider did the work, and the response was lost on the way back.
4. The provider is still working and will finish in two seconds.

From your side all four look the same. This is **partial failure**: one part of the system fails while the others carry on, and no part has the full picture. Module 4 met this problem at the HTTP level and solved it with idempotency keys. This module looks at what it means for everything your backend calls: other APIs, the database, queues and caches.

Two consequences follow, and the rest of the module builds on them:

- **A timeout is not a "no".** After a timeout you must assume the work might have happened. Retrying is only safe when the operation is idempotent.
- **You cannot get "exactly once" from the network.** You choose between at-most-once (never retry, sometimes lose work) and at-least-once (retry, sometimes do the work twice). Systems that advertise "exactly once" deliver at-least-once and make the receiver ignore duplicates. Exactly-once *processing* is at-least-once delivery plus idempotency.

## Timeouts everywhere

A call without a timeout can wait forever. Node's `fetch` gives up only when the underlying undici client's own limits hit, which are measured in minutes. `pg` waits for a free pool connection forever by default, and Postgres runs a statement as long as it takes. Every one of those waits holds resources, and under load they pile up until the process falls over. One slow dependency then takes down every endpoint that shares the pool, not only the one that calls it.

Put a timeout on every hop:

| Hop | Where to set it |
| --- | --- |
| Outgoing HTTP | `AbortSignal.timeout(ms)` passed to `fetch` |
| Waiting for a pooled connection | `connectionTimeoutMillis` on the `pg` pool |
| A query | `statement_timeout`, per role, per connection or per transaction |
| A forgotten open transaction | `idle_in_transaction_session_timeout`, and `transaction_timeout` (Postgres 17 and later) |
| Valkey or Redis | `commandTimeout` and `connectTimeout` in ioredis |
| The incoming request itself | server or load balancer timeout |

```ts
import pg from 'pg';

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  connectionTimeoutMillis: 2_000,                  // waiting for a free client
  options: '-c statement_timeout=5000 -c idle_in_transaction_session_timeout=10000',
});
```

**How long?** Measure first. A good starting point is a little above the dependency's p99 latency under normal load. If a call usually takes 80 ms and its p99 is 400 ms, a 1 second timeout cuts off only the stuck calls. A timeout near the median turns ordinary slow requests into errors and retries, which add load exactly when the dependency is struggling.

## Deadlines: one budget for the whole request

Per-call timeouts are not enough on their own. If your handler calls three services in turn, each with a 2 second timeout and two retries, the worst case is 18 seconds, long after the client or the load balancer gave up. The work continues for nobody.

A **deadline** fixes this. The request gets one budget when it arrives, and every call inside it gets whatever is left:

```ts
export async function getDashboard(userId: string, signal: AbortSignal) {
  // signal is the request's deadline, created once at the edge.
  const profile = await fetch(`${USERS}/users/${userId}`, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(1_000)]),
  });
  const orders = await fetch(`${ORDERS}/orders?user=${userId}`, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(1_500)]),
  });
  return { profile: await profile.json(), orders: await orders.json() };
}

// At the edge: a 3 second budget for the whole request.
const deadline = AbortSignal.timeout(3_000);
await getDashboard('u_42', deadline);
```

`AbortSignal.any()` returns a signal that aborts as soon as any of its inputs does, so each call stops at its own timeout or at the request deadline, whichever comes first. When a call is cut off, `fetch` rejects with a `DOMException` whose `name` is `TimeoutError` for a timeout signal and `AbortError` for a plain `abort()`. A network failure, such as a reset connection, is a `TypeError` with the real reason in `error.cause`. Telling these apart is what the next lesson's retry policy is built on.

The same idea crosses service boundaries. gRPC sends the deadline in a header and every server honours it. Over plain HTTP you can do the same with a header of your own (for example the remaining milliseconds), so the downstream service does not keep working after you stopped waiting.

It is also worth cancelling work when the client goes away. If the browser closes the tab, Express emits `close` on the response before it finishes. Abort a controller on that event and pass its signal down, and a dropped request stops its database queries and outgoing calls instead of running to the end.

```ts
app.get('/users/:userId/dashboard', async (req, res) => {
  const gone = new AbortController();
  res.on('close', () => { if (!res.writableFinished) gone.abort(); });
  const signal = AbortSignal.any([gone.signal, AbortSignal.timeout(3_000)]);
  res.json(await getDashboard(req.params.userId, signal));
});
```

## Aborting is not undoing

An abort stops *your* waiting. It does not reach into the other machine and stop the work. If the payment provider received your request, aborting the `fetch` closes the socket, and the charge may still go through. A Postgres query is the exception that proves the rule: `statement_timeout` runs inside the server, so the server really stops. For everything else, after a timeout or abort the state of the other side is unknown, and you are back at the four cases above.

That is why the order of the next lessons matters. Timeouts make failure fast. Retries recover from it. Idempotency makes the retries safe.

## Where state goes when a process dies

Partial failure also happens inside your own service. A deploy sends `SIGTERM`, the process has 10 or 30 seconds before `SIGKILL`, and every request in flight at that moment stops wherever it is. Module 0 showed graceful shutdown: stop accepting connections, let running requests finish. That reduces the damage but cannot remove it, because a crash, an out-of-memory kill or a lost container gives no warning at all.

So look at any multi-step handler and ask, for each line, "what if the process dies right after this line?":

```ts
await stripe.charges.create(...);     // charged
// <- process dies here
await db.insert(orders).values(...);  // never written
```

The customer paid and there is no order. No amount of `try`/`catch` helps, because no code runs after a `SIGKILL`. The fixes are structural: do the risky step in a way that can be repeated safely, record intent before acting, and have something that finishes or undoes half-done work later. Lessons 3 to 5 cover exactly those.

## Common mistakes

- Calling `fetch` or a database without a timeout because "it is usually fast".
- Per-call timeouts that add up to more than the client will wait, with no overall deadline.
- Treating a timeout as a failure that did not happen, and retrying a payment without an idempotency key.
- Timeouts set near the median latency, which turn normal variance into errors.
- Believing an abort cancels work on the remote side.
- Assuming `try`/`finally` cleans up after a crash. Nothing runs after `SIGKILL`.

## Go deeper

- [MDN: AbortSignal.any()](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/any_static): combining a deadline with per-call timeouts.
- [MDN: AbortSignal.timeout()](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static): the `TimeoutError` it produces.
- [PostgreSQL: Client connection defaults](https://www.postgresql.org/docs/current/runtime-config-client.html): `statement_timeout`, `lock_timeout` and the transaction timeouts.
- [Amazon Builders' Library: Timeouts, retries and backoff with jitter](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/): how AWS picks timeout values.
