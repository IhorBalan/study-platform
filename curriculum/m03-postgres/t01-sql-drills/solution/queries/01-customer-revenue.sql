-- Every customer with their number of paid orders and paid revenue.
-- The status filter lives in the join, not in WHERE, so customers without
-- paid orders keep their row (with zeros) instead of disappearing.
with order_totals as (
  select order_id, sum(quantity * unit_price) as total
  from order_items
  group by order_id
)
select c.id as customer_id,
       c.email,
       count(o.id) as paid_orders,
       coalesce(sum(t.total), 0) as revenue
from customers c
left join orders o on o.customer_id = c.id and o.status = 'paid'
left join order_totals t on t.order_id = o.id
group by c.id, c.email
order by revenue desc, customer_id;
