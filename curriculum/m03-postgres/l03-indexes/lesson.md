---
title: "Indexes: choosing the right one"
skills: [sql-indexes]
---

Without an index, Postgres answers `where customer_id = 42` by reading every row of the table. That is fine at a thousand rows and an outage at fifty million. An index is a second, smaller structure that finds rows without reading them all. Every index also slows down writes and takes disk and memory, so the skill is not "add indexes" but "add the few that match your queries". This lesson covers the index types you will use, how to order the columns of a composite index, and why the planner sometimes ignores an index you created.

## What a B-tree index is

The default index type is a B-tree: the values of the indexed columns, kept sorted, each with a pointer to the row in the table (the heap). Think of it as a sorted array of `[value, rowPointer]` with a few levels of signposts on top, so finding a value takes a handful of page reads instead of a scan.

Because it is sorted, a B-tree serves more than equality:

- `=`, `<`, `>`, `between`, `in (...)`
- `order by` on the indexed columns, so the plan has no Sort step, and `limit` can stop early
- `is null`
- `like 'abc%'` (a prefix), if the index uses the `C` collation or the `text_pattern_ops` operator class

It cannot serve `like '%abc'`, a condition on a function of the column, or containment in an array.

```sql
create index orders_customer_id_idx on orders (customer_id);
```

## Composite indexes and column order

An index on `(customer_id, created_at)` is sorted by `customer_id` first, and by `created_at` within each customer. Like a phone book sorted by surname, then first name: easy to find all the Smiths, or Smith, John; useless for finding every John.

So column order decides which queries the index can serve:

| Query | Uses `(customer_id, created_at)` well? |
|---|---|
| `where customer_id = 42` | Yes, the leading column |
| `where customer_id = 42 order by created_at desc limit 20` | Yes, and no sort: rows come out in order |
| `where customer_id = 42 and created_at > now() - interval '7 days'` | Yes, one contiguous range |
| `where created_at > now() - interval '7 days'` | Poorly at best |

The rule of thumb: **columns compared with `=` first, then the column you sort by or compare with a range.** Put a range column before an equality column and the index has to walk the whole range and filter.

PostgreSQL 18 added skip scan: when the leading column has no condition but few distinct values, the planner can jump through the index once per distinct value. It helps in some cases; design for the leading column anyway.

A composite index also serves queries on its leading columns alone, so `(customer_id, created_at)` makes a separate index on `(customer_id)` redundant. Drop the redundant one: it costs writes and buys nothing.

## Partial indexes

A partial index has a `where` clause and only contains the rows that match it.

```sql
create index orders_pending_idx on orders (created_at) where status = 'pending';
```

If 0.5% of orders are pending, this index is a two-hundredth of the size of a full one, stays in memory, and costs nothing when a paid order is inserted. The planner uses it only when the query's `where` clause implies the index's condition, so write the query with the same `status = 'pending'`. Partial unique indexes are also how you say "unique among active rows": `create unique index on subscriptions (user_id) where cancelled_at is null`.

## Expression indexes

An index on `email` does not help `where lower(email) = 'ada@example.com'`, because the indexed values are not lower-cased. Index the expression itself:

```sql
create index customers_lower_email_idx on customers (lower(email));
```

The query must use the same expression. Run `analyze` after creating one, so the planner gathers statistics on the expression.

## Covering indexes and index-only scans

If every column a query needs is in the index, Postgres can answer from the index alone, an Index Only Scan, without visiting the table. `include` adds columns to the index leaves without making them part of the sort key:

```sql
create index orders_customer_created_idx on orders (customer_id, created_at) include (total_cents);
-- select created_at, total_cents from orders where customer_id = 42 ...  can skip the heap
```

There is a catch. Because of how Postgres versions rows (lesson 5), the index does not know whether a row is visible to your transaction. The table's visibility map records pages where all rows are visible to everyone; only for those pages can the heap be skipped. VACUUM maintains that map, so on a table with lots of recent writes, "Index Only Scan" in a plan can still show many `Heap Fetches`.

## GIN, BRIN and the others

**GIN** (generalised inverted index) maps each element to the rows that contain it, like the index at the back of a book. Use it for values that contain many items:

```sql
create index products_tags_idx on products using gin (tags);          -- tags @> array['sale']
create index events_payload_idx on events using gin (payload jsonb_path_ops);  -- payload @> '{"type":"click"}'
create index docs_search_idx on docs using gin (search_vector);      -- full-text search (lesson 8)
```

GIN is fast to read and slower to update than a B-tree. With the `pg_trgm` extension, a GIN index also speeds up `like '%abc%'` and fuzzy matching.

**BRIN** (block range index) stores only the minimum and maximum value for each range of table pages. It is tiny, often a thousand times smaller than a B-tree, and works only when the column's values follow the physical order of the rows, as `created_at` does in an append-only log or events table. A query for one hour of a huge events table skips every page range whose min and max exclude it. On a column without that correlation, a BRIN index is useless.

**GiST** handles ranges, geometry and nearest-neighbour search, and powers exclusion constraints such as "no two bookings for the same room may overlap". **Hash** indexes serve equality only and rarely beat a B-tree.

## When Postgres ignores your index

The planner estimates the cost of each plan and picks the cheapest. An index loses when:

1. **The query matches too many rows.** Fetching rows through an index means random page reads. Above a few percent of the table, reading it sequentially is cheaper, so `where status = 'paid'` on a table that is 80% paid scans the table. This is the planner being right.
2. **The condition does not match the index.** A function on the column (`date(created_at) = ...`, `lower(email)`), an implicit cast, `like '%abc'`, or a composite index whose leading column is not in the query.
3. **The statistics are wrong.** After a bulk load, the planner may think a table is tiny. `analyze` fixes it; autovacuum normally does it for you.
4. **The table is small.** A few pages are cheaper to read whole than through an index.
5. **The index cannot give the order.** `order by created_at desc` with an index that has `created_at` after a range column still needs a sort.

Do not reach for `set enable_seqscan = off` to force an index in production. Use it while investigating to see what the index plan would cost, then fix the cause.

## The cost side

Each index is updated on every insert, on deletes during vacuum, and on updates that change an indexed column. Many indexes also stop Postgres from using HOT updates, an optimisation that avoids touching indexes when no indexed column changes. Check for indexes that are never used:

```sql
select relname, indexrelname, idx_scan, pg_size_pretty(pg_relation_size(indexrelid))
from pg_stat_user_indexes
order by idx_scan, pg_relation_size(indexrelid) desc;
```

On a live table, build new indexes with `create index concurrently`, which does not block writes (lesson 6).

## Common mistakes

- A composite index with a range column first, or with column order copied from the table definition.
- Separate single-column indexes where one composite index would serve the query.
- An index on `email` for queries on `lower(email)`.
- A partial index whose condition the query does not repeat.
- Indexing a low-cardinality column such as `status` or a boolean on its own.
- Keeping indexes that `pg_stat_user_indexes` shows are never scanned.

## Go deeper

- [PostgreSQL: Indexes](https://www.postgresql.org/docs/current/indexes.html): the whole chapter, short and worth reading end to end.
- [PostgreSQL: Index types](https://www.postgresql.org/docs/current/indexes-types.html): which operators each type supports.
- [PostgreSQL: Multicolumn indexes](https://www.postgresql.org/docs/current/indexes-multicolumn.html): how column order affects use.
- [PostgreSQL: Index-only scans](https://www.postgresql.org/docs/current/indexes-index-only-scans.html): covering indexes and the visibility map.
- [PostgreSQL: pg_trgm](https://www.postgresql.org/docs/current/pgtrgm.html): trigram indexes for `like '%...%'` and similarity search.
