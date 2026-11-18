The order history page of a shop has become slow. It was instant at launch; now its p95 is over two seconds in production, and it gets worse every week. You have a copy of the query and its plan from staging, which has about a twentieth of production's data. Diagnose it in writing. No code is submitted.

## The schema (relevant parts)

```sql
create table orders (
  id          bigint primary key,
  customer_id bigint not null references customers (id),
  status      text not null,          -- paid, shipped, refunded, pending
  total_cents integer not null,
  created_at  timestamptz not null
);
create index orders_status_idx on orders (status);

create table order_items (
  order_id         bigint not null references orders (id),
  product_id       bigint not null references products (id),
  quantity         integer not null,
  unit_price_cents integer not null,
  primary key (product_id, order_id)
);
```

Staging has 500,000 orders and 1,500,000 order items (124 MB). Customer 1234 has 250 orders, 72 of them shipped.

## The query and its plan

```sql
select o.id, o.created_at, o.total_cents, count(*) as items
from orders o
join order_items i on i.order_id = o.id
where o.customer_id = 1234 and o.status = 'shipped'
group by o.id
order by o.created_at desc
limit 20;
```

Output of `explain (analyze, buffers)` on staging, PostgreSQL 18:

```
Limit  (cost=25069.16..25069.21 rows=20 width=28) (actual time=84.545..93.689 rows=20.00 loops=1)
  Buffers: shared hit=13262 read=601
  ->  Sort  (cost=25069.16..25069.34 rows=70 width=28) (actual time=84.542..93.684 rows=20.00 loops=1)
        Sort Key: o.created_at DESC
        Sort Method: top-N heapsort  Memory: 27kB
        Buffers: shared hit=13262 read=601
        ->  Finalize GroupAggregate  (cost=25045.01..25067.30 rows=70 width=28) (actual time=84.409..93.614 rows=72.00 loops=1)
              Group Key: o.id
              Buffers: shared hit=13259 read=601
              ->  Gather Merge  (cost=25045.01..25065.76 rows=168 width=28) (actual time=84.384..93.573 rows=161.00 loops=1)
                    Workers Planned: 2
                    Workers Launched: 2
                    Buffers: shared hit=13259 read=601
                    ->  Partial GroupAggregate  (cost=24044.98..24046.34 rows=70 width=28) (actual time=81.259..81.294 rows=53.67 loops=3)
                          Group Key: o.id
                          Buffers: shared hit=13259 read=601
                          ->  Sort  (cost=24044.98..24045.20 rows=88 width=20) (actual time=81.240..81.256 rows=72.00 loops=3)
                                Sort Key: o.id
                                Sort Method: quicksort  Memory: 27kB
                                Buffers: shared hit=13259 read=601
                                Worker 0:  Sort Method: quicksort  Memory: 28kB
                                Worker 1:  Sort Method: quicksort  Memory: 27kB
                                ->  Parallel Hash Join  (cost=6596.51..24042.14 rows=88 width=20) (actual time=15.865..81.170 rows=72.00 loops=3)
                                      Hash Cond: (i.order_id = o.id)
                                      Buffers: shared hit=13243 read=601
                                      ->  Parallel Seq Scan on order_items i  (cost=0.00..15805.00 rows=625000 width=8) (actual time=0.210..35.393 rows=500000.00 loops=3)
                                            Buffers: shared hit=8954 read=601
                                      ->  Parallel Hash  (cost=6596.14..6596.14 rows=29 width=20) (actual time=14.403..14.405 rows=24.00 loops=3)
                                            Buckets: 1024  Batches: 1  Memory Usage: 104kB
                                            Buffers: shared hit=4289
                                            ->  Parallel Bitmap Heap Scan on orders o  (cost=1545.19..6596.14 rows=29 width=20) (actual time=2.962..14.310 rows=24.00 loops=3)
                                                  Recheck Cond: (status = 'shipped'::text)
                                                  Filter: (customer_id = 1234)
                                                  Rows Removed by Filter: 47357
                                                  Heap Blocks: exact=1190
                                                  Buffers: shared hit=4289
                                                  Worker 0:  Heap Blocks: exact=1859
                                                  Worker 1:  Heap Blocks: exact=1118
                                                  ->  Bitmap Index Scan on orders_status_idx  (cost=0.00..1545.17 rows=141433 width=0) (actual time=4.268..4.268 rows=142143.00 loops=1)
                                                        Index Cond: (status = 'shipped'::text)
                                                        Index Searches: 1
                                                        Buffers: shared hit=122
Planning:
  Buffers: shared hit=187
Planning Time: 1.061 ms
Execution Time: 93.899 ms
```

## What to write

400 to 700 words, prose or lists.

1. **Read the plan.** Name the node where most of the time goes and quote the figures that show it. Name a second node that does far more work than its output needs, and quote its figures.
2. **Explain why.** Why does the planner scan all of `order_items` even though the table has a primary key that contains `order_id`? Why is `orders_status_idx` a poor index for this query?
3. **Explain the trend.** Why does this query get slower as the shop grows, even for a customer whose order count stays the same?
4. **Fix it.** Give the exact `CREATE INDEX` statements you would add (or change), with column order, and say why each one has that shape. Say how you would build them on the live production table.
5. **Verify.** Describe the plan you expect afterwards (node types, roughly how many rows and buffers) and how you would confirm the fix in production without making things worse.
6. **One caution.** A colleague wants to run `EXPLAIN ANALYZE` on the related slow `DELETE FROM orders WHERE ...` endpoint in production to see its plan. What do you tell them?

## What is assessed

Whether you read the right numbers from the plan, whether your explanation of each cause is correct, whether your indexes would produce a fast plan and can be built safely, and whether your verification steps are concrete. There are no automated checks.
