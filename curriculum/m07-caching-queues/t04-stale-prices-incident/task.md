Write a short incident review and fix plan for the scenario below, in 500 to 800 words. Prose, lists or a small table are all fine. No code is required, but short snippets are welcome where they make a point precise.

## The scenario

A shop's API is NestJS on two instances with PostgreSQL and Valkey. Three months ago, product pages got slow, and someone added caching:

- `GET /products/:id` uses cache-aside: read `product:<id>` from Valkey, and on a miss load the product from Postgres and `SET` it with a TTL of 24 hours.
- When an admin edits a product in the back office, the handler updates Postgres, then calls `SET product:<id>` with the new product.
- The response carries `Cache-Control: public, max-age=3600`. A CDN sits in front of the API.
- Every night a job imports price changes from the supplier with one SQL `UPDATE` per product. It takes a Valkey lock (`SET import-lock 1 NX EX 60`) so that only one instance runs it. Lately the import takes about 4 minutes.
- The cart and the checkout page call the same `GET /products/:id` to show prices. Checkout charges the price that the cart sends to `POST /orders`.

## What happened

1. After the nightly import, customers saw yesterday's prices for most of the day. Some were charged the old price.
2. An admin lowered a price at 14:02. A colleague's page still showed the old price at 14:30, after several reloads.
3. To fix it, an engineer ran `FLUSHALL` on Valkey at 15:00. For about two minutes the database was at 100% CPU, product pages timed out, and the error rate alerted.
4. On one night the supplier's prices were applied twice and the import log shows two runs that overlapped.

## What to cover

1. **Causes.** For each of the four events, why it happened. Be specific about which copy of the price was stale and why.
2. **Fixes.** What you would change in the cache, in the HTTP headers, in the import job and in checkout. Order them by how much they reduce the risk.
3. **The flush.** Why it hurt, and what you would do instead next time a cache must be cleared.
4. **Verification.** How you would know the fix works, and how you would notice if it regressed.

## What is assessed

Whether the causes are right and specific, whether each fix addresses its cause, whether you know what must never be served from a cache, and whether you spot the problem with the import lock. There are no automated checks.
