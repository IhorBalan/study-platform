# Billing storage: dev and prod

Both environments are live. Each one was applied from its own directory with local state, so the state of `envs/dev` holds `aws_s3_bucket.invoices`, `aws_sqs_queue.invoice_jobs` and so on, and the same for `envs/prod`.

## Refactoring notes

<!-- How you moved each resource into the module without destroying it, and how you would migrate each environment's state to the new backend. -->

## Differences between dev and prod

<!-- Which values differ, and how each environment sets them. -->
