---
title: Idempotency in depth
skills: [idempotent-operations]
---

Module 4 gave your API an `Idempotency-Key` header: the client labels an attempt, the server stores the outcome and replays it for retries. That protects the edge. This lesson follows the key inside, where the hard cases live: a handler that calls another service in the middle, a process that dies while holding a key, and operations that can be made idempotent without any key at all.

## A quick recap

From module 4, lesson 3: reserve the key atomically (`INSERT ... ON CONFLICT DO NOTHING` on a primary key), compare a fingerprint of the validated request so a reused key with a different body gets `422`, and replay the stored status and body for a finished key. Keys are scoped per client and expire after a window longer than any retry.

That design assumes the work between "reserve" and "done" is one database transaction. Real handlers are rarely that tidy.

## The external call in the middle

Take a payment handler. It must call a card provider over HTTP and record the payment in Postgres. You cannot put the HTTP call inside a database transaction: the transaction would hold locks and a pooled connection for the length of a network call (module 3 warned against exactly this), and a rollback cannot un-charge a card anyway.

So split the work into **phases**, each of which is either one local transaction or one external call:

1. **Reserve.** In a transaction, insert the key row with the request fingerprint and a lease (`locked_until = now() + 30 s`). Commit.
2. **Call out.** Charge the card, passing a key derived from yours to the provider.
3. **Finish.** In one transaction, insert the payment row and mark the key `done` with the response to replay. Commit.

```sql
create table idempotency_keys (
  customer_id   text        not null,
  key           text        not null,
  request_hash  text        not null,
  status        text        not null default 'started' check (status in ('started', 'done')),
  locked_until  timestamptz,
  response      jsonb,
  created_at    timestamptz not null default now(),
  primary key (customer_id, key)
);
```

Now walk through every crash point:

- **Dies after reserve, before the charge.** The key is `started` and nothing was charged.
- **Dies after the charge, before finish.** The key is `started`, the card was charged, and there is no payment row. This is the dangerous one.
- **Dies after finish.** Everything is recorded; a retry replays.

Both of the first two leave a `started` key. A retry has to complete the work, and in the second case it must not charge again.

## Leases: taking over a stuck key

If a `started` key blocked retries forever, one crash would make that payment impossible. The lease solves it. While `locked_until` is in the future, the owner is presumably still working, and a duplicate gets "in progress" (`409` at the HTTP edge). Once the lease has expired, a retry may take the key over, and the takeover must itself be atomic so two retries cannot both win:

```sql
update idempotency_keys
   set locked_until = now() + interval '30 seconds'
 where customer_id = $1 and key = $2
   and status = 'started' and locked_until < now()
returning key;
```

One row back means you own the key now. Zero rows means someone else does, or the key is done. Choose the lease longer than the slowest normal run of the handler, or a slow but healthy request will be taken over while it is still running.

## Pass the key downstream

The takeover re-runs phase 2. If the first owner charged the card before it died, a plain re-run charges twice. The fix is to make phase 2 idempotent too, by sending a **stable downstream key** derived from yours:

```ts
const providerKey = `pay:${customerId}:${key}`;   // same input -> same key, every time
const charge = await provider.charge({ amountCents, customerId }, { idempotencyKey: providerKey });
```

The provider sees the same key on the retry, recognises the first charge and returns it. Stripe and most payment APIs accept idempotency keys for exactly this reason. Never generate a fresh UUID here: a new key per attempt is no key at all.

When a dependency has no idempotency support, record intent before the call and check for the result afterwards. For example, store the outgoing reference first, and on a takeover ask the provider "do you have a transfer with reference X?" before sending another. If neither is possible, the step cannot be made safe, and you need reconciliation: a job that compares your records with the provider's and fixes the difference.

## Finishing atomically

Phase 3 writes the payment and the stored response in **one** transaction. If they were separate, a crash between them leaves either a payment the key does not know about (the retry charges again, saved only by the downstream key) or, worse, a key marked `done` with a response that points at a payment that was never written. Writing them together also gives you a second guard for free: a unique constraint on the provider's charge id in `payments` makes a duplicate insert fail loudly instead of silently creating a second row.

```ts
await tx(pool, async (client) => {
  const { rows } = await client.query(
    'insert into payments (customer_id, amount_cents, charge_id) values ($1, $2, $3) returning id',
    [customerId, amountCents, charge.id],
  );
  const response = { paymentId: rows[0].id, chargeId: charge.id, amountCents };
  await client.query(
    `update idempotency_keys set status = 'done', response = $3, locked_until = null
      where customer_id = $1 and key = $2`,
    [customerId, key, response],
  );
});
```

`tx` here is the usual helper: take a client, `begin`, run the callback, `commit` or `rollback`, release in `finally`.

## What to do when the call fails

Not every failure is a crash. The provider may answer "card declined" (permanent) or time out (unknown). Decide per outcome:

- **Permanent failure.** Store it as the key's final response, or delete the key so the client can try again with the same key and a different card. Document which.
- **Unknown outcome.** Leave the key `started` with its lease. A retry after the lease takes over and repeats the call with the same downstream key, which settles the question.
- **Your own bug before any external call.** Release the key (delete the row) so the retry starts clean.

## Request fingerprints

A fingerprint is a hash of the parts of the request that define the operation. Hash the validated, normalised input, not raw bytes, and include everything that changes the effect: amount and currency, yes; a client-side timestamp or a tracing header, no. The point is to catch a client that reuses a key for a different operation. Getting it slightly too broad causes false `422`s; too narrow lets a different payment replay an old response.

```ts
import { createHash } from 'node:crypto';

const fingerprint = (input: { amountCents: number; currency: string }) =>
  createHash('sha256').update(JSON.stringify([input.amountCents, input.currency])).digest('hex');
```

An array with a fixed order sidesteps the fact that `JSON.stringify` follows object key order.

## Natural idempotency

The cheapest idempotency needs no key table, because the operation already has the property:

- **Set, do not increment.** `update users set plan = 'pro'` can run twice. `update users set credits = credits + 100` cannot.
- **Upsert on a natural key.** `insert ... on conflict (order_id) do nothing` makes "create the shipment for order 42" safe to repeat.
- **Conditional state transitions.** `update orders set status = 'paid' where id = $1 and status = 'pending'` succeeds once. The retry updates zero rows, and you treat zero rows as "already done".
- **Deterministic ids.** If the client or the producer chooses the id (a UUID generated before the first attempt), a retried insert hits the primary key instead of creating a second row.

Look for one of these first. Reach for a key table when the operation has external side effects or a response that must be replayed exactly.

## The same idea for messages

Queues deliver at least once, so a message handler sees duplicates after a worker crash or a redelivery timeout. The fix has the same shape: give every message an id, and record "processed message X" in the same transaction as the handler's database writes. The next lesson calls that the **inbox** and pairs it with the outbox on the sending side.

## Common mistakes

- Holding a database transaction open across the external call.
- A `started` key with no lease, so one crash blocks the operation forever.
- A takeover that is a read followed by a write, so two retries both take over.
- A fresh downstream key per attempt, which re-charges on every takeover.
- Writing the business row and marking the key `done` in separate transactions.
- Fingerprinting raw JSON, so key order makes identical requests look different.
- Using a key table where a conditional update or upsert would do.

## Go deeper

- [Brandur Leach: Implementing Stripe-like idempotency keys in Postgres](https://brandur.org/idempotency-keys): atomic phases and recovery points in detail.
- [Amazon Builders' Library: Making retries safe with idempotent APIs](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/): client tokens and semantic equivalence.
- [Stripe: Idempotent requests](https://docs.stripe.com/api/idempotent_requests): how a provider honours your downstream key.
- [PostgreSQL: UPDATE](https://www.postgresql.org/docs/current/sql-update.html): `RETURNING` and how a conditional update reports zero rows.
