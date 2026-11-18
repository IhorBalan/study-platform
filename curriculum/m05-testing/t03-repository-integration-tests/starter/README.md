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

TODO: which strategy you chose, and one thing it costs or cannot handle.
