-- Run by your tests and by the checks in an empty schema. Do not qualify names with a schema.
drop table if exists stripe_events;
drop table if exists fulfilments;
drop table if exists orders;
drop table if exists subscriptions;

-- Given. Keep these tables and columns.
create table orders (
  id                 text        primary key,
  status             text        not null default 'pending' check (status in ('pending', 'paid')),
  amount_minor       bigint      not null,
  currency           text        not null,
  stripe_session_id  text,
  paid_at            timestamptz
);

-- One row per fulfilment. A second row for the same order means the customer got their goods twice.
create table fulfilments (
  id          bigint      generated always as identity primary key,
  order_id    text        not null references orders (id),
  created_at  timestamptz not null default now()
);

create table subscriptions (
  stripe_subscription_id  text        primary key,
  stripe_customer_id      text        not null,
  status                  text        not null,
  price_id                text        not null,
  current_period_end      timestamptz not null,
  cancel_at_period_end    boolean     not null default false,
  updated_at              timestamptz not null default now()
);

-- Every event id that was processed, written in the same transaction as the event's effects.
create table stripe_events (
  id           text        primary key,
  type         text        not null,
  received_at  timestamptz not null default now()
);
