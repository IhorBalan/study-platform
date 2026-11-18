The starter is a working server with a performance bug. `GET /hash` computes an iterated SHA-256 digest in one synchronous loop. While that loop runs, the event loop is blocked and every other request waits, including the health check a load balancer would use. Make the server stay responsive without changing its results.

## The server

`server.mjs` exports `createServer()`, which returns a `node:http` server that is not yet listening.

- `GET /health` → `200` `{ "status": "ok" }`
- `GET /hash?input=<string>&rounds=<n>` → `200` `{ "input", "rounds", "hash" }`. `rounds` is an integer from 1 to 20,000,000. Anything else, or a missing `input`, is a `400`.

`hash.mjs` defines the digest: SHA-256 of the input, then SHA-256 of the previous digest's bytes, `rounds` times in total, as lower-case hex.

## Requirements

- Keep the exported `createServer()` and both routes, with the same responses and the same digests as the starter.
- While a heavy `/hash` request is in progress, `GET /health` must answer within 300 ms.
- Several `/hash` requests at the same time must each get their own correct result.
- Use only Node built-ins. You may add files next to `server.mjs`, for example a worker script. Chunking the loop with `setImmediate` and moving it to a worker thread are both acceptable.

## Submission

The changed code, and a `README.md` that says which approach you chose and why, what it costs, and how you measured `/health` latency before and after.

## What is checked

The checks start your server in a child process on a random port. They compare digests with a reference implementation, then run one hash sized to take over a second and time `/health` requests while it runs. The slowest must stay under 300 ms.
