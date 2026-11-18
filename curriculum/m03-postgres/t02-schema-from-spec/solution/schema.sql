-- Team task tracker. Every rule from the spec lives in the database,
-- so no code path (an admin script, a second service) can bypass it.

create table users (
  id           bigint generated always as identity primary key,
  email        text not null,
  display_name text not null check (char_length(display_name) between 1 and 80),
  created_at   timestamptz not null default now()
);
-- Case-insensitive uniqueness. A plain unique constraint would allow
-- 'Ada@example.com' and 'ada@example.com' side by side.
create unique index users_email_lower_key on users (lower(email));

create table teams (
  id         bigint generated always as identity primary key,
  name       text not null unique check (char_length(name) between 1 and 100),
  created_at timestamptz not null default now()
);

create table memberships (
  team_id   bigint not null references teams (id) on delete cascade,
  user_id   bigint not null references users (id) on delete cascade,
  role      text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  -- One membership per user and team. The primary key's index also serves
  -- the foreign key on team_id, because team_id is its leading column.
  primary key (team_id, user_id)
);
-- The primary key cannot serve lookups by user_id alone.
create index memberships_user_id_idx on memberships (user_id);

create table tasks (
  id             bigint generated always as identity primary key,
  team_id        bigint not null references teams (id) on delete cascade,
  title          text not null check (char_length(title) between 1 and 200),
  status         text not null default 'todo' check (status in ('todo', 'doing', 'done')),
  assignee_id    bigint,
  estimate_hours numeric(6, 2) check (estimate_hours > 0),
  due_on         date,
  created_at     timestamptz not null default now(),
  completed_at   timestamptz,
  -- completed_at is set exactly when the task is done.
  constraint tasks_completed_matches_status
    check ((status = 'done') = (completed_at is not null)),
  -- The assignee must be a member of the task's team. Pointing at the
  -- membership (not at users) enforces that, and when the membership goes
  -- away only assignee_id is cleared (PostgreSQL 15+ column list).
  constraint tasks_assignee_membership_fkey
    foreign key (team_id, assignee_id) references memberships (team_id, user_id)
    on delete set null (assignee_id)
);
create index tasks_team_id_assignee_id_idx on tasks (team_id, assignee_id);
