A take-home in the style small companies send: the core of a link shortener with a per-client rate limit and a small HTTP API. **Time box: 90 minutes.** Stop when it runs out, and say in the README what you would do next. Node built-ins only; nothing to install.

## shortener.mjs

Keep the exported error classes and `DEFAULT_RATE_LIMIT` (`{ capacity: 10, refillPerSecond: 1 }`). `createShortener({ clock = Date.now, rateLimit = DEFAULT_RATE_LIMIT } = {})` returns `{ shorten, resolve, stats }`. `clock()` returns milliseconds.

**`shorten(url, { clientId, alias })`** returns `{ code, url }`. In this order:

1. `clientId` must be a non-empty string, else `ValidationError`.
2. **Rate limit:** a token bucket per `clientId`. It starts full at `capacity`, refills continuously at `refillPerSecond`, and never exceeds `capacity`. Every call takes one token, even if it later fails validation. With less than one token, throw `RateLimitError` whose `retryAfterSeconds` is the whole number of seconds until one token is available (rounded up, at least 1).
3. `url` must be a string of at most 2048 characters that parses as an absolute `http:` or `https:` URL, else `ValidationError`.
4. `alias`, when given, must match `^[A-Za-z0-9_-]{4,32}$` (else `ValidationError`) and must not be in use as any code (else `ConflictError`). It becomes the code.
5. Otherwise generate a random 7-character code from `[0-9A-Za-z]`, unique among stored codes.

**`resolve(code)`** returns the url and counts a hit, or `null`. **`stats(code)`** returns `{ code, url, hits, createdAt }` (`createdAt` is the ISO string of `clock()` at creation), or `null`. `stats` does not count a hit.

## server.mjs

`createApp(shortener)` returns an unstarted `node:http` server.

| Request | Success | Errors |
| --- | --- | --- |
| `POST /links` with JSON `{ "url", "alias"? }` | `201` with `{ code, url }` | `400` invalid body or input, `409` alias taken, `429` with `Retry-After` |
| `GET /:code` | `302` with `Location` | `404` |
| `GET /links/:code/stats` | `200` with the stats | `404` |

The client id is the `X-Client-Id` header, falling back to the socket address. Every error is an RFC 9457 problem document (`Content-Type: application/problem+json`, with `title` and `status`).

## Tests and README

Write tests in `test/*.test.mjs` with `node:test`; `npm test` runs them. They must pass and must fail against a copy of your code whose rate limit never applies. Fill in the README: assumptions, trade-offs, what is not done, and your time spent.

## What is checked

Hidden checks call your core with a fake clock and probe the HTTP API on a random port: validation, code format and uniqueness over 3,000 links, aliases, hits, the bucket's refill, cap and `retryAfterSeconds`, status codes and headers, and your own tests against the broken copy. A reviewer then reads your code and README as a take-home reviewer would.
