# Team task tracker schema

Write `schema.sql` from the spec in the task brief, then try it:

```sh
pnpm lab up postgres
createdb -h localhost -p 55432 -U lab tracker     # password: lab
export DATABASE_URL=postgres://lab:lab@localhost:55432/tracker
npm run db:apply
psql "$DATABASE_URL"                               # try some inserts that should fail
```

## Design notes

TODO: a few lines on the decisions the spec left open: key types, how you enforce case-insensitive email, how you made sure an assignee belongs to the task's team, and one place where you would consider denormalising later and why.
