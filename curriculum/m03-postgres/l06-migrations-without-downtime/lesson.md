---
title: "Migrations without downtime"
skills: [zero-downtime-migrations]
---

On your laptop every migration takes milliseconds. On a production table with 200 million rows and a thousand queries a second, the same `alter table` can block every request for ten minutes. The problem is rarely the work itself; it is the lock the work holds. This lesson shows which schema changes are safe on a large live table, how to do the unsafe ones in safe steps, and the expand and contract pattern that keeps old and new application code working during a deploy.

## Locks are the real risk

Most `alter table` forms take an `ACCESS EXCLUSIVE` lock: nothing else may read or write the table while it is held. If the change only touches the catalog, the lock lasts a moment and nobody notices. If it rewrites or scans the table, the lock lasts as long as that work.

There is a second trap. A lock request waits in a queue. If a slow report holds an ordinary read lock on `orders`, your `alter table orders` waits for it, and **every query that arrives after your `alter table` waits behind it**, even plain `select`s. A migration that would take 5 ms can stall the whole application for as long as the report runs.

So every migration on a busy table starts with:

```sql
set lock_timeout = '3s';
```

If the lock cannot be taken within 3 seconds, the migration fails instead of queueing traffic behind it. Retry it a little later. Many teams also set `statement_timeout` for migrations.

## Which changes are cheap

| Change | Cost on a large table |
|---|---|
| Add a nullable column, no default | Catalog only. Instant. |
| Add a column with a constant default (`default 'eu'`, `default now()`) | Catalog only since PostgreSQL 11. Instant. |
| Add a column with a volatile default (`default gen_random_uuid()`) | Rewrites the table under an exclusive lock. |
| `set not null` on an existing column | Scans the whole table under an exclusive lock, unless a validated constraint already proves it. |
| `create index` | Blocks all writes for the whole build. |
| `create index concurrently` | Allows reads and writes. Slower, cannot run inside a transaction. |
| Add a check constraint | Scans the table under an `ACCESS EXCLUSIVE` lock, so no reads or writes, unless added `not valid` and validated separately. |
| Add a foreign key | Scans the table while blocking writes on both tables, unless added `not valid` and validated separately. |
| Change a column's type | Usually rewrites the table and its indexes. Some changes, such as `varchar(50)` to `text`, do not. |
| Rename or drop a column | Instant in the database, and breaks every running instance of the old code. |

## Adding a NOT NULL column to a big table

Say every order needs a `region`. Adding it as `not null` with a fixed default is instant, but often there is no correct default: the value must be computed per row. The safe sequence:

```sql
-- 1. Add the column as nullable. Instant.
alter table orders add column region text;
```

Deploy code that writes `region` for every new order. From now on no new nulls appear.

```sql
-- 2. Backfill existing rows in batches, each in its own short transaction.
update orders o
set region = c.region
from customers c
where c.id = o.customer_id
  and o.id > $1
  and o.id <= $1 + 5000;
-- start with $1 = 0 and add 5000 each time, until $1 passes max(id)
```

The loop walks the table by `id` and stops when it runs out of ids. Selecting "the next 5,000 rows where `region is null`" and repeating until nothing is updated looks simpler, but it never ends if some customers have no region: their orders are set to `NULL` again on every pass and are picked again. Decide what those rows get (a fallback value or a data fix) before step 3.

Small batches keep each transaction short, so row locks are brief, autovacuum keeps up, and replicas do not fall far behind. A script or job runs the loop and pauses between batches.

```sql
-- 3. Add the rule without checking existing rows. Brief lock.
alter table orders add constraint orders_region_not_null check (region is not null) not valid;

-- 4. Check existing rows. Scans the table but does not block reads or writes.
alter table orders validate constraint orders_region_not_null;

-- 5. Promote to a real NOT NULL. Postgres sees the validated check and skips the scan.
alter table orders alter column region set not null;
alter table orders drop constraint orders_region_not_null;
```

`not valid` means "enforce this for new writes, but do not check old rows yet". `validate constraint` does the check with a lock that lets normal traffic continue. Step 5 is instant because Postgres can prove from the check that there are no nulls.

PostgreSQL 18 shortens this: a `NOT NULL` constraint itself can be added as `not valid` and validated later (`alter table orders add constraint orders_region_not_null not null region not valid`, then `validate constraint`). The check-constraint route works on every supported version.

Foreign keys follow the same pattern: add with `not valid`, then `validate constraint`.

## Adding an index to a live table

```sql
create index concurrently if not exists orders_customer_id_created_at_idx
  on orders (customer_id, created_at);
```

`concurrently` builds the index in several passes while writes continue. Three things to know:

- It cannot run inside a transaction block. Many migration tools wrap each migration in a transaction; put concurrent index builds in a migration of their own, with the wrapping turned off.
- If it fails (a deadlock, a unique violation, a cancelled statement), it leaves an `INVALID` index behind. The index costs writes and serves no reads. Find it with `select indexrelid::regclass from pg_index where not indisvalid`, drop it with `drop index concurrently`, and try again.
- `reindex index concurrently` rebuilds a bloated or broken index the same way.

## Expand and contract

A deploy is not atomic. During a rolling deploy, old and new versions of your app run side by side for minutes, and a rollback brings the old version back. So every migration must work with **both** the code before it and the code after it.

That rules out renaming a column in one step: the old code still queries the old name. Instead, split the change into an **expand** phase that only adds, and a **contract** phase that only removes, with deploys in between. To rename `customers.name` to `full_name`:

1. **Expand**: add `full_name`, nullable.
2. **Deploy**: code writes both `name` and `full_name`, still reads `name`.
3. **Backfill**: copy `name` into `full_name` in batches.
4. **Deploy**: code reads `full_name`, still writes both.
5. **Deploy**: code stops writing `name`.
6. **Contract**: drop `name`.

Each step can be rolled back to the one before it without losing data. The same shape works for splitting a table, changing a column's type, or moving data to a new table. It costs several deploys; that is the price of never being down.

Two related rules:

- **Never drop a column that running code still selects.** ORMs often select every column by name, so even unused columns must leave the code first.
- **Keep migrations separate from deploys of code that depends on them.** Run the migration, check it, then deploy.

## Your migration tool

Drizzle Kit, Prisma Migrate and node-pg-migrate all generate or run SQL files. None of them knows your table is large. Read the SQL a tool generates before it reaches production, and rewrite it in the safe forms above where needed. Test migrations against a copy of production-sized data at least once.

## Common mistakes

- Running `alter table` on a busy table without `lock_timeout`.
- `create index` without `concurrently` on a live table.
- A concurrent index build inside a migration transaction, or an `INVALID` index left behind.
- `alter column set not null` on a large table without a validated check first.
- One giant `update` to backfill a column.
- Renaming or dropping a column in the same deploy as the code change.

## Go deeper

- [PostgreSQL: ALTER TABLE](https://www.postgresql.org/docs/current/sql-altertable.html): the notes section lists which forms rewrite or scan the table, and which lock each takes.
- [PostgreSQL: CREATE INDEX](https://www.postgresql.org/docs/current/sql-createindex.html): "Building Indexes Concurrently" explains the passes and failure modes.
- [PostgreSQL: Explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html): which lock modes conflict with which.
- [PostgreSQL: Client connection defaults](https://www.postgresql.org/docs/current/runtime-config-client.html): `lock_timeout` and `statement_timeout`.
