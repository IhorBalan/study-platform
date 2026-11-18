---
title: Integration tests against a real database
skills: [db-integration-testing]
---

Most backend bugs sit where your code meets the database: a query that returns rows in the wrong order, a missing `WHERE`, a constraint you forgot, a transaction that does not hold the lock you assumed. Mocks cannot see any of that. This lesson shows how to test against a real PostgreSQL, started on demand with Testcontainers, and how to keep those tests isolated from each other and fast enough to run on every save.

## Why a real database, and not a substitute

The tempting shortcuts each miss something:

- **Mocking the driver** checks that you called `query()` with some string. The SQL never runs.
- **SQLite or an in-memory imitation of Postgres** runs SQL, but not your SQL dialect. `RETURNING`, `ON CONFLICT`, `jsonb`, arrays, `timestamptz`, partial indexes and isolation levels behave differently or not at all.
- **A shared development database** runs the right SQL, but its contents change under you, and two developers or CI jobs running at once corrupt each other's tests.

What you want is the same major version of Postgres as production, empty and private to this test run. Docker makes that cheap, and Testcontainers makes it a few lines of test code.

## Testcontainers in one file

Testcontainers is a library (for Node, Java, Go and others) that starts a container from your test code, waits until it is ready, gives you its connection details, and removes it afterwards. A small helper container called Ryuk removes the containers even if the test process crashes.

```sh
npm install -D vitest testcontainers @testcontainers/postgresql
```

Start one container for the whole run in Vitest's global set-up, apply the migrations once, and hand the URL to the test files:

```ts
// test/global-setup.ts
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import type { TestProject } from 'vitest/node';
import { migrate } from '../src/schema.js';

export default async function setup(project: TestProject) {
  const container = await new PostgreSqlContainer('postgres:18-alpine').start();
  const url = container.getConnectionUri();

  const pool = new pg.Pool({ connectionString: url });
  await migrate(pool);
  await pool.end();

  project.provide('databaseUrl', url);
  return async () => {
    await container.stop();
  };
}

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}
```

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { globalSetup: ['test/global-setup.ts'] },
});
```

A test file reads the URL with `inject('databaseUrl')` from `vitest`. The first run pulls the image, which takes a while; after that, starting Postgres takes a second or two. CI runners with Docker (GitHub's Ubuntu runners have it) run the same code unchanged.

In this module's tasks the sandbox has no Docker, so the lab Postgres plays the container's part and its URL arrives in `DATABASE_URL`. The test code is the same either way: it gets a URL and an empty database.

## Isolation: every test starts clean

Tests now share a database, and shared state is the root of most test-suite pain. A test that inserts a note and then asserts `listRecent()` returns one note passes on an empty table and fails on the second run. A test that relies on the previous test's row passes in file order and fails when shuffled. You need a rule that gives every test a known starting point. There are three common ones.

### 1. A transaction per test, rolled back

Check out one client, `BEGIN` before each test, `ROLLBACK` after it. Everything the test wrote disappears, and nothing was ever visible to other connections.

```ts
// test/notes-repository.test.ts
import pg from 'pg';
import { afterAll, afterEach, beforeEach, expect, inject, it } from 'vitest';
import { NotesRepository } from '../src/notes-repository.js';

const pool = new pg.Pool({ connectionString: inject('databaseUrl') });
let client: pg.PoolClient;
let repo: NotesRepository;

beforeEach(async () => {
  client = await pool.connect();
  await client.query('BEGIN');
  repo = new NotesRepository(client);
});

afterEach(async () => {
  await client.query('ROLLBACK');
  client.release();
});

afterAll(() => pool.end());

it('rename changes only the target note', async () => {
  const target = await repo.create({ title: 'old' });
  const other = await repo.create({ title: 'untouched' });
  await repo.rename(target.id, 'new');
  expect(await repo.findById(other.id)).toEqual(other);
});
```

This is the fastest option: a rollback is nearly free. It needs code that accepts a connection from outside (here the repository takes a `Pool` or a `PoolClient`, which is good design anyway), and it has limits:

- Code that opens its own transaction issues a second `BEGIN`, which Postgres ignores with a warning, and its `COMMIT` then ends your test transaction. Wrap the code's transactions in savepoints, or use another strategy for those tests.
- Anything that uses a different connection (a second pool, a background job) cannot see the uncommitted rows.
- `now()` returns the transaction's start time, so every row in the test has the same timestamp. Order by an extra column such as `id` if order matters.
- You cannot test what only happens at commit: deferred constraints, or two concurrent transactions racing.

### 2. Truncate before each test

```ts
beforeEach(async () => {
  await pool.query('TRUNCATE notes, tags RESTART IDENTITY CASCADE');
});
```

Simple and honest: data is really committed, any number of connections can see it, and code may run its own transactions. It is slower than a rollback (still milliseconds for a few tables), and `TRUNCATE` takes an exclusive lock, so two test files that truncate the same database must not run at the same time. Truncate before each test, not after: a crashed run then cannot leave dirt for the next one.

### 3. A database per worker

Vitest runs test files in parallel workers. Give each worker its own database, cloned from a migrated template, and the workers can no longer see each other at all:

```ts
// test/worker-db.ts
import pg from 'pg';
import { inject } from 'vitest';

export async function createWorkerDatabase(): Promise<string> {
  const adminUrl = inject('databaseUrl');
  const name = `test_${process.env.VITEST_POOL_ID ?? '1'}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${name}`);
  await admin.query(`CREATE DATABASE ${name} TEMPLATE app_template`);
  await admin.end();
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  return url.toString();
}
```

The global set-up migrates `app_template` instead of the default database. Copying a template is far faster than running every migration again. Postgres refuses to copy a template while anything is connected to it, so close the migration pool before the workers start. Inside each worker database you still need rule 1 or 2 between tests.

Which to choose: start with transactions for repository tests, use truncation where the code manages its own transactions or connections, and add a database per worker when the suite is big enough that parallel files matter.

## Keeping it fast

- **One container per run**, never one per test or per file.
- **Migrate once**, into the template or in global set-up.
- **Small pools.** A test file needs one or two connections, not the production default.
- **Turn off durability you do not need.** For a throwaway test database, start Postgres with `-c fsync=off` (through `withCommand` on the container). Never do this anywhere else.
- **Create only the rows a test needs**, with a small builder function (`makeNote({ title: 'x' })`) instead of a shared seed file that every test depends on.
- **Avoid asserting on data you did not create.** "The list contains my two notes, newest first" is robust; "the table has exactly 2 rows" depends on isolation being perfect.

## Common mistakes

- Asserting on ids (`expect(note.id).toBe('1')`). Sequences are not rolled back and are not reset by plain `TRUNCATE`.
- Cleaning up in `afterEach` only, so one crashed run poisons the next.
- Testing `rename()` with a single row, where an `UPDATE` without `WHERE` looks correct.
- Forgetting `pool.end()`, so the test process never exits.
- Running migrations in every test file, which turns a two-second suite into a twenty-second one.

## Go deeper

- [Testcontainers for Node.js: PostgreSQL module](https://node.testcontainers.org/modules/postgresql/): options, connection details and wait strategies.
- [Vitest: Configuring Vitest](https://vitest.dev/config/): `globalSetup`, `provide` and the options for pools and parallelism.
- [PostgreSQL: Template databases](https://www.postgresql.org/docs/current/manage-ag-templatedbs.html): how `CREATE DATABASE ... TEMPLATE` copies a database.
- [PostgreSQL: TRUNCATE](https://www.postgresql.org/docs/current/sql-truncate.html): `RESTART IDENTITY`, `CASCADE` and the locks it takes.
- [PostgreSQL: Current date and time](https://www.postgresql.org/docs/current/functions-datetime.html#FUNCTIONS-DATETIME-CURRENT): why `now()` is fixed for a whole transaction.
