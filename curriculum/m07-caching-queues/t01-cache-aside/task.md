The product page reads the same rows from PostgreSQL thousands of times a minute. Write the cache-aside helper that sits in front of it: TTLs, a cache for "not found", invalidation that a slow read cannot undo, and protection against a stampede when a hot key expires.

## Requirements

Edit `src/cache.ts`. Keep its types and its one export, `createCache(options)`, which returns `{ getOrLoad, invalidate }`. Import only `ioredis` types and Node built-ins.

| Option | Meaning |
| --- | --- |
| `redis` | An ioredis client. The caller creates and closes it. |
| `prefix` | Every key you write starts with this string. |
| `ttlSeconds` | TTL of a cached value. |
| `negativeTtlSeconds` | TTL of a cached `null`. |
| `lockTimeoutMs` | Optional, default 5000. See below. |

**`getOrLoad(key, loader)`**

- The value lives under exactly `prefix + key`, stored as `JSON.stringify(value)` with `EX ttlSeconds`. A value found there is returned without calling `loader`, whoever stored it.
- A loader that returns `null` is cached too, with `negativeTtlSeconds`.
- A loader that throws: the error reaches the caller, nothing is stored, and the next call tries again at once.
- 50 concurrent calls for a missing key in one process call `loader` once and all get its value.
- Two processes (two `createCache` instances with separate connections, same prefix) missing the same key at the same time call `loader` once in total. The other process waits for the value.
- A process that holds the right to load for longer than `lockTimeoutMs` (it hung or crashed) stops blocking others: they load the value themselves.

**`invalidate(key)`** removes the value. If a load for that key started before the call and finishes after it, its result must not be stored.

Any extra keys you need (locks, versions) also start with `prefix` and must expire.

## Tests

Write tests in `test/*.test.ts` with `node:test` against the lab Valkey. Read `VALKEY_URL`, and put every key under `VALKEY_KEY_PREFIX`. `npm test` runs them. They must pass, and fail against a cache that never caches and against an `invalidate` that does nothing.

## Submission

`src/`, `test/`, `package.json`, `tsconfig.json` and `README.md`, without `node_modules`.

## What is checked

The checks run `tsc`, then call your helper against Valkey: hits and misses, TTLs, a cached `null`, a failing loader, invalidate during a slow load, 50 parallel misses, two instances racing, a loader that never returns, and a scan for keys without a TTL. Then they run your tests against your code and against two broken copies.
