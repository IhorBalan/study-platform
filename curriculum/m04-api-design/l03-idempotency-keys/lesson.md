---
title: Idempotency keys and safe retries
skills: [api-idempotency]
---

A client sends `POST /payments`, and the connection drops before the response arrives. Did the payment happen? The client cannot know. If it retries, it may charge twice. If it does not, it may never charge. Idempotency keys remove the guess: the client labels the attempt, and the server promises that every request with that label has the effect of one.

## Why timeouts make this unavoidable

On a network, "no response" has three possible causes: the request never arrived, the server failed while handling it, or the server finished and the response was lost. Only the client sees the timeout, and it cannot tell them apart. Mobile apps, serverless functions with short timeouts, and job queues that redeliver messages all retry as a matter of course.

`GET`, `PUT` and `DELETE` are idempotent by definition, so retrying them is safe. `POST` creates something new each time. The fix is to make each `POST` carry an identity that survives the retry.

## How it works

The client generates a unique key, usually a UUID, **once per logical operation**, before the first attempt, and sends it with every retry of that operation:

```http
POST /payments HTTP/1.1
Content-Type: application/json
Idempotency-Key: 5f0c2b8e-6d1a-4c7e-9a43-0b6f2f8f1d27

{ "amount": 1999, "currency": "EUR", "orderId": "ord_77" }
```

The server stores what happened under that key. A later request with the same key gets the stored response instead of a new charge. The pattern was popularised by Stripe and is being standardised by the IETF as the `Idempotency-Key` header; the draft specifies the status codes used below.

A key has three states, and each state has one answer:

| Key state | Same body | Different body |
| --- | --- | --- |
| Unknown | Process, store the result | (not applicable) |
| In flight | `409 Conflict`: still processing, retry later | `422` |
| Done | Replay the stored status and body | `422 Unprocessable Content` |

A missing key on an endpoint that requires one is a `400`. Many APIs add a header such as `Idempotent-Replayed: true` to replays, which helps when debugging.

**Why compare the body?** A client bug that reuses a key for a different payment must not get the old payment's response and believe the new one succeeded. Store a hash (SHA-256) of the validated request, not the raw bytes, so that key order and whitespace do not count as a difference.

**What to store.** Only completed outcomes you are willing to repeat. A successful `201` is stored. A `400` for an invalid body usually is not: nothing happened, so let the client fix the body and retry with the same key. A `500` is a judgement call: Stripe's v1 API replays it once the endpoint has started work, on the grounds that the outcome is unknown; a crash that never stored anything is covered below.

## The race you must close

The naive version has a bug:

```ts
const existing = await store.get(key);       // two concurrent requests both see "unknown"
if (!existing) {
  const payment = await charge(input);        // ...and both charge
  await store.set(key, payment);
}
```

The check and the reservation must be one atomic step. In memory, on a single Node process, that means no `await` between them. Across instances it means an atomic primitive in shared storage.

**PostgreSQL**: a primary key does the work.

```sql
CREATE TABLE idempotency_keys (
  client_id     text        NOT NULL,
  key           text        NOT NULL,
  request_hash  text        NOT NULL,
  state         text        NOT NULL DEFAULT 'in_flight',  -- in_flight | done
  response_code int,
  response_body jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, key)
);

-- Reserve. One row back: we own the key. No row: someone has it already.
INSERT INTO idempotency_keys (client_id, key, request_hash)
VALUES ($1, $2, $3)
ON CONFLICT DO NOTHING
RETURNING key;
```

If the insert returns nothing, read the existing row and answer from the table above. When the work is done, set `state = 'done'` and the response in the same transaction as the business write (inserting the `payments` row), so you never have a payment without a stored response or the other way round.

**Valkey**: `SET` with `NX` (only if absent) and an expiry is atomic.

```sh
SET idem:client_42:5f0c2b8e '{"state":"in_flight","hash":"…"}' NX EX 86400
```

`OK` means you own the key; `nil` means it exists. Valkey is fast and expires keys for you, but the record lives apart from your business data, so a crash between the payment commit and the Valkey update can leave them disagreeing. Postgres in the same transaction avoids that.

## Scope, expiry and crashes

- **Scope keys per client** (API key, account or user), as in the primary key above. Otherwise two customers who generate the same key collide, and one could read the other's response.
- **Expire records.** Stripe keeps keys for at least 24 hours. Pick a window longer than any sensible retry (hours to days), document it, and delete old rows on a schedule.
- **Crashes leave keys in flight.** If the process dies after reserving, the key says "in flight" forever and every retry gets `409`. Store a reservation time and let a retry take over a key that has been in flight longer than the request timeout.
- **Pass the key downstream.** If your handler calls a payment provider that supports idempotency keys, send a key derived from yours. Then even a takeover after a crash cannot charge twice, because the provider deduplicates too.

## In NestJS

The logic fits a small injectable store that the controller calls after validation:

```ts
@Post()
async create(
  @Headers('idempotency-key') key: string | undefined,
  @Body({ schema: CreatePaymentSchema }) input: CreatePayment,
  @Res({ passthrough: true }) res: Response,
) {
  if (!key) throw new BadRequestException('Idempotency-Key header is required');
  const outcome = await this.idempotency.run(key, hash(input), () => this.payments.create(input));
  if (outcome.replayed) res.setHeader('Idempotent-Replayed', 'true');
  return outcome.body;
}
```

An interceptor is the other common home, because it wraps many routes at once. Remember that interceptors run before pipes. An interceptor that reserves the key will reserve it for a request that is then rejected by validation, so it must release the key when the request fails.

## Not only payments

Any `POST` with a side effect that must happen once benefits from this: creating an order, sending an invitation email, starting an export, enqueuing a job. A natural unique key in the data, such as `orderId` on a payment with a unique constraint, is a good second line of defence. It does not replace the key, though, because it cannot replay the original response.

## Common mistakes

- Generating a new key on each retry, which makes every attempt look new.
- A check-then-insert with an `await` in between, which lets concurrent duplicates through.
- Replaying a stored response to a request with a different body.
- Storing failures permanently, so a client that fixed its input can never use the key again.
- Unscoped keys shared between all clients.
- No expiry, so the table grows forever.

## Go deeper

- [IETF draft: The Idempotency-Key HTTP Header Field](https://datatracker.ietf.org/doc/html/draft-ietf-httpapi-idempotency-key-header): the header, status codes and the fingerprint idea.
- [Stripe: Idempotent requests](https://docs.stripe.com/api/idempotent_requests): a production implementation, including key expiry.
- [PostgreSQL: INSERT ... ON CONFLICT](https://www.postgresql.org/docs/current/sql-insert.html): the atomic reservation.
- [Valkey: SET](https://valkey.io/commands/set/): the `NX` and `EX` options.
