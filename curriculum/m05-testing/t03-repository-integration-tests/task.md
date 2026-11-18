`src/notes-repository.ts` stores notes in PostgreSQL with `pg`. It is correct. Write integration tests that run it against a real database, catch real bugs, and pass on any database state, run after run.

## The repository

`new NotesRepository(db)` takes a `pg.Pool` or a `pg.PoolClient`. `migrate(db)` from `src/schema.ts` creates the `notes` table if it does not exist.

| Method | Behaviour |
| --- | --- |
| `create({ title, body? })` | Inserts a note and returns `{ id, title, body, createdAt }`. `body` defaults to `''`. `id` is a string. |
| `findById(id)` | The note, or `null` when no note has that id. |
| `listRecent(limit)` | At most `limit` notes, newest first: by `created_at`, then by `id`, both descending. |
| `rename(id, title)` | Changes that one note's title and returns the updated note, or `null` when no note has that id. |
| `delete(id)` | `true` when a note was deleted, `false` when no note had that id. Other notes stay. |

## Requirements

- Tests go in `test/notes-repository.test.ts` (one file; parallel test files would share the database). Use `node:test` and `pg`.
- Connect with `process.env.DATABASE_URL`. Call `migrate()` before the tests and close the pool after them.
- Every test must pass on a database that already has notes in it, including rows left by an earlier run, and in any order.
- Do not change the files in `src/`; the checks replace them anyway.
- Add a few lines to `README.md` on your isolation strategy and what it costs.

Locally, create your own database first:

```sh
pnpm lab up postgres
createdb -h localhost -p 55432 -U lab notes_test     # password: lab
export DATABASE_URL=postgres://lab:lab@localhost:55432/notes_test
npm install && npm test
```

## Submission

The folder with `src/`, `test/`, `package.json` and `README.md`, without `node_modules`.

## What is checked

The checks get a fresh database in `DATABASE_URL` and drop the `notes` table between runs. They run your tests against the correct repository on an empty table, then twice in a row without cleaning up, then twice in shuffled order (`node --test --test-randomize`). Then they run them against broken repositories, such as one whose `rename()` touches other rows or whose `listRecent()` returns one note too many. Your tests must fail for each.
