# Articles API: cursor pagination

```sh
npm install
npm run build && npm start     # http://127.0.0.1:3000
curl -s 'http://127.0.0.1:3000/articles?limit=5'
```

## Notes

The cursor is the sort key of the last item on the page, `(createdAt, id)`, as base64url JSON. Clients treat it as an opaque string, so the server can change what is inside (add a field, sign it) without breaking anyone. Because it names a position in the order rather than a row number, inserts before that position and deletes of the row itself do not shift the next page.

In PostgreSQL the page would be:

```sql
SELECT id, title, author, created_at FROM articles
WHERE (created_at, id) < ($1, $2)
ORDER BY created_at DESC, id DESC
LIMIT $3 + 1;
```

with an index on `(created_at DESC, id DESC)` (or `(author, created_at DESC, id DESC)` for the author filter), so each page is an index range scan however deep the client goes.
