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

| Hole | Attack | Fix |
| --- | --- | --- |
| SQL injection in `search` | `?search=' OR '1'='1` returned every row the WHERE clause could reach; a `UNION SELECT` could read `password_hash` | The value is bound as `$2` (`customer ILIKE '%' \|\| $2 \|\| '%'`), with `%`, `_` and `\` escaped so they match literally |
| SQL injection in `sort` | `?sort=(CASE WHEN ... password_hash ...)` leaks data one bit at a time through the order | `sort` must be a key of a fixed map; the SQL fragment comes from the map, anything else is `400` |
| Mass assignment | `POST /auth/signup` with `"role":"admin"`, `PATCH /me` with `{"role":"admin"}`, `POST /invoices` with `ownerId` | zod `strictObject` schemas run by `StandardSchemaValidationPipe` reject unknown keys with `400`; the SQL names its columns explicitly |
| Missing ownership check (BOLA) | `GET /invoices/1`, `/2`, ... returns everyone's invoices; `DELETE` likewise | `WHERE id = $1 AND owner_id = $2` in the query itself, so a foreign id is simply not found (`404`) |
| Leaked hashes | `RETURNING *` sent `password_hash` back on sign-up and profile updates | Every query lists the columns of the public `AuthUser` shape (`USER_COLUMNS`) |

`sort` cannot be a parameter because parameters carry values, and a column name or `DESC` is part of the statement's structure. Postgres has to know the structure before it binds values. The only safe way to make structure depend on input is to choose between fixed fragments that you wrote.
