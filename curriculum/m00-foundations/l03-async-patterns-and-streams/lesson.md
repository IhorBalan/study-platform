---
title: Async patterns and streams
skills: [async-control-flow, node-streams]
---

You already write `async`/`await` in React code. On the server the syntax is the same but the stakes differ: an unhandled rejection can take the process down, an unbounded `Promise.all` can exhaust a connection pool, and a call without a timeout can hold a request open for minutes. This lesson covers the patterns that keep asynchronous server code under control.

## Errors and unhandled rejections

A promise that rejects with no handler attached triggers `unhandledRejection`. By default Node prints the error and exits with a non-zero code. That default is right: the process is in an unknown state. Do not silence it with an empty handler. Find the floating promise instead.

The usual cause is a promise nobody awaits:

```ts
app.on('order', (order) => {
  sendReceipt(order); // rejection has nowhere to go
});
```

Either `await` it inside a `try`/`catch`, or attach `.catch` and log. One more trap: `return somePromise` inside a `try` block does not catch its rejection, because the function returns before the promise settles. Write `return await somePromise` when the surrounding `catch` or `finally` must see the outcome.

## Running things concurrently

`await` in a loop runs tasks one after another. To run them together, start them all and then wait:

- `Promise.all(promises)` resolves with every result in input order, or rejects with the first failure. It does **not** stop the other tasks. They keep running, and their results are discarded.
- `Promise.allSettled(promises)` never rejects. It returns `{ status, value | reason }` for each input. Use it when partial success is meaningful, such as notifying several webhooks.
- `Promise.race` and `Promise.any` settle with the first settled and the first fulfilled promise respectively.

## Limiting concurrency

`Promise.all(ids.map(fetchUser))` with 5,000 ids opens 5,000 requests at once. The database pool, the upstream API or your own memory will object. Bound the number in flight. The core of a limiter is small: start `limit` workers that each pull the next index until none remain.

```ts
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
```

This works because JavaScript is single-threaded: `next++` cannot race. A production version also stops handing out work after the first failure and supports cancellation. You will write that in a task.

## Cancellation and timeouts

`AbortController` is the standard way to cancel. You create a controller, pass its `signal` to the operation, and call `abort()` when the result is no longer wanted. `fetch`, `node:fs/promises`, timers from `node:timers/promises`, and stream functions all accept a signal.

```ts
const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
```

`AbortSignal.timeout(ms)` gives a signal that aborts by itself. `AbortSignal.any([a, b])` combines signals, for example "the client disconnected" and "two seconds passed". In your own functions, call `signal.throwIfAborted()` before starting work, and listen for the `'abort'` event to stop work in progress. Reject with `signal.reason`.

Every outbound call from a server needs a timeout. Without one, a hung dependency turns into hung requests, and those pile up until the process runs out of memory or sockets.

## Streams and backpressure

A stream processes data in pieces, so memory stays flat no matter how large the payload is. Request bodies, responses, files and sockets are all streams. There are four kinds: `Readable`, `Writable`, `Duplex` (both) and `Transform` (a duplex that changes data on the way through).

The key idea is **backpressure**. If the source produces faster than the destination can consume, something must slow the source down, or the data piles up in memory. A writable signals this through `write()`: it returns `false` once its internal buffer passes `highWaterMark`, and emits `'drain'` when it is ready for more. Code that ignores the return value buffers without limit.

You rarely handle that by hand. `pipeline` connects streams, propagates backpressure, forwards errors, and destroys every stream when one fails:

```ts
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';

await pipeline(
  createReadStream('access.log'),
  createGzip(),
  createWriteStream('access.log.gz'),
);
```

A readable is also an async iterable, so `for await (const chunk of req)` reads a request body with backpressure built in: the stream is paused while the loop body runs.

## Common mistakes

- Using `array.forEach(async ...)`. Nothing awaits the callbacks, and rejections become unhandled.
- Assuming `Promise.all` cancels the remaining work when one task fails.
- Calling `Promise.all` over an unbounded list of I/O operations.
- Calling `fetch` or a database query with no timeout or signal.
- Chaining streams with `.pipe()` and no error handling. `.pipe()` does not forward errors or clean up; `pipeline` does.
- Collecting a whole stream into one buffer "to make it simpler", then failing on the first large upload.

## Go deeper

- [MDN: Promise](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise): exact semantics of `all`, `allSettled`, `race` and `any`.
- [MDN: AbortSignal](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal): `timeout()`, `any()`, `reason` and `throwIfAborted()`.
- [Node.js process events](https://nodejs.org/api/process.html): how `unhandledRejection` and `uncaughtException` behave.
- [Node.js stream API](https://nodejs.org/api/stream.html): the stream types, `pipeline`, and `highWaterMark`.
- [Backpressuring in streams](https://nodejs.org/en/learn/modules/backpressuring-in-streams): what happens in memory when backpressure is ignored.
