The documents API can log users in, but it checks nothing after that. Add authentication, a role check and an ownership check so that each user reaches exactly what they should.

## The starter

Users, login and a small HS256 `TokenService` are given. The practice users are `alice` and `bob` (members) and `carol` (admin); each password is the username followed by `-password`. `POST /auth/login` returns `{ "accessToken": "..." }`. Decorators `@Public()`, `@Roles([...])` and `@CurrentUser()` are in `src/auth/`.

Keep `src/app.module.ts` exporting `AppModule`, and keep the routes and their shapes.

## Requirements

1. **Authentication.** Write `AuthGuard` and register it globally. Every route needs `Authorization: Bearer <accessToken>`, except routes marked `@Public()` (`GET /health`, `POST /auth/login`). A missing, malformed, tampered or foreign token gets `401`. The guard loads the user with `UsersService.findById()` and sets `request.user`. Identity comes from the token only; headers such as `X-User-Id` or `X-Role` change nothing.
2. **Roles.** Write `RolesGuard` and register it globally after `AuthGuard`. `GET /admin/users` is for `admin` only: members get `403`, callers without a valid token get `401`.
3. **Ownership.** For `/documents`:

| Request | Owner | Other member | Admin |
| --- | --- | --- | --- |
| `GET /documents` | own documents | own documents | own documents |
| `GET /documents/:id` | `200` | `404` | `200` |
| `PATCH /documents/:id` | `200` | `404`, unchanged | `200` |
| `DELETE /documents/:id` | `204` | `404`, still there | `204` |

`POST /documents` stays as it is: the owner is the caller.

## Submission

The whole project without `node_modules` and `dist`. Answer the two questions in `README.md`.

## What is checked

The checks compile the project, create the app from `AppModule`, log in as all three users and call every route as each of them and as nobody, with forged, tampered and `alg: "none"` tokens and spoofed headers. The review looks at where each rule lives.
