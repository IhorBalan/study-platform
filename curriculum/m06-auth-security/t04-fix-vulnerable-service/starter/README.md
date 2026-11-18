# Invoices API: fix the holes

A small invoices API on PostgreSQL. It works for honest clients. Read the task brief, then make it safe without breaking them.

```sh
npm install
pnpm lab up postgres            # from the platform repo, if it is not running
export DATABASE_URL=postgres://lab:lab@localhost:55432/lab
npm run build && npm start      # http://127.0.0.1:3000
```

The app creates its three tables (`users`, `sessions`, `invoices`) on start.

## Notes on my fixes

TODO: for each hole you fixed (SQL injection in search, SQL injection in sort, mass assignment, the missing ownership check, the leaked password hashes), one line: the attack request, and the fix.

TODO: why can `sort` not be fixed with a `$1` parameter like `search`?
