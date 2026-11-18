---
title: Optimistic and pessimistic concurrency
skills: [concurrency-control]
---

Module 3, lesson 5 showed the lost update and four ways to prevent it inside one transaction: an atomic `update`, `select ... for update`, a version column, and a stricter isolation level with retries. You also solved it in task t04. This lesson takes the same problem to the places it shows up in a real product: two people editing the same record in two browser tabs, a background job that must run on one instance only, and locks that span more than one row. The two families of answers are **optimistic** (detect the conflict and refuse) and **pessimistic** (prevent it by waiting).

## The question to ask first

Where does the "read" happen, and how long until the "write"?

- **Inside one request, milliseconds apart.** A row lock or an atomic `update` is simple and correct. The lock is held for a few milliseconds.
- **Across a human's think time**: the form loaded at 10:00, saved at 10:07. You cannot hold a database lock for seven minutes across two HTTP requests. Only optimistic concurrency works.
- **No row to lock at all**: "only one instance may run the nightly export", "only one signup per email while we call the fraud API". That is where advisory locks come in.

## Optimistic concurrency across HTTP

Give the row a `version` that every update increments, and make every update conditional on the version the client saw:

```sql
alter table documents add column version int not null default 1;

update documents
   set title = $3, body = $4, version = version + 1
 where id = $1 and version = $2
returning version;
```

One row back: the write won, and the new version goes back to the client. Zero rows: either the document does not exist or someone else saved first. Tell them apart with a second query, and report the conflict.

HTTP already has the vocabulary for this, so use it rather than inventing a field. The server sends the version as an **ETag**, and the client sends it back in **If-Match**:

```http
GET /documents/42 HTTP/1.1

HTTP/1.1 200 OK
ETag: "7"

PUT /documents/42 HTTP/1.1
If-Match: "7"
Content-Type: application/json

{ "title": "Q3 plan", "body": "..." }
```

| Situation | Response |
| --- | --- |
| `If-Match` matches the current version | `200` with the new `ETag` |
| `If-Match` does not match | `412 Precondition Failed` |
| `If-Match` missing on an endpoint that requires it | `428 Precondition Required` |

RFC 9110 names `412` for a failed `If-Match`. Some APIs answer `409 Conflict` instead, as the example table in module 4, lesson 1 did; either works if it is documented, but `412` is what generic HTTP clients and caches understand.

```ts
import pg from 'pg';

export async function updateDocument(pool: pg.Pool, id: number, ifMatch: string | undefined, input: { title: string; body: string }) {
  if (!ifMatch) return { status: 428 } as const;
  const expected = Number(ifMatch.replace(/^"|"$/g, ''));
  if (!Number.isInteger(expected)) return { status: 412 } as const;
  const { rows } = await pool.query(
    `update documents set title = $3, body = $4, version = version + 1
      where id = $1 and version = $2 returning version`,
    [id, expected, input.title, input.body],
  );
  if (rows.length === 1) return { status: 200, etag: `"${rows[0].version}"` } as const;
  const exists = await pool.query('select 1 from documents where id = $1', [id]);
  return { status: exists.rowCount ? 412 : 404 } as const;
}
```

Module 0 used ETags for caching, where the server compares `If-None-Match` to skip sending a body. `If-Match` is the write-side twin: it protects against overwriting what you have not seen. A front end handles the `412` by showing "this document changed since you opened it", with the other person's version and a way to merge or reload. That is a product decision, and it is the honest one: the user made their edit based on data that is no longer true.

When the conflict is not a person's decision, for example a job that recalculates a total, the server can **retry the read-modify-write** itself: read again, recompute, try the conditional update again, a few times with a small jittered backoff.

Optimistic concurrency shines when conflicts are rare. When many writers hit the same row constantly (a counter, a popular product's stock), most attempts fail and retry, and an atomic `update stock = stock - 1` or a lock does far better.

## Pessimistic locks, more precisely

`select ... for update` locks the selected rows until the transaction ends. A few refinements are worth knowing:

- **`for no key update`** is what a plain `update` takes. It still blocks other writers, but it does not block inserts into child tables whose foreign key points at this row, which `for update` does. Prefer it when you lock a row only to change non-key columns.
- **`nowait`** fails at once with `55P03` (`lock_not_available`) instead of waiting. Good for "someone else is editing this, try again" in an admin tool.
- **`lock_timeout`** caps the wait for any lock in the session or transaction: `set local lock_timeout = '2s'`. A lock wait without a cap is a hidden request with no timeout (lesson 1).
- **`skip locked`** takes only rows nobody holds, the outbox relay's trick from lesson 4.

Locks are held until commit, so the rule from module 3 stands: short transactions, and no network calls while holding a lock.

## Advisory locks

Sometimes there is no row to lock. You want to serialise "create the workspace for this email", but the workspace row does not exist yet. Or you want one instance of a scheduled job across all your containers. Postgres **advisory locks** lock an arbitrary 64-bit number that only your application gives meaning to:

```sql
begin;
select pg_advisory_xact_lock(hashtextextended('signup:ada@example.com', 0));
-- check, call what you need, insert: no other transaction with the same key gets past the line above
commit;  -- the lock is released here
```

The `_xact_` variants are released automatically at the end of the transaction. Use them. The session-level variants (`pg_advisory_lock`, `pg_advisory_unlock`) belong to the **connection**, and with a pool that is a trap: the lock outlives your request, stays with a connection someone else borrows next, and an unlock sent through `pool.query()` may run on a different connection and do nothing.

For "run on one instance", the non-blocking `pg_try_advisory_xact_lock(key)` returns `true` or `false` immediately. The instance that gets `true` runs the job; the others skip this round.

```ts
await tx(pool, async (client) => {
  const { rows } = await client.query('select pg_try_advisory_xact_lock($1) as ok', [EXPORT_LOCK_ID]);
  if (!rows[0].ok) return;   // another instance is on it
  await runNightlyExport(client);
});
```

Note that the job holds a transaction open while it runs. For long jobs, use a lease row in a table (lesson 3's `locked_until`) instead.

## Distributed locks and fencing tokens

You can also lock in Valkey with `SET lock:export <owner> NX PX 30000`. Any lock with an expiry has the problem lesson 3's lease had: a process that pauses (a long garbage collection, a frozen container) can lose its lock without knowing, while a second process takes it, and both then write.

The robust answer is a **fencing token**: each grant of the lock comes with a number that only increases, and the resource being protected rejects writes carrying an older number than one it has already seen. If that sounds familiar, it is a version column. Locks reduce how often two writers collide; the conditional write at the resource is what makes the collision harmless. When the resource is your Postgres, a conditional update often makes the external lock unnecessary.

## Deadlocks, once more

Module 3 explained the cause (two transactions waiting for each other) and the cure (always lock in the same order). Two places where the order hides:

- **Batch updates**: `update ... where id = any($1)` locks rows in whatever order the plan visits them. Lock first in a defined order with `select id from items where id = any($1) order by id for update`, then update.
- **Different code paths**: a transfer locks the payer then the payee, and a refund locks the payee then the payer. Lock by a rule (lowest id first), not by role.

When Postgres detects a deadlock it aborts one transaction with `40P01`. Log it, retry the whole transaction, and treat a steady rate of them as a bug in lock order.

## Choosing

| Situation | Use |
| --- | --- |
| Arithmetic on one row (stock, balance, counter) | Atomic conditional `update` |
| Read, decide, write in one request, several rows | `select ... for update` (ordered), short transaction |
| A user edits a record across requests | Version column, ETag and `If-Match` |
| Serialise on something that is not a row yet | `pg_advisory_xact_lock` |
| One instance runs a scheduled job | `pg_try_advisory_xact_lock` or a lease row |
| Workers share a queue table | `for update skip locked` |

## Common mistakes

- Last write wins on an edit form, silently discarding a colleague's changes.
- Treating a zero-row conditional update as success.
- Session-level advisory locks taken through a connection pool.
- Lock waits with no `lock_timeout`.
- A distributed lock with an expiry and no fencing at the resource.
- Optimistic retries on a hot row that every request touches.

## Go deeper

- [PostgreSQL: Explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html): row lock modes, advisory locks and deadlocks.
- [PostgreSQL: Advisory lock functions](https://www.postgresql.org/docs/current/functions-admin.html#FUNCTIONS-ADVISORY-LOCKS): every variant, session and transaction level.
- [RFC 9110: If-Match](https://www.rfc-editor.org/rfc/rfc9110#section-13.1.1): the precondition and when to answer `412`.
- [RFC 6585: 428 Precondition Required](https://www.rfc-editor.org/rfc/rfc6585#section-3): making clients send a precondition.
- [MDN: ETag](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/ETag): ETags for caching and for avoiding mid-air collisions.
