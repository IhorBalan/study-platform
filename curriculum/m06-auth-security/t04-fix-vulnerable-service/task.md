This invoices API was written in a hurry. It works for honest clients and falls over for anyone else. Find and fix the holes, and keep every normal request working.

## The app

NestJS with `pg` on PostgreSQL. It reads `DATABASE_URL` and creates its tables on start. Sessions, password hashing and the guards are already correct; leave them as they are.

| Route | Body or query | Who |
| --- | --- | --- |
| `POST /auth/signup` | `{ email, password, name }`, password 8 to 1024 characters | anyone |
| `POST /auth/login` | `{ email, password }` → `{ token }` | anyone |
| `GET /me`, `PATCH /me` | `PATCH` takes `{ name }` | signed in |
| `POST /invoices` | `{ customer, amountCents }` | signed in |
| `GET /invoices` | `?search=<text>&sort=<key>`: your invoices whose customer contains the text, case-insensitive | signed in |
| `GET /invoices/:id`, `DELETE /invoices/:id` | | the owner |
| `GET /admin/invoices` | | admins |

## Requirements

Fix at least these, without changing the routes or response shapes:

1. **SQL injection in `search`.** Any text, including `'` and `%`, is searched for literally.
2. **SQL injection in `sort`.** Allowed: `created_at`, `amount_cents`, `customer`, each optionally prefixed with `-` for descending. The default is `-created_at`. Anything else gets `400`.
3. **Mass assignment.** Sign-up, `PATCH /me` and `POST /invoices` accept exactly the fields in the table. Any other field (`role`, `id`, `ownerId`, ...) gets `400` and changes nothing. New users are always `member`.
4. **Broken object-level authorisation.** Another user's invoice gets `404` on read and delete, the same as an id that does not exist.
5. **Leaked secrets.** No response contains a password hash.

Keep `src/app.module.ts` exporting `AppModule`.

## Submission

The whole project without `node_modules` and `dist`, and `README.md` with the notes it asks for.

## What is checked

The checks compile the project and create the app from `AppModule` against a fresh, empty database in `DATABASE_URL`. Two users sign up and create invoices. The checks then send the normal requests and a set of attack requests (quotes, `UNION SELECT`, stacked statements, expressions in `sort`, extra fields, other users' ids) and look at both the responses and the data afterwards.
