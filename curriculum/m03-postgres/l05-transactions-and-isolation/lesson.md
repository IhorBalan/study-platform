---
title: "Transactions, MVCC and isolation"
skills: [transactions-isolation]
---

A transaction groups statements so that they succeed or fail together. That part is easy. The hard part is what happens when many transactions run at once: what each one sees of the others, which ones wait, and which ones fail. Get it wrong and you sell the last concert ticket twice, with code that passed every test. This lesson explains how Postgres keeps concurrent transactions apart (MVCC), what VACUUM cleans up afterwards, the isolation levels and their anomalies, and how to handle locks, deadlocks and serialization failures.

## Transactions live on one connection

```sql
begin;
update accounts set balance = balance - 100 where id = 1;
update accounts set balance = balance + 100 where id = 2;
commit;   -- or rollback
```

`begin` and `commit` apply to the connection that sent them. With a connection pool, every statement of a transaction must go through the same client. Lesson 7 shows how that looks with `pg`.

## MVCC: readers do not block writers

Postgres never overwrites a row in place. An `update` writes a new version of the row and marks the old one as replaced; a `delete` only marks it. Each version records which transaction created it and which one ended it. When a statement runs, it gets a **snapshot**: the list of transactions that had committed at that moment. It sees exactly the row versions that were current in that snapshot.

The consequences:

- Readers never wait for writers, and writers never wait for readers. A long report does not block checkout.
- Two writers to the **same row** do wait: the second waits for the first to commit or roll back.
- Old versions stay in the table after nobody can see them any more. They are **dead tuples**.

## Dead tuples and VACUUM

Dead tuples take space and slow down scans. `VACUUM` removes them:

- It marks their space as free, so **new rows in the same table** can reuse it.
- It updates the visibility map, which makes index-only scans possible.
- It freezes old transaction ids, which prevents transaction id wraparound, a condition in which Postgres stops accepting writes to protect your data.

What `VACUUM` does **not** do, in general, is give disk space back to the operating system. The table file keeps its size; only completely empty pages at its very end are cut off. `VACUUM FULL` rewrites the table into a new compact file and returns the space, but holds an exclusive lock for the whole time: no reads, no writes. Tools such as `pg_repack` do the same with only a brief lock.

You rarely run `VACUUM` by hand. **Autovacuum** runs it, and `ANALYZE`, when enough rows have changed. Two situations defeat it:

1. **Long-running transactions.** A dead tuple can only be removed when no open snapshot might still need it. One session left `idle in transaction` for hours holds back cleanup on every table. Watch `pg_stat_activity` and set `idle_in_transaction_session_timeout`.
2. **Very large tables with heavy updates**, where the default thresholds (a fraction of the table) mean autovacuum runs too rarely. Tune them per table.

## Isolation levels and anomalies

The SQL standard defines anomalies, and isolation levels by which anomalies they allow:

| Anomaly | What happens |
|---|---|
| Dirty read | You see another transaction's uncommitted change |
| Non-repeatable read | You read a row twice and get different values |
| Phantom read | You run the same `where` twice and get different rows |
| Serialization anomaly | The result matches no order of running the transactions one by one |

How Postgres behaves at each level:

| Level | Dirty read | Non-repeatable | Phantom | Serialization anomaly |
|---|---|---|---|---|
| Read Uncommitted | No (behaves as Read Committed) | Possible | Possible | Possible |
| Read Committed (default) | No | Possible | Possible | Possible |
| Repeatable Read | No | No | No (stricter than the standard) | Possible |
| Serializable | No | No | No | No |

**Postgres has no real Read Uncommitted.** You can ask for it, and you get Read Committed: MVCC never exposes uncommitted versions.

**Read Committed** takes a new snapshot for every statement. Two `select`s in one transaction can see different data. When an `update` finds that its target row was changed by a transaction that just committed, it re-checks its `where` clause against the new version and carries on. That rule is what makes `update ... set stock = stock - 1 where stock >= 1` safe.

**Repeatable Read** takes one snapshot at the first statement and keeps it, so the transaction sees a frozen picture of the database. If it tries to update a row that another transaction changed after that snapshot, it fails with `could not serialize access due to concurrent update`, SQLSTATE `40001`.

**Serializable** adds tracking of what each transaction read. If a set of concurrent transactions could produce a result impossible in any serial order, one of them fails with `40001`. It costs some overhead and more retries; in exchange you can reason about each transaction as if it ran alone.

## The lost update

The most common concurrency bug in web backends:

```ts
const { rows } = await db.query('select stock from products where id = $1', [id]);
if (rows[0].stock < qty) throw new OutOfStockError();
await db.query('update products set stock = $1 where id = $2', [rows[0].stock - qty, id]);
```

Two requests read `stock = 1`, both pass the check, both write `0`. Two items sold, one in stock. Read Committed does not prevent this, because each statement is fine on its own. Four fixes:

1. **One atomic statement.** `update products set stock = stock - $2 where id = $1 and stock >= $2`. Zero rows updated means out of stock. The simplest and usually the best.
2. **Lock the row first.** `select stock from products where id = $1 for update` inside a transaction. The second request waits at the `select` until the first commits, then reads the new value.
3. **Optimistic concurrency.** Add a `version` column, update `where id = $1 and version = $2`, and treat zero rows as a conflict to report or retry. Good when conflicts are rare and you cannot hold a lock, for example across an HTTP round trip to a user.
4. **Repeatable Read or Serializable, with retries.** The second writer gets `40001` and runs the whole transaction again.

## Write skew

Two doctors are on call; the rule is that at least one must stay on call. Each checks "is someone else on call?", sees yes, and takes themself off. Each transaction updated a different row, so no row lock conflicted, and nobody is on call. This is write skew, and only Serializable prevents it automatically. Alternatives: lock the rows you read with `for update`, or model the rule so that it becomes a constraint or a conflict on one row.

## Locks

Row locks come from `update`, `delete` and `select ... for update` (or the weaker `for no key update`, `for share`). They are held until the transaction ends, so keep transactions short and never wait for an HTTP call while holding one.

Two modifiers are worth knowing:

- `for update skip locked` skips rows another transaction has locked. It turns a table into a job queue: each worker claims the next unlocked job.
- `for update nowait` fails immediately instead of waiting.

DDL such as `alter table` takes table-level locks, which lesson 6 covers. Set `lock_timeout` so a statement gives up instead of waiting forever.

## Deadlocks

Transaction A locks row 1 and wants row 2. Transaction B locks row 2 and wants row 1. Neither can proceed. Postgres checks for this after `deadlock_timeout` (1 second by default), aborts one of them with `deadlock detected`, SQLSTATE `40P01`, and lets the other continue.

The standard prevention is a consistent lock order. A transfer between two accounts should lock the lower id first, whatever the direction of the transfer. Batch updates should process ids in sorted order.

## When to retry

Retry the **whole transaction**, from `begin`, on exactly these errors:

- `40001` serialization failure
- `40P01` deadlock detected

Both mean "this would have worked alone; try again". Re-run every read as well, because the decision you made from old data may now be wrong. Retry a few times with a small random backoff. Do not retry constraint violations (`23505` unique, `23503` foreign key, `23514` check): they will fail again. And keep side effects such as sending an email or calling Stripe outside the retried block, or make them idempotent.

```ts
const RETRYABLE = new Set(['40001', '40P01']);

export async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();   // fn runs begin ... commit on one client
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (!code || !RETRYABLE.has(code) || i >= attempts) throw error;
      await new Promise((r) => setTimeout(r, 10 * 2 ** i + Math.random() * 20));
    }
  }
}
```

## Common mistakes

- Read, decide in code, write back an absolute value: a lost update.
- `begin` and `commit` sent through `pool.query`, so they run on different connections.
- Holding a transaction open across a network call or user think time.
- Locking rows in a different order in different code paths.
- Retrying only the failed statement instead of the whole transaction.
- Expecting `VACUUM` to shrink the table file.

## Go deeper

- [PostgreSQL: Concurrency control](https://www.postgresql.org/docs/current/mvcc.html): the MVCC chapter.
- [PostgreSQL: Transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html): exact behaviour of each level, with examples.
- [PostgreSQL: Explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html): table and row lock modes, and deadlocks.
- [PostgreSQL: Routine vacuuming](https://www.postgresql.org/docs/current/routine-vacuuming.html): autovacuum, space reuse and wraparound.
- [PostgreSQL: Error codes](https://www.postgresql.org/docs/current/errcodes-appendix.html): every SQLSTATE, including 40001 and 40P01.
