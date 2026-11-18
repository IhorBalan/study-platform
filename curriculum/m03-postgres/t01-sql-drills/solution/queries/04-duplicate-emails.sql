-- Addresses used by more than one customer, ignoring case and surrounding spaces.
select lower(trim(email)) as email,
       array_agg(id order by id) as customer_ids
from customers
group by lower(trim(email))
having count(*) > 1
order by email;
