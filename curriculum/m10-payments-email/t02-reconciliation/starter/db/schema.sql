-- Run by your tests and by the checks in an empty schema. Do not qualify names with a schema.
-- Given: this is the shop's existing table. Do not change it; reconciliation only reads it.
drop table if exists payments;

create table payments (
  id                        int         generated always as identity primary key,
  order_id                  text        not null,
  stripe_payment_intent_id  text        unique,              -- null for rows created by hand
  amount_minor              bigint      not null,            -- comes back from pg as a string
  currency                  text        not null,            -- upper case here ('EUR'); Stripe uses 'eur'
  status                    text        not null check (status in ('pending', 'failed', 'succeeded', 'partially_refunded', 'refunded')),
  refunded_minor            bigint      not null default 0,
  created_at                timestamptz not null default now()
);
