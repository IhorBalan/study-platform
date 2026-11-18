-- Shop schema for the SQL drills. Load it into an empty database:
--   psql "$DATABASE_URL" -f db/schema.sql -f db/seed.sql
create table categories (
  id   integer primary key,
  name text not null unique
);

create table products (
  id          integer primary key,
  category_id integer not null references categories (id),
  name        text not null,
  price       numeric(10, 2) not null
);

create table customers (
  id         integer primary key,
  email      text not null,
  name       text not null,
  created_at timestamptz not null
);

create table orders (
  id          integer primary key,
  customer_id integer not null references customers (id),
  created_at  timestamptz not null,
  status      text not null check (status in ('paid', 'pending', 'refunded'))
);

create table order_items (
  order_id   integer not null references orders (id),
  product_id integer not null references products (id),
  quantity   integer not null check (quantity > 0),
  unit_price numeric(10, 2) not null,
  primary key (order_id, product_id)
);
