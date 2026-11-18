---
title: "Optional: Row-Level Security and document stores"
skills: [row-level-security, document-stores]
---

Optional reading: no task depends on this lesson, and you can skip it and come back when a project needs it. It covers two topics that come up in design discussions and interviews. Row-Level Security lets Postgres itself keep tenants' data apart. Document stores such as MongoDB are the main alternative to a relational model, and the question "SQL or NoSQL?" deserves a better answer than habit.

## Multi-tenant data and its failure mode

Most SaaS products keep all customers (tenants) in shared tables with a `tenant_id` column. Every query must then include `where tenant_id = $1`. One forgotten condition, in a new endpoint, a report or an admin script, and one customer sees another's data. Code review catches most of these. Row-Level Security (RLS) catches the rest, because the database adds the condition itself.

## Row-Level Security

RLS attaches **policies** to a table. A policy is a condition that Postgres adds to every query on the table for the roles it applies to:

```sql
alter table projects enable row level security;
alter table projects force row level security;

create policy tenant_isolation on projects
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::bigint)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::bigint);
```

- `using` filters which existing rows a query can see, update or delete.
- `with check` validates rows being inserted or updated, so a tenant cannot write a row for another tenant.
- With RLS enabled and no matching policy, a role sees **no rows**. The default is deny.
- `current_setting('app.tenant_id', true)` reads a custom setting. The `true` returns `NULL` instead of raising an error when the setting was never defined. On a pooled connection where an earlier transaction set it, the setting reads as an empty string afterwards, and casting `''` to `bigint` would raise an error. `nullif(..., '')` turns that into `NULL` too. Either way the policy matches nothing.

Who is exempt matters more than the policy itself:

- **Superusers and roles with `BYPASSRLS`** ignore all policies. Your application must not connect as one. Many managed databases and local setups hand out a superuser by default.
- **The table's owner** ignores policies unless you add `force row level security`. Migrations usually run as the owner, so the application should connect as a different role that only has `select`, `insert`, `update` and `delete` grants.

### Setting the tenant with a connection pool

The application sets the tenant at the start of each transaction:

```ts
await inTransaction(pool, async (client) => {
  await client.query(`select set_config('app.tenant_id', $1, true)`, [String(tenantId)]);
  const { rows } = await client.query('select id, name from projects');   // only this tenant's rows
  return rows;
});
```

The third argument `true` makes the setting **local to the transaction**, the same as `set local`. That detail is essential with a pool: a session-level `set` would stay on the connection and leak into the next request that borrows it, which then sees the previous tenant's data. Always set the tenant inside a transaction, on the same client as the queries.

### Costs and limits

- Every query gets the policy's condition, so `tenant_id` must lead your indexes. A policy that calls a function or a subquery per row can be slow; keep it a plain comparison.
- Errors become silent: a missing tenant setting returns empty results rather than failing. Log or assert the tenant in your data layer as well.
- RLS protects rows. It does not stop a tenant from exhausting shared resources, and it is no substitute for authorisation checks on what a user may do within their tenant.

RLS is defence in depth. Keep the `where tenant_id = $1` in your queries for clarity and index use, and let the policy catch the one you forget.

## Document stores

A document store such as MongoDB keeps records as JSON-like documents grouped in collections, with no fixed schema per collection. A blog post can hold its comments, tags and author name inside one document:

```json
{
  "_id": "post_42",
  "title": "Hello",
  "author": { "id": "u_7", "name": "Ada" },
  "tags": ["intro", "news"],
  "comments": [{ "by": "u_9", "text": "Welcome!", "at": "2026-11-01T10:00:00Z" }]
}
```

Reading the post with everything on it is one lookup, no joins. That is the core trade: **you design documents around the queries you will run**, instead of designing tables around the facts and joining at query time.

### Where a document store fits

- **Data read and written as one unit**, whose shape varies between records: product catalogues with category-specific attributes, CMS content, event payloads, user settings.
- **Aggregates with clear boundaries**, where nearly every operation touches one document. An order with its lines, a form submission with its answers.
- **Very high write throughput spread across many machines**, using built-in sharding by a key that matches the access pattern.

### Where it fights you

- **Data with many relationships** queried from several directions. "All comments by user 9 across all posts" is easy in SQL and awkward when comments live inside posts. You end up duplicating data and keeping copies in sync, the denormalisation cost from lesson 2, everywhere.
- **Invariants across records.** MongoDB has supported multi-document transactions since version 4.0 and offers schema validation, but foreign keys, check constraints across fields and unique rules on related data are much weaker than in Postgres.
- **Ad hoc questions.** Reporting and analytics on embedded data need aggregation pipelines that are harder to write and to index than SQL.

### SQL or NoSQL?

For a new product with a small team, Postgres is the default for good reasons: constraints that keep data correct, transactions, joins for questions you have not thought of yet, and `jsonb` for the parts that really are document-shaped. A `jsonb` column with a GIN index covers many "we need flexible attributes" cases without a second database.

Choose a document store when the data really is a set of independent aggregates with varying shape, the access patterns are known and stable, and you value horizontal write scaling or the document programming model more than relational integrity. "We don't want to write migrations" is not one of those reasons: a schemaless database still has a schema, it just lives in your code, unchecked.

Running both is common, too: Postgres as the system of record, and a document store or a search engine for one read-heavy view of the data.

## Common mistakes

- The application connecting as a superuser or as the table owner, so RLS policies are silently skipped.
- Setting the tenant with a session-level `set` on a pooled connection.
- A policy without `with check`, so tenants can write rows into another tenant.
- Embedding unbounded arrays (every comment ever) in one document, which grows without limit.
- Picking a document store to avoid schema design, then rebuilding joins in application code.

## Go deeper

- [PostgreSQL: Row security policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html): policies, `force`, and who bypasses them.
- [PostgreSQL: CREATE POLICY](https://www.postgresql.org/docs/current/sql-createpolicy.html): permissive and restrictive policies per command.
- [PostgreSQL: JSON types](https://www.postgresql.org/docs/current/datatype-json.html): `jsonb` operators and indexing.
- [MongoDB: Data modelling](https://www.mongodb.com/docs/manual/data-modeling/): embedding versus referencing, from the source.
