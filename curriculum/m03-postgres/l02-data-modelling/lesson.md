---
title: "Data modelling: keys, constraints and normalisation"
skills: [data-modelling]
---

Your schema outlives every version of your API. Code that writes to the database will change, multiply and be bypassed by scripts and migrations; the schema is the one thing every write passes through. So the rules that must always hold belong in the schema, as constraints, where no code path can skip them. This lesson covers how to choose keys, which constraints to use, and how normalisation decides where each fact lives.

## Keys

Every table needs a primary key: a column or set of columns that is unique and never null. Two choices matter.

**Surrogate or natural key.** A natural key is a real-world value, such as an email address or an ISBN. A surrogate key is an id with no meaning. Prefer a surrogate primary key and enforce the natural key with a separate unique constraint. Natural keys change (people change email), and every foreign key that points at a changed value must change with it.

**Integer or UUID.** For surrogates in Postgres:

```sql
id bigint generated always as identity primary key
-- or
id uuid primary key default uuidv7()
```

`bigint` identity is compact (8 bytes), fast to index and readable in logs. `generated always` stops clients from inserting their own ids by accident. Its weaknesses: ids are guessable and sequential, which can leak business volume, and they can only be created by the database. UUIDs can be created anywhere, including in the client before the row exists, and reveal nothing. Random UUIDs (version 4) scatter inserts across the whole index, which hurts write performance on large tables. Version 7 UUIDs start with a timestamp, so new values land at the end of the index like an identity does. PostgreSQL 18 has a built-in `uuidv7()` function.

Use `bigint`, not `integer`, for ids. Running out of 2.1 billion values on a busy table is an outage, and the fix is a painful migration.

## Constraints

Think of constraints as types for data at rest. A TypeScript type disappears at run time; a constraint is checked on every insert and update, forever.

```sql
create table tasks (
  id           bigint generated always as identity primary key,
  team_id      bigint not null references teams (id) on delete cascade,
  title        text not null check (char_length(title) between 1 and 200),
  status       text not null default 'todo' check (status in ('todo', 'doing', 'done')),
  completed_at timestamptz,
  constraint completed_iff_done check ((status = 'done') = (completed_at is not null))
);
create index tasks_team_id_idx on tasks (team_id);
```

- **`NOT NULL`** on every column that must have a value. Nullable should be a decision, not a default.
- **`CHECK`** for rules about one row: ranges, allowed values, and rules that tie two columns together, like `completed_iff_done`. A check cannot look at other rows.
- **`UNIQUE`** for natural keys. It creates a unique index. For case-insensitive uniqueness, use a unique index on an expression: `create unique index on users (lower(email))`.
- **Foreign keys** (`references`) guarantee the referenced row exists. Choose the delete behaviour deliberately: the default (`no action`, nearly the same as `restrict`) refuses to delete a parent with children; `cascade` deletes the children; `set null` keeps them and clears the reference.

Postgres indexes the referenced side of a foreign key, because it must be unique, but never the referencing side. Without an index on `tasks.team_id`, deleting a team scans all of `tasks` to find children, and every join from teams to tasks does the same. Add one index per foreign key, unless an existing index already starts with those columns.

### Composite foreign keys enforce relationships

"A task can only be assigned to a member of its team" sounds like application logic. It is a constraint, if the foreign key points at the membership instead of at the user:

```sql
alter table tasks add column assignee_id bigint;
alter table tasks add constraint tasks_assignee_is_member
  foreign key (team_id, assignee_id) references memberships (team_id, user_id)
  on delete set null (assignee_id);
```

When a user leaves the team, their membership row is deleted and only `assignee_id` is cleared; `team_id` stays. The column list after `set null` exists since PostgreSQL 15.

### Enums: CHECK or enum type?

`check (status in (...))` and `create type status as enum (...)` both restrict values. A check is easier to change: drop it and add a new one. An enum type is stored compactly and documents itself, and adding a value is cheap, but removing or renaming a value is awkward. A lookup table with a foreign key is the most flexible, and the right choice when values carry their own data (a label, a sort order). Pick one style per codebase.

## Normalisation

Normalisation is the discipline of storing each fact once. The normal forms boil down to three questions you ask of every column:

1. **One value per cell.** No comma-separated lists of ids. A list becomes its own table, or a Postgres array when you never need to join on it or enforce references.
2. **Depends on the whole key.** In `order_items (order_id, product_id, quantity, product_name)`, `product_name` depends only on `product_id`. It belongs in `products`.
3. **Depends on nothing but the key.** In `orders (id, customer_id, customer_email)`, `customer_email` depends on `customer_id`, not on the order. When the customer changes their address, which orders do you update?

Every duplicated fact is a future inconsistency. A normalised schema makes wrong states impossible to store, which is worth more than any validation layer.

### Not every copy is duplication

`order_items.unit_price` looks like a copy of `products.price`. It is not: it records the price *at the time of the order*, a different fact that must not change when the catalogue does. The same goes for a shipping address on an order. Ask "should this change when the source changes?" If no, it is a separate fact and belongs where it is.

## Denormalising on purpose

Sometimes reading is too slow because the answer has to be assembled from many rows. Then you store a derived value: a `comment_count` on posts, a `total_cents` on orders, a search document built from several tables. That is denormalisation, and it is a trade:

- **You gain** cheap reads, and indexes on values that otherwise only exist after a join or aggregate.
- **You pay** with a second copy that must be updated on every write, in the same transaction, by every code path. A missed path means a counter that drifts.

Do it when you have measured a slow read, not in advance. Prefer mechanisms that cannot drift: a generated column (`generated always as (...) stored`) for values computed from the same row, a trigger or a materialised view for values from other rows, and a periodic job that recomputes and compares when drift would be costly.

## JSONB columns

`jsonb` stores a JSON document in a column, with indexing support. It is a good fit for data you store and return whole but rarely filter on: webhook payloads, third-party responses, per-tenant settings. It is a poor fit for core entities: no foreign keys inside it, no `NOT NULL` per field, and the planner knows little about its contents. A useful rule: if you put a field in a `WHERE` clause or join on it regularly, it deserves a real column.

## Common mistakes

- Validating only in the API, so a script or a second service writes data the API would have rejected.
- A natural key (email, username) as the primary key, referenced from every other table.
- `integer` ids on tables that will grow, or random UUIDs on a table with heavy inserts.
- Foreign keys without an index on the referencing column.
- Copying a value "for speed" without deciding how it stays in sync.
- A `jsonb` column that slowly becomes the real schema, with no constraints.

## Go deeper

- [PostgreSQL: Constraints](https://www.postgresql.org/docs/current/ddl-constraints.html): every constraint type, including foreign key actions.
- [PostgreSQL: Data types](https://www.postgresql.org/docs/current/datatype.html): numeric, text, time and UUID types and their trade-offs.
- [PostgreSQL: Identity columns](https://www.postgresql.org/docs/current/ddl-identity-columns.html): `generated always` versus `by default`.
- [PostgreSQL: Generated columns](https://www.postgresql.org/docs/current/ddl-generated-columns.html): stored and virtual computed columns.
- [PostgreSQL: JSON types](https://www.postgresql.org/docs/current/datatype-json.html): `json` versus `jsonb` and their indexing.
