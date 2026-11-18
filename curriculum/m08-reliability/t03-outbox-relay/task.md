Placing an order must tell the warehouse. The starter writes the order and the message in two separate statements, and its relay publishes and deletes rows with no claim at all. It works on a laptop and loses or duplicates messages in production. Fix all three parts.

## The code

- `src/orders.ts`: `placeOrder(pool, { customerId, totalCents })` resolves `{ orderId }`.
- `src/outbox.ts`: `relayOnce(pool, publish, { batchSize }?)` publishes pending messages and resolves how many it published.
- `src/inbox.ts`: `consume(pool, message, apply)` resolves `'processed'` or `'duplicate'`.
- `src/messages.ts`: the `Message` type, `{ id: string, topic: string, payload }`.

Keep these exports. `db/schema.sql` must keep `orders` as given and a table named `outbox` with `id`, `topic` and `payload`. Add columns and an inbox table as you need. It runs in an empty schema, so do not qualify names, and it must be safe to run twice. Use only `pg` and Node built-ins.

## Requirements

- **placeOrder** inserts the order and one outbox row, topic `order.placed`, payload `{ orderId, customerId, totalCents }`. Both commit or neither does.
- **relayOnce** publishes up to `batchSize` (default 50) pending messages, oldest first. `message.id` is the outbox row id as a string. A published message is never published again by a later round.
- If `publish` throws, that message stays pending for a later round. `relayOnce` still resolves, and messages it already published stay published.
- Several relays, each with its own pool, may run at once. As long as no publish fails, every message is published exactly once.
- **consume** runs `apply(client)` with the client of its transaction, and records the message id in the same transaction. A message id that was processed before returns `'duplicate'` without calling `apply`. If `apply` throws, `consume` rejects and nothing is recorded. Simultaneous deliveries of one id apply it once.

## Tests

Write tests in `src/test/*.test.ts` with `node:test`. Import `relayOnce` from `../outbox.js`. `src/test/helpers.ts` has a pool, a schema reset and a recording publisher. `npm test` must pass with `DATABASE_URL` set, and fail against a relay that swallows publish errors.

## Submission

The project without `node_modules` and `dist`. Fill in `README.md`.

## What is checked

A fresh schema, triggers that make the outbox insert or the commit fail, publishers that fail on purpose, four relays draining 200 messages at once, duplicate and simultaneous deliveries to `consume`, and your tests against the broken relay.
