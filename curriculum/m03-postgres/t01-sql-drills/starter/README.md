# SQL drills

Five queries against a small shop database. Each file in `queries/` states the exact columns, rows and order it must return.

```sh
pnpm lab up postgres
createdb -h localhost -p 55432 -U lab drills     # password: lab
export DATABASE_URL=postgres://lab:lab@localhost:55432/drills
npm run db:reset                                 # schema and sample data
psql "$DATABASE_URL" -f queries/01-customer-revenue.sql
```

## Notes

(Optional) Anything that surprised you, for example a query that returned the right rows for the wrong reason.
