---
title: How card payments work for a developer
skills: [payments-fundamentals]
---

Taking a payment looks like one API call: send an amount, get "paid" back. It is not. A card payment involves at least four companies, can take seconds or days to settle, can ask the customer to prove who they are halfway through, and can be reversed months later. This lesson gives you the model you need before you write any Stripe code: who is involved, why your server must never see a card number, and why the outcome of a payment reaches you asynchronously.

## The parties

When a customer pays a shop with a card, money and messages pass through:

- **The cardholder**, in a browser or an app.
- **The merchant**: your business. You sell something and want the money.
- **The payment processor** (Stripe, Adyen, Braintree and others). It gives you an API, talks to the card networks and moves money into your bank account. For most startups it also acts as the **acquirer**, the bank-side party that holds a merchant account for you.
- **The card network** (Visa, Mastercard, American Express). It routes the request to the right bank and sets the rules.
- **The issuer**: the customer's bank. It decides whether to approve, and it is the one that may ask for extra authentication.

A payment has two phases that are easy to blur. **Authorisation** asks the issuer "will you pay this amount?" and reserves the funds. **Capture** says "yes, take it now". Most online shops capture immediately. A hotel or a marketplace that ships later may authorise first and capture days later. Funds then **settle** into your Stripe balance and are **paid out** to your bank on a schedule. The customer sees the charge at authorisation; you see the money days later.

## Why you never touch card data

The card number (the PAN), expiry date and security code are covered by the **Payment Card Industry Data Security Standard (PCI DSS)**. Anyone who stores, processes or transmits them must meet its controls. If raw card numbers reach your server, even if you only forward them, your server, its network, its logs and the people with access to them are all "in scope". That means hundreds of controls, audits and a lot of liability. A single `console.log(req.body)` could put card numbers in your log platform.

So the rule is simple: **card data goes from the customer's browser straight to the processor and never to you**. The processor gives you a token or an object id in return, and that id is what your backend works with. Stripe offers several ways to do this, and all of them keep you in the lightest PCI category, a short self-assessment questionnaire (SAQ A) instead of a full audit:

| Option | What the customer sees | What you build |
| --- | --- | --- |
| **Payment Links** | A Stripe-hosted page, created in the Dashboard | Nothing; good for a first sale |
| **Checkout, hosted page** | A redirect to a Stripe-hosted payment page | Create a Checkout Session on your server, redirect, handle webhooks |
| **Checkout, embedded** | Stripe's form embedded in your page | Same server work, plus a small front-end mount |
| **Elements** | Card and wallet fields inside your own UI, rendered in Stripe iframes | Your own payment page; more front-end work and more edge cases |

The card fields in Elements look like your inputs, but they are iframes served by Stripe. Your JavaScript never sees what the customer types. The front-end comparison is useful here: it is like an OAuth popup. Your app gets a result, never the password.

What you may store: anything the API returns to you, including the card brand, last four digits and expiry month and year. That is enough for "Visa ending 4242, expires 08/29" in your UI.

## The PaymentIntent: a state machine

Stripe models one attempt to collect money as a **PaymentIntent**. Even if you use Checkout, a PaymentIntent sits underneath it. It is a state machine, and its states explain why payments are asynchronous:

```text
requires_payment_method -> requires_confirmation -> requires_action -> processing -> succeeded
                     ^                                     |
                     +------------- (declined) ------------+          canceled (from most states)
```

- `requires_payment_method`: no card yet, or the last one was declined.
- `requires_action`: the issuer wants the customer to authenticate, usually with **3D Secure** (a bank app prompt or an SMS code). In Europe, Strong Customer Authentication rules make this common. The customer must complete it in the browser; your server cannot.
- `processing`: submitted, result not known yet. For cards this is short. For bank debits (SEPA Direct Debit, ACH) it can last days.
- `succeeded`: the money is yours, until it is not (see below).

A minimal server-side PaymentIntent with stripe-node looks like this. You will rarely write it directly if you use Checkout, but it shows the shape:

```ts
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

const intent = await stripe.paymentIntents.create(
  {
    amount: 2500,                 // 25.00 in the smallest unit of the currency
    currency: 'eur',
    automatic_payment_methods: { enabled: true },
    metadata: { orderId: 'ord_123' },
  },
  { idempotencyKey: 'order-ord_123-payment' },
);
// Send intent.client_secret to the browser; Stripe.js confirms it there.
```

Three habits are already visible. The amount is an **integer in minor units** (lesson 5). The request carries an **idempotency key**, so a retry after a timeout does not create a second PaymentIntent. And `metadata` links Stripe's object back to your order, which you will need when a webhook arrives.

## Why the outcome arrives later

Look at where the decision is made. The customer completes 3D Secure on their phone, the issuer approves, the network answers Stripe, and Stripe updates the PaymentIntent. Your server was not part of that conversation. Meanwhile the customer's browser may be closed, offline or redirected somewhere else.

So you learn the outcome in two ways:

1. **The browser comes back** to your success page. Convenient for the UI, but **never proof of payment**. Customers close tabs, lose signal and bookmark success URLs. Anyone can type your success URL by hand.
2. **Stripe calls your server** with a signed webhook event such as `checkout.session.completed` or `payment_intent.succeeded`. This is the reliable signal. It arrives even if the customer vanished, and Stripe retries it until you acknowledge it.

That is the central design rule of this module: **the webhook is the source of truth for fulfilment; the redirect is only a hint for the UI.** Lesson 3 is entirely about receiving webhooks safely.

## Money can move backwards

A `succeeded` payment is not final:

- **Refunds** are initiated by you. Full or partial, they take days to reach the customer.
- **Disputes** (chargebacks) are initiated by the customer through their bank, often weeks or months later. The money is taken back from your balance immediately, along with a dispute fee, and you can submit evidence. Your system should react, for example by flagging the account.
- **Asynchronous failures**: a bank debit can show `processing` for days and then fail.

Your data model must allow a paid order to become refunded or disputed later. Design for a timeline of events, not a boolean `paid`.

## Test mode and sandboxes

Stripe gives you separate test environments (sandboxes) with their own API keys (`sk_test_...`) and test card numbers. `4242 4242 4242 4242` with any future expiry succeeds. Other documented numbers trigger declines or 3D Secure, so you can test every branch of the state machine without real money. Never put live keys (`sk_live_...`) in development environments, and treat a secret key like a database password: it can move money.

## Common mistakes

- Posting card numbers to your own API "just to forward them", which pulls your whole backend into PCI scope.
- Treating the success page as confirmation and fulfilling the order there only.
- Storing a single `paid: boolean`, with no room for refunds, disputes or delayed failures.
- Using floats for amounts (`19.99`) instead of integer minor units (`1999`).
- Creating a PaymentIntent without an idempotency key, so a retried request creates two.
- Logging whole request bodies or Stripe objects without thinking about what is in them.

## Go deeper

- [Stripe: Payment Intents API](https://docs.stripe.com/payments/payment-intents): the lifecycle and statuses in detail.
- [Stripe: Integration security guide](https://docs.stripe.com/security/guide): PCI responsibilities and which card details you may store.
- [PCI Security Standards Council](https://www.pcisecuritystandards.org/): the standard itself and the self-assessment questionnaires.
- [Stripe: Testing](https://docs.stripe.com/testing): test cards for success, declines and 3D Secure.
- [Stripe: 3D Secure](https://docs.stripe.com/payments/3d-secure): when authentication is required and how it changes the flow.
