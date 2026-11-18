# Stripe webhook handler

## How it works

`POST /webhooks/stripe` verifies the `Stripe-Signature` header over `req.rawBody` (the app is created with
`rawBody: true` in `createApp()`), then calls `handleStripeEvent`. That function:

1. returns `duplicate` at once if the event id is already in `stripe_events`;
2. fetches the current Checkout Session or Subscription from Stripe, outside any transaction;
3. in one transaction, inserts the event id (`on conflict do nothing`) and applies the effect. A concurrent
   duplicate blocks on the primary key and then inserts nothing.

Orders move `pending -> paid` with a conditional update, and a fulfilment row is written only when that update
changed a row, so `checkout.session.completed` and `async_payment_succeeded` for the same session fulfil once.
Subscriptions are upserted from the object fetched from Stripe, never from the event payload, so arrival order
does not matter.

## Failure modes

- Bad or old signature: 400, nothing stored. Stripe retries; the retry carries a new signature.
- Stripe API or database error: the transaction rolls back, the response is 500, Stripe retries.
- Crash after commit, before the response: Stripe retries and gets `duplicate`.

## When I would move to a queue

Fetching from Stripe inside the request is fine at this size, but under a burst (all subscriptions renew on the
first of the month) or with slow fulfilment (PDFs, emails) the handler should only verify, insert the event with
its payload and return 200; a BullMQ worker keyed by the event id would do the rest with retries.
