Explain a state incident and how you would recover from it. Write 400 to 700 words. Short HCL or shell snippets are welcome but not required.

## What happened

The orders team keeps its production OpenTofu configuration in `infra/prod`. State is in an S3 backend:

```hcl
backend "s3" {
  bucket = "orders-tofu-state"   # versioning is enabled on this bucket
  key    = "prod/terraform.tfstate"
  region = "eu-west-1"
}
```

There is no `use_lockfile` and no `dynamodb_table`. CI runs `tofu apply` when a pull request merges to `main`. Developers also have a role on their laptops that can apply.

On Tuesday at 14:02:

1. **PR #212 merges.** It adds an SQS queue `aws_sqs_queue.exports` (`orders-prod-exports`) and an SSM parameter `aws_ssm_parameter.exports_queue_url` (`/orders/prod/exports-queue-url`), and changes the uploads bucket's lifecycle rule from 365 to 30 days for noncurrent versions. CI starts `tofu apply`.
2. **At the same minute, Dana runs `tofu apply` on her laptop** from a branch she cut on Monday, to raise `maxReceiveCount` on the jobs queue from 3 to 5 during an incident. Her branch does not contain PR #212. Her plan, computed at 14:02, shows exactly one change, `maxReceiveCount` 3 to 5, and she approves it.
3. CI finishes at 14:04 and reports success. Dana's apply finishes at 14:05 and also reports success.

On Wednesday a new PR's plan in CI shows three changes: `aws_sqs_queue.exports` and `aws_ssm_parameter.exports_queue_url` to be created, and `maxReceiveCount` on the jobs queue to be changed from 5 to 3. It shows no change to the lifecycle rule. The queue and the parameter exist in the AWS console. The PR merges anyway, and the apply fails on the parameter with `ParameterAlreadyExists`.

## What to cover

1. **What happened.** Step by step: what each apply read, what it changed in AWS, and what it wrote to the state. Why does the state no longer contain the queue and the parameter although both exist? What is the lifecycle rule in AWS right now, and why does Wednesday's plan not mention it?
2. **Wednesday's plan.** For each of the three planned changes, say whether applying it is what the team wants, and why the apply failed on the parameter. What may the failed apply already have changed before it stopped?
3. **Recovery.** A safe, ordered procedure to get back to a state that matches reality and a plan that shows only intended changes. Include what you do before touching anything, how you bring the orphaned resources back under management, what you do about Dana's hotfix, and how you confirm you are done. If you consider restoring an older state version from the bucket's version history, say what it would and would not fix.
4. **Prevention.** At least three changes to the backend, CI or permissions, and for each, which part of this incident it would have stopped.

## What is assessed

Whether your account of what each apply did is correct, whether your recovery would leave state and AWS in agreement without deleting or recreating anything that holds data, and whether your prevention steps address the actual causes. There are no automated checks.
