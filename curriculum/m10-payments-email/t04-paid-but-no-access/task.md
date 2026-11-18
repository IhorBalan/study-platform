Write an incident analysis and fix plan for the scenario below, in 600 to 900 words. Prose, lists or a small table are all fine. Short code or SQL snippets are welcome where they make a point precise.

## The scenario

A small SaaS sells a Pro plan for €49 a month. The NestJS API uses Stripe Checkout in subscription mode and keeps an `accounts.plan` column (`free` or `pro`) that every request reads.

- The upgrade button creates a Checkout Session with `customer_email` set to the account's email. No other field links the session to the account.
- `POST /webhooks/stripe` handles `checkout.session.completed`: it finds the account by `session.customer_details.email` and sets `plan = 'pro'`. `customer.subscription.deleted` sets it back to `free`. Nothing else is handled.
- The handler verifies the signature, responds `200` immediately, and then processes the event in the background with `setImmediate`. Errors there are logged and swallowed.
- On Tuesday a deploy added `app.use(express.json())` in `main.ts` so a new admin route could read JSON. The webhook controller reads `req.rawBody`, which is still enabled.

## What happened

1. On Thursday a customer writes: "I was charged €49 yesterday and the app still says Free." Support sees the payment in the Stripe Dashboard.
2. The Dashboard's event deliveries for the endpoint show only `400` responses since Tuesday afternoon, and `200` before that.
3. The logs have dozens of "account not found" errors since launch, mostly from customers who paid with a work email different from their login.
4. Another customer, upgraded on Wednesday, has a subscription in status `incomplete` because their bank asked for 3D Secure and they closed the tab.
5. Someone suggests running `update accounts set plan = 'pro' where email = ...` for everyone who complains.

## What to cover

1. **Causes.** Every reason, from the scenario, that a customer can pay and stay on Free. For each, how you would confirm it.
2. **Repair.** How you restore access for the affected customers, and how you find all of them. Comment on the suggestion in point 5.
3. **Fixes.** What you change in the webhook handler, in how sessions are created, and in what the account stores.
4. **Detection.** How you would have noticed this on Tuesday instead of on Thursday.
5. **Policy.** What access a customer with an `incomplete` or `past_due` subscription should have, and what they should see right after paying.

## What is assessed

Whether the causes are specific and supported by the evidence, whether the repair uses the same safe path as normal processing, whether the fixes address each cause, and whether the plan would catch the next silent failure. There are no automated checks.
