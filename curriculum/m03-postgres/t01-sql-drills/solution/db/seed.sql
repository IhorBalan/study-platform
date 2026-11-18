-- Deterministic sample data. The checks run your queries against this data
-- plus some extra rows, so do not hard-code results.
insert into categories (id, name) values
  (1, 'Books'), (2, 'Games'), (3, 'Music'), (4, 'Tools');

insert into products (id, category_id, name, price)
select i, (i - 1) % 4 + 1, 'Product ' || i, 5 + (i * 7) % 40 + 0.99
from generate_series(1, 16) as i;

insert into customers (id, email, name, created_at)
select i, 'user' || i || '@example.com', 'Customer ' || i,
       timestamptz '2025-06-01 00:00:00+00' + i * interval '3 days'
from generate_series(1, 36) as i;

-- Customers 37 to 40 re-registered with an address that differs only in case or spaces.
insert into customers (id, email, name, created_at) values
  (37, ' User3@Example.com', 'Customer 3 again', '2026-01-02 10:00:00+00'),
  (38, 'USER7@example.com ', 'Customer 7 again', '2026-01-05 10:00:00+00'),
  (39, 'user7@EXAMPLE.com', 'Customer 7, third account', '2026-02-11 09:30:00+00'),
  (40, 'someone.new@example.com', 'Customer 40', '2026-03-01 12:00:00+00');

insert into orders (id, customer_id, created_at, status)
select i,
       (i * 7) % 36 + 1,
       timestamptz '2026-01-01 00:00:00+00' + ((i * 17) % 300) * interval '1 day' + (i % 24) * interval '1 hour',
       case when i % 10 = 0 then 'refunded' when i % 13 = 0 then 'pending' else 'paid' end
from generate_series(1, 300) as i;

insert into order_items (order_id, product_id, quantity, unit_price)
select o.id, p.id, (o.id + k) % 4 + 1, p.price
from orders o
cross join lateral generate_series(1, o.id % 3 + 1) as k
join products p on p.id = (o.id * 3 + k * 5) % 16 + 1;
