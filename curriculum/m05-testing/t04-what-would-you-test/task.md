"What would you test in this endpoint?" is a favourite interview question, and the same decision you make every time you open a pull request. Answer it for the endpoint below. Write 400 to 700 words, as lists or short prose. No code is required.

## The endpoint

`POST /workspaces/:workspaceId/invites` in a NestJS API backed by PostgreSQL.

- **Auth.** A bearer token identifies the caller. Only members with the role `admin` in that workspace may invite. Others get `403`; no token gets `401`.
- **Body.** `{ "email": string, "role": "member" | "admin" }`, validated with a zod schema. The email is trimmed and lower-cased before use. Invalid input gets `400`.
- **Rules.** If the email already belongs to a member, `409`. A workspace may have at most 50 pending invites; the 51st gets `422`. Inviting an email that already has a pending invite replaces that invite instead of adding a second one.
- **Effects.** In one transaction, the handler inserts the invite with a random token and `expires_at = now + 7 days`, and writes an `invite.created` row to an outbox table. A background worker later reads the outbox and calls the email provider's HTTP API.
- **Response.** `201` with the invite (without the token) and a `Location` header.

## What to cover

1. **Unit tests.** Which pieces of logic would you pull out and test in isolation? List the cases, including edge cases.
2. **Integration tests.** Which behaviour needs the real database? Name the cases, and say how you keep tests isolated from each other.
3. **HTTP-level tests.** Which cases go through the whole Nest app (guards, pipes, filters)? What do you replace with a test double there, and what stays real?
4. **End-to-end.** Is a full end-to-end test (API, worker, a fake email server) worth it here? If so, how many, and which flow?
5. **Doubles.** For the clock, the token generator, the email provider and the database: real, fake, stub or mock, and why.
6. **What you would not test**, and why. Name at least one thing.

## What is assessed

Whether each case sits at the cheapest level that can catch its bug, whether the edge cases are the ones that break in practice, and whether your choice of doubles keeps the tests honest. There are no automated checks.
