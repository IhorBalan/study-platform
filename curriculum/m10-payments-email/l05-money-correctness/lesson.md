---
title: "Money correctness: minor units, idempotency and reconciliation"
skills: [payment-reconciliation, payments-fundamentals]
---

Most bugs cost you an error message. Money bugs cost money, quietly: a rounding error on every invoice, a double charge after a timeout, an order marked paid that never was. This lesson collects the habits that keep money correct: how to represent amounts, how to make every call to the payment provider safe to retry, how refunds and disputes fit in, and how to prove, every day, that your database agrees with Stripe. It ends with the Stripe CLI for local work and an honest look at letting someone else be the merchant.

## Integer minor units

Store and compute money as **integers in the currency's smallest unit**: cents for EUR and USD, yen for JPY. Stripe's API does the same: `amount: 1099` means 10.99 EUR, and `amount: 500` in JPY means 500 yen, because the yen has no minor unit.

Floats are the classic mistake:

```ts
0.1 + 0.2;              // 0.30000000000000004
19.99 * 3;              // 59.97000000000001
Math.round(1.005 * 100); // 100, not 101
```

Binary floating point cannot represent most decimal fractions exactly, so sums drift and rounding goes the wrong way. With integers, `1999 * 3` is exactly `5997`.

Rules that follow:

- **Columns**: `bigint` or `integer` in minor units, plus a `currency` column. Not `real`, not `double precision`. If you must store decimal amounts (a legacy table, an export), use `numeric(12, 2)` and convert at the boundary.
- **The `pg` driver returns `bigint` as a string**, because a JavaScript number cannot hold every 64-bit integer. `'1999' + '500'` is `'1999500'`. Convert with `Number()` after checking it is a safe integer, or configure a type parser once.
- **Never add amounts of different currencies.** Keep totals per currency: `Map<string, number>`.
- **Currency digits differ.** EUR has 2, JPY has 0. Do not divide by 100 to display; let `Intl.NumberFormat` handle it, and use Stripe's currency documentation for the few special cases (ISK, for example, is sent to Stripe with two decimals that are always `00`).
- **Stripe expects lowercase currency codes** (`eur`). Normalise once when you read from or write to your own tables.

```ts
export function formatMoney(amountMinor: number, currency: string, locale = 'en-US'): string {
  const fmt = new Intl.NumberFormat(locale, { style: 'currency', currency: currency.toUpperCase() });
  const digits = fmt.resolvedOptions().maximumFractionDigits ?? 2;
  return fmt.format(amountMinor / 10 ** digits);
}
formatMoney(2550, 'eur'); // "€25.50"
formatMoney(2550, 'jpy'); // "¥2,550"
```

Division is the one place you must decide on rounding. Splitting 1000 cents three ways is 333 + 333 + 334; give the remainder cents to some parts explicitly so the parts always add up to the whole.

## Idempotency keys on every write

Module 8 showed why a retried call to a payment provider needs an idempotency key. Stripe's API v1 implements them like this:

- Every `POST` accepts an `Idempotency-Key` header. In stripe-node it is a request option: `stripe.refunds.create(params, { idempotencyKey })`.
- Stripe saves the status code and body of the first request with that key once the endpoint starts executing, and returns the saved result on retries, **including a saved `500`**.
- A retry with the same key but different parameters is rejected as an error, which catches bugs where one key is reused for two operations.
- Keys may be removed after 24 hours. A key is a guard against retries, not a permanent record.

Derive keys from your own ids, so a retry from a different process sends the same key: `refund-${refundRequestId}`, `checkout-${orderId}`. A random UUID generated inside the retry loop is no protection at all. stripe-node can also retry failed network calls on its own (the `maxNetworkRetries` option) and then adds a key for you, but only within that one call; your own retries need your own key.

## Refunds and disputes

A refund is a write you start:

```ts
await stripe.refunds.create(
  { payment_intent: order.stripePaymentIntentId, amount: 500 }, // partial: 5.00
  { idempotencyKey: `refund-${refundRequest.id}` },
);
```

The charge then shows `amount_refunded`, and you receive `charge.refunded` and `refund.*` events. Model refunds as rows of their own (who, how much, why, Stripe's refund id) rather than overwriting the order's amount. Your revenue is then always `amount - amount_refunded`, and you can explain every cent.

A **dispute** (chargeback) is started by the customer's bank. You receive `charge.dispute.created`; the money and a dispute fee leave your balance immediately; you have a deadline to submit evidence. Product reactions are yours: pause the account, revoke a licence, alert someone. A high dispute rate puts your Stripe account at risk, so clear billing descriptors and trial reminders are money correctness too.

## Reconciliation: Stripe is the source of truth for money

Webhooks get lost in outages, handlers have bugs, someone refunds by hand in the Dashboard. Sooner or later your database and Stripe disagree. **Reconciliation** is a scheduled job that compares the two and reports every difference. Stripe is the source of truth for what money moved; your database is the source of truth for what you promised the customer.

A daily job for yesterday's charges:

1. **Load Stripe's side** for a time window, with auto-pagination: `for await (const charge of stripe.charges.list({ created: { gte, lt }, limit: 100 }))`.
2. **Load your side** for the same window: payments created in it.
3. **Match** on a stable key, usually the PaymentIntent id stored on your payment row. One PaymentIntent can have several charges (a declined attempt, then a successful one), so compare against the **succeeded** charge.
4. **Classify** every difference:
   - **Missing**: Stripe has a succeeded charge and you have no record. Usually a lost webhook; the customer paid and may not have what they bought.
   - **Mismatched**: both exist, but the amount, currency, status or refunded amount differ. A Dashboard refund, a partial capture or a bug.
   - **Orphaned**: you think money arrived, but Stripe has no succeeded charge. The most dangerous one: you may be giving away product.
5. **Report and act**: totals per currency on both sides, a list per class, an alert when any list is not empty. Fix automatically only where it is safe (replay the missing event through your idempotent handler); send the rest to a human.

Watch the window edges. A payment created at 23:59:59 locally may be stamped a second later by Stripe; choose windows on Stripe's `created` and give your side a small margin, or reconcile overlapping windows. For accounting, Stripe's **balance transactions** and payout reconciliation reports also include fees and tell you which charges each bank payout contained.

## The Stripe CLI

The CLI connects your laptop to a sandbox without exposing a public URL:

```sh
stripe login
stripe listen --forward-to localhost:3000/webhooks/stripe   # prints a whsec_ for this session
stripe trigger checkout.session.completed                  # creates real test objects and events
stripe events resend evt_123                               # redeliver one event to test idempotency
stripe logs tail                                           # watch your API requests live
```

`stripe listen` signs forwarded events with its own secret, so set `STRIPE_WEBHOOK_SECRET` to the value it prints, not the Dashboard endpoint's secret. `stripe trigger` creates real objects in the sandbox (customers, payment intents), which makes it a quick way to exercise a handler; use test clocks for subscription timelines.

## Merchant of record: someone else sells it

With Stripe you are the **merchant**: you owe sales tax and VAT in every country where you have customers, handle disputes and appear on the card statement. A **merchant of record (MoR)** resells your product instead. It collects and remits tax, deals with disputes and support, and pays you the rest. For a solo developer selling software globally, that can save weeks of tax registration work.

| | Stripe (you are the merchant) | Merchant of record |
| --- | --- | --- |
| Fees | Lowest card processing fees; Stripe Tax and Billing cost extra | Typically 5% + 50¢ per transaction on standard plans |
| Tax | Your responsibility (Stripe Tax helps calculate and file) | Theirs |
| Control | Full API, any business model | Narrower: digital products, their checkout |
| Customer relationship | Yours | Partly theirs (their name on receipts) |

The options in late 2026: **Paddle** (5% + 50¢), **Polar** (open source, aimed at developers; 5% + 50¢ on its free tier, lower on paid plans), and **Stripe Managed Payments**, Stripe's own MoR for digital products sold through Checkout and Payment Links. **Lemon Squeezy**, acquired by Stripe in 2024, no longer accepts new sign-ups and points new users to Managed Payments. Compare current prices yourself before choosing; these change.

An MoR is a good default when you sell digital goods to consumers worldwide and have no finance team. Direct Stripe wins when margins matter at volume, when you need Connect or marketplace flows, or when you mostly sell to businesses in a few countries.

## Common mistakes

- Floats or `numeric` without a currency for money, and dividing by 100 for every currency.
- Adding `bigint` columns that came back from `pg` as strings.
- Idempotency keys generated per attempt, so retries create new refunds.
- Overwriting an order's amount on refund, so revenue cannot be explained later.
- Trusting webhooks alone with no reconciliation, so a lost event is never noticed.
- Comparing against the first charge of a PaymentIntent instead of the succeeded one.

## Go deeper

- [Stripe: Supported currencies](https://docs.stripe.com/currencies): minor units, zero-decimal currencies and special cases.
- [Stripe API: Idempotent requests](https://docs.stripe.com/api/idempotent_requests): what is saved and for how long.
- [Stripe: Refunds](https://docs.stripe.com/refunds): full and partial refunds and their events.
- [Stripe: Disputes](https://docs.stripe.com/disputes): how chargebacks work and how to respond.
- [Stripe CLI](https://docs.stripe.com/stripe-cli): `listen`, `trigger` and the rest.
