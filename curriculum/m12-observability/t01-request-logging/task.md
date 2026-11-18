The orders API logs with pino, but its lines cannot be tied to a request, there is no line per request at all, and a signup writes the user's password to the log. Fix all three.

## Requirements

`src/app.ts` exports `createApp({ destination? })`, which returns an Express 5 app that is not yet listening. Every log line must go to `destination` (default: stdout). Keep the routes behaving as they do now. Use only `express`, `pino` and Node built-ins.

**One summary line per request.** When a response finishes, write one line with `msg: "request completed"` and these fields:

| Field | Value |
| --- | --- |
| `reqId` | the request's id |
| `method` | `"GET"`, `"POST"`, … |
| `route` | the route template, such as `"/orders/:id"`; `"unmatched"` when no route matched |
| `statusCode` | the status as a number |
| `durationMs` | milliseconds from arrival to finish, a number |

Log it at `info` for 2xx and 3xx, `warn` for 4xx, `error` for 5xx (pino levels 30, 40, 50).

**Request ids.** If the `x-request-id` header holds 1 to 64 characters from `A-Z a-z 0-9 . _ : -`, use it. Otherwise generate one (`crypto.randomUUID()` is fine). Send the id back in the `x-request-id` response header.

**Correlation.** Every line written while handling a request, including the lines that the orders code writes after an `await`, carries the field `reqId` with that request's id. Requests run concurrently, so a module-level variable will not do.

**No secrets.** Passwords, `Authorization` headers and cookies must never appear in the output. Keep the `"user signed up"` and `"unhandled error"` lines, and keep the error message in the latter.

## Tests

Write tests in `test/*.test.ts` with `node:test`, passing your own destination to `createApp()`. They must pass, and they must fail against an app that also logs every request body, and against one whose handler lines lose `reqId`.

## Submission

`src/`, `test/`, `package.json`, `tsconfig.json` and `README.md`, without `node_modules`.

## What is checked

The checks run `tsc`, start your app with their own destination, and send requests with safe, unsafe and missing ids, 20 at once, to every route. They parse every line, look for a password, a bearer token and a cookie value they sent, and run your tests against your code and two broken copies.
