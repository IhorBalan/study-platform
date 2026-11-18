# Order confirmation email

## Once per order

`email_log (kind, ref)` is the claim. `sendOrderConfirmation` inserts a `sending` row with `on conflict do nothing`;
only the caller whose insert succeeded sends. Concurrent callers block on the primary key and then skip. After a
successful send the row becomes `sent`; after a failed send the claim is deleted, so the next attempt (a job retry)
sends.

## The gap that remains

If the SMTP server accepted the message and the process died before the update, the row stays `sending` and
nobody sends again: the customer probably got the email, but we cannot be sure. I chose "maybe zero" over "maybe
two" for this row. A sweeper could re-send `sending` rows older than a few minutes, which turns the risk into a
rare duplicate instead; for a receipt I would accept that and add it. The deterministic Message-ID
(`order-confirmation-<id>@shop.example`) means a duplicate is at least recognisable.

## In production

Call this from a queue worker after the order commits (outbox), retry with backoff on temporary SMTP errors, and
send through a provider with SPF, DKIM and an aligned DMARC record on `shop.example`.
