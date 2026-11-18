# Make slow queries fast

`queries.sql` holds four queries that read far more rows than they return. Add indexes in `migrations/001_indexes.sql` until each plan uses one.

```sh
pnpm lab up postgres
createdb -h localhost -p 55432 -U lab perf       # password: lab
export DATABASE_URL=postgres://lab:lab@localhost:55432/perf
npm run db:reset          # about 650,000 rows, a few seconds
npm run db:migrate
psql "$DATABASE_URL"      # then: explain (analyze, buffers) <a query from queries.sql>
```

To start again from no indexes, run `npm run db:reset`.

## Before and after

TODO: for each query, the plan's top node types and the execution time before and after your index (from EXPLAIN ANALYZE), and one sentence on why you chose that index.
