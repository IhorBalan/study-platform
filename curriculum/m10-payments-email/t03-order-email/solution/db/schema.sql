-- Run by your tests and by the checks in an empty schema. Do not qualify names with a schema.
drop table if exists email_log;

-- One row per business email. The primary key is what makes "once per order" hold across retries,
-- duplicate webhooks and several workers.
create table email_log (
  kind        text        not null,
  ref         text        not null,
  status      text        not null check (status in ('sending', 'sent')),
  message_id  text,
  updated_at  timestamptz not null default now(),
  primary key (kind, ref)
);
