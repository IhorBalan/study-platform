A pairing round in the style of a small company: a working endpoint and a request to extend it while you explain what you do. **Time box: 45 minutes.** Nobody is listening here, so you keep a short log in `NOTES.md` in place of talking. Node built-ins only.

The starter serves `GET /tickets` and returns every ticket. A ticket is `{ id, title, status, priority, createdAt }`: `id` is a whole number, `status` is `open`, `pending` or `closed`, `priority` is 1 to 4, and `createdAt` is an ISO string in UTC.

## tickets.mjs

Keep `ValidationError`. `listTickets(tickets, { status, sort, limit, cursor } = {})` returns `{ items, nextCursor }` and does not change `tickets`.

- **`status`**: when given, keep only tickets in that status. Anything but the three statuses is a `ValidationError`.
- **`sort`**: `createdAt`, `-createdAt`, `priority` or `-priority`; a leading `-` means descending. The default is `-createdAt`. Ties are broken by `id` in the same direction. Anything else is a `ValidationError`.
- **`limit`**: a whole number from 1 to 100, passed as a number (the string `'10'` is invalid here; turning query text into a number belongs in `server.mjs`). The default is 20. Anything else is a `ValidationError`.
- **`cursor`**: the `nextCursor` of the previous page, used with the same `status` and `sort`. The page starts right after the last ticket of that page. `nextCursor` is a non-empty string while more tickets follow, and `null` on the last page. The format is yours. A value that is not one of your cursors, the empty string included, is a `ValidationError`.

Pages must stay correct when the list changes between two calls: a ticket created or deleted in the meantime, including the last ticket of the previous page, causes no skipped and no repeated ticket.

## server.mjs

`createApp(tickets)` returns an unstarted `node:http` server. `GET /tickets?status=&sort=&limit=&cursor=` answers `200` with `{ items, nextCursor }` as `application/json`. Invalid input answers `400` with an RFC 9457 problem document (`Content-Type: application/problem+json`, with `title` and `status`). In the query, `limit` is decimal digits only: `limit=10abc`, `limit=1e1` and an empty `limit=` are invalid, and so is an empty `cursor=`. Unknown parameters are ignored.

## Tests and NOTES.md

Write tests in `test/*.test.mjs` with `node:test`; `npm test` runs them. They must pass, and they must fail against a copy of your code that ignores the cursor. Fill in `NOTES.md` as you go: questions and assumed answers first, then your slices, your decisions with reasons, and what is left.

## What is checked

Hidden checks call `listTickets` with their own tickets and probe the HTTP API on a random port: the filter, the four sorts with ties, the limit, a full walk through the pages, changes between pages, status codes, and your own tests against the broken copy. A reviewer then reads your code and `NOTES.md` as a pairing interviewer would.
