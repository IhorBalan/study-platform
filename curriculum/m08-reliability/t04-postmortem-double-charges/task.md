Write the analysis and fix for an incident, as you would in a blameless postmortem. 500 to 900 words, prose or lists. No code is required, though short SQL or pseudocode is welcome.

## What happened

On Tuesday at 14:02 the team deployed the checkout API. The deploy replaced containers one by one; each old container got `SIGTERM` and, ten seconds later, `SIGKILL`. Between 14:02 and 14:09, 37 customers were charged twice for one order. Support also found eleven customers who checked out normally the next morning and were charged their rental deposit twice.

The flow:

1. The mobile app sends `POST /checkout` with the cart. It has a 15-second timeout and retries a failed or timed-out request up to twice, with backoff.
2. The handler validates the cart, calls the payment provider's `createCharge(amount, customer)` (no idempotency key), then inserts the `orders` row and its line items in one transaction, then enqueues a `send-receipt` job and responds `201`.
3. The `send-receipt` worker charges a refundable deposit for rental items through the same provider call, then sends the receipt email. Jobs use a visibility timeout of 30 seconds: a job not acknowledged within 30 seconds is delivered again.

From the logs: during the deploy, charge calls took 6 to 12 seconds because the provider was slow that afternoon. The next morning, the email service was slow and some receipt jobs took 35 to 50 seconds.

## What to write

1. **What happened.** Both paths that led to double charges, step by step, with what each party knew at the crucial moment.
2. **Why the retries were not the bug.** What would have made them harmless.
3. **The fix for the API.** How `POST /checkout` becomes safe to retry and safe to kill at any line. Be concrete about what is stored, when, and in which transaction.
4. **The fix for the worker.**
5. **Order of steps.** Which steps of checkout can be undone, which cannot, and how that changes the order.
6. **Clean-up.** How you find the affected customers, what you do for them, and how you would notice the next time before support does.
7. **The deploy.** Would a graceful shutdown have prevented this? Why or why not?

## What is assessed

Whether the causal chain is right for both paths, whether the fix closes every crash point you name, and whether the remediation finds every affected customer. There are no automated checks.
