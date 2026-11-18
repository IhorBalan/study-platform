-- Run by the tests and the checks in an empty schema. Do not qualify names with a schema.
drop table if exists inbox;
drop table if exists outbox;
drop table if exists orders;

-- Given. Keep these columns.
create table orders (
  id            int         generated always as identity primary key,
  customer_id   text        not null,
  total_cents   int         not null check (total_cents >= 0),
  created_at    timestamptz not null default now()
);

-- The table must be called outbox and keep id, topic and payload. Add what the relay needs.
create table outbox (
  id            bigint      generated always as identity primary key,
  topic         text        not null,
  payload       jsonb       not null,
  created_at    timestamptz not null default now(),
  published_at  timestamptz,
  attempts      int         not null default 0,
  last_error    text
);
create index outbox_pending on outbox (id) where published_at is null;

create table inbox (
  message_id    text        primary key,
  processed_at  timestamptz not null default now()
);
