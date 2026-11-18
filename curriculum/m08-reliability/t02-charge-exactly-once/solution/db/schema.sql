-- Run by the tests and the checks in an empty schema. Do not qualify names with a schema.
drop table if exists idempotency_keys;
drop table if exists payments;

-- Given. Keep these columns.
create table payments (
  id            int         generated always as identity primary key,
  customer_id   text        not null,
  amount_cents  int         not null check (amount_cents > 0),
  charge_id     text        not null unique,   -- the gateway's id: a second line of defence
  created_at    timestamptz not null default now()
);

create table idempotency_keys (
  customer_id   text        not null,
  key           text        not null,
  request_hash  text        not null,
  status        text        not null default 'started' check (status in ('started', 'done')),
  locked_until  timestamptz,
  response      jsonb,
  created_at    timestamptz not null default now(),
  primary key (customer_id, key)
);
