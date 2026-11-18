# Orders on DynamoDB

An order repository on one DynamoDB table, with conditional writes, optimistic locking, a status index and expiry.

```sh
pnpm lab up aws
export AWS_ENDPOINT_URL=http://localhost:4566
export AWS_REGION=us-east-1 AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test
export AWS_RESOURCE_PREFIX=dev-
npm install
npm test
npm run typecheck
```

## Notes

**Key design.**

| Access pattern | Operation | Key |
| --- | --- | --- |
| Get one order | GetItem | `pk = CUSTOMER#<customerId>`, `sk = ORDER#<orderId>` |
| A customer's orders, newest first | Query on `pk`, `begins_with(sk, 'ORDER#')`, backwards | order ids are time-sortable, so `sk` order is creation order |
| All orders in a status, oldest first | Query on `gsi1` | `gsi1pk = STATUS#<status>`, `gsi1sk = <createdAt>#<orderId>` |

`updateStatus` changes `status` and `gsi1pk` in the same `UpdateItem`, so the index follows the status. Creates use `attribute_not_exists(pk)`; updates require `attribute_exists(pk) AND version = :expected` and add one to `version`.

**Hot partition.** `gsi1pk = STATUS#pending` receives a write for every new order, so at high volume one index partition takes them all. Shard it: `STATUS#pending#<n>` with n from a hash of the order id (say 0 to 9), and query all shards and merge when listing. Customer partitions are fine unless one customer places thousands of orders per second.

**Short pages.** Expired orders are removed by a filter after DynamoDB has applied `Limit`, because TTL deletion is lazy and an expired item can still be read. A page can therefore hold fewer than `limit` items, even zero, with a cursor that is not null. That is fine for a cursor API: the client keeps following `nextCursor` until it is null, and no order is skipped or repeated. An API that promised exact page sizes would have to loop internally.

**When Postgres.** "Show all orders over 500 euros from customers in France in the last 30 days, sorted by total" needs ad-hoc filters and sorting on columns that are not keys. DynamoDB would need a new index per question or a scan; in Postgres it is one query and maybe one index. Reporting like this is the usual moment to move the data, or to stream it into Postgres or an analytics store.
