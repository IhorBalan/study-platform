-- The four slow queries. Do not change them; make them fast with indexes.

-- 1. A customer's latest orders (the account page).
select id, status, total_cents, created_at
from orders
where customer_id = 1234
order by created_at desc
limit 20;

-- 2. Pending orders older than an hour (a job runs this every minute).
select id, customer_id, created_at
from orders
where status = 'pending' and created_at < now() - interval '1 hour'
order by created_at
limit 100;

-- 3. Log-in looks up a customer by email, ignoring case.
select id, name
from customers
where lower(email) = lower('User4242@example.com');

-- 4. Products with a given tag.
select id, name
from products
where tags @> array['clearance'];
