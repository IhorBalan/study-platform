Stripe is about to send this app real webhooks: paid Checkout Sessions and subscription changes. The endpoint exists but trusts nobody and does nothing. Make it verify every request, act on each event exactly once and survive any delivery order.

## The project

`src/app.ts` exports `createApp()`, which `main.ts` and the checks both use. The pool (`PG_POOL`, `tx()` in `src/db.ts`) and the Stripe client (`STRIPE`, `src/stripe.ts`) are wired for you. The client reads `STRIPE_SECRET_KEY` and, when set, `STRIPE_API_BASE`, which the checks point at a local fake of the Stripe API. Your code reads `DATABASE_URL` and `STRIPE_WEBHOOK_SECRET`.

`db/schema.sql` must keep the given `orders`, `fulfilments` and `subscriptions` tables and add `stripe_events` with an `id` primary key. It runs in an empty schema and must be safe to run twice.

## Requirements

`POST /webhooks/stripe`:

- Missing, invalid or older than 5 minutes `Stripe-Signature`: `400`, and nothing changes.
- Valid: `2xx`, including for duplicates and for event types you ignore.
- Processing fails (for example the Stripe API returns an error): `5xx`, and the event id is not stored, so the retry is processed.

`src/webhooks/stripe-events.ts` exports `handleStripeEvent({ pool, stripe }, event)`, which resolves `'processed'`, or `'duplicate'` when the event id was processed before. It:

- On `checkout.session.completed` and `checkout.session.async_payment_succeeded`, retrieves the session. If `payment_status` is `paid` or `no_payment_required`, sets the order with id `client_reference_id` to `paid`, stores the session id in `stripe_session_id`, and inserts one `fulfilments` row. An order is fulfilled at most once.
- On `customer.subscription.created`, `.updated` and `.deleted`, retrieves the subscription and upserts it: customer id, status, `items.data[0].price.id`, `items.data[0].current_period_end` and `cancel_at_period_end`.
- Stores the event id in `stripe_events` with the effects, atomically.

Write tests in `src/test/*.test.ts` (`helpers.ts` has a fake Stripe). `npm test` must pass with `DATABASE_URL` set.

## Submission

The project without `node_modules` and `dist`. Fill in `README.md`.

## What is checked

Signed fixture events against a fresh schema and a fake Stripe API: bad, tampered, old and pretty-printed signatures, paid and unpaid sessions, repeated and simultaneous deliveries, subscriptions arriving out of order, a failing API, and your tests against a handler that never sees duplicates.
