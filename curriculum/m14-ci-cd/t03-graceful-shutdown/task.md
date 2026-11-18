Every deploy stops the old process. If it dies on the spot, the requests it was serving fail, and the load balancer keeps sending new ones for a few seconds. Make `server.mjs` shut down gracefully.

## Requirements

Keep the server as it is for normal operation: it listens on `127.0.0.1` and the port in `PORT`, logs a JSON line `{"msg":"listening","port":<port>}` to stdout once it is listening, and serves:

| Route | Normal answer |
| --- | --- |
| `GET /healthz/live` | `200` |
| `GET /healthz/ready` | `200` |
| `GET /work?ms=N` | `200 {"done":true,"ms":N}` after N milliseconds |

On `SIGTERM` (and `SIGINT`), shut down in this order:

1. **Fail readiness at once.** `GET /healthz/ready` answers `503`. Liveness stays `200`.
2. **Keep serving for `SHUTDOWN_DELAY_MS`** (default `0`). New connections and requests are still accepted.
3. **Stop accepting.** After the delay, new connections are refused. Idle keep-alive connections are closed.
4. **Drain.** Requests in flight finish normally. A keep-alive connection that served a request during the drain must not stay open afterwards.
5. **Exit `0`** as soon as the last request has finished.
6. **Deadline.** If the whole shutdown takes longer than `SHUTDOWN_TIMEOUT_MS` (default `10000`), counted from the signal, close everything and exit with code `1`.

Use only Node built-ins.

## Submission

`server.mjs` and `package.json`. In `README.md`, replace the TODO with a few lines on how your shutdown works and how you would choose the two values for a real deployment.

## What is checked

The checks start `node server.mjs` with `PORT=0` several times, with different values for the two variables, and send `SIGTERM` at chosen moments. They check that readiness turns to `503` during the delay while requests are still served, that new connections are refused after it, that a slow request in flight completes with `200` and the process then exits `0` within a second, that idle and busy keep-alive connections do not keep it alive, and that a request longer than the deadline ends in exit code `1` close to the deadline. The review looks at how clearly the stages read in the code.
