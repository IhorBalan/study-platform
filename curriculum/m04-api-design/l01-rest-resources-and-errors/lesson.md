---
title: "REST resources, status codes and errors"
skills: [api-rest-design]
---

An API is a user interface for programmers. Its users write code against it once and then expect it to behave the same way for years. Good REST design is mostly about predictability: a client that has seen three of your endpoints should be able to guess the fourth, and a client that hits an error should know what to do next without reading your source.

## Resources first, verbs second

REST models the world as resources (things with an identity) that you manipulate with a small, fixed set of HTTP methods. The URL names the thing. The method says what to do with it.

```http
GET    /projects                  list projects
POST   /projects                  create a project
GET    /projects/42               read one
PATCH  /projects/42               change some fields
DELETE /projects/42               remove it
GET    /projects/42/tasks         tasks that belong to project 42
```

A few rules keep this predictable:

- **Plural nouns for collections**, the id as the next segment. `/projects/42`, never `/project/42` or `/getProject?id=42`.
- **One naming style.** Pick kebab-case or camelCase for paths and stick to it. JSON fields usually follow the frontend's convention (camelCase), because that is where they are read.
- **Nest one level at most.** `/projects/42/tasks` reads well. `/orgs/1/projects/42/tasks/7/comments` forces the client to know four ids to read one comment. Give the comment its own top-level URL, `/comments/9001`, once it has a globally unique id.
- **Actions that do not fit CRUD** become either a state change (`PATCH /orders/7` with `{ "status": "cancelled" }`) or a sub-resource that you create (`POST /orders/7/cancellation`). The second form is useful when the action has its own data (a reason, a refund amount) or its own rules. Avoid `POST /cancelOrder`.

The frontend analogy: think of URLs like your router's route table and of methods like the event handlers on a form. A route never contains "submit"; the event does.

## Methods carry promises

Clients, proxies and libraries rely on what each method promises (RFC 9110).

| Method | Safe (no side effects) | Idempotent (repeat = same result) | Typical success |
| --- | --- | --- | --- |
| `GET` | yes | yes | `200` |
| `POST` | no | no | `201` with `Location`, or `200`/`202` |
| `PUT` | no | yes | `200` or `204` (or `201` if it created) |
| `PATCH` | no | not guaranteed | `200` |
| `DELETE` | no | yes | `204` |

Idempotent means that sending the request twice leaves the server in the same state as sending it once. That is why a fetch library may retry a `PUT` or `DELETE` after a dropped connection but must never blindly retry a `POST`. Lesson 3 shows how to make `POST` safe to retry anyway.

`PUT` replaces the whole resource with the body. `PATCH` changes part of it. For JSON the simplest `PATCH` format is JSON Merge Patch (RFC 7396): send only the fields to change, and `null` to remove one. It cannot express "append to this array", which is rarely a problem in practice.

## Status codes a client can act on

Status codes are for code, not for humans. Each one should tell the client which branch to take. You need far fewer than the full list:

| Code | Meaning for the client |
| --- | --- |
| `200 OK` | Here is the result. |
| `201 Created` | Created. `Location` says where it lives. |
| `202 Accepted` | Queued. Poll the URL you got back. |
| `204 No Content` | Done, nothing to show. |
| `400 Bad Request` | The request is malformed (bad JSON, wrong types, missing field). Fix the code. |
| `401 Unauthorized` | Who are you? Log in or refresh the token. |
| `403 Forbidden` | I know who you are, and you may not do this. |
| `404 Not Found` | No such resource (or you may not know it exists). |
| `409 Conflict` | The request is fine, but the current state does not allow it: a duplicate email, an edit based on a stale version. |
| `422 Unprocessable Content` | Well-formed, but semantically invalid. Some APIs use it for all validation errors, others for business rules only. Pick one rule and write it down. |
| `429 Too Many Requests` | Slow down. `Retry-After` says for how long. |
| `500`, `503` | Our fault. Retrying later may help. |

Two choices come up in every review. First, returning `404` instead of `403` for a resource the caller may not see hides its existence, which matters for private ids that are guessable. Second, the line between `400` and `422` is debated; consistency matters more than the choice. A common split: `400` for anything a schema can catch, `409` for conflicts with current state, `422` for business rules that need data.

A `201` should carry `Location: /projects/43` and usually the created resource itself, so the client does not need a second request.

## One error shape: problem details

You met RFC 9457 in the NestJS module. Here is how to design with it rather than just emit it. A problem document has five standard members, all optional:

```json
{
  "type": "https://api.example.com/problems/insufficient-credit",
  "title": "Not enough credit",
  "status": 409,
  "detail": "This export needs 40 credits; the workspace has 12.",
  "instance": "/exports/8f2c"
}
```

- **`type` is the error's identity.** A client switches on it, not on `title` or `detail`. Use `about:blank` for errors that mean nothing beyond the status code, and your own URI for each business error a client may handle differently. The URI does not have to resolve, but a page explaining the error is a kind gesture.
- **`title` is stable per `type`.** It may be shown to developers. Do not put request data in it.
- **`detail` explains this occurrence.** It is for humans, so a client should never parse it.
- **Extension members** carry machine-readable data. The useful ones are a list of field errors and the numbers behind a business rule:

```json
{
  "type": "https://api.example.com/problems/validation",
  "title": "Request body is invalid",
  "status": 400,
  "errors": [
    { "pointer": "/email", "detail": "must be a valid email address" },
    { "pointer": "/items/2/quantity", "detail": "must be at least 1" }
  ]
}
```

The JSON Pointer in `pointer` lets a form library map each error to a field, which is exactly what your React form wants. Serve every error, including `404` and `500`, with `Content-Type: application/problem+json`. A `500` says "something went wrong" and nothing about stack traces, SQL or file paths.

## A worked example

A small API for a team's projects, written as the table you would put in a design review:

| Request | Success | Failures |
| --- | --- | --- |
| `GET /projects?limit=20&cursor=…` | `200` page | `400` bad limit |
| `POST /projects` | `201` + `Location` | `400` invalid body, `409` name taken |
| `GET /projects/{id}` | `200` | `404` |
| `PATCH /projects/{id}` (merge patch) | `200` updated project | `400`, `404`, `412` stale `If-Match` (`428` if it is missing) |
| `POST /projects/{id}/archive` | `200` archived project | `404`, `409` already archived |
| `DELETE /projects/{id}` | `204` | `404`, `409` project still has open tasks |

Writing this table before any code catches most design problems while they are still cheap.

## Common mistakes

- Verbs in URLs (`/createUser`, `/deleteProject?id=4`) and mixed singular and plural collections.
- `200 OK` with `{ "success": false }` in the body. Proxies, monitoring and fetch libraries all believe the `200`.
- A different error shape per endpoint, or validation errors as one concatenated string that a form cannot map to fields.
- Clients that switch on `detail` text because there is no `type`.
- Leaking internals in `500` responses.
- Deep nesting that forces clients to know parent ids they do not have.

## Go deeper

- [RFC 9457: Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc9457): the members, extension rules and the `about:blank` type.
- [RFC 9110: HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110): the authoritative meaning of each method and status code.
- [RFC 7396: JSON Merge Patch](https://www.rfc-editor.org/rfc/rfc7396): the simple `PATCH` format and its limits.
- [MDN: HTTP response status codes](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status): a readable reference with browser behaviour.
