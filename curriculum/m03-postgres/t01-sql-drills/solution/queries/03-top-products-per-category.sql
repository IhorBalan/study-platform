-- The two best-selling products (by units in paid orders) in each category.
with units as (
  select p.id, p.name, p.category_id, sum(i.quantity) as units_sold
  from products p
  join order_items i on i.product_id = p.id
  join orders o on o.id = i.order_id and o.status = 'paid'
  group by p.id
),
ranked as (
  select u.*,
         row_number() over (partition by u.category_id order by u.units_sold desc, u.id) as rank
  from units u
)
select c.name as category, r.name as product, r.units_sold, r.rank
from ranked r
join categories c on c.id = r.category_id
where r.rank <= 2
order by c.name, r.rank;
