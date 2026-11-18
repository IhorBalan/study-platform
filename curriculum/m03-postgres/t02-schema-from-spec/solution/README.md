# Team task tracker schema

## Design notes

- Keys are `bigint generated always as identity`. They are small, sortable and never chosen by a client. UUIDs would help if ids were created outside the database.
- Email uniqueness is a unique index on `lower(email)`. A plain unique constraint treats `Ada@x` and `ada@x` as different; `citext` would also work but needs an extension.
- The assignee rule is a composite foreign key from `tasks (team_id, assignee_id)` to `memberships (team_id, user_id)`. Pointing at `users` would only prove the user exists. `on delete set null (assignee_id)` clears only the assignee when someone leaves a team, and keeps `team_id`.
- `completed_at` is tied to `status = 'done'` with a CHECK, so the two can never disagree.
- Indexes: the memberships primary key starts with `team_id`, so it covers that foreign key. `user_id` needs its own index. `tasks (team_id, assignee_id)` covers both foreign keys on tasks.
- Denormalising later: a `open_task_count` on teams would make a dashboard cheap, at the price of keeping it in sync in the same transaction as every task change. I would only add it once counting is measurably slow.
