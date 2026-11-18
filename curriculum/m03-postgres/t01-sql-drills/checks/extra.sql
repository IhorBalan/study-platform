-- Extra rows the checks add on top of seed.sql, so results cannot be hard-coded.
insert into categories (id, name) values (5, 'Garden'), (6, 'Empty shelf');
insert into products (id, category_id, name, price) values
  (17, 5, 'Rake', 24.50), (18, 5, 'Hose', 31.00), (19, 1, 'Unsold book', 9.99);
insert into customers (id, email, name, created_at) values
  (41, ' user12@EXAMPLE.com', 'Customer 12 again', '2026-04-01 08:00:00+00'),
  (42, 'quiet@example.com', 'No orders yet', '2026-04-02 08:00:00+00'),
  (43, 'twice@example.com', 'Two quick orders', '2026-04-03 08:00:00+00');
insert into orders (id, customer_id, created_at, status) values
  (301, 43, '2026-11-01 23:30:00+00', 'paid'),
  (302, 43, '2026-11-02 00:15:00+00', 'paid'),
  (303, 42, '2026-11-03 10:00:00+00', 'pending'),
  (304, 5,  '2026-12-30 12:00:00+00', 'paid'),
  (305, 41, '2026-12-31 18:00:00+00', 'refunded'),
  -- Already March in UTC, still February in New York.
  (306, 10, '2026-03-01 02:00:00+00', 'paid');
insert into order_items (order_id, product_id, quantity, unit_price) values
  (301, 17, 3, 24.50),
  (302, 18, 1, 29.00),
  (302, 2, 2, 18.99),
  (303, 17, 10, 24.50),
  (304, 18, 2, 31.00),
  (304, 5, 1, 45.99),
  (305, 18, 9, 31.00),
  (306, 3, 1, 15.99);
