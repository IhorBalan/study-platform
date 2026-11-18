---
title: "Stripe Checkout end to end"
skills: [stripe-checkout, payments-fundamentals]
---

Stripe Checkout is the fastest safe way to take a one-off payment: your server creates a session, the customer pays on a page Stripe hosts, and Stripe tells your server what happened. This lesson builds that flow in NestJS and is strict about one point that trips up nearly every first integration: the customer coming back to your site does not mean you were paid. Fulfilment belongs in a webhook.

## Products and prices

Stripe separates **what** you sell from **how much** it costs:

- A **Product** is the thing: "Pro plan", "Conference ticket".
- A **Price** belongs to a product and fixes the amount, the currency and, for subscriptions, the interval. Prices are effectively immutable. To change a price, you create a new Price and archive the old one.

You can create both in the Dashboard. In code, refer to a price by a stable **lookup key** you choose (`ticket_standard_eur`) rather than hard-coding `price_...` ids that differ between test and live mode:

```ts
const prices = await stripe.prices.list({ lookup_keys: ['ticket_standard_eur'], active: true });
const price = prices.data[0];
```

For carts with dynamic amounts you can pass `price_data` inline instead. Either way, **the server decides the amount**. Never accept a price or total from the browser; a curious user will send `1`.

## Your order comes first

Before you talk to Stripe, create your own order in your database with status `pending`. The order id is what ties everything together:

```sql
create table orders (
  id                  text primary key,
  user_id             text not null,
  status              text not null default 'pending'
                        check (status in ('pending', 'paid', 'refunded', 'canceled')),
  amount_minor        bigint not null,
  currency            text not null,
  stripe_session_id   text unique,
  paid_at             timestamptz
);
```

Creating the order first gives you a record of intent, lets you compute the amount from your own catalogue, and gives you an id to send to Stripe.

## Creating the session from NestJS

A thin service wraps the Stripe client. The client is created once and injected, like a database pool:

```ts
// checkout.service.ts
import { Inject, Injectable } from '@nestjs/common';
import Stripe from 'stripe';
import { STRIPE } from './stripe.provider.js';
import { OrdersRepository } from './orders.repository.js';

@Injectable()
export class CheckoutService {
  constructor(
    @Inject(STRIPE) private readonly stripe: Stripe,
    private readonly orders: OrdersRepository,
  ) {}

  async start(userId: string, ticketLookupKey: string): Promise<string> {
    const order = await this.orders.createPending(userId, ticketLookupKey); // amount from your catalogue
    const session = await this.stripe.checkout.sessions.create(
      {
        mode: 'payment',
        line_items: [{ price: order.stripePriceId, quantity: 1 }],
        client_reference_id: order.id,
        metadata: { orderId: order.id },
        customer_email: order.email,
        success_url: `${process.env.APP_URL}/orders/${order.id}/thanks?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.APP_URL}/cart`,
      },
      { idempotencyKey: `checkout-${order.id}` },
    );
    await this.orders.attachSession(order.id, session.id);
    return session.url!; // the controller redirects the browser here (303)
  }
}
```

A few details carry weight:

- `mode` is `payment` for one-off purchases, `subscription` for recurring billing (lesson 4) and `setup` to save a card for later.
- `client_reference_id` and `metadata` carry your order id. Both come back in the session object inside every webhook, so you never have to guess which order a payment belongs to.
- `{CHECKOUT_SESSION_ID}` is a literal placeholder. Stripe replaces it with the real id when it redirects. Keep the braces.
- The idempotency key is derived from the order id, so a double click or a retried request returns the same session instead of creating two.
- The hosted page is the default UI mode. The embedded form uses `ui_mode: 'embedded_page'` and a `return_url` instead of `success_url`.
- A session expires after 24 hours by default (you can shorten it with `expires_at`). An expired session sends `checkout.session.expired`, which is your cue to release reserved stock.

The controller answers the browser's form post with a redirect to `session.url`. A frontend developer will recognise the pattern: it is a full-page redirect, like an OAuth login, not a fetch.

## The success page is not proof of payment

When the customer pays, Stripe redirects them to your `success_url`. It is tempting to mark the order paid right there. Do not:

- **Anyone can open the URL.** It is a GET with an id in it. Without checking, a user could "complete" orders they never paid for.
- **Paying customers may never arrive.** They close the tab, lose signal on a train or their phone dies during 3D Secure. The payment still succeeded.
- **Some payment methods are not instant.** For bank debits the session completes with `payment_status: 'unpaid'` and the money arrives days later.

So the success page only shows status. It can call your API, which reads the order from your database and, if you want a faster answer, retrieves the session from Stripe:

```ts
const session = await stripe.checkout.sessions.retrieve(sessionId);
if (session.client_reference_id !== orderId) throw new NotFoundException();
// paid -> "Thanks!"; unpaid -> "We are waiting for your bank"; otherwise -> "Processing..."
```

## Fulfilment from the webhook

Stripe's own guidance is to write one `fulfilCheckout(sessionId)` function, call it from the webhook and, optionally, from the success page as a speed-up, and make it safe to run many times, even concurrently, for the same session. Its job:

1. Retrieve the session from Stripe, so you act on its current state, not on a stale copy.
2. Check `payment_status`. Fulfil only when it is `paid` (or `no_payment_required`, for a fully discounted order).
3. Mark the order paid and fulfil it **exactly once**.

Step 3 is where duplicates are stopped. A conditional update succeeds for exactly one caller:

```ts
export async function fulfilCheckout(pool: pg.Pool, stripe: Stripe, sessionId: string) {
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (session.payment_status === 'unpaid') return 'waiting';

  return tx(pool, async (db) => {
    const { rowCount } = await db.query(
      `update orders set status = 'paid', paid_at = now()
        where id = $1 and status = 'pending'`,
      [session.client_reference_id],
    );
    if (rowCount === 0) return 'already-fulfilled';
    await db.query('insert into ticket_grants (order_id) values ($1)', [session.client_reference_id]);
    return 'fulfilled';
  });
}
```

Two callers at the same moment both run the `update`. Postgres row locking lets the first one change the row; the second waits, re-checks `status = 'pending'`, finds `paid`, and updates zero rows. That is the natural idempotency from module 8, applied to fulfilment.

Which events trigger it:

| Event | Meaning | Action |
| --- | --- | --- |
| `checkout.session.completed` | The customer finished Checkout | Fulfil if `payment_status` is `paid` |
| `checkout.session.async_payment_succeeded` | A delayed payment (bank debit) cleared | Fulfil |
| `checkout.session.async_payment_failed` | A delayed payment failed | Cancel the order, email the customer |
| `checkout.session.expired` | The session timed out unpaid | Release stock |

When a webhook endpoint listens for `checkout.session.completed`, the hosted page waits up to about 10 seconds for your endpoint to respond before redirecting the customer. A fast webhook therefore often finishes before the success page loads, which is one more reason to answer webhooks quickly.

## Should you check the amount?

Stripe charged what the Price said, and you chose the Price on the server, so the amounts normally match. A cheap safety net is still worth it: when fulfilling, compare `session.amount_total` and `session.currency` with the order. If they differ (a Price was edited, a coupon was misconfigured), put the order on hold for a human rather than fulfilling it silently.

## Testing locally

The Stripe CLI forwards real test-mode events to your laptop: `stripe listen --forward-to localhost:3000/webhooks/stripe` prints a signing secret for the session, and paying with the test card `4242 4242 4242 4242` produces a real `checkout.session.completed`. Lesson 5 covers the CLI in more detail.

## Common mistakes

- Fulfilling on the success page and nowhere else.
- Taking the amount or the price id from the browser.
- Losing the link between session and order because neither `client_reference_id` nor `metadata` was set.
- Treating `checkout.session.completed` as "paid" without checking `payment_status`.
- A `fulfilCheckout` that grants access twice when the webhook and the success page call it at the same time.
- Creating sessions without an idempotency key, so a double click opens two sessions for one order.

## Go deeper

- [Stripe: Checkout](https://docs.stripe.com/payments/checkout): hosted and embedded modes, and what Checkout supports.
- [Stripe: Fulfil orders](https://docs.stripe.com/checkout/fulfillment): the `fulfill_checkout` pattern and the events to listen for.
- [Stripe API: Create a Checkout Session](https://docs.stripe.com/api/checkout/sessions/create): every parameter, including `expires_at` and `client_reference_id`.
- [Stripe: Products and prices](https://docs.stripe.com/products-prices/overview): modelling your catalogue and lookup keys.
