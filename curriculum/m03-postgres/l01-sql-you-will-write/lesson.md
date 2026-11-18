---
title: "SQL you will actually write"
skills: [sql-queries]
---

Most backend features need the same handful of query shapes: join a few tables, aggregate, rank, compare a row with its neighbours, find duplicates. An ORM can write the simple ones for you. The rest you write by hand, and you need to read the simple ones when they misbehave. This lesson covers those shapes with one shop schema: `customers`, `orders`, `order_items`, `products` and `categories`.

## Think in sets, read in clause order

SQL describes a result, not a loop. It helps to know the order in which the clauses are logically applied, because it is not the order you write them:

1. `FROM` and `JOIN` build one wide set of rows.
2. `WHERE` removes rows.
3. `GROUP BY` collapses rows into groups, and `HAVING` removes groups.
4. Window functions run.
5. `SELECT` computes the output columns.
6. `ORDER BY`, then `LIMIT` and `OFFSET`.

That order explains several rules that look arbitrary. You cannot use a `SELECT` alias in `WHERE`, because `WHERE` runs first. You cannot filter on a window function in `WHERE` either; you wrap the query in a CTE and filter outside. `HAVING` exists because `WHERE` runs before the groups do.

## Joins and the LEFT JOIN trap

An inner join keeps only rows that match on both sides. A left join keeps every row of the left table and fills the right side with `NULL` when nothing matches. Use a left join when the question says "every customer" or "including those without".

The classic bug is a condition on the right-hand table in `WHERE`:

```sql
-- Wrong: customers without paid orders vanish.
select c.id, count(o.id) as paid_orders
from customers c
left join orders o on o.customer_id = c.id
where o.status = 'paid'
group by c.id;
```

For a customer with no orders, `o.status` is `NULL`, and `NULL = 'paid'` is not true, so `WHERE` drops the row the left join just kept. Move the condition into the join:

```sql
select c.id, count(o.id) as paid_orders
from customers c
left join orders o on o.customer_id = c.id and o.status = 'paid'
group by c.id;
```

`count(o.id)` counts non-null values, so customers without paid orders get `0`. `count(*)` would count the null-filled row and give them `1`.

## Aggregation at the right grain

Joining `orders` to `order_items` gives one row per item, not per order. Count orders on that set and you count items. Sum an order-level column such as a shipping fee and you add it once per item. This is called fan-out, and it produces numbers that look plausible and are wrong.

Two fixes. Count distinct keys when you only need a count (`count(distinct o.id)`). When you need sums at two levels, aggregate the detail table first, in a CTE, and join the result:

```sql
with order_totals as (
  select order_id, sum(quantity * unit_price) as total
  from order_items
  group by order_id
)
select o.customer_id, count(*) as orders, sum(t.total) as revenue
from orders o
join order_totals t on t.order_id = o.id
where o.status = 'paid'
group by o.customer_id;
```

If you find yourself adding `DISTINCT` to make the numbers come out right, look for fan-out first.

## CTEs: named steps

`WITH name AS (...)` gives a subquery a name, so a long query reads as a sequence of steps. Since PostgreSQL 12 the planner inlines a CTE that is referenced once and has no side effects, so it costs nothing compared with a subquery. Add `MATERIALIZED` when you want it computed once and kept, and `NOT MATERIALIZED` to force inlining. CTEs can also be recursive (`WITH RECURSIVE`), which is how you walk a tree such as nested categories or a comment thread.

## Window functions

A window function computes a value for each row from a set of related rows, without collapsing them the way `GROUP BY` does. If `GROUP BY` is `reduce`, a window function is a `map` that can see its neighbours.

```sql
select month,
       revenue,
       sum(revenue) over (order by month) as running_total,
       revenue - lag(revenue) over (order by month) as change
from monthly_revenue
order by month;
```

- `over (order by month)` makes `sum` a running total: each row sums itself and everything before it.
- `lag(x)` and `lead(x)` read the previous or next row's value.
- `partition by` restarts the window per group, like a separate `GROUP BY` that keeps the rows.

The ranking functions differ only on ties:

| Values | `row_number()` | `rank()` | `dense_rank()` |
|---|---|---|---|
| 90, 82, 82, 70 | 1, 2, 3, 4 | 1, 2, 2, 4 | 1, 2, 2, 3 |

## Top N per group

"The two best-selling products in each category" is the most asked SQL interview question after joins. Rank inside each partition, then filter outside:

```sql
with ranked as (
  select p.category_id, p.name, sum(i.quantity) as units,
         row_number() over (partition by p.category_id
                            order by sum(i.quantity) desc, p.id) as rn
  from products p
  join order_items i on i.product_id = p.id
  group by p.id
)
select category_id, name, units
from ranked
where rn <= 2
order by category_id, rn;
```

The window can use `sum(...)` because windows run after `GROUP BY`. The `p.id` in the window's `ORDER BY` makes ties deterministic; without it, two runs can return different rows. Choose `rank()` instead if tied products should both appear.

Postgres has two alternatives. `DISTINCT ON (category_id) ... ORDER BY category_id, units desc` keeps the first row per group and is the shortest way to write top 1. A `LATERAL` join runs a subquery per outer row (`from categories c cross join lateral (select ... where p.category_id = c.id order by ... limit 2) top`), which is fastest when an index serves the inner query and there are few groups.

## Finding duplicates

Group by the normalised value and keep groups with more than one row:

```sql
select lower(trim(email)) as email,
       array_agg(id order by id) as customer_ids
from customers
group by lower(trim(email))
having count(*) > 1;
```

To act on duplicates, for example to delete all but the oldest, number the rows within each group and target the rest:

```sql
with numbered as (
  select id, row_number() over (partition by lower(trim(email)) order by id) as n
  from customers
)
select id from numbered where n > 1;   -- the rows to merge or delete
```

Once the data is clean, add a unique index on the same expression so duplicates cannot come back.

## NULL in three-valued logic

`NULL` means unknown, so any comparison with it is unknown, not false. `WHERE x = NULL` never matches; write `x IS NULL`. `x <> 'paid'` skips rows where `x` is `NULL`. `NOT IN (subquery)` returns no rows at all if the subquery returns one `NULL`; use `NOT EXISTS`. Aggregates other than `count(*)` ignore nulls, and `sum` over zero rows is `NULL`, not `0`, so wrap it in `coalesce(sum(...), 0)`.

## Time zones

Store instants as `timestamptz`. Functions that cut time into days or months, such as `date_trunc` and a cast to `date`, use the session time zone. A report "per month in UTC" must say so: `date_trunc('month', created_at at time zone 'UTC')`. Otherwise it gives different answers on a laptop and a server.

## Common mistakes

- A condition on the right-hand table of a `LEFT JOIN` placed in `WHERE`.
- Counting or summing after a join that multiplied the rows, then hiding it with `DISTINCT`.
- `rank()` or `row_number()` without a tie-breaker, so results change between runs.
- `NOT IN` with a subquery that can return `NULL`.
- `sum()` over no rows returning `NULL` where the API promised `0`.
- Day and month boundaries computed in whatever time zone the session happens to use.

## Go deeper

- [PostgreSQL: Table expressions](https://www.postgresql.org/docs/current/queries-table-expressions.html): joins, `LATERAL`, `GROUP BY` and `HAVING` in full.
- [PostgreSQL: WITH queries](https://www.postgresql.org/docs/current/queries-with.html): CTE inlining, `MATERIALIZED` and recursive queries.
- [PostgreSQL: Window functions tutorial](https://www.postgresql.org/docs/current/tutorial-window.html): partitions and frames with examples.
- [PostgreSQL: Window function list](https://www.postgresql.org/docs/current/functions-window.html): `lag`, `lead`, `ntile` and the ranking functions.
- [PostgreSQL: SELECT](https://www.postgresql.org/docs/current/sql-select.html): the reference, including `DISTINCT ON`.
