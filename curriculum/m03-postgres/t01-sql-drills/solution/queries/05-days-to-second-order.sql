-- How long customers took to come back: first and second paid order.
with numbered as (
  select customer_id,
         created_at,
         row_number() over (partition by customer_id order by created_at, id) as n
  from orders
  where status = 'paid'
)
select first.customer_id,
       first.created_at as first_order_at,
       second.created_at as second_order_at,
       (second.created_at at time zone 'UTC')::date - (first.created_at at time zone 'UTC')::date as days_between
from numbered first
join numbered second on second.customer_id = first.customer_id and second.n = 2
where first.n = 1
order by days_between, first.customer_id;
