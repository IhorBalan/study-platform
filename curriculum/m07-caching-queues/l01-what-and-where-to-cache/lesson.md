---
title: What to cache, and where
skills: [cache-strategies]
---

A cache keeps a copy of data closer to where it is needed, so you pay the cost of producing it less often. You already know caches from the frontend: the browser's HTTP cache, a CDN, React Query's query cache. The backend adds one more layer, an application cache in a shared store such as Valkey. Every copy speeds up reads and can go stale. This lesson is about choosing which copies are worth that risk.

## When a cache is worth adding

Add a cache when you have measured a problem it solves, not because the stack "should have Redis". The good signs:

- **The same data is read far more often than it changes.** A product page read 5,000 times a minute and edited twice a day is the textbook case.
- **Producing it is expensive.** A query with joins and aggregates, a call to a slow third-party API, a rendered PDF.
- **Slightly old data is acceptable.** If a page may be 60 seconds out of date, you can cache it for 60 seconds with almost no extra logic.

Before reaching for a cache, check the cheaper fixes: a missing index, an N+1 query, a response that returns 2 MB when the client needs 2 KB. A cache in front of a slow query hides the problem until the first miss under load.

## Where caches live

From the user outwards:

| Layer | Controlled by | Shared between users | You can delete an entry |
| --- | --- | --- | --- |
| Browser HTTP cache | `Cache-Control` on your response | No | No |
| CDN or reverse proxy | Headers, plus the CDN's purge API | Yes | Usually, through the API |
| In-process memory (a `Map`, an LRU) | Your code | Per process only | Only in that process |
| Shared cache (Valkey) | Your code | Yes, across instances | Yes |
| Database buffer cache | PostgreSQL | Yes | Not needed |

The column that matters most is the last one. Once a response with `max-age=3600` reaches a browser, nothing you do on the server takes it back for an hour. An in-process cache is fast but each instance has its own copy, so with three instances an invalidation has to reach three processes. Valkey is one copy that every instance shares and that you can delete from, which is why it is the usual application cache.

## HTTP caching in one minute

HTTP caching is defined in RFC 9111. The headers you set most often:

```http
Cache-Control: public, max-age=60, stale-while-revalidate=300
ETag: "p1-v42"
```

- `max-age=60`: any cache may reuse this response for 60 seconds without asking.
- `public` or `private`: whether shared caches (CDNs) may store it. Anything per user is `private`.
- `no-cache`: store it, but revalidate with the server before every reuse. With an `ETag`, revalidation is cheap: the client sends `If-None-Match`, and you answer `304 Not Modified` with no body.
- `no-store`: never store it. Use it for anything sensitive.
- `stale-while-revalidate=300`: after `max-age`, a cache may serve the old copy for up to 300 more seconds while it fetches a new one in the background (RFC 5861).

HTTP caching is free performance for public, rarely changing data such as images, versioned assets and public catalogue pages. It is the wrong tool for prices, stock or anything per user, because you cannot recall it.

## Application caching patterns

### Cache-aside (lazy loading)

The application owns both reads and writes. On a read it checks the cache, and on a miss loads from the database and fills the cache. This is the pattern you will use most.

```ts
import { Redis } from 'ioredis';
import pg from 'pg';

const redis = new Redis(process.env.VALKEY_URL!);
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const prefix = process.env.VALKEY_KEY_PREFIX ?? 'dev:';

type Product = { id: string; name: string; priceCents: number };

export async function getProduct(id: string): Promise<Product | null> {
  const key = `${prefix}product:${id}`;
  // A cache error is a miss, not a failed request.
  const cached = await redis.get(key).catch(() => null);
  if (cached !== null) return JSON.parse(cached) as Product;

  const { rows } = await db.query<Product>(
    'SELECT id, name, price_cents AS "priceCents" FROM products WHERE id = $1',
    [id],
  );
  const product = rows[0] ?? null;
  if (product) await redis.set(key, JSON.stringify(product), 'EX', 300).catch(() => {});
  return product;
}
```

Strengths: only data that is actually read gets cached, and if Valkey is down the code falls back to the database. That fallback only exists because of the two `catch` calls, and it is only fast if the client gives up quickly: by default ioredis queues commands while it reconnects, so create it with a `commandTimeout` (a few hundred milliseconds), or every request waits on the dead cache first. Log or count the errors so that an outage is visible. Weaknesses: the first read after a miss is slow, and keeping it fresh is your job (next lesson).

### Read-through

The same flow, but a library or the cache itself does the loading: you ask the cache, and it calls a loader you registered. Your code reads as if the cache were the source. A helper like `cache.getOrLoad(key, loader)` turns cache-aside into read-through for the rest of your codebase, which is what you build in this module's first task.

### Write-through and write-behind

- **Write-through**: every write goes to the database and to the cache in the same operation, so the cache always has the latest value. It costs a cache write on every update, including for data nobody reads, and if the two writes are not atomic they can disagree.
- **Write-behind** (write-back): writes go to the cache first and are flushed to the database later in batches. Fast, but a crash can lose writes. It suits counters and analytics, not orders.

Most web backends use cache-aside for reads and **delete the key on write** rather than write-through. The next lesson explains why deleting beats updating.

## Choosing a TTL

Every entry gets a time to live. The TTL is your upper bound on staleness when everything else fails, so choose it from the business answer to "how old may this be?", not from performance.

- Product descriptions: an hour is fine.
- Prices: minutes, and only with invalidation on change.
- A feature flag: seconds.
- An expensive report: until tomorrow.

Add a little random jitter (say ±10%) so that thousands of keys written at the same moment do not expire at the same moment.

## What a cache is not

A cache is a copy, so the system must still be correct when it is empty. Never make Valkey the only place something lives unless you have configured it as a database (persistence, backups, `noeviction`). If a feature breaks after `FLUSHALL`, it was not using a cache.

## Common mistakes

- Caching before measuring, or caching to hide a missing index.
- A long `max-age` on responses whose data can change, which no server-side invalidation can undo.
- Caching per-user responses as `public` on a CDN, so one user's data is served to another.
- No TTL on application cache keys, so memory grows until eviction starts deleting things you did not choose.
- Letting a cache error fail the request. A cache error is a miss.
- Treating the cache as the source of truth.

## Go deeper

- [MDN: HTTP caching](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Caching): how browsers and shared caches decide what to reuse.
- [MDN: Cache-Control](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control): every directive, with examples.
- [RFC 9111: HTTP Caching](https://www.rfc-editor.org/rfc/rfc9111): the specification itself.
- [RFC 5861](https://www.rfc-editor.org/rfc/rfc5861): `stale-while-revalidate` and `stale-if-error`.
- [Valkey: key eviction](https://valkey.io/topics/lru-cache/): using Valkey as an LRU cache.
