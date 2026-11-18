---
title: Scaling reads and writes
skills: [sd-scaling]
---

When a system gets slower under load, there is a long menu of fixes: indexes, caches, replicas, poolers, partitions, shards, CDNs. They are not interchangeable. Each one solves a specific bottleneck and adds a specific cost, often a consistency problem. This lesson orders them from cheapest to most expensive and shows what each one buys.

## The order of operations

1. **Measure.** Find the endpoint, the query and the resource that is saturated: CPU, connections, locks, I/O or a third party. Module 12 covers the tools; module 3 covers `EXPLAIN`.
2. **Fix the query.** A missing index or an N+1 loop explains most "the database is slow" incidents. This costs nothing to run.
3. **Scale up.** Give the database a bigger instance. Managed Postgres goes to dozens of cores and hundreds of gigabytes of memory. It is a button, not a project, and it buys months.
4. **Cache** repeated reads.
5. **Pool connections** once there are many app instances.
6. **Add read replicas** for reads you cannot cache.
7. **Partition** very large tables, usually by time.
8. **Shard** across several primaries, as a last resort.

Teams that skip to step 6 or 8 usually still have the missing index from step 2.

## Caching layers

A request can be answered at several layers, from closest to the user to closest to the data:

| Layer | Example | Invalidation |
| --- | --- | --- |
| Browser | `Cache-Control: private, max-age=60` on a user's settings | Time only, or a changed URL |
| CDN | Static assets, public images, public API responses with `s-maxage` | Time, versioned URLs, purge API |
| In-process | An LRU map of feature flags or plan limits in each API instance | Time; each instance holds its own copy |
| Shared cache | Valkey holding a rendered dashboard per workspace | Delete on write, plus a TTL (module 7) |
| Database | Postgres shared buffers keeping hot pages in memory | Automatic |

Push cacheable data as far out as it can safely go. A static asset with a content hash in its file name can be cached for a year by every browser and CDN, and your servers never see the request again. Per-user data should never be in a shared CDN cache unless the response is marked `private` or the cache key includes the user.

The design question for each cache is the one from lesson 2: what is the source of truth, how is the cache updated, how stale may it be. Module 7 covers invalidation and stampedes. A cache is never the only copy of anything.

## Read replicas and replication lag

A read replica is a second Postgres server that replays the primary's write-ahead log. Reads can go to it, writes cannot. Managed providers set one up in a few clicks.

Streaming replication is usually **asynchronous**: the primary commits without waiting for the replica. Lag is often milliseconds, but it grows to seconds or minutes when the replica is busy, when a large migration or batch update runs, or when the network hiccups. Long queries on the replica can also conflict with changes being replayed; Postgres then delays replay or cancels the query, depending on `max_standby_streaming_delay`.

That lag breaks read-your-writes. The user saves a ticket, the next page load reads the replica, and the change seems to have vanished. Patterns that handle it:

- **Route by need.** Reads that must be current, and anything inside a write transaction, go to the primary. Reports, exports, search pages and dashboards go to the replica.
- **Stick to the primary after a write.** Remember the time of a user's last write (in the session or a short-lived cookie) and send that user's reads to the primary for a few seconds.
- **Watch the lag.** `pg_stat_replication.replay_lag` on the primary, and stop routing to a replica that falls behind.

```ts
import { Pool } from 'pg';

const primary = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
const replica = new Pool({ connectionString: process.env.DATABASE_REPLICA_URL, max: 10 });

const STICKY_MS = 5_000;

export function poolFor(opts: { lastWriteAt?: number; needsFresh?: boolean }): Pool {
  const recentWrite = opts.lastWriteAt !== undefined && Date.now() - opts.lastWriteAt < STICKY_MS;
  return opts.needsFresh || recentWrite ? primary : replica;
}
```

Replicas scale reads, not writes. Every replica replays every write.

## Connection pooling and PgBouncer

Each Postgres connection is a separate server process with its own memory. `max_connections` defaults to 100, and raising it far above a few hundred hurts performance. Meanwhile your connection count is the product of things that grow independently:

```text
API instances × pool size + worker instances × pool size + migrations + admin tools
  6 × 20      +     4 × 10                               ≈ 160 connections
```

Autoscaling to 15 API instances during a spike pushes that past the limit, and new instances fail at start-up. Serverless functions are worse: every concurrent execution opens its own pool.

A **connection pooler** such as PgBouncer sits between the apps and Postgres. Apps open as many client connections as they like; PgBouncer multiplexes them over a small number of real server connections. In **transaction mode**, a server connection is lent to a client for one transaction and returned. That is what gives the big win, and it has rules:

- Session state does not survive between transactions: `SET` (use `set_config(..., true)` inside the transaction instead), session-level advisory locks, `LISTEN`, temporary tables and `WITH HOLD` cursors do not work.
- Protocol-level prepared statements work only when PgBouncer's `max_prepared_statements` is set to a non-zero value.

Managed providers often include a pooler (Amazon RDS Proxy, or a PgBouncer endpoint on many Postgres hosts). Add one when connection count, not query speed, is the limit.

## Scaling writes

Writes are harder, because there is one primary. Before reaching for distribution:

- **Make each write cheaper.** Fewer indexes on write-heavy tables, smaller rows, no synchronous side effects in the transaction.
- **Batch.** Insert 500 rows in one statement instead of 500 statements. Flush counters every few seconds instead of on every event.
- **Smooth bursts with a queue.** If 5,000 webhook events arrive in a minute, accept them, enqueue them, and let workers write at a steady rate (lesson 4).
- **Avoid hot rows** (lesson 2).

## Partitioning

Declarative partitioning splits one logical table into child tables by a key, most often time:

```sql
create table events (
  workspace_id bigint not null,
  id           uuid not null default uuidv7(),
  created_at   timestamptz not null,
  type         text not null,
  payload      jsonb not null,
  primary key (workspace_id, id, created_at)
) partition by range (created_at);

create table events_2026_11 partition of events
  for values from ('2026-11-01') to ('2026-12-01');
```

It pays off for large, append-heavy tables with time-based queries and retention: queries that filter on `created_at` only scan the matching partitions, and dropping last year's data is `drop table events_2025_11`, which is instant, instead of a huge `delete` that bloats the table. Costs: primary keys and unique constraints must include the partition key, someone or something has to create future partitions, and queries that do not filter on the key touch every partition. Partitioning stays on one server, so it does not add write capacity.

## Sharding, as a last resort

Sharding splits data across several independent primaries. It is the only way to scale writes beyond one machine, and it is expensive in every way: queries across shards, transactions across shards, rebalancing when one shard gets hot, migrations run per shard, and backups and restores per shard.

For B2B SaaS, the natural shard key is the tenant, because almost every query already filters by it. If tenant id leads every key (lesson 2), you have kept this option open without paying for it. Most startups never need it: a large single Postgres serves a very long way, and when it does not, there are extensions and managed products that shard Postgres by a distribution key so you do not build it yourself.

## Search, briefly

A growing product catalogue or document list does not need a search engine on day one. Postgres full-text search with a GIN index (module 3, lesson 8) handles millions of rows and keeps search transactionally consistent with the data. Add a dedicated search engine when you need relevance tuning, facets at scale, typo tolerance or volumes where Postgres search measurably struggles, and accept that the index becomes an eventually consistent copy you must keep in sync.

## Common mistakes

- Adding replicas or a cache before checking for a missing index.
- Sending a user's read to a replica right after their write.
- Letting autoscaling multiply connections past `max_connections`.
- Using session features (`SET`, advisory locks, `LISTEN`) through a transaction-mode pooler.
- Partitioning a table that is neither large nor time-shaped, or sharding before scaling up.
- Putting per-user responses in a shared CDN cache.

## Go deeper

- [PostgreSQL: Hot Standby](https://www.postgresql.org/docs/current/hot-standby.html): queries on replicas and how they conflict with replay.
- [PostgreSQL: Table Partitioning](https://www.postgresql.org/docs/current/ddl-partitioning.html): declarative partitioning and its limitations.
- [PgBouncer features](https://www.pgbouncer.org/features.html): which session features work in each pooling mode.
- [MDN: HTTP caching](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Caching): browser and shared caches, `Cache-Control` and validation.
- [Amazon S3: performance guidelines](https://docs.aws.amazon.com/AmazonS3/latest/userguide/optimizing-performance.html): request rates per prefix for file-heavy designs.
