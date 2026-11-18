-- Shop tables with primary keys only. Your indexes go in migrations/.
create table customers (
  id         bigint primary key,
  email      text not null,
  name       text not null,
  created_at timestamptz not null
);

create table orders (
  id          bigint primary key,
  customer_id bigint not null references customers (id),
  status      text not null,
  total_cents integer not null,
  created_at  timestamptz not null
);

create table products (
  id          bigint primary key,
  name        text not null,
  tags        text[] not null default '{}',
  price_cents integer not null
);
