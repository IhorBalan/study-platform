---
title: Invalidation, stampedes and what not to cache
skills: [cache-invalidation, cache-strategies]
---

Putting data into a cache is easy. Knowing when it is wrong and getting it out again is the hard part, and so is surviving the moment it is gone. This lesson covers the three problems that cause most cache incidents: stale data after a write, a crowd of requests hitting the database when a hot key expires, and data that should never have been cached.

## Invalidate on write: delete, do not update

When data changes, the cached copy must go. You have two options after writing to the database:

1. `SET` the new value into the cache.
2. `DEL` the key, and let the next read load it.

Prefer deleting. Updating looks fresher, but it races. Two admins save the same product a few milliseconds apart: A's database write lands first, then B's, but B's cache `SET` lands before A's. The database holds B's version and the cache holds A's, until the TTL ends. Deleting has no such ordering problem, because the next read always loads what the database holds now.

Delete **after the transaction commits**, not inside it. A `DEL` sent before `COMMIT` lets a concurrent reader miss, load the old row (the new one is not visible yet) and put it back in the cache, where it stays until the TTL ends. If the process can crash between the commit and the delete, the TTL bounds the damage; when that is not good enough, drive invalidation from the outbox or change data capture (module 8).

Find **every** write path. The admin form calls `invalidate()`, but the nightly CSV import, the migration script and the support team's SQL console do not. A short TTL is the safety net for the paths you missed.

## The race that deleting does not fix

Deleting still leaves one race, between a slow read and a write:

1. Request R misses and starts loading product 7. It reads price 10.
2. An admin changes the price to 12 and deletes `product:7`.
3. R finishes and stores price 10 in the cache.

The cache now serves 10 until the TTL ends, although the delete happened. It is rare, because R has to be slow at exactly the wrong moment. Under load it happens.

The usual fix is a version check. Keep a version marker per key that every invalidation changes. A reader notes the version before loading and stores its result only if the version is still the same, in one atomic step (a Lua script, see the next lesson). Facebook's memcache paper calls a variant of this a lease. For many systems, a short TTL is an acceptable bound instead; decide which you need.

## Stampedes (thundering herd)

A hot key expires. In the next 50 milliseconds, 400 requests miss, and all 400 run the same expensive query. The database slows down, so the queries take longer, so more requests miss. This is a cache stampede, and it is how a cache can take a database down at the moment the cache was meant to protect it. `FLUSHALL` in production does the same to every key at once.

Defences, from simplest:

- **Single flight in the process.** Keep a `Map` of in-flight loads. The second caller for the same key awaits the first caller's promise instead of loading.

```ts
const inFlight = new Map<string, Promise<unknown>>();

export function once<T>(key: string, load: () => Promise<T>): Promise<T> {
  const running = inFlight.get(key);
  if (running) return running as Promise<T>;
  const promise = load().finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}
```

- **A short lock across processes.** Single flight works per process; with 10 instances, 10 loads still run. The first instance takes a lock in Valkey (`SET lock:<key> <token> NX PX 5000`); the others wait briefly and read the value it stores. The lock must expire on its own, and waiters must give up after a deadline, or a crashed instance blocks the key forever.
- **Stale-while-revalidate.** Store the value with a soft expiry inside it and a longer real TTL. After the soft expiry, serve the old value immediately and let one request refresh it in the background. Users never wait for a reload. This is the same idea as the HTTP directive and as React Query's `staleTime`.
- **Jittered TTLs** spread expiries out so that keys written together do not expire together.
- **Warming** loads the hottest keys before traffic arrives, for example after a deploy.

## Negative caching

A request for product `does-not-exist` misses the cache, misses the database, and is not cached, so every such request costs a query. Bots and broken links can make that a lot of queries. Cache the absence too: store a marker (JSON `null` works) with a short TTL, such as 30 seconds. Short, because when the product is created its "not found" entry must go, and you may not invalidate it from every path.

```ts
const raw = await redis.get(key);
if (raw === 'null') return null;              // cached "not found"
if (raw !== null) return JSON.parse(raw);
const row = await loadFromDb(id);
await redis.set(key, JSON.stringify(row), 'EX', row ? 300 : 30);
return row;
```

Never cache errors. A timeout from the database means "unknown", not "not found".

## What not to cache

- **Anything you will act on.** Checkout charges the price from the database, inside the transaction that creates the order. A cached price is fine on the product page and wrong on the invoice. The same goes for stock levels when you reserve stock, account balances and permissions checks after a role change.
- **Per-user data under a shared key.** A key like `cart` instead of `cart:<userId>` serves one user's cart to everyone. Include every input that changes the result in the key: user, tenant, locale, currency.
- **Secrets and personal data** without a reason, an expiry and the same access controls as the database.
- **Data that is cheap to compute.** Every cache adds an invalidation path to maintain.

## Common mistakes

- Updating the cache on write instead of deleting, and losing the race between two writers.
- Invalidating from the API but not from imports, scripts and other services that write the same table.
- Running `FLUSHALL` to fix staleness, and causing a stampede.
- A stampede lock without a TTL, or waiters without a deadline.
- Caching "not found" for as long as real values, or caching errors.

## Go deeper

- [RFC 5861](https://www.rfc-editor.org/rfc/rfc5861): `stale-while-revalidate` and `stale-if-error` as HTTP defines them.
- [Valkey: SET](https://valkey.io/commands/set/): the `NX`, `PX` and `GET` options used for locks and caches.
- [Valkey: key eviction](https://valkey.io/topics/lru-cache/): what happens when memory runs out.
- [MDN: HTTP caching](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Caching): validation with ETags, and how stale responses are served.
