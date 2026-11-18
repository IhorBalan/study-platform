---
title: Rate limiting
skills: [rate-limiting]
---

A rate limiter caps how much one client can ask of you in a period of time. It protects capacity (one script cannot starve every other user), cost (each SMS or LLM call costs money) and security (a login form that allows 10 guesses a minute is much harder to brute-force than one that allows 10,000). It is also one of the most common interview questions, either as "design a rate limiter" or as live code.

## The three algorithms

All three answer "may this client make one more request now?" They differ in what they remember and how they treat bursts.

### Fixed window

Count requests per client per calendar slot: key `rl:<client>:<minute>`, `INCR`, and `EXPIRE` on the first request.

```ts
const minute = Math.floor(Date.now() / 60_000);
const key = `${prefix}rl:${clientId}:${minute}`;
const [[, count]] = (await redis.multi().incr(key).expire(key, 60).exec()) as [[null, number], unknown];
const allowed = count <= 100;
```

Cheap (one counter per client) and easy to explain. Its flaw is the boundary: 100 requests at 12:00:59 and 100 more at 12:01:00 are 200 in one second, all allowed.

### Sliding window

Count requests in the last 60 seconds, measured from now, not from the top of the minute.

- **Sliding window log**: store a timestamp per allowed request in a sorted set, drop entries older than the window, count the rest. Exact, but it stores up to `limit` entries per client, which matters for limits like 10,000 per hour. You build this in the module's rate limiter task.
- **Sliding window counter**: keep the current and previous fixed-window counts and weight the previous one by how much of it still overlaps the window. Two numbers per client and close enough for most APIs.

### Token bucket

Each client has a bucket of up to `capacity` tokens that refills at `rate` tokens per second. A request takes a token or is refused. The result allows short bursts (a page that fires 8 requests at load) while holding the long-run rate. It stores two numbers per client (tokens and last refill time) and is what most API gateways and cloud providers use. Its sibling, the **leaky bucket**, drains a queue at a constant rate and smooths bursts out instead of allowing them.

```ts
// KEYS[1]: the bucket. ARGV: capacity, refill per second, now in ms.
const TOKEN_BUCKET = `
local capacity = tonumber(ARGV[1])
local rate = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local bucket = redis.call('HMGET', KEYS[1], 'tokens', 'at')
local tokens = tonumber(bucket[1]) or capacity
local at = tonumber(bucket[2]) or now
tokens = math.min(capacity, tokens + (now - at) / 1000 * rate)
local allowed = 0
if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
end
redis.call('HSET', KEYS[1], 'tokens', tostring(tokens), 'at', now)
redis.call('PEXPIRE', KEYS[1], math.ceil(capacity / rate * 1000))
local wait = 0
if allowed == 0 then wait = math.ceil((1 - tokens) / rate * 1000) end
return { allowed, wait }
`;

export async function take(clientId: string, capacity = 10, perSecond = 2) {
  const [allowed, retryAfterMs] = (await redis.eval(
    TOKEN_BUCKET, 1, `${prefix}bucket:${clientId}`, capacity, perSecond, Date.now(),
  )) as [number, number];
  return { allowed: allowed === 1, retryAfterMs };
}
```

Ten quick calls succeed, the eleventh waits about half a second for the next token.

## Where the state lives

With one API instance, a `Map` in memory works. With three instances behind a load balancer, each has its own `Map`, and every client gets three times the limit, more or less depending on how the balancer spreads requests. The state must live where all instances see it: Valkey is the usual answer, because it is fast, has TTLs, and runs the check-and-update atomically.

Atomically is the important word. "Read the count, compare in Node, then increment" is two round trips, and two instances can both read 99 of 100 and both let a request through. Under a burst, dozens will. The decision has to be one command or one Lua script, as in the bucket above. Pass the time in as an argument (or read it with `TIME` inside the script) so that one clock decides; then your tests can pass a fake clock too.

## Where to enforce

Use layers, each with the key it can see:

- **At the edge** (CDN, API gateway, reverse proxy): coarse per-IP limits that stop floods before they cost your app anything.
- **In the app** (middleware or a Nest guard): per user, per API key, per plan, per tenant, because only the app knows who the client is. Anonymous traffic falls back to the IP. Behind a proxy, read the client IP from `X-Forwarded-For` only with Express's `trust proxy` set to your proxies, or every request seems to come from the load balancer, and clients can forge the header.
- **Per route**: login, password reset, sign-up and SMS sending get their own strict limits, keyed by account or phone number as well as by IP.
- **Outbound**: limits that partners impose on you. BullMQ's worker `limiter` option (`{ max: 10, duration: 1000 }`) caps how fast jobs reach a rate-limited API.

In NestJS, `@nestjs/throttler` provides a `ThrottlerGuard` you register with `APP_GUARD` and configure with `ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 100 }] })`. Its default storage is in memory, so with more than one instance plug in a shared storage, such as a community Redis storage.

## Telling the client

A limited request gets `429 Too Many Requests` (RFC 6585) with a `Retry-After` header in seconds, so that well-behaved clients wait instead of hammering:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 3
Content-Type: application/problem+json

{"type":"about:blank","title":"Too Many Requests","status":429}
```

Many APIs also send remaining quota on every response (`X-RateLimit-Remaining`, or the `RateLimit` and `RateLimit-Policy` fields from an IETF draft). On the client side, the matching behaviour is retrying with backoff and honouring `Retry-After`.

## When the limiter itself fails

If Valkey is unreachable, the limiter must either let requests through (**fail open**) or reject them (**fail closed**). For a limit that protects capacity, failing open is usually right: an outage of the limiter should not become an outage of the product. For a limit that is a security control (login attempts, OTP checks, money-moving endpoints), fail closed. Decide per limit, and log loudly either way.

## Common mistakes

- Keeping counters in process memory with several instances.
- Read-compare-write across round trips instead of one atomic script.
- Counting rejected requests, so a client that keeps retrying stays blocked forever.
- Keying anonymous traffic by `req.ip` behind a proxy without `trust proxy`, so everyone shares one limit.
- 429 without `Retry-After`, which invites immediate retries.
- One global limit for every route, too loose for login and too tight for cheap reads.

## Go deeper

- [MDN: 429 Too Many Requests](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/429): the status code and its use with `Retry-After`.
- [MDN: Retry-After](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Retry-After): seconds or an HTTP date.
- [RFC 6585](https://www.rfc-editor.org/rfc/rfc6585): where 429 is defined.
- [NestJS: rate limiting](https://docs.nestjs.com/security/rate-limiting): `@nestjs/throttler`, multiple limits and proxies.
- [BullMQ: rate limiting](https://docs.bullmq.io/guide/rate-limiting): limiting how fast workers process jobs.
