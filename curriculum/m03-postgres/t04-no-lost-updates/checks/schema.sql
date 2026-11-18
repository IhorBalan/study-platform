create table products (
  id    bigint primary key,
  name  text not null,
  stock integer not null check (stock >= 0)
);

create table reservations (
  id         bigint generated always as identity primary key,
  product_id bigint not null references products (id),
  quantity   integer not null check (quantity > 0),
  order_ref  text not null unique,
  created_at timestamptz not null default now()
);
create index reservations_product_id_idx on reservations (product_id);
