The orders service moves to DynamoDB. Write its repository on a single table: create without overwriting, read one order, list a customer's orders and all orders in a status with cursor pagination, change a status with optimistic locking, and hide orders that have expired.

## Requirements

The table is given in `src/table.ts` (do not change it): primary key `pk` + `sk` (strings), one global secondary index `gsi1` on `gsi1pk` + `gsi1sk` (strings, all attributes projected), and Time to Live on the number attribute `expiresAt`. You decide what goes into the four key attributes.

Implement `OrderRepository` in `src/orders.ts`. Keep its exported types, classes and signatures. Import only `@aws-sdk/lib-dynamodb`, `@aws-sdk/client-dynamodb` and Node built-ins, and call AWS only through `client.send(...)` on the client passed to the constructor (a `DynamoDBDocumentClient`).

- **`create(order)`** stores a new order with `version: 1` and returns it. If an order with the same `customerId` and `orderId` exists, throw `OrderExistsError` and leave it unchanged.
- **`get(customerId, orderId)`** returns the order or `null`.
- **`listByCustomer(customerId, { limit = 20, cursor })`** returns `{ items, nextCursor }`: that customer's orders, newest first. Order ids sort by creation time. `nextCursor` is a string to pass back as `cursor`, or `null` after the last page.
- **`listByStatus(status, { limit = 20, cursor })`**: all orders in a status, across customers, by `createdAt` oldest first. Same paging.
- **`updateStatus(customerId, orderId, status, expectedVersion)`** sets the status and increments `version` only if the stored version equals `expectedVersion`, and returns the new order. Otherwise throw `VersionConflictError`, or `OrderNotFoundError` if the order does not exist. It must never create an order.
- An order whose `expiresAt` (epoch seconds) has passed counts as gone for every method, even while DynamoDB has not deleted it yet.
- Returned orders contain exactly the fields of `Order`: no `pk`, `sk` or index attributes. A page may hold fewer than `limit` items; every order must appear exactly once across pages.
- No `Scan`.

## Tests

Write tests in `test/*.test.ts` with `node:test`, against the emulator, on a table you create with `createOrdersTable` (name starting with `AWS_RESOURCE_PREFIX`) and delete in `after()`. They must pass, and fail against a repository that accepts a duplicate create and one that ignores `expectedVersion`.

## Submission

`src/`, `test/`, `package.json`, `tsconfig.json` and `README.md`, without `node_modules`. Answer the four notes in `README.md`.

## What is checked

The checks run `tsc`, create their own copy of the table, and call your repository through a client that records every command: create, get and duplicates; seven orders paged by three next to another customer's; status changes and the status index; stale and concurrent updates; expired orders; and the absence of scans. Then they run your tests against your code and two broken copies.
