# Billing storage: dev and prod

Both environments are live. Each one was applied from its own directory with local state, so the state of `envs/dev` holds `aws_s3_bucket.invoices`, `aws_sqs_queue.invoice_jobs` and so on, and the same for `envs/prod`.

## Refactoring notes

The resources now live in `modules/billing-storage`, called once from each environment as `module.billing_storage`. Their addresses in state change from `aws_s3_bucket.invoices` to `module.billing_storage.aws_s3_bucket.invoices`. Without help, OpenTofu would plan to destroy the old address and create the new one, which for the bucket means deleting invoices. `envs/<env>/moved.tf` maps every old address to its new one, so the plan shows five moves and no other changes.

The order for each environment, dev first:

1. `tofu init -migrate-state` copies the local state into the S3 backend. Keep the old `terraform.tfstate` until the next step looks right.
2. `tofu plan`: expect only "has moved to" lines and `0 to add, 0 to change, 0 to destroy`. Anything else means the module does not match what exists; fix the module, not the plan.
3. `tofu apply` records the moves in the remote state.
4. Delete the local state file. Remove the moved blocks in a later change, once both environments have been applied.

`prevent_destroy` on the bucket makes any plan that would delete it fail, which catches a forgotten moved block too.

## Differences between dev and prod

The copies differed only in the jobs queue: prod uses a visibility timeout of 120 seconds and keeps jobs for 14 days. These are module inputs with dev's values as defaults; `envs/prod` sets them. Everything else is the same by construction now.
