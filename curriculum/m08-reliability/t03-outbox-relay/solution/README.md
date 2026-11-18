# Outbox, relay and inbox

`npm test` builds the project and runs your tests against the database in `DATABASE_URL`
(for the lab: `postgres://lab:lab@localhost:55432/lab`). The tests reset their own tables.

## Notes on my solution

`placeOrder` inserts the order and the outbox row in one transaction, so there is never an order without its message or a message without its order.

The relay claims up to `batchSize` pending rows with `for update skip locked` in one transaction, publishes them in order and marks each one published after `publish()` resolves. Other relays skip the locked rows and take the next ones, so they work in parallel without duplicates. While a batch is being published the relay holds those row locks and one pooled connection, so batches stay small and `publish()` should have a timeout.

Delivery is at least once: if the process dies after `publish()` resolved but before the transaction commits, the row is still pending and the next round publishes it again. The consumer's inbox records the message id in the same transaction as the handler's writes, so a redelivered message is recognised and skipped, and a handler that fails rolls back its inbox row too.

A failed publish increments `attempts` and stores `last_error`, and the round stops so later messages keep their order. A message that keeps failing would block its relay's progress at that point; before production I would cap attempts (move it to a dead-letter state after, say, 20 tries), alert on it, and add a backoff column (`available_at`) so a poisoned message does not get retried every few hundred milliseconds. Published rows should also be deleted after a few days.
