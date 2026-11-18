---
title: The workflow and the language
skills: [iac-workflow]
---

OpenTofu has a small vocabulary: providers that talk to APIs, resources that describe objects, data sources that look things up, and variables, locals and outputs that move values around. Around them is a four-command loop: `init`, `plan`, `apply`, `destroy`. This lesson builds a small configuration and walks through that loop, with most attention on the step that prevents accidents: reading the plan.

## A configuration is a directory

OpenTofu reads every `.tf` file in the current directory and treats them as one configuration, called the **root module**. File names do not matter to the tool; they matter to people. A common split:

```
versions.tf    # required OpenTofu and provider versions
providers.tf   # provider configuration
variables.tf   # inputs
main.tf        # resources (or one file per area: s3.tf, sqs.tf)
outputs.tf     # values to print or pass on
```

## Providers

A provider is a plugin that translates resources into API calls. You declare which providers you need and where they come from, then configure them:

```hcl
terraform {
  required_version = ">= 1.10.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = var.region
}
```

`~> 6.0` means "6.0 or any later 6.x", so a new major version with breaking changes is never picked up by accident. `tofu init` downloads the provider and records the exact version and checksums in `.terraform.lock.hcl`, which you commit. Lesson 4 returns to versions.

## Resources

A resource block has a **type** (`aws_sqs_queue`, which tells you the provider) and a **local name** (`jobs`), which together form its **address**: `aws_sqs_queue.jobs`. The arguments describe the object.

```hcl
resource "aws_sqs_queue" "jobs_dlq" {
  name                      = "${local.name_prefix}-jobs-dlq"
  message_retention_seconds = 1209600
}

resource "aws_sqs_queue" "jobs" {
  name                       = "${local.name_prefix}-jobs"
  visibility_timeout_seconds = 60

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.jobs_dlq.arn
    maxReceiveCount     = 5
  })
}
```

`aws_sqs_queue.jobs_dlq.arn` is a **reference** to an attribute of another resource. The ARN does not exist until AWS creates the queue, so OpenTofu learns two things from it: the value to fill in later, and that `jobs_dlq` must be created first. `jsonencode` turns an HCL object into the JSON string the API expects; the provider docs note that `maxReceiveCount` must be a number, not `"5"`.

Each resource type has arguments you set and attributes you can read after creation (`arn`, `url`, `id`). The provider's documentation lists both, and it is the page you will have open most of the time.

## Data sources

A data source reads something that exists outside this configuration, without managing it:

```hcl
data "aws_caller_identity" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
}
```

Use data sources instead of hard-coding account ids, existing VPC ids or shared resources owned by another team.

## Variables, locals and outputs

Think of a module as a function. Variables are its parameters, locals are its internal constants, and outputs are its return value.

```hcl
variable "environment" {
  type        = string
  description = "dev, staging or prod"

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be dev, staging or prod."
  }
}

locals {
  name_prefix = "orders-${var.environment}"
  tags = {
    Service     = "orders"
    Environment = var.environment
  }
}

output "jobs_queue_url" {
  value = aws_sqs_queue.jobs.url
}
```

- **Types** (`string`, `number`, `bool`, `list(string)`, `map(string)`, `object({...})`) catch mistakes at plan time, much like TypeScript.
- **No default** makes a variable required. Leave the default off for values with no safe guess, such as the environment.
- Values come from `-var environment=dev`, a `-var-file=dev.tfvars` file, files named `terraform.tfvars` or `*.auto.tfvars` (loaded automatically), or `TF_VAR_environment` in the environment.
- `sensitive = true` on a variable or output hides its value in plan output. It does not keep the value out of state.

## Many of one thing: count and for_each

```hcl
resource "aws_sqs_queue" "work" {
  for_each = toset(["render", "email", "archive"])
  name     = "${local.name_prefix}-${each.key}"
}
```

The instances are `aws_sqs_queue.work["render"]` and so on. `count = 3` would give `work[0]`, `work[1]`, `work[2]`, addressed by position. Remove the middle item from a list behind `count` and every later instance shifts down one index, so OpenTofu plans to replace or destroy queues you meant to keep. Prefer `for_each` with stable keys; keep `count` for "zero or one" (OpenTofu 1.11 added the `enabled` meta-argument for that case too).

## The loop

```sh
tofu init                         # download providers and modules, set up the backend
tofu fmt -recursive               # format files the standard way
tofu validate                     # check syntax and types without calling any API
tofu plan -var-file=dev.tfvars -out=dev.tfplan
tofu apply dev.tfplan             # apply exactly the plan you reviewed
tofu destroy -var-file=dev.tfvars # delete everything this configuration manages
```

`init` is safe to run any time and is needed after adding a provider, a module or changing the backend. `plan` refreshes its view of every resource in state by reading it from the API, compares with the configuration, and prints the difference. `-out` saves that plan; applying the saved file guarantees that what runs is what you read. Without `-out`, `apply` computes a fresh plan and asks you to confirm it.

## Reading a plan

This is where you catch mistakes. A plan lists each resource with a symbol:

| Symbol | Meaning |
|---|---|
| `+` | create |
| `~` | update in place |
| `-` | destroy |
| `-/+` | destroy, then create a replacement |
| `+/-` | create the replacement first, then destroy (with `create_before_destroy`) |
| `<=` | read a data source during apply |

An abbreviated, illustrative excerpt for renaming a queue (not captured from a real run):

```text
  # aws_sqs_queue.jobs must be replaced
-/+ resource "aws_sqs_queue" "jobs" {
      ~ name = "orders-dev-jobs" -> "orders-dev-work" # forces replacement
        ...
    }

Plan: 1 to add, 0 to change, 1 to destroy.
```

Three habits:

1. **Read the summary line first.** Any number in "to destroy" deserves an explanation before you continue.
2. **Look for `forces replacement`.** Some arguments cannot be changed in place: a queue's name, a bucket's name. A replaced queue loses its messages; a replaced bucket must be emptied first.
3. **Values shown as `(known after apply)`** are attributes that do not exist yet, such as a new ARN. That is normal for creates. On an update, it can mean a dependency is being replaced.

## The dependency graph

OpenTofu builds a graph from the references in your configuration and walks it: creating in dependency order, destroying in reverse, and running independent branches in parallel. `tofu graph` prints it in DOT format if you want to see it.

Sometimes a dependency is real but invisible to the tool. An S3 lifecycle rule for noncurrent versions should be applied after versioning is turned on, but nothing in the rule refers to the versioning resource. `depends_on` states the order explicitly:

```hcl
resource "aws_s3_bucket_lifecycle_configuration" "uploads" {
  bucket     = aws_s3_bucket.uploads.id
  depends_on = [aws_s3_bucket_versioning.uploads]
  # rule { ... }
}
```

Use it sparingly. A reference is better whenever one exists, because it also carries the value.

## Common mistakes

- Applying without reading the plan, or reading only the first screen of a long one.
- `count` over a list of names, so removing one item replaces the ones after it.
- Hard-coding an ARN or account id instead of referencing a resource or a data source.
- Not committing `.terraform.lock.hcl`, so each machine may resolve a different provider version.
- Assuming `sensitive = true` keeps a value secret everywhere. It only hides it in the output.

## Go deeper

- [Resource syntax](https://opentofu.org/docs/language/resources/syntax/): addresses, meta-arguments and the `removed` block.
- [Input variables](https://opentofu.org/docs/language/values/variables/): types, validation, sensitive values and how values are assigned.
- [tofu plan](https://opentofu.org/docs/cli/commands/plan/): planning modes, `-out`, `-refresh-only` and `-replace`.
- [AWS provider documentation](https://registry.terraform.io/providers/hashicorp/aws/latest/docs): every resource's arguments and attributes.
