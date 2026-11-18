---
title: Modules, versions and environments
skills: [iac-modules-environments]
---

The first configuration is one directory. The second environment is usually a copy of it, and within a month the copies differ in ways nobody chose. Modules remove the copying, version constraints keep every machine on the same provider, and a clear environment layout makes it hard to apply to production by mistake. This lesson covers all three, plus naming and tagging, which are boring until you need to find out who owns a bucket.

## Modules are functions

Every directory of `.tf` files is a module. The one you run `tofu` in is the **root module**; a module it calls is a **child module**. If you think of a module as a function, variables are its parameters, outputs are its return value, and everything else is the body.

```
modules/
  queue-with-dlq/
    main.tf
    variables.tf
    outputs.tf
    versions.tf
```

```hcl
# modules/queue-with-dlq/variables.tf
variable "name" {
  type        = string
  description = "Queue name. The DLQ gets a -dlq suffix."
}

variable "max_receive_count" {
  type    = number
  default = 5
}

variable "tags" {
  type    = map(string)
  default = {}
}
```

```hcl
# modules/queue-with-dlq/main.tf
resource "aws_sqs_queue" "dlq" {
  name                      = "${var.name}-dlq"
  message_retention_seconds = 1209600
  tags                      = var.tags
}

resource "aws_sqs_queue" "this" {
  name = var.name
  tags = var.tags

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq.arn
    maxReceiveCount     = var.max_receive_count
  })
}
```

```hcl
# modules/queue-with-dlq/outputs.tf
output "url" { value = aws_sqs_queue.this.url }
output "arn" { value = aws_sqs_queue.this.arn }
output "dlq_arn" { value = aws_sqs_queue.dlq.arn }
```

Calling it:

```hcl
module "jobs" {
  source = "../../modules/queue-with-dlq"

  name = "orders-${var.environment}-jobs"
  tags = local.tags
}

module "emails" {
  source            = "../../modules/queue-with-dlq"
  name              = "orders-${var.environment}-emails"
  max_receive_count = 3
  tags              = local.tags
}
```

The resources now have addresses such as `module.jobs.aws_sqs_queue.this`. Elsewhere you write `module.jobs.url`. Every queue gets a DLQ with the same retention, because there is only one place to write it.

Rules that keep modules pleasant:

- **A module does one job.** "A queue with its DLQ" or "an uploads bucket with its settings". Not "everything for the orders service, with 40 flags".
- **Inputs are the things that differ.** If every caller passes the same value, it belongs inside the module.
- **No provider configuration inside.** A child module lists what it needs in `required_providers` and inherits the configured provider from the root. A `provider` block in a child module makes it hard to reuse and impossible to remove cleanly.
- **Do not wrap a single resource** in a module just to rename its arguments. That adds a layer and saves nothing.

## Module sources and versions

`source` can be a local path (as above), a Git URL or a registry address:

```hcl
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 6.0"
  # ...
}

module "shared_queue" {
  source = "git::https://github.com/acme/infra-modules.git//queue-with-dlq?ref=v1.4.0"
}
```

Pin every remote module: a `version` constraint for a registry module, a tag or commit in `ref` for Git. An unpinned module can change under you between two plans. Registry modules are a reasonable start for large building blocks such as a VPC. Read what they create before using them, because a popular module with every option exposed can be harder to review than the twenty resources you actually need.

## The lock file

`tofu init` resolves each provider to an exact version within your constraints and writes it, with checksums, to `.terraform.lock.hcl`. Commit that file. With it, a teammate, CI and you in six months all install the same provider build, and a tampered download fails the checksum.

To move to a newer provider version within your constraints, run `tofu init -upgrade`, read the provider's changelog, plan, and commit the updated lock file in its own pull request. Since OpenTofu 1.12, `init` records checksums for every platform, so a lock file created on a Mac also works on Linux CI without running `tofu providers lock` first.

## Environments: directories or workspaces

You need dev, staging and prod built from the same code, each with its own state. There are two common ways.

**Workspaces** keep one directory and one backend, and store a separate state per workspace name. You switch with `tofu workspace select prod` and branch on `terraform.workspace` in the code. It is quick to start and it has real problems:

- The current workspace is invisible state on someone's laptop. `tofu apply` in the wrong one is easy.
- All workspaces share one backend, so the same credentials can reach every environment's state.
- Differences end up as `terraform.workspace == "prod" ? ... : ...` scattered through the code.

OpenTofu's own documentation says workspaces are not suitable when deployments need separate credentials and access controls, and recommends separate root configurations that call shared modules instead. Workspaces are fine for short-lived copies, such as a test stack per branch.

**A directory per environment** is that recommendation:

```
infra/
  modules/
    queue-with-dlq/
    uploads-bucket/
  envs/
    dev/
      main.tf        # backend, provider, module calls
      outputs.tf
    staging/
    prod/
```

Each environment directory is short: a backend block with its own state key, a provider block (ideally pointing at its own AWS account), and module calls with that environment's values. The directory you are in is the environment you change. The differences between environments are the visible differences between three small files, which is easy to review. Prod can require a different role, so a developer's credentials cannot reach it at all.

The cost is a little repetition in each directory. Tools such as Terragrunt exist to remove it; for a handful of environments, the plain layout is usually enough.

A middle way is one root directory with a `-var-file` and a `-backend-config` file per environment. It works, but the environment is again chosen by a command-line flag, so a CI wrapper should own those flags.

## Splitting state by blast radius

One state for everything makes every plan slow and every mistake large. Split root configurations along lines of ownership and change rate: shared networking, data stores, and each service's own resources. A data store changes rarely and must never be destroyed by accident; a service's queues change weekly. Separate states also mean a broken plan in one area does not block deploys in another.

Pass values between them through something stable, such as an SSM parameter written by one configuration and read with a data source by another. Reading another configuration's state with `terraform_remote_state` also works, but couples you to its outputs and requires read access to its whole state.

## Naming and tagging

Pick one naming pattern and apply it everywhere, built in a local:

```hcl
locals {
  name_prefix = "${var.service}-${var.environment}"
  tags = {
    Service     = var.service
    Environment = var.environment
    Owner       = "team-orders"
    ManagedBy   = "opentofu"
  }
}

provider "aws" {
  region = var.region
  default_tags {
    tags = local.tags
  }
}
```

`default_tags` applies the tags to every resource the provider manages that supports tags. Tags answer the questions you will be asked during an incident or a cost review: whose is this, which environment, and is it managed by code (so nobody should edit it by hand). Activate them as cost allocation tags in billing and the bill can be split by service.

Two naming details: S3 bucket names are global across all AWS accounts, so include something unique to your company; and keep names short, because some services limit length (SQS queue names have an 80-character maximum).

## Common mistakes

- Copying an environment directory instead of extracting a module, then fixing a bug in one copy only.
- A `provider` block inside a reusable module.
- Remote modules without a pinned version, or a lock file in `.gitignore`.
- Workspaces for prod and dev with one set of credentials that can reach both.
- One giant state for the whole company, so every plan takes minutes and touches everything.

## Go deeper

- [Modules](https://opentofu.org/docs/language/modules/): calling modules, sources and meta-arguments.
- [Version constraints](https://opentofu.org/docs/language/expressions/version-constraints/): operators and best practice for modules and providers.
- [Dependency lock file](https://opentofu.org/docs/language/files/dependency-lock/): what is recorded and how upgrades work.
- [Workspaces](https://opentofu.org/docs/cli/workspaces/): use cases, and when not to use them.
