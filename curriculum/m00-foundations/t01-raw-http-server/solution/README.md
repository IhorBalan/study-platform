# Notes API on node:http

Run it with `node start.mjs` and explore with `curl -v`.

## Notes on my solution

`routes` is a small table: each entry has a path pattern and a map from method to handler. The
dispatcher finds the entry by path first. No entry means 404. An entry without the request's
method means 405, and the `Allow` header is built from the keys of that map, so it cannot drift.

Handlers throw `HttpError` for anything the client did wrong. One `try`/`catch` around the
dispatcher turns an `HttpError` into a problem document and anything else into a generic 500.

`readJsonBody` counts bytes as chunks arrive. Past the limit it stops storing chunks but keeps
consuming them, because destroying the request stream would also close the socket before the 413
could be written. The 413 response carries `Connection: close`.
