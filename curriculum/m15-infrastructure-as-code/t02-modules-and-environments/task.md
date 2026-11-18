The billing team's storage was written once for dev, then copied to `envs/prod/main.tf` and edited by hand. Both environments are live. Each was applied from its own directory with local state, and the provider has an access key pasted into it. Turn this into one module called from both environments, without destroying anything.

## Requirements

- **A module.** Create a directory under `modules/` (for example `modules/billing-storage/`) that declares the bucket, its versioning and public access block, and both queues. Every `variable` has a `type`. It has at least one `output`. It contains no `provider` block and no `backend` block.
- **Two thin environments.** `envs/dev` and `envs/prod` each call that module with a relative `source` (for example `../../modules/billing-storage`). They declare no `aws_s3_bucket*` or `aws_sqs_queue*` resources themselves. Values that differ between the two copies today become module inputs.
- **Nothing destroyed.** Each environment's state holds these addresses today:

  ```
  aws_s3_bucket.invoices
  aws_s3_bucket_versioning.invoices
  aws_s3_bucket_public_access_block.invoices
  aws_sqs_queue.invoice_jobs_dlq
  aws_sqs_queue.invoice_jobs
  ```

  In each environment, add a `moved` block for every one of them, with `to` pointing at a resource of the same type that your module declares, for example `module.billing_storage.aws_s3_bucket.invoices`.
- **No credentials.** No `access_key`, `secret_key` or `token` in any provider or backend block, and no access key id anywhere in a `.tf` file.
- **Remote state.** Each environment has `terraform { backend "s3" { ... } }` with a literal `bucket` and `key`, and locking (`use_lockfile = true`). The two keys differ. Use the bucket `acme-tofu-state` in `eu-west-1`.
- **A safety rail.** The module's bucket has `lifecycle { prevent_destroy = true }`.

In the README, explain the order of operations to roll this out to each environment, including moving the local state into the backend, and list the differences between dev and prod and how each is now set.

## What is checked

The checks parse the `.tf` files under `envs/dev`, `envs/prod` and `modules/*` and look at their structure: which module each environment calls, the moved blocks and whether their targets exist in that module, the backend blocks, the provider blocks and the bucket's lifecycle. OpenTofu is not run, so file names, attribute order and formatting do not matter. The review then looks at the module's inputs, whether the first plan would be empty apart from the moves, and your rollout notes.
