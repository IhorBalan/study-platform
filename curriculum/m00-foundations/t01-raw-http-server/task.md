Build a small notes API using only `node:http`. No framework, no npm packages.

## Requirements

Edit `server.mjs`. It must export a function `createServer()` that returns a `node:http` server which is **not yet listening**. The checks call `listen(0, '127.0.0.1')` themselves. Every call to `createServer()` returns a server with its own empty in-memory store.

A note is `{ "id": string, "text": string }`. The server generates the id.

| Request | Success response |
| --- | --- |
| `GET /notes` | `200`, JSON array of all notes in creation order |
| `POST /notes` with body `{ "text": "..." }` | `201`, the created note, `Location: /notes/<id>` |
| `GET /notes/:id` | `200`, the note |
| `DELETE /notes/:id` | `204`, no body |

Success responses with a body use `Content-Type: application/json`.

## Errors

Every error response has `Content-Type: application/problem+json` and a JSON body with at least `type` (string), `title` (string) and `status` (number, equal to the HTTP status).

- `400`: the `POST` body is not valid JSON.
- `413`: the `POST` body is larger than 1024 bytes, whether or not `Content-Length` was sent.
- `415`: the `POST` has a `Content-Type` other than `application/json` (parameters such as `; charset=utf-8` are fine), or none.
- `422`: the JSON is valid but is not an object with a non-empty string `text`.
- `404`: unknown path, or no note with that id.
- `405`: known path, unsupported method. Include an `Allow` header listing the supported methods: `GET, POST` for `/notes` and `GET, DELETE` for `/notes/:id`.

## Submission

`server.mjs` (plus any other `.mjs` files it imports) and a short `README.md` that explains how you structured routing and error handling.

## What is checked

Automated checks start your server on a random port and exercise every row and every error above. The review then looks at how the routing, body reading and error handling are structured.
