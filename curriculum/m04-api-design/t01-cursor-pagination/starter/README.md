# Articles API: cursor pagination

`GET /articles` returns every article in one unsorted array. Read the task brief, then turn it into a keyset-paginated list.

```sh
npm install
npm run build && npm start     # http://127.0.0.1:3000
curl -s 'http://127.0.0.1:3000/articles' | head -c 400
```

`src/articles/seed.ts` holds the starting data. Do not change it: the checks read it.

## Notes

Write a few lines here: what your cursor contains, why it is opaque to clients, and what would change if the articles lived in PostgreSQL (query and index).
