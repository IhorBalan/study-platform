The articles feed returns all 75 articles in one unsorted array. Turn it into a feed that a client can page through safely while articles are being published and deleted.

## Requirements

Keep `src/app.module.ts` exporting `AppModule`, keep `POST /articles` and `DELETE /articles/:id` working, and do not change `src/articles/seed.ts`. Data stays in memory, and every app created from `AppModule` starts from the seed.

`GET /articles` accepts three optional query parameters and returns `200` with this shape:

```json
{ "items": [{ "id": "art-075", "title": "...", "author": "ada", "createdAt": "2026-10-04T08:00:00.000Z" }], "nextCursor": "eyJj..." }
```

| Parameter | Rule |
| --- | --- |
| `limit` | an integer from 1 to 100; default 20. Anything else (`0`, `101`, `2.5`, `abc`, empty) is `400` |
| `cursor` | a `nextCursor` value from an earlier response. A value the server did not issue is `400` |
| `author` | only articles by this author. Combines with `limit` and `cursor` |

- Order is `createdAt` descending, then `id` descending. Several seed articles share a timestamp.
- `nextCursor` is `null` when there is nothing after this page. The last page must say so itself; a client must never need an extra request that returns an empty page.
- The cursor is opaque: not a plain number and not the raw id. Clients only pass it back.
- Creating or deleting articles between two requests must not make a client see an article twice or miss one that existed throughout. This includes deleting the very article the cursor points after.
- Every `400` is an RFC 9457 problem document: `Content-Type: application/problem+json` with at least `title` and `status`.

## Submission

The whole project without `node_modules` and `dist`. In `README.md`, describe your cursor and the SQL query and index you would use if the articles lived in PostgreSQL.

## What is checked

The checks compile the project, create a fresh app from `AppModule` for each criterion, and page through the feed with different limits and filters. Between two page requests they create articles and delete articles, then compare the pages with the expected order. They also send invalid limits and cursors. The review looks at how the page is selected and how the cursor is handled.
