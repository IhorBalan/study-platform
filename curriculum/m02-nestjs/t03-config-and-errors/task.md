Give the notes API configuration it can trust and errors a client can rely on.

## Requirements

The starter is the validated notes API plus `GET /health` and `GET /debug/boom`. Keep `src/app.module.ts` exporting `AppModule` and leave `src/debug/debug.controller.ts` unchanged. The checks never run `src/main.ts`, so register everything through modules (`APP_FILTER`, a factory provider).

### Configuration

Finish `src/config/env.ts` and provide the parsed configuration under the `ENV` token.

| Variable | Rule | Default |
| --- | --- | --- |
| `NODE_ENV` | `development`, `test` or `production` | `development` |
| `PORT` | integer from 1 to 65535 | `3000` |
| `MAX_NOTES` | integer of at least 1 | `100` |
| `ADMIN_TOKEN` | at least 16 characters | none, it is required |

- With invalid configuration, `NestFactory.create(AppModule)` rejects with an `Error`. Its message names **every** invalid variable and never contains the value of `ADMIN_TOKEN`. Throw; do not call `process.exit`.
- `GET /health` answers `200` with `{ "status": "ok", "environment": "<NODE_ENV>" }`, read from the typed config.
- When `MAX_NOTES` notes exist, a valid `POST /notes` answers `409`. The service signals this with its own error class, not an `HttpException`. Invalid input still gets `400`.

Nothing uses `ADMIN_TOKEN` yet; it is there so that you handle one secret correctly.

### Errors

A global exception filter turns every error into an RFC 9457 problem document: `Content-Type: application/problem+json` and a JSON object with `type` (a string such as `"about:blank"`), `title` (a non-empty string) and `status` (the HTTP status as a number). `detail`, if present, is a string.

- `404` for an unknown note and for an unknown route, `400` for validation, `409` for a full store.
- A `400` still names the field at fault somewhere in the document.
- `GET /debug/boom` answers `500`. The body contains no part of the thrown message and no stack trace.
- Successful responses are unchanged.

## Submission

The whole project without `node_modules`, `dist` and `.env`.

## What is checked

The checks create the app from `AppModule` in child processes with valid, missing and invalid variables and read what a failure prints. They then call the routes above. The review looks at where `process.env` is read, how the domain error is mapped and what is logged.
