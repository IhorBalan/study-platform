-- Paid revenue per calendar month (UTC) with a running total.
with monthly as (
  select date_trunc('month', o.created_at at time zone 'UTC')::date as month,
         sum(i.quantity * i.unit_price) as revenue
  from orders o
  join order_items i on i.order_id = o.id
  where o.status = 'paid'
  group by 1
)
select month,
       revenue,
       sum(revenue) over (order by month) as running_total
from monthly
order by month;
