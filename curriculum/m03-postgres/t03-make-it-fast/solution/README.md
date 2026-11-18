# Make slow queries fast

## Before and after

Times are from `explain (analyze, buffers)` on the seeded data, second run (warm cache), lab Postgres 18.

1. **Latest orders.** Before: Seq Scan on orders, Sort, Limit, 22 ms. After: Index Scan Backward on `(customer_id, created_at)`, Limit, 0.03 ms. Equality column first, then the sort column, so the index returns rows in the order the query wants and stops after 20.
2. **Pending orders.** Before: Seq Scan, Sort, Limit, 33 ms. After: Index Scan on the partial index, Limit, 0.13 ms. The partial index holds 2,500 rows instead of 500,000, so it is a fraction of the size and unpaid orders cost nothing to maintain.
3. **Email lookup.** Before: Seq Scan on customers with a filter on `lower(email)`, 12 ms. After: Index Scan on the expression index, 0.01 ms. An index on `email` alone cannot serve `lower(email)`.
4. **Tag search.** Before: Seq Scan on products, 17 ms. After: Bitmap Index Scan on the GIN index, then Bitmap Heap Scan, 0.2 ms. `@>` on an array is answered by GIN, not by a B-tree.

All four use `create index concurrently` so that, on a live table, writes continue while the index builds.
