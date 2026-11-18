-- Enough rows that an index matters: 50,000 customers, 500,000 orders, 100,000 products.
-- Takes a few seconds. Run ANALYZE afterwards so the planner has statistics.
insert into customers (id, email, name, created_at)
select i,
       case when i % 3 = 0 then 'User' || i || '@Example.com' else 'user' || i || '@example.com' end,
       'Customer ' || i,
       timestamptz '2024-01-01 00:00:00+00' + i * interval '10 minutes'
from generate_series(1, 50000) as i;

-- The first 2,000 customers have about 250 orders each; the others have none yet.
-- About 0.5% of orders are pending; the rest are paid, shipped or refunded.
insert into orders (id, customer_id, status, total_cents, created_at)
select i,
       (i::bigint * 7919) % 2000 + 1,
       case when i % 200 = 0 then 'pending'
            when i % 7 = 0 then 'refunded'
            when i % 3 = 0 then 'shipped'
            else 'paid' end,
       500 + (i * 37) % 20000,
       timestamptz '2025-01-01 00:00:00+00' + i * interval '1 minute'
from generate_series(1, 500000) as i;

-- Three common tags per product, and a rare 'clearance' tag on 0.2% of them.
insert into products (id, name, tags, price_cents)
select i,
       'Product ' || i,
       array['tag' || (i % 40), 'tag' || ((i * 3) % 40 + 40), 'tag' || ((i * 7) % 40 + 80)]
         || case when i % 500 = 0 then array['clearance'] else array[]::text[] end,
       100 + (i * 13) % 10000
from generate_series(1, 100000) as i;

analyze;
