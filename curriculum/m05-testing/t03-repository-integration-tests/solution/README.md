# Notes repository: integration tests

A small `pg` repository over a `notes` table, and one test that passes exactly once. Read the task brief, make the tests isolated, then cover the whole repository.

```sh
pnpm lab up postgres
createdb -h localhost -p 55432 -U lab notes_test     # password: lab
export DATABASE_URL=postgres://lab:lab@localhost:55432/notes_test
npm install
npm test        # node --test runs the .ts files directly
npm test        # ...and again: see the starter test fail
```

Node strips the TypeScript types when it runs a `.ts` file, so use only syntax that can be erased (no `enum`, no constructor parameter properties) and import local files with their `.ts` extension.

At work you would likely run these tests with Vitest and start Postgres per test run with Testcontainers. Here the lab Postgres stands in for the container, and `node:test` for Vitest.

## Isolation

Each test runs in a transaction on one client checked out of the pool: `BEGIN` in `beforeEach`, `ROLLBACK` in `afterEach`. The repository accepts that client in place of the pool, so it never notices. A `TRUNCATE` inside the same transaction hides rows that earlier, non-isolated runs committed, and the rollback undoes it. Rollback is faster than truncating and re-seeding, and tests cannot see each other's rows.

What it costs: code that opens its own transaction or uses a second connection (a job queue, `pool.query` inside a service) escapes the test transaction, and `now()` is frozen for the whole test, so ordering by `created_at` alone cannot be tested this way. For those cases, truncate committed data instead, or give each worker its own database.
