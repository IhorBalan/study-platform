The API's rate limiter counts requests in a `Map` inside each process, in fixed one-minute windows. With three instances behind a load balancer every client gets three times its limit. Move it to Valkey as a sliding window that all instances share, and answer limited requests properly.

## Requirements

Edit `src/rate-limiter.ts`. Keep its exports and types. Import only `ioredis` and `express` types and Node built-ins.

**`createRateLimiter({ redis, prefix, limit, windowMs, now? })`** returns `{ consume(key) }`. `now` is the clock in milliseconds and defaults to `Date.now`; use it for every time decision.

`consume(key)` resolves to `{ allowed, remaining, retryAfterMs }`:

- A request is allowed when fewer than `limit` allowed requests for this key happened in the last `windowMs`, that is, at times `t` with `now - windowMs < t <= now`.
- Allowed: `remaining` is how many more would be allowed right now, and `retryAfterMs` is `0`.
- Denied: `remaining` is `0`, and `retryAfterMs` is the time until the oldest request in the window leaves it. Denied requests are not recorded.
- Requests at the same millisecond are separate requests.
- Two instances (separate connections, same `prefix`) racing must never allow more than `limit` together.
- The state of client `key` lives under exactly `prefix + key` and expires within `windowMs` of the last allowed request.

**`rateLimitMiddleware(limiter, keyFor)`** returns an Express middleware (Nest can mount it with `app.use()`).

- Allowed: call `next()`.
- Denied: respond `429` with `Retry-After` set to `retryAfterMs` in whole seconds, rounded up, and a short JSON body. The handler does not run.
- If `consume` throws (Valkey is down), let the request through. For this API, an outage of the limiter must not become an outage of the product.

## Tests

Write tests in `test/*.test.ts` with `node:test` against the lab Valkey, using `VALKEY_URL` and keys under `VALKEY_KEY_PREFIX`. Use a fake clock. They must pass, and fail against a limiter that never denies and one that puts every client into one shared limit.

## Submission

`src/`, `test/`, `package.json`, `tsconfig.json` and `README.md`, without `node_modules`.

## What is checked

The checks run `tsc`, then drive two limiter instances on separate connections with a fake clock: exact results, a burst across a window boundary, requests while blocked, requests in the same millisecond, 60 concurrent requests, and the key's TTL. They mount your middleware in Express, and run your tests against your code and two broken copies.
