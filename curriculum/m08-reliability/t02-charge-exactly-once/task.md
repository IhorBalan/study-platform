Module 4 made an endpoint safe to retry with an in-memory key store. That store forgets everything on restart, knows nothing of other instances, and assumes the charge itself can never fail halfway. Build the version that survives all three, in Postgres.

## The code

`src/payments.ts` exports `createPayments(pool, gateway, options?)`, which returns `{ pay }`. `pay({ customerId, key, amountCents })` charges the card through `gateway.charge({ idempotencyKey, customerId, amountCents })` and records a row in `payments`. The gateway deduplicates by `idempotencyKey`: a key it has seen returns the first charge, anything else is a new charge. Today `pay` charges on every call.

Keep the exports and types in `payments.ts`. `db/schema.sql` must keep the `payments` table as given and add your own table(s). It runs in an empty schema, so do not qualify names, and it must be safe to run twice. Use only `pg` and Node built-ins. The pool comes from the caller.

## Requirements

- **New key:** charge once, insert one `payments` row, resolve `{ paymentId, chargeId, amountCents, replayed: false }`.
- **Same customer, key and amount, finished:** resolve the stored result with `replayed: true`. Do not call the gateway.
- **Same key, different amount:** reject with `IdempotencyConflictError`. Keys are scoped per customer.
- **Same key, still running:** reject with `RequestInProgressError` while the first request's lease (`options.leaseMs`, default 30 000) lasts. After it, a retry takes the key over and completes the work.
- **Gateway call fails:** `pay` rejects. A retry with the same key must eventually succeed, and the card is charged once in total.
- **Recording fails:** a retry must record the payment, never replay a result for a payment that does not exist.

All of this must hold with several instances (several pools) running at once.

## Tests

Write tests in `src/test/*.test.ts` with `node:test`, importing `../payments.js`. `src/test/helpers.ts` has a pool, a schema reset and a fake gateway. `npm test` must pass with `DATABASE_URL` set, and fail against a copy of `pay()` that ignores the key.

## Submission

The project without `node_modules` and `dist`. Fill in `README.md`.

## What is checked

Fresh schema, a fake gateway, two pools as two instances: replays, conflicts, ten simultaneous duplicates, a lost gateway response, a gateway call that never returns, a failing `payments` insert, and your tests against the broken copy.
