The shop's `payments` table and Stripe have drifted apart: lost webhooks, refunds made in the Dashboard, rows typed in by hand. Write the daily job that finds every difference. Stripe is the source of truth for money; the job reports and changes nothing.

## The code

`src/reconcile.ts` exports `reconcile(pool, charges, window)` and the types `StripeCharge` and `ReconciliationReport`. Keep both. `charges` is an array or an async iterable of Stripe charges (in production, `stripe.charges.list({ created: { gte, lt } })`); `fixtures/charges.json` has examples. `window` is `{ from, to }`, from inclusive, to exclusive. `db/schema.sql` holds the given `payments` table; do not change it. Use only `pg` and Node built-ins.

## Rules

- Only charges with `status: 'succeeded'` count. Others are ignored completely.
- A charge belongs to the payment with the same PaymentIntent id (`payment_intent` is a string or an expanded object). Look it up across the whole table.
- A payment **claims money** when its status is `succeeded`, `partially_refunded` or `refunded`.
- **Missing**: a succeeded charge with no payment. `{ chargeId, paymentIntentId, amountMinor, currency }`.
- **Mismatched**: a payment whose charge disagrees. `fields` lists any of `amount`, `currency` (compare in lower case), `status` (expected: `succeeded` with no refund, `partially_refunded`, or `refunded` when fully refunded) and `refunded` (`refunded_minor` vs `amount_refunded`). `{ paymentId, paymentIntentId, chargeId, fields }`.
- **Matched**: the number of payments that agree in every field.
- **Orphaned**: a payment created inside the window that claims money and has no succeeded charge. `{ paymentId, paymentIntentId }`.
- **Totals**: per lower-case currency, `stripeNetMinor` (amount minus refunds of succeeded charges) and `localNetMinor` (amount minus refunds of payments that claim money, among those in the window or matched), as numbers.

Write tests in `src/test/*.test.ts`; `npm test` must pass with `DATABASE_URL` set.

## Submission

The project without `node_modules` and `dist`. Fill in `README.md`.

## What is checked

Each list, totals across EUR, USD and JPY, declined-then-paid intents, an async iterable in pages, an expanded `payment_intent`, payments just outside the window, and your tests against a `reconcile()` that counts failed charges as succeeded.
