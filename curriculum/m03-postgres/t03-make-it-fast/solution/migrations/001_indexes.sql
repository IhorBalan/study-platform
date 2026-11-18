-- 1. Equality column first, then the sort column. The index returns one
--    customer's orders already in created_at order, so LIMIT 20 stops early
--    and there is no Sort step. Its leading column also serves the
--    foreign key on orders.customer_id.
create index concurrently if not exists orders_customer_id_created_at_idx
  on orders (customer_id, created_at);

-- 2. Only 0.5% of orders are pending. A partial index holds just those rows,
--    so it is tiny, stays in cache and is cheap to maintain on every insert.
create index concurrently if not exists orders_pending_created_at_idx
  on orders (created_at) where status = 'pending';

-- 3. The query filters on lower(email), so the index must be on the same expression.
create index concurrently if not exists customers_lower_email_idx
  on customers (lower(email));

-- 4. Array containment (@>) is a GIN operator; a B-tree cannot answer it.
create index concurrently if not exists products_tags_gin_idx
  on products using gin (tags);
