When an order is paid, the customer gets a confirmation email. The payment webhook can arrive twice, two workers can pick up the same job, and the SMTP server can be down. Write the sender so that each order gets exactly one confirmation in all of those cases, and test it against Mailpit.

## The code

- `src/mailer.ts` exports `createSmtpTransport()`, a nodemailer transport built from `SMTP_HOST` and `SMTP_PORT`.
- `src/order-email.ts` exports `formatMoney(amountMinor, currency)`, `renderOrderConfirmation(order)` and `sendOrderConfirmation({ pool, transport }, order)`. Keep the exported types.
- `db/schema.sql` creates whatever tables you need. It runs in an empty schema and must be safe to run twice.

Use only `pg`, `nodemailer` and Node built-ins. The pool and the transport come from the caller.

## The email

- From `Shop <orders@shop.example>` to `order.to`, subject `Order <orderId> confirmed`, Message-ID `<order-confirmation-<orderId>@shop.example>`.
- A plain-text and an HTML part. Both list every item (name, quantity, line amount) and the total. The text part contains the line `Total: <amount>`.
- Amounts are integers in minor units. Format them with `Intl.NumberFormat('en-US', { style: 'currency', currency })`, using the currency's own number of decimals: 2699 EUR cents is `€26.99`, 2699 JPY is `¥2,699`.
- The customer name is HTML-escaped in the HTML part and appears exactly as given in the text part.

## Sending once

- A new order: send, resolve `'sent'`.
- An order that was sent, or is being sent by another caller: send nothing, resolve `'skipped'`.
- If sending fails: reject, and leave the order free so that a later call sends it.

Write tests in `src/test/*.test.ts`; `npm test` must pass with `DATABASE_URL` set.

## Submission

The project without `node_modules` and `dist`. Fill in `README.md`.

## What is checked

Messages read back from Mailpit for recipients containing the run id: headers, both parts in EUR and JPY, an HTML injection attempt, repeated and simultaneous calls, a send to an unreachable SMTP server followed by a retry, two orders for one customer, and your tests against a sender that emails one order twice.
