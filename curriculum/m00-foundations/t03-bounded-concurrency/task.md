`Promise.all(items.map(fn))` starts everything at once. Write the tool you reach for when that is too much: a map that runs at most `limit` calls at a time.

## Requirements

Edit `map-limit.mjs`. It must export:

```js
export function mapLimit(items, limit, fn, options)
```

- `items` is an array. `fn(item, index)` returns a value or a promise. `options.signal` is an optional `AbortSignal`.
- It returns a promise for an array of results **in input order**, whatever order the calls finish in. An empty `items` resolves to `[]`.
- At most `limit` calls of `fn` are in flight at any moment. When one finishes, the next item starts immediately. Do not wait for a whole batch.
- **Fail fast.** When a call rejects, or `fn` throws synchronously, the returned promise rejects with that same error straight away, without waiting for the calls still in flight. No further calls start.
- **Abort.** When `signal` aborts, the returned promise rejects with `signal.reason` straight away and no further calls start. If the signal is already aborted, `fn` is never called.
- If `limit` is not a positive integer, the returned promise rejects with a `RangeError` and `fn` is never called.
- Calls that are still in flight after a rejection must not cause an unhandled promise rejection, even if they fail later.

Use only JavaScript and Node built-ins. No timers or polling are needed.

## Submission

`map-limit.mjs` and a `README.md` that answers: what happens to the calls already in flight when `mapLimit` rejects, and how would you change the signature of `fn` so they could be cancelled too?

## What is checked

The checks call `mapLimit` with instrumented functions. They count how many calls are in flight, compare result order, and verify when the promise settles after a failure and after an abort, and that no new call starts afterwards.
