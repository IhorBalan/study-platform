---
title: "Subscriptions: lifecycle, trials, dunning and entitlements"
skills: [subscription-billing, webhook-handling]
---

A one-off payment ends when the order is fulfilled. A subscription keeps going: it renews every month, cards expire, payments fail and recover, customers upgrade, downgrade and cancel, often from a page you did not build. Stripe Billing runs that machine for you. Your job is to mirror the parts you need into your own database, decide who gets access, and test months of billing in minutes. This lesson covers all three.

## The objects

- A **Customer** in Stripe represents the payer. Create one per account in your app and store its id (`cus_...`) on your user or organisation row.
- A **Subscription** links a customer to one or more recurring Prices. Each **subscription item** has a price, a quantity and its own billing period (`current_period_start`, `current_period_end`). In current API versions the period lives on the item, not on the subscription.
- Every period produces an **Invoice**, and each invoice is paid by a PaymentIntent, exactly as in lesson 1.

The easiest way to start a subscription is Checkout with `mode: 'subscription'`:

```ts
const session = await stripe.checkout.sessions.create({
  mode: 'subscription',
  customer: org.stripeCustomerId,
  line_items: [{ price: proMonthlyPriceId, quantity: org.seats }],
  subscription_data: { trial_period_days: 14, metadata: { orgId: org.id } },
  client_reference_id: org.id,
  success_url: `${APP_URL}/billing?session_id={CHECKOUT_SESSION_ID}`,
  cancel_url: `${APP_URL}/pricing`,
});
```

Checkout collects the card, creates the subscription and sends `checkout.session.completed` with the new subscription's id.

## Statuses and what they mean for access

| Status | Meaning | Access? |
| --- | --- | --- |
| `trialing` | In a trial | Yes |
| `active` | In good standing | Yes |
| `incomplete` | The first payment has not succeeded yet; the customer has 23 hours | No |
| `incomplete_expired` | The first payment never succeeded; the subscription is dead | No |
| `past_due` | A renewal payment failed; Stripe is retrying | Your call: usually yes, with a banner |
| `unpaid` | Retries are exhausted and your settings keep the subscription open without charging | No |
| `canceled` | Ended. Terminal; a returning customer gets a new subscription | No |
| `paused` | A trial ended without a payment method and you chose to pause | No |

Write this policy down in one function, not scattered `if (status === 'active')` checks:

```ts
const ACCESS = new Set(['trialing', 'active', 'past_due']);
export const hasAccess = (sub: { status: string }) => ACCESS.has(sub.status);
```

## Entitlements live in your database

Your API should never call Stripe to decide whether a request is allowed. That would add latency to every request and make Stripe an outage dependency. Keep a local copy, updated from webhooks:

```sql
create table subscriptions (
  stripe_subscription_id  text primary key,
  org_id                  text not null references orgs (id),
  status                  text not null,
  price_id                text not null,
  quantity                int  not null,
  current_period_end      timestamptz not null,
  cancel_at_period_end    boolean not null default false,
  updated_at              timestamptz not null default now()
);
```

Feature checks then read your own table: "does this org have an active subscription to a price that includes SSO?" Map prices to features in your code or with Stripe's Entitlements feature. Either way, the request path reads Postgres.

Keep the table in sync with these events:

| Event | Why |
| --- | --- |
| `customer.subscription.created`, `.updated`, `.deleted` | Status, price, quantity and period changes |
| `invoice.paid` | A period was paid; extend access, record revenue |
| `invoice.payment_failed` | Tell the customer to update their card |
| `customer.subscription.trial_will_end` | Three days before a trial ends, by default; remind the customer |
| `checkout.session.completed` | Link the new subscription to your org |

As lesson 3 explained, these arrive in any order, so on each subscription event retrieve the subscription and upsert its current state. Then a late `created` cannot undo an `updated`.

## Trials

Set `trial_period_days` (or `trial_end`) when you create the subscription. During the trial the status is `trialing` and no money moves. Two product decisions matter more than the code:

- **Card up front or not.** Asking for a card at sign-up lowers trial starts and raises conversion. Without a card, configure what happens at the end (cancel or pause), and listen for the status change.
- **The reminder.** Send an email on `customer.subscription.trial_will_end`. Surprise charges cause disputes.

## Changing plans and proration

Upgrading mid-month raises a question: who pays for the remaining days? Stripe answers with **proration**. When you change the price or quantity of an item, `proration_behavior` decides:

- `create_prorations` (the default): add a credit for unused time on the old price and a charge for the remaining time on the new one to the next invoice.
- `always_invoice`: invoice the difference immediately. Common for upgrades, so the customer pays before using more.
- `none`: no adjustment; the new price applies from the next period.

```ts
await stripe.subscriptions.update(sub.id, {
  items: [{ id: sub.items.data[0].id, price: businessPriceId }],
  proration_behavior: 'always_invoice',
});
```

Show the customer the amount before they confirm. `stripe.invoices.createPreview()` returns the invoice the change would produce.

## Failed payments and dunning

Cards expire and get blocked. When a renewal fails, the subscription becomes `past_due` and Stripe retries. **Smart Retries** picks retry times from patterns across Stripe's network; you can also set a fixed schedule. In the Billing settings you choose what happens after the last retry: cancel the subscription, mark it `unpaid`, or leave it `past_due`. That process of retries plus reminder emails is called **dunning**.

Your side of dunning is small but important: email the customer on `invoice.payment_failed` with a link to update their card, show a banner while the status is `past_due`, and remove access when it becomes `unpaid` or `canceled`. Stripe can also send these emails for you.

## The customer portal

Building "update card", "download invoices", "change plan" and "cancel" pages yourself is weeks of work. Stripe's hosted **customer portal** does it. Configure what customers may do in the Dashboard, then create a short-lived session and redirect:

```ts
const portal = await stripe.billingPortal.sessions.create({
  customer: org.stripeCustomerId,
  return_url: `${APP_URL}/billing`,
});
return { url: portal.url };
```

Every change a customer makes there reaches you as the same webhooks, which is one more reason your database must follow events rather than your own UI actions.

Cancellation usually means `cancel_at_period_end: true`: the subscription stays `active` until the period ends, then becomes `canceled`. Show "Your plan ends on 30 November" from `cancel_at_period_end` and the item's `current_period_end`.

## Test clocks

A renewal happens once a month; you cannot wait a month to test it. **Test clocks** let you create customers in a simulated time and move it forward in a sandbox:

```ts
const clock = await stripe.testHelpers.testClocks.create({
  frozen_time: Math.floor(Date.UTC(2026, 0, 1) / 1000),
});
const customer = await stripe.customers.create({ email: 'trial@example.test', test_clock: clock.id });
// create a subscription with a 14-day trial for this customer, then:
await stripe.testHelpers.testClocks.advance(clock.id, {
  frozen_time: Math.floor(Date.UTC(2026, 0, 16) / 1000),
});
```

Advancing generates the real events (trial ending, invoice created, payment attempted) and delivers them to your webhook endpoint, so your whole pipeline is exercised. You can advance at most two billing intervals at a time, and the Dashboard offers the same feature as "Run simulation". Combine it with the test card `4000 0000 0000 0341`, which attaches but fails when charged, to rehearse dunning.

## Common mistakes

- Calling Stripe on every request to check access instead of reading your own table.
- Writing subscription state from event payloads in arrival order, so a late event rolls a customer back.
- Granting access on `incomplete`, or removing it the moment a renewal fails instead of during dunning.
- Reading `current_period_end` from the subscription object; in current API versions it is on the subscription item.
- Changing plans without telling the customer about the prorated charge.
- Never testing a renewal or a failed payment because "it only happens once a month".

## Go deeper

- [Stripe: How subscriptions work](https://docs.stripe.com/billing/subscriptions/overview): lifecycle, statuses and payment failures.
- [Stripe: Using webhooks with subscriptions](https://docs.stripe.com/billing/subscriptions/webhooks): which events to handle and when.
- [Stripe: Prorations](https://docs.stripe.com/billing/subscriptions/prorations): how plan changes are charged.
- [Stripe: Customer portal](https://docs.stripe.com/customer-management): configuring the hosted billing page.
- [Stripe: Test your Billing integration](https://docs.stripe.com/billing/testing): test clocks and scenarios to rehearse.
