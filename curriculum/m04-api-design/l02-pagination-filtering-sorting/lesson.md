---
title: "Pagination, filtering and sorting"
skills: [api-pagination]
---

Every list endpoint grows. A `GET /orders` that returns all rows works in the demo and times out in production a year later, so every collection needs a page size from day one. How you paginate decides whether deep pages stay fast and whether clients see each row exactly once while the data changes underneath them.

## Offset pagination

The obvious version mirrors a table component with page numbers:

```http
GET /orders?limit=20&offset=40
```

```sql
SELECT * FROM orders ORDER BY created_at DESC LIMIT 20 OFFSET 40;
```

It is easy to build and supports "jump to page 7". It has two problems that only show up with real data.

**It gets slower the deeper you go.** `OFFSET 100000` does not skip to row 100,000. The database produces 100,020 rows in order and throws away the first 100,000. Page 5,000 costs 5,000 times more than page 1. Crawlers, exports and "load more" buttons all reach those pages.

**It shifts under inserts and deletes.** The offset counts rows, and the rows move. Suppose a client has read page 1 (rows 1 to 20) of a feed sorted newest first. Three new orders arrive. Page 2 (`OFFSET 20`) now starts with what used to be rows 18 to 20, so the client shows three orders twice. Delete a row on page 1 instead and one order is skipped. In an infinite-scroll list that means duplicate React keys and items that never appear.

## Cursor (keyset) pagination

Instead of "skip N rows", the client says "give me what comes after this item". The position is the sort key of the last item it received:

```sql
SELECT id, total, created_at FROM orders
WHERE (created_at, id) < ($1, $2)          -- the last item of the previous page
ORDER BY created_at DESC, id DESC
LIMIT 21;                                   -- page size + 1
```

With an index on `(created_at DESC, id DESC)`, PostgreSQL walks the index from that point and stops after 21 entries. Page 5,000 costs the same as page 1. And because the position is a value rather than a count, inserted or deleted rows elsewhere cannot shift it. Even if the row the cursor points at is deleted, the comparison still works, since it does not need that row to exist.

Three details make it correct:

1. **The sort must be total.** If two orders share `created_at`, their relative order is undefined and a page boundary between them can drop or repeat one. Add a unique tie-breaker, usually the primary key, to both the `ORDER BY` and the comparison.
2. **Fetch one extra row.** If 21 rows come back, there is a next page; return 20 and build the cursor from the 20th. The last page then says `nextCursor: null` itself, and the client never makes a request that returns an empty page.
3. **The row comparison `(a, b) < (x, y)`** is PostgreSQL's row constructor comparison: it compares `a` first and uses `b` only on a tie. Written by hand it is `a < x OR (a = x AND b < y)`, which is easy to get wrong. When the sort mixes directions (`ORDER BY price ASC, id DESC`), the row form no longer applies and you must write the expanded form.

### The cursor is opaque

Do not hand the client `?after_created_at=…&after_id=…`. Encode the position into one string:

```ts
type Cursor = { createdAt: string; id: string };

export const encodeCursor = (c: Cursor) => Buffer.from(JSON.stringify(c)).toString('base64url');

export function decodeCursor(raw: string): Cursor | undefined {
  try {
    const value = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    return typeof value?.createdAt === 'string' && typeof value?.id === 'string' ? value : undefined;
  } catch {
    return undefined;
  }
}
```

Opaque means clients pass it back and never build or parse it. You can then change what is inside (add a sort field, a version number, or an HMAC signature) without breaking anyone. base64url is not encryption: anyone can decode it, so never put anything secret in it. An invalid cursor is a `400`, not a `500`.

A response shape that works for both web and mobile:

```json
{
  "items": [{ "id": "ord_93", "total": 4200, "createdAt": "2026-11-02T10:15:00.000Z" }],
  "nextCursor": "eyJjcmVhdGVkQXQiOiIyMDI2LTExLTAyVDEwOjE1OjAwLjAwMFoiLCJpZCI6Im9yZF85MyJ9"
}
```

Some APIs send the next page's URL in a `Link: <…>; rel="next"` header (RFC 8288) instead of, or as well as, the body. Either is fine; be consistent.

### What you give up

Cursors cannot jump to page 7 and do not know how many pages there are. For an infinite feed, a history list, an export or a sync job, nobody needs either. For a small admin table that someone sorts and pages through by hand, offset is still a reasonable choice, especially when the table is bounded (a few thousand rows) and rarely changes. Choose per endpoint.

Totals deserve care in either style: `SELECT count(*)` on a large table scans it. If the UI needs "about 12,400 results", consider an estimate, a capped count ("1,000+") or leaving it out.

## Filtering and sorting

Filters are query parameters named after fields: `GET /orders?status=paid&customerId=c_17&createdAfter=2026-10-01`. Keep them flat and typed, validate them like a body, and reject unknown ones so that a misspelled `?stauts=paid` does not silently return everything.

For sorting, a common convention is `?sort=-createdAt` (minus for descending). Two rules matter more than the syntax:

- **Allowlist the sort fields.** Each one needs an index that matches the filter and sort together, or deep pages become full scans. `sort=anything` turns into a denial-of-service lever.
- **The cursor belongs to one sort.** A cursor built for `-createdAt` is meaningless under `sort=total`. Put the sort (and ideally the filters) into the cursor and return `400` if the client changes them mid-walk.

The index follows the query: equality filters first, then the sort columns in sort order. For `WHERE customer_id = $1 ORDER BY created_at DESC, id DESC` that is an index on `(customer_id, created_at DESC, id DESC)`.

## Limits

Give `limit` a default and a maximum, and say both in the docs. Without a maximum, `?limit=1000000` is a cheap way to knock over your database. Return `400` for values outside the range rather than clamping silently. Clamping hides client bugs and makes "I asked for 500 and got 100, so this is the last page" a plausible but wrong reading.

## Common mistakes

- Sorting by a non-unique column only, so rows with equal values swap places between requests.
- Building the next page with `OFFSET` in an infinite-scroll feed.
- Cursors that are plain row numbers, or ids looked up with "find the index of this id" (which breaks when that row is deleted).
- No maximum `limit`.
- Accepting any column name in `sort`.
- Returning a `nextCursor` on the last page, so every client makes one pointless extra request.

## Go deeper

- [PostgreSQL: LIMIT and OFFSET](https://www.postgresql.org/docs/current/queries-limit.html): why large offsets are slow and why an `ORDER BY` is required.
- [PostgreSQL: row constructor comparison](https://www.postgresql.org/docs/current/functions-comparisons.html): the exact semantics of `(a, b) < (x, y)`.
- [Use The Index, Luke: paging through results](https://use-the-index-luke.com/no-offset): keyset pagination and its indexes, with diagrams.
- [RFC 8288: Web Linking](https://www.rfc-editor.org/rfc/rfc8288): the `Link` header and `rel="next"`.
