---
title: Valkey data structures and atomic operations
skills: [valkey-data-structures]
---

Valkey is an in-memory data structure server. It began in 2024 as the Linux Foundation's open source fork of Redis 7.2.4, after Redis changed its licence, and it speaks the same protocol, so `ioredis` and BullMQ work with it unchanged. Thinking of it as "a cache with `GET` and `SET`" wastes most of what it offers. Each data type is a ready-made, atomic building block, and choosing the right one often removes a whole class of race conditions.

## One thread, so every command is atomic

Valkey executes commands one at a time on a single main thread (I/O can use extra threads, but command execution stays serial). That gives you a strong guarantee for free: a single command never interleaves with another. `INCR` on a counter from 50 clients at once gives exactly 50 increments. The trouble starts when one operation needs **several** commands. That is what `MULTI` and Lua are for, further down.

It also means one slow command blocks everybody. `KEYS *` on a million keys stops the server for the whole scan. Use `SCAN` with a cursor in production.

## The types and what each is for

All examples use ioredis 6 and a key prefix, as the lab tasks do.

```ts
import { Redis } from 'ioredis';

const redis = new Redis(process.env.VALKEY_URL ?? 'redis://localhost:56379');
const p = process.env.VALKEY_KEY_PREFIX ?? 'dev:';
```

### Strings

A string holds bytes up to 512 MB: JSON, a token, a number. With `INCR` and `INCRBY` it is an atomic counter. With `SET ... NX PX` it is a lock or an idempotency marker.

```ts
await redis.set(`${p}session:abc`, JSON.stringify({ userId: 42 }), 'EX', 3600);
await redis.incr(`${p}views:product:1`);
const first = await redis.set(`${p}processed:evt_123`, '1', 'EX', 86_400, 'NX'); // 'OK' or null
```

### Hashes

A hash is a small map of fields under one key. Use it for an object whose fields you read or update separately, such as a user's profile or per-field counters (`HINCRBY`). A JSON string must be rewritten whole; a hash field need not.

```ts
await redis.hset(`${p}user:42`, { name: 'Ada', plan: 'pro' });
await redis.hincrby(`${p}user:42`, 'logins', 1);
const user = await redis.hgetall(`${p}user:42`); // { name: 'Ada', plan: 'pro', logins: '1' }
```

Everything comes back as strings. Parse numbers yourself.

### Lists

An ordered sequence with fast push and pop at both ends. Lists were the classic job queue (`LPUSH` plus a blocking `BRPOP`). Today a library like BullMQ, or a stream, does that job better, because a popped item is gone if the worker then crashes.

### Sets

Unordered unique members. Use them for membership and deduplication: tags on a product, the ids of users online, "has this IP already voted". `SINTER` and `SUNION` combine sets on the server.

```ts
await redis.sadd(`${p}tags:product:1`, 'red', 'sale', 'red'); // stored once
const isOnSale = await redis.sismember(`${p}tags:product:1`, 'sale'); // 1
```

### Sorted sets

Unique members, each with a numeric score, kept in score order. This is the type you will reach for most often after strings: leaderboards, "the 10 most recent", time-indexed data (the score is a timestamp), delayed jobs (the score is the run time) and sliding-window rate limits.

```ts
await redis.zadd(`${p}leaderboard`, 120, 'ada', 95, 'grace', 140, 'linus');
const top2 = await redis.zrange(`${p}leaderboard`, '0', '1', 'REV', 'WITHSCORES'); // ['linus','140','ada','120']
await redis.zremrangebyscore(`${p}recent-logins`, '-inf', Date.now() - 3_600_000); // drop older than an hour
```

### Streams

An append-only log with ids based on time, and **consumer groups** that track which entries each consumer has read and acknowledged. Unlike pub/sub, entries persist, and a consumer that was offline catches up. Unlike a list, an entry that was read but not acknowledged (`XACK`) can be claimed by another consumer after a crash. Streams are a small Kafka inside Valkey, and BullMQ uses one for its events.

```ts
await redis.xadd(`${p}events`, '*', 'type', 'order.created', 'orderId', 'o1');
await redis.xgroup('CREATE', `${p}events`, 'mailer', '0', 'MKSTREAM').catch(() => {}); // exists already
const batch = await redis.xreadgroup('GROUP', 'mailer', 'worker-1', 'COUNT', 10, 'STREAMS', `${p}events`, '>');
```

## Several commands as one: MULTI and Lua

Suppose you want "increment the counter and set its expiry". Two separate commands leave a gap: a crash after `INCR` leaves a counter that never expires. Two tools close such gaps.

**`MULTI`/`EXEC`** queues commands and runs them back to back, with nothing in between:

```ts
const results = await redis.multi().incr(`${p}hits`).expire(`${p}hits`, 60).exec();
// [[null, 1], [null, 1]]: one [error, result] pair per command
```

`MULTI` cannot branch. You cannot say "increment only if the value is below 10", because no command inside the transaction sees another's result. (`WATCH` adds optimistic locking: `EXEC` fails if a watched key changed, and you retry.)

**Lua scripts** run on the server, atomically, and can read, decide and write:

```ts
const INCR_CAPPED = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
if current >= tonumber(ARGV[1]) then return -1 end
return redis.call('INCR', KEYS[1])
`;

// Book one of at most 100 seats; -1 means sold out. Safe under any concurrency.
const seat = await redis.eval(INCR_CAPPED, 1, `${p}seats:show-1`, 100);
```

Rules for scripts: pass every key in `KEYS` (not built inside the script) so the script also works on a cluster; keep them short, because nothing else runs while a script runs; and remember ioredis can register a script with `defineCommand`, which sends it once and then calls it by its SHA. A check-then-act sequence across round trips (`GET`, decide in Node, `SET`) is the most common race in Valkey code; the fix is almost always a script or a single command with the right options, such as `SET key value NX` or `SET key value IFEQ old` (Valkey 8.1 and later).

## Persistence and eviction

Valkey keeps everything in memory, and two settings decide what happens to it.

**Persistence** decides what survives a restart. RDB writes periodic snapshots: compact and fast to load, but you lose writes since the last snapshot. AOF appends every write to a log, with `appendfsync everysec` losing at most about a second. A pure cache can run with neither. A job queue needs AOF, or a restart loses every queued job.

**Eviction** decides what happens when `maxmemory` is reached:

- `noeviction`: writes fail with an error. Required for BullMQ and for anything stored only in Valkey, because silently deleted job keys corrupt a queue.
- `allkeys-lru` or `allkeys-lfu`: evict the least recently or least frequently used keys. Right for a cache-only instance.
- `volatile-lru` and friends: evict only keys with a TTL.

These two needs conflict, so production setups often run two instances: one for the cache (LRU, no persistence) and one for queues and locks (`noeviction`, AOF).

## Common mistakes

- `KEYS *` in production. Use `SCAN`.
- A check in Node followed by a write, where a single command or a script would be atomic.
- Building key names inside a Lua script instead of passing them in `KEYS`.
- Storing a large object as JSON and rewriting it to change one field, where a hash would do.
- Running BullMQ on an instance with an LRU eviction policy.
- Forgetting that every reply is a string, and comparing `'10' > '9'`.

## Go deeper

- [Valkey: data types](https://valkey.io/topics/data-types/): every type with its commands.
- [Valkey: transactions](https://valkey.io/topics/transactions/): `MULTI`, `EXEC` and `WATCH`.
- [Valkey: scripting with Lua](https://valkey.io/topics/eval-intro/): `EVAL`, script caching and the rules for keys.
- [Valkey: streams](https://valkey.io/topics/streams-intro/): consumer groups, pending entries and claiming.
- [Valkey: persistence](https://valkey.io/topics/persistence/): RDB and AOF compared.
