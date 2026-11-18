The notes API stores whatever a client sends: a number as a title, a megabyte of text, fields it has never heard of. Make it check its input at the boundary.

## Requirements

The starter is a working notes API. Keep `src/app.module.ts` exporting `AppModule`, and keep every route behaving as before for valid requests.

`POST /notes` accepts a JSON object with exactly these fields:

| Field | Rule |
| --- | --- |
| `title` | required, a string of 1 to 100 characters |
| `body` | optional, a string of at most 2000 characters (`""` is allowed) |
| anything else | not allowed, including `id` and `createdAt` |

Lengths are counted as sent; do not trim. A request that breaks a rule gets `400 Bad Request` and stores nothing. The `400` response is a JSON object that names the field at fault somewhere in it, for example in a `message` array. The default error body of Nest's validation pipes already does this.

Use either approach from the lesson:

- class-validator: a DTO class and `ValidationPipe`, or
- zod: a schema passed as `@Body({ schema })`, run by `StandardSchemaValidationPipe`.

The checks create the app from `AppModule` and never run `src/main.ts`. A pipe registered with `app.useGlobalPipes()` in `main.ts` therefore has no effect on them. Register a global pipe in a module with the `APP_PIPE` token, or bind the pipe on the route.

## Submission

The whole project without `node_modules` and `dist`. Add a few lines to `README.md` on which approach you chose and what you gave up by not choosing the other.

## What is checked

The checks compile the project, create the app from `AppModule` and send valid notes (including a title of exactly 100 characters and a body of exactly 2000), then notes with a missing title, wrong types, values one character too long and unknown fields. Each bad request must get `400`, must name the field, and must leave `GET /notes` unchanged. The review looks at where the validation lives and whether the rules are declared once.
