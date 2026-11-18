Your service calls a partner API that fails a few times an hour: dropped connections, `503`s during their deploys, the odd request that never answers. Write the helper every outgoing call will go through.

## Requirements

Edit `retry.ts`. Node runs it directly by stripping the types, so use erasable TypeScript only, and Node built-ins only. Keep the exports `fetchWithRetry`, `backoffDelay`, `RetryOptions` and `DEFAULTS`.

**`backoffDelay(retry, { baseDelayMs, maxDelayMs, random })`** returns full jitter: `Math.floor(random() * Math.min(maxDelayMs, baseDelayMs * 2 ** (retry - 1)))`. `retry` is 1 for the first retry. Defaults: base 100, max 2000, `Math.random`.

**`fetchWithRetry(url, init?, options?)`** takes the same `url` and `init` as `fetch`, plus `RetryOptions` (defaults in `DEFAULTS`):

- **Retried:** network failures (a `TypeError`), an attempt that exceeds `attemptTimeoutMs`, and the statuses `408`, `429`, `500`, `502`, `503`, `504`. At most `retries` retries (default 3, so 4 requests).
- **Not retried:** every other status. Return the response.
- **Methods:** `GET`, `HEAD`, `OPTIONS`, `PUT` and `DELETE` may be retried. Any other method only when the request has an `Idempotency-Key` header; without one it gets exactly one attempt. Every attempt sends the same method, headers and string body.
- **Giving up:** when retries run out, return the last response, or reject with the last error if the last attempt got no response.
- **Waits:** `backoffDelay(n, options)` before retry `n`. If a `429` or `503` has `Retry-After` in seconds, wait that long instead; if that would pass the deadline, return that response at once.
- **Deadline:** the whole call, waits included, ends after `deadlineMs`. It then rejects with an error named `TimeoutError`.
- **Cancellation:** if `options.signal` aborts, reject at once with its reason (an `AbortError`), also during a wait, and send nothing more. An already aborted signal sends no request.

## Tests

Write tests in `test/*.test.ts` with `node:test`, importing `../retry.ts`. `test/server.ts` gives you a scripted local server. `npm test` must pass, and your tests must fail against a copy of your module that retries `400` and `404`.

## Submission

`retry.ts`, `test/` and `README.md` with your notes.

## What is checked

The checks start a local server that answers with scripted statuses, hangs or drops connections, then count the requests, inspect each attempt's method, headers and body, and time the calls with fixed `random` functions. They also run your tests against your module and against the broken copy.
