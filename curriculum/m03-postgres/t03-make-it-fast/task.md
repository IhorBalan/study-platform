Four queries in a shop database read hundreds of thousands of rows to return a handful. Make each one use an index, and prove it with query plans.

## Setup

The starter has `db/schema.sql` (customers, orders and products, with primary keys only), `db/seed.sql` (50,000 customers, 500,000 orders, 100,000 products) and `queries.sql` with the four queries:

1. A customer's 20 latest orders.
2. The 100 oldest pending orders older than an hour. About 0.5% of orders are pending.
3. A customer by email, ignoring case.
4. Products that carry the tag `clearance`.

Load the data and run each query with `explain (analyze, buffers)` before you change anything.

## Requirements

Write `migrations/001_indexes.sql`. It runs once against the seeded tables and contains only index statements.

- Query 1 uses an index, and the plan has no Sort node.
- Query 2 uses a **partial** index.
- Query 3 uses an index.
- Query 4 uses a GIN index.
- No query plan has a Seq Scan on the table it filters.

Do not change the queries or the tables. Put one statement before each semicolon, at the end of a line; the checks split the file there and run the statements one at a time, so `create index concurrently` works. Do not use `DO` blocks or functions.

Fill in the "Before and after" section of `README.md`.

## What is checked

The checks create the tables and seed them in a fresh schema, run your migration on its own connection, run `ANALYZE`, and then read `EXPLAIN (FORMAT JSON)` for each query, with parallel workers off. They look at the plan's node types and at the catalog entry of each index the plan uses (partial or not, B-tree or GIN). Settings such as `enable_seqscan` in your migration have no effect on the plans. The review looks at the shape of each index, redundant indexes, whether the migration is safe on a live table, and your before-and-after notes.
