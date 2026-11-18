# Payment reconciliation

## Rules

- Only succeeded charges moved money. A PaymentIntent's earlier failed charges are ignored, so a declined attempt
  followed by a successful one is compared against the successful charge.
- Charges are matched to `payments` by PaymentIntent id across the whole table, so a payment stamped a few seconds
  before the window still matches. Orphans are only looked for among payments created inside the window.
- Amounts are integers in minor units throughout. `bigint` columns come back from `pg` as strings and are converted
  with a safe-integer check. Currencies are compared in lower case (`EUR` here, `eur` at Stripe).

## What to do with each list

- **Missing**: the customer paid and we have no record, usually a lost webhook. Replay the charge's events through
  the idempotent webhook handler; alert if that does not resolve it.
- **Mismatched**: refunds made in the Dashboard show up as `status` and `refunded` differences; a different amount
  or currency is a bug and goes to a human.
- **Orphaned**: we believe money arrived that Stripe never received. Highest priority: we may be giving product away.
  Never fix automatically.

## Schedule

Run daily for the previous UTC day, with the window on Stripe's `created`, and once more a few days later for the
same window, because late refunds and disputes change charges after the fact.
