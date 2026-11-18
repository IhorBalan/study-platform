---
title: "From raw SQL to Drizzle"
skills: [db-access-node]
---

Everything so far happened in `psql`. Your service talks to Postgres through a driver, a connection pool and usually a query builder or ORM. Each layer can make the database look slow when the database is fine: a pool with no free connections, a hundred small queries where one would do, a transaction that spans two connections. This lesson starts from the `pg` driver (node-postgres), adds Drizzle on top, covers the N+1 problem, and compares Prisma and TypeORM.

## Why a pool

Each Postgres connection is a separate server process. Opening one costs a TCP handshake, often TLS, and authentication: several milliseconds, more than many queries. Each open connection also uses memory on the server, and `max_connections` defaults to 100. So you neither open a connection per request nor keep thousands open. You keep a small **pool** of open connections and lend them out.

```ts
import { Pool } from 'pg';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,                          // the default
  idleTimeoutMillis: 10_000,        // close idle connections after 10 s (the default)
  connectionTimeoutMillis: 5_000,   // the default is 0: wait forever for a free connection
});

const { rows } = await pool.query('select id, title from tasks where team_id = $1', [teamId]);
```

`pool.query` borrows a connection, runs one statement and returns it. Size the pool from the database's side: the sum of `max` over every instance of every service must stay below `max_connections`, with room for migrations and your own `psql`. Ten application instances with `max: 20` already need 200. Serverless functions, where every instance has its own pool, usually need a proxy such as PgBouncer in front of Postgres.

Always set `connectionTimeoutMillis`. With the default, a request waiting for a connection waits forever, and the symptom is requests that hang with no error.

## Parameterised queries

```ts
// Never:
await pool.query(`select * from users where email = '${email}'`);
// Always:
await pool.query('select * from users where email = $1', [email]);
```

With placeholders, `pg` sends the SQL text and the values separately, and Postgres never parses the values as SQL. That rules out SQL injection for values. Placeholders cannot stand for identifiers (table or column names) or keywords such as `asc`; when those come from a request, map them through a fixed allow-list in code.

Two type surprises: `bigint` (`int8`) and `numeric` come back as **strings**, because a JavaScript number cannot hold every value exactly. Convert deliberately, for example with `Number(row.id)` where you know ids stay below 2^53, and keep money as integer cents or as strings.

## Transactions need one client

`pool.query('begin')` and the next `pool.query(...)` may run on different connections, and then there is no transaction at all. Take one client and release it in `finally`:

```ts
import type { Pool, PoolClient } from 'pg';

export async function inTransaction<T>(pool: Pool, work: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
```

## Pool exhaustion is not a deadlock

The two are often confused, and they look different:

- **Pool exhaustion** happens in your process. All clients are checked out and new callers wait for one. Causes: a client that is never released (a missing `finally`), transactions that wait on slow external calls, more concurrent work than `max`, or code that holds a client in a transaction and then calls `pool.query` for another query, which needs a second client. If every request does that at once, they all hold one and wait for another forever. Symptoms: requests hang or fail with `timeout exceeded when trying to connect`; the database itself is idle.
- **A database deadlock** happens inside Postgres. Two transactions each hold a row lock the other needs. Postgres detects it within about a second and aborts one with `40P01`. Symptom: an error, not a hang.

When everything hangs and Postgres shows few active queries, suspect the pool. Monitor `pool.totalCount`, `pool.idleCount` and `pool.waitingCount`.

## Drizzle: SQL-shaped and typed

Drizzle is a TypeScript query builder with an optional ORM-style layer. You declare tables in TypeScript, and queries read like SQL with full types:

```ts
// schema.ts
import { bigint, index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const authors = pgTable('authors', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  name: text('name').notNull(),
});

export const posts = pgTable('posts', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  authorId: bigint('author_id', { mode: 'number' }).notNull().references(() => authors.id),
  title: text('title').notNull(),
  likes: integer('likes').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('posts_author_id_created_at_idx').on(t.authorId, t.createdAt)]);

export type Post = typeof posts.$inferSelect;
```

```ts
// queries.ts
import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';
import { authors, posts } from './schema.js';
import { pool } from './pool.js';

const db = drizzle(pool, { schema });

const recent = await db
  .select({ id: posts.id, title: posts.title, author: authors.name })
  .from(posts)
  .innerJoin(authors, eq(posts.authorId, authors.id))
  .where(and(eq(posts.authorId, 42), gt(posts.likes, 0)))
  .orderBy(desc(posts.createdAt))
  .limit(20);

await db.transaction(async (tx) => {
  await tx.update(posts).set({ likes: sql`${posts.likes} + 1` }).where(eq(posts.id, 7));
});
```

Drizzle sends every value as a parameter. `db.transaction` takes one client from the pool for you. The `sql` template tag is the escape hatch for anything the builder does not cover, still parameterised. `.toSQL()` on a query shows the SQL it will send, which is the first thing to look at when a query is slow.

Drizzle Kit (a separate dev dependency) compares your schema files with the database and generates SQL migrations. Read what it generates: it does not know your table is large (lesson 6).

## The N+1 problem

```ts
const authorsList = await db.select().from(authors).limit(50);       // 1 query
for (const a of authorsList) {
  a.posts = await db.select().from(posts).where(eq(posts.authorId, a.id));   // + 50 queries
}
```

One query for the list, then one per item: N+1 round trips. Each is fast in isolation, so it hides in development and becomes the slowest endpoint in production, where every round trip costs a millisecond or more. Fixes:

- **A join** when you need a flat result.
- **One batched query**: `where(inArray(posts.authorId, ids))`, then group in memory.
- **Drizzle's relational queries**, after declaring `relations(...)`: `db.query.authors.findMany({ with: { posts: true } })` builds a single SQL statement for the whole tree.
- **DataLoader** in GraphQL resolvers, which collects the ids requested in one tick and loads them in one query.

Spot it by logging queries (`drizzle(pool, { logger: true })`) or by counting queries per request in tests.

## Prisma and TypeORM

| | Drizzle | Prisma | TypeORM |
|---|---|---|---|
| Schema | TypeScript tables | Its own `schema.prisma` language, generates a client | Decorated entity classes |
| Queries | SQL-shaped builder, plus relational queries | Object API (`findMany`, `include`), no SQL shape | Repositories, a query builder, Active Record option |
| Raw SQL | `sql` tag, first-class | `$queryRaw` tagged template | `query()` and the query builder |
| Migrations | Drizzle Kit generates SQL | Prisma Migrate generates SQL | Generated from entities, or hand-written |
| Fits | Teams who know SQL and want types | Teams who want the most guided API and tooling | Existing NestJS and Java-style codebases |

Prisma has the gentlest learning curve and good tooling. Its recent versions dropped the separate Rust query engine and connect through driver adapters such as `pg`, which removed most of its old deployment pain. TypeORM integrates closely with NestJS and is common in existing code; its typing of query results is weaker, and its decorators hide what SQL runs. Drizzle stays closest to SQL, so what you learned in this module carries over directly.

## ORM, query builder or raw SQL?

- **Raw SQL** with `pg`: full control and no abstraction to learn. You write result types and mapping by hand, and dynamic queries are string assembly.
- **Query builder** (Drizzle, Kysely): typed SQL. You still think in tables and joins. A good default for most services.
- **ORM** (Prisma, TypeORM): you think in objects and relations, and it writes SQL for you. Fast for CRUD, and easy to generate N+1 queries or over-fetch without noticing.

Whatever you choose, keep the escape hatch to SQL, and look at the SQL that runs.

## Common mistakes

- A new `Client` per request, or a `Pool` per request.
- `connectionTimeoutMillis` left at 0, so pool exhaustion looks like a hang.
- `begin` and `commit` through `pool.query`.
- Releasing a client only on the success path.
- Holding a transaction's client while awaiting `pool.query` or an HTTP call.
- Template strings with values in SQL.
- Queries inside a loop over query results.

## Go deeper

- [node-postgres: Pooling](https://node-postgres.com/features/pooling): checkout, release and pool events.
- [node-postgres: Pool API](https://node-postgres.com/apis/pool): every option and counter.
- [Drizzle ORM documentation](https://orm.drizzle.team/docs/overview): schema, queries, relational queries and Drizzle Kit.
- [Prisma documentation](https://www.prisma.io/docs): schema language, client and migrations.
- [TypeORM documentation](https://typeorm.io): entities, repositories and the query builder.
