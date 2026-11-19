Write the OpenTofu configuration for the infrastructure behind a small orders service: an uploads bucket, a jobs queue with a dead-letter queue, and an SSM parameter that tells the app where the queue is.

## Requirements

Keep every `.tf` file at the top level of the submission (no subdirectories). File names are up to you; the starter suggests a split.

- **Versions.** A `terraform` block with `required_version`, and `required_providers` with `aws = { source = "hashicorp/aws", version = ... }` and a version constraint.
- **Provider.** One `provider "aws"` block that works against the lab emulator: an `endpoints` block with `s3`, `sqs` and `ssm` taken from an input variable (not a literal URL), and `s3_use_path_style`, `skip_credentials_validation` and `skip_requesting_account_id` set to `true`. No `access_key`, `secret_key` or `token`: credentials come from the environment.
- **Variables.** Every `variable` has a `type`. One of them is called `environment`.
- **Names and tags.** The names of the bucket, both queues and the parameter are built from `var.environment` (directly or through a local). Tags come from a local that includes the environment, either through the provider's `default_tags` or a `tags` argument on each bucket, queue and parameter.
- **Bucket.** An `aws_s3_bucket`, an `aws_s3_bucket_versioning` for it with status `Enabled`, and an `aws_s3_bucket_lifecycle_configuration` for it with at least one enabled rule that has an action.
- **Queues.** Two `aws_sqs_queue` resources. The jobs queue has a redrive policy (the `redrive_policy` argument or an `aws_sqs_queue_redrive_policy` resource) whose `deadLetterTargetArn` is the other queue's `arn` and whose `maxReceiveCount` is a number.
- **Parameter.** An `aws_ssm_parameter` with a name, a type and a value. If it is a `SecureString`, its value must not be written in any file of the submission: not as a string or heredoc, not as the default of a variable, and not in a `.tfvars` file.
- **Outputs.** Outputs for the bucket name, the jobs queue URL and the parameter name.

Fill in the README: how you ran it (or would run it), the decisions above, and what changes for real AWS.

## Running it

The checks do not run OpenTofu. If you have it installed, run `pnpm lab up aws`, export `AWS_ACCESS_KEY_ID=test` and `AWS_SECRET_ACCESS_KEY=test`, then `tofu init`, `tofu plan -var environment=dev` and `tofu apply`. Lesson 6 walks through it. Destroy what you created when you are done.

## What is checked

The checks parse your `.tf` files and look at their structure: the blocks, their arguments and the references between them. Attribute order, file names and formatting do not matter. The review then looks at your settings and your README.
