Five queries you will meet again in real work: an outer join with aggregation, a running total, top N per group, duplicates, and the gap between two events. Each goes in its own file and is checked by running it against a seeded database and comparing the rows.

## Setup

The starter has `db/schema.sql` (categories, products, customers, orders, order_items) and `db/seed.sql` with sample data. Load both into a scratch database as the README shows. Read the schema first: revenue is always `quantity * unit_price` from `order_items`, never `products.price`.

## Requirements

Write one query in each file in `queries/`. The comment at the top of each file is the specification: the exact column names in order, which rows to return and how to sort them. In short:

| File | Returns |
| --- | --- |
| `01-customer-revenue.sql` | every customer with `paid_orders` and `revenue`, zeros for those without paid orders |
| `02-monthly-revenue.sql` | paid revenue per UTC month with a `running_total` |
| `03-top-products-per-category.sql` | the two products with the most units sold in paid orders, per category |
| `04-duplicate-emails.sql` | emails used by more than one customer, ignoring case and surrounding spaces |
| `05-days-to-second-order.sql` | for customers with two or more paid orders, the days between the first and the second |

Only orders with `status = 'paid'` count, except in drill 4, which does not look at orders. A file may contain comments; if it holds several statements, the last one is the result.

## What is checked

Each file runs in a read-only transaction against `db/schema.sql`, the seed data and a few extra rows that are not in the seed, so hard-coded answers fail. The session time zone is set to `America/New_York`, so say `UTC` where the specification says UTC. Column names and their order must match. Rows are compared in order; numbers are compared by value, so `12.5` and `12.50` are equal. The review looks at whether each query uses the right construct and aggregates at the right grain.
