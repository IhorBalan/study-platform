---
title: "Reading EXPLAIN (ANALYZE, BUFFERS)"
skills: [query-plans]
---

SQL says what you want; the planner decides how to get it. `EXPLAIN` shows that decision as a tree of steps, and `EXPLAIN ANALYZE` runs the query and adds what each step really did. It is the browser's performance panel for a query: you stop guessing why something is slow and read where the time goes. This lesson shows how to read a plan, what the common node types mean, and a routine for investigating a slow query.

## EXPLAIN and EXPLAIN ANALYZE

```sql
explain select * from orders where customer_id = 1234;                    -- plan only, nothing runs
explain (analyze) select * from orders where customer_id = 1234;          -- runs it, adds actuals
explain (analyze, buffers, format json) select ...;                        -- page reads, machine-readable
```

Plain `EXPLAIN` shows estimates and does not run anything. `EXPLAIN ANALYZE` **executes the statement**. For a `select` that only costs time. For `update`, `delete` or `insert` it changes data, so wrap it:

```sql
begin;
explain (analyze, buffers) delete from orders where created_at < '2020-01-01';
rollback;
```

`BUFFERS` reports how many 8 kB pages each step touched: `shared hit` pages came from Postgres's cache, `read` pages came from the operating system or disk. Since PostgreSQL 18, `ANALYZE` includes buffer figures by default. Buffers are often a better measure than time, because time depends on what happened to be cached.

## Anatomy of a plan

Here is a real plan from the lab database: 500,000 orders, and no useful index.

```
Limit  (cost=10423.63..10423.68 rows=20 width=26) (actual time=21.915..21.919 rows=20.00 loops=1)
  ->  Sort  (cost=10423.63..10424.25 rows=249 width=26) (actual time=21.913..21.915 rows=20.00 loops=1)
        Sort Key: created_at DESC
        Sort Method: top-N heapsort  Memory: 27kB
        ->  Seq Scan on orders  (cost=0.00..10417.00 rows=249 width=26) (actual time=0.025..21.820 rows=250.00 loops=1)
              Filter: (customer_id = 1234)
              Rows Removed by Filter: 499750
Execution Time: 21.945 ms
```

Read it **from the innermost node outwards**: each node feeds its parent. Here the Seq Scan reads the table, the Sort orders 250 rows, and the Limit keeps 20.

On each node:

- `cost=10423.63..10424.25` is the planner's estimate in arbitrary units: the cost before the first row comes out (startup) and the cost for all rows (total). Use it to compare plans, not as milliseconds.
- `rows=249` (in the first parentheses) is the estimated row count; `width` is the average row size in bytes.
- `actual time=0.025..21.820` is in milliseconds: time to the first row and to the last row, **per loop**.
- `rows=250.00` is the actual row count per loop. PostgreSQL 18 prints it with decimals, because averages over several loops are rarely whole numbers.
- `loops=1` is how many times the node ran. Inside a nested loop, an inner node runs once per outer row, so multiply time and rows by `loops`.

The diagnosis is in one line: `Rows Removed by Filter: 499750`. The scan read half a million rows to keep 250. After `create index on orders (customer_id, created_at)`:

```
Limit  (cost=0.42..78.85 rows=20 width=26) (actual time=0.012..0.021 rows=20.00 loops=1)
  ->  Index Scan Backward using orders_customer_id_created_at_idx on orders  (cost=0.42..980.80 rows=250 width=26) (actual time=0.011..0.019 rows=20.00 loops=1)
        Index Cond: (customer_id = 1234)
Execution Time: 0.029 ms
```

No sort (the index returns rows in order) and the scan stops after 20 rows: 750 times faster.

## Scan types

| Node | What it does | Typical cause |
|---|---|---|
| Seq Scan | Reads every page of the table | No usable index, or most rows match |
| Index Scan | Walks the index, fetches each matching row from the table | Few rows, or rows needed in index order |
| Index Only Scan | Answers from the index alone | All needed columns are in the index; watch `Heap Fetches` |
| Bitmap Index Scan + Bitmap Heap Scan | Collects matching row locations from one or more indexes, sorts them by page, reads each page once | A moderate number of rows, or several indexes combined with AND/OR |

A Bitmap Heap Scan with `Recheck Cond` is normal. If it shows `Rows Removed by Filter` in the thousands, the index found far more rows than the query keeps: the index matches only part of the `where` clause.

## Join types

- **Nested Loop**: for each row of the outer input, look up matches in the inner input. Excellent when the outer side is small and the inner side has an index on the join key. Terrible when the planner thought the outer side was small and it was not.
- **Hash Join**: build a hash table from the smaller input, then stream the larger input through it. Good for large unsorted inputs with no useful index. The `Hash` node shows `Batches`; more than 1 means it did not fit in `work_mem` and spilled to disk.
- **Merge Join**: walk two inputs already sorted on the join key, like merging two sorted arrays. Appears when both sides come sorted from indexes.

None of them is bad. A join type is a symptom; the question is whether the row estimates that led to it were right.

## Estimates versus actuals

The planner chooses a plan from estimated row counts, which come from statistics that `ANALYZE` (usually run by autovacuum) samples from each table. When an estimate is off by a factor of 10 or more, the plan built on it is likely wrong. Compare `rows=` in the first and second parentheses of each node, starting at the innermost one that is off. Common causes:

- **Stale statistics** after a bulk load or a big delete. Run `analyze table_name`.
- **Correlated columns.** The planner assumes `city = 'Paris' and country = 'France'` are independent and multiplies their selectivities, underestimating badly. `create statistics ... (dependencies) on city, country from addresses` teaches it otherwise.
- **Conditions it cannot estimate**, such as a function call or a comparison between two columns. It falls back to fixed guesses.

## Other things worth noticing

- `Sort Method: external merge  Disk: 51200kB` means the sort spilled to disk. An index that provides the order, or a larger `work_mem` for that query, removes it.
- `Workers Planned: 2` under a `Gather` node means a parallel plan. Actual rows on the parallel nodes are per worker.
- `Planning Time` that is large compared with `Execution Time` points at very many partitions or a very complex query, not at data access.

## A routine for a slow query

1. **Find it.** The `pg_stat_statements` extension ranks statements by total and mean time. Fix the query that costs the most in total, which is not always the slowest single one.
2. **Reproduce it** with realistic parameter values. A customer with 10 orders and one with 100,000 can get different plans.
3. **Run `explain (analyze, buffers)`** twice, and read the second run, so caching does not mislead you.
4. **Find the expensive node**: the one where `actual time` jumps, or with the most buffers, or with a large `Rows Removed by Filter`.
5. **Check its estimates.** Wrong estimates mean statistics or query shape; right estimates mean the data access itself must change.
6. **Fix one thing**: an index, a rewritten condition, fresh statistics. Then run the plan again and compare.

Visualisers such as explain.dalibo.com and explain.depesz.com colour the expensive nodes of a long text or JSON plan, which helps with large plans.

## Common mistakes

- Running `EXPLAIN ANALYZE` on a `delete` or `update` outside a transaction that is rolled back.
- Reading actual time without multiplying by `loops`.
- Treating `cost` as milliseconds.
- Measuring once, on a cold cache, and drawing conclusions from disk reads.
- Testing with a parameter value that is not representative.
- "Fixing" a plan with `enable_seqscan = off` instead of finding why the index lost.

## Go deeper

- [PostgreSQL: Using EXPLAIN](https://www.postgresql.org/docs/current/using-explain.html): worked examples of every common node.
- [PostgreSQL: EXPLAIN](https://www.postgresql.org/docs/current/sql-explain.html): every option, including `BUFFERS`, `SETTINGS` and `FORMAT`.
- [PostgreSQL: Statistics used by the planner](https://www.postgresql.org/docs/current/planner-stats.html): how estimates are made, and extended statistics.
- [PostgreSQL: pg_stat_statements](https://www.postgresql.org/docs/current/pgstatstatements.html): finding the queries worth fixing.
- [PostgreSQL: auto_explain](https://www.postgresql.org/docs/current/auto-explain.html): logging the plans of slow queries in production.
