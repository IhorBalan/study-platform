---
title: "Webhooks in depth: signatures, duplicates and ordering"
skills: [webhook-handling]
---

A webhook endpoint is a public URL that changes money-related state in your database. Anyone on the internet can POST to it, the real sender delivers some messages twice and in no particular order, and it gives up after a few days if you keep failing. This lesson turns that hostile setting into a handler you can trust: verify the signature over the exact bytes, store each event once, apply state changes that tolerate any order, and answer fast. Module 8 gave you the inbox pattern and module 7 gave you queues; here they meet a real provider.

## What Stripe sends

Each delivery is a POST with a JSON **Event** and a `Stripe-Signature` header:

```http
POST /webhooks/stripe HTTP/1.1
Content-Type: application/json; charset=utf-8
Stripe-Signature: t=1795013688,v1=bbc6331417ce0e9e9e764573ab9a8c217c5b26fa4ce94d47e12ef8568687c6ab

{
  "id": "evt_1Q...",
  "object": "event",
  "type": "checkout.session.completed",
  "created": 1795013687,
  "data": { "object": { "id": "cs_test_...", "object": "checkout.session", "payment_status": "paid", ... } }
}
```

`data.object` is a **snapshot** of the object at the time of the event. Stripe also offers **thin** events, which carry only the type and the related object's id and expect you to fetch the rest; the SDK parses them with `stripe.parseEventNotification()`. Both are signed the same way. This lesson uses snapshot events because most existing integrations and tutorials do, and the safety rules are the same for both.

## Signature verification

The signature is an HMAC-SHA256, keyed with your endpoint's signing secret (`whsec_...`), over the string `` `${t}.${rawBody}` ``. Three properties follow:

- **Authenticity.** Only Stripe and you know the secret, so a valid `v1` proves Stripe sent it.
- **Integrity.** Change one byte of the body and the HMAC no longer matches.
- **Freshness.** The timestamp `t` is inside the signed string. The SDK rejects a signature older than a tolerance (5 minutes by default), so a captured request cannot be replayed next week. Never pass a tolerance of `0`: that disables the check.

The SDK does all of this in one call, and throws `StripeSignatureVerificationError` when anything is wrong:

```ts
const event = stripe.webhooks.constructEvent(rawBody, signatureHeader, process.env.STRIPE_WEBHOOK_SECRET!);
```

The header may hold several `v1` entries while you roll a secret: Stripe can keep the old secret valid for up to 7 days and signs with both. Accept the request if any `v1` matches. The SDK does that for you.

## The raw body problem

The signature covers the **exact bytes** Stripe sent. Body parsers turn those bytes into an object, and `JSON.stringify(req.body)` will not give the same bytes back: whitespace, key order and Unicode escaping all differ. This is the most common reason "signature verification fails in production but my test passes".

NestJS can keep the original bytes next to the parsed body. Turn it on where the app is created:

```ts
// main.ts (or a createApp() function your tests also use)
const app = await NestFactory.create(AppModule, { rawBody: true });
```

Then read `req.rawBody`, a `Buffer`, in the controller:

```ts
import { BadRequestException, Controller, Headers, HttpCode, Inject, Post, Req, type RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import Stripe from 'stripe';

@Controller('webhooks')
export class StripeWebhookController {
  constructor(@Inject(STRIPE) private readonly stripe: Stripe, private readonly events: StripeEventsService) {}

  @Post('stripe')
  @HttpCode(200)
  async receive(@Req() req: RawBodyRequest<Request>, @Headers('stripe-signature') signature?: string) {
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(req.rawBody!, signature ?? '', process.env.STRIPE_WEBHOOK_SECRET!);
    } catch {
      throw new BadRequestException('invalid signature');
    }
    await this.events.handle(event);
    return { received: true };
  }
}
```

`rawBody: true` is an option of `NestFactory.create`, not of a module. If your tests create the app some other way, they will not have it, so put app creation in one function that both `main.ts` and the tests call. In Express without Nest, use `express.raw({ type: 'application/json' })` on the webhook route only.

Respond `400` for a bad signature. Stripe will retry, which is harmless, and you will see the failures in the Dashboard.

## At-least-once delivery

Stripe retries a delivery that did not get a `2xx` in time: for up to three days with exponential backoff in live mode, and a few times over a few hours in a sandbox. Retries, network glitches and manual resends mean **the same event can arrive more than once**. Each retry gets a fresh timestamp and signature, so the signature check does not catch duplicates. The event `id` does.

Record every processed event id in the same transaction as its effects. This is module 8's inbox:

```sql
create table stripe_events (
  id           text primary key,      -- evt_...
  type         text not null,
  received_at  timestamptz not null default now()
);
```

```ts
async handle(event: Stripe.Event): Promise<'processed' | 'duplicate'> {
  return tx(this.pool, async (db) => {
    const { rowCount } = await db.query(
      'insert into stripe_events (id, type) values ($1, $2) on conflict (id) do nothing',
      [event.id, event.type],
    );
    if (rowCount === 0) return 'duplicate';
    await this.apply(db, event);           // same transaction
    return 'processed';
  });
}
```

If `apply` throws, the transaction rolls back, the event id is not stored, your endpoint returns `500`, and Stripe's retry gets a clean second chance. If two copies arrive at once, the second `insert` waits on the primary key and then does nothing. Storing the id **before** the work and committing separately would turn a crash into a lost event.

Stripe adds one more caveat: occasionally two **different** Event objects describe the same change. That is why the effects themselves should also be idempotent (the conditional `update ... where status = 'pending'` from lesson 2), not only the event log.

## Out-of-order delivery

Stripe does not guarantee order. Creating a subscription produces `customer.subscription.created`, `invoice.created`, `invoice.paid` and more, and your endpoint may see them in any sequence, especially after a retry. Two rules make you order-proof:

1. **Do not order by `created`.** Stripe's own docs warn that `created` is in seconds and distinct events share timestamps. "Ignore events older than the last one" silently drops real changes.
2. **Treat the event as a signal, then read the current state.** For objects that change over time, such as subscriptions, fetch the object from the API and store what it says now:

```ts
case 'customer.subscription.created':
case 'customer.subscription.updated':
case 'customer.subscription.deleted': {
  const sub = await this.stripe.subscriptions.retrieve(event.data.object.id);
  await upsertSubscription(db, sub); // insert ... on conflict (stripe_subscription_id) do update
  break;
}
```

A late `created` event now writes the same current state as the `updated` one before it, instead of rolling the subscription back to `incomplete`. The cost is one API call per event, which is fine at startup scale. Do the fetch before you open the transaction if you can, so no database transaction waits on the network (module 8, lesson 3).

For one-way transitions, such as an order going from `pending` to `paid`, a conditional update is enough: a late `checkout.session.completed` with `payment_status: 'unpaid'` must never move a paid order back.

## Respond fast, process in a job

Stripe expects a `2xx` quickly and treats a slow response as a failure. Hosted Checkout even waits briefly for your endpoint before redirecting the customer. If fulfilment means generating a PDF, calling three APIs and sending email, do not do it inside the request. Instead:

1. Verify the signature.
2. Insert the event into `stripe_events` with its payload, or enqueue a job whose id is the event id.
3. Return `200`.
4. A worker (BullMQ from module 7, or a database job table) processes the event with retries and a dead-letter queue, still idempotently.

With a job id equal to the event id, BullMQ also deduplicates jobs. Whatever the worker does, the inbox rule holds: the "processed" mark and the effects commit together.

For a small app, processing inside the request is acceptable while it stays fast. The task for this lesson does that, and its README asks when you would move to a queue.

## Other defences

- **Only subscribe to the events you handle.** Less noise and less load.
- **Exempt the route from CSRF protection** and from auth guards; the signature is its authentication.
- **Use HTTPS** for the endpoint in live mode.
- **Recover from outages**: list events with the API (`stripe.events.list({ delivery_success: false })`) and process them through the same idempotent handler.
- **Alert on failures**: a rising rate of `400` or `500` responses means lost money or lost access for customers.

## Common mistakes

- Verifying `JSON.stringify(req.body)` instead of the raw bytes.
- Turning off the timestamp check with a tolerance of `0`, or catching the verification error and carrying on.
- Marking an event processed in one statement and applying it in another transaction.
- Ignoring "older" events by comparing `created` timestamps.
- Returning `200` when processing failed, which tells Stripe never to retry.
- Long work inside the request, so Stripe times out and retries while the first attempt is still running.

## Go deeper

- [Stripe: Receive events in your webhook endpoint](https://docs.stripe.com/webhooks): retries, ordering, duplicates and signature verification.
- [Stripe: Manage webhook endpoints](https://docs.stripe.com/events/manage-webhook-endpoints): signature errors, processing missed events.
- [Stripe: How events work](https://docs.stripe.com/events/how-events-work): snapshot and thin events.
- [NestJS: Raw body](https://docs.nestjs.com/faq/raw-body): enabling `rawBody` and reading it in a controller.
- [RFC 2104: HMAC](https://www.rfc-editor.org/rfc/rfc2104): the construction behind the signature.
