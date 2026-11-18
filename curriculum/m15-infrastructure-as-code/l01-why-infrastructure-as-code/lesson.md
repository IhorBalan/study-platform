---
title: Why infrastructure as code
skills: [iac-foundations]
---

Your application code goes through review, CI and version control. The bucket, queue and role it runs on are often created by clicking in a console, by whoever had access that afternoon. Infrastructure as code (IaC) puts those resources in files that go through the same process as the code. This lesson covers what that buys you, the declarative model behind most tools, and how OpenTofu compares with the other tools a small team will meet.

## Three problems IaC solves

**Drift.** Someone raises a queue's visibility timeout in the console during an incident. Nobody writes it down. Staging still has the old value, so the bug it fixed comes back when you test there. Six months later nobody knows which value is right. When the code is the source of truth, a plan shows that difference the next time anyone looks, and you either adopt it in code or revert it.

**Review.** A pull request that changes `block_public_policy = true` to `false` is something a colleague can question before it ships. A click in the console is not. The plan attached to the pull request also tells the reviewer exactly what will change in the account, which is more than most code diffs offer.

**Repeatability.** A new environment, a second region or a disaster-recovery copy is the same configuration with different inputs. Without code, it is an afternoon of clicking from memory and a slightly different result each time.

There is a fourth, quieter benefit: the files are documentation that cannot go stale. A new hire reads `queues.tf` and knows what exists and why, because the comments sit next to the settings.

## Declarative, not imperative

You have seen this distinction in React. Instead of telling the DOM "add this node, then change that class", you describe what the UI should look like for the current state, and React works out the changes. Most IaC tools work the same way.

An imperative script says how:

```sh
aws sqs create-queue --queue-name orders-dev-jobs-dlq
aws sqs create-queue --queue-name orders-dev-jobs \
  --attributes '{"VisibilityTimeout":"60"}'
```

Run it twice and the second run fails, or worse, half-succeeds. Change the timeout to 90 and you need a different command (`set-queue-attributes`). The script describes one transition, not the result.

A declarative configuration says what:

```hcl
resource "aws_sqs_queue" "jobs" {
  name                       = "orders-dev-jobs"
  visibility_timeout_seconds = 60
}
```

The tool compares this with what exists and computes the difference: create it if it is missing, update the timeout if it differs, do nothing if it matches. Running it twice is safe. Changing 60 to 90 is a one-line diff, and the tool decides that this means an update in place.

To know what exists, the tool keeps a record of the objects it manages, called **state**. React has the previous virtual DOM to diff against; OpenTofu has its state file. Lesson 3 is about state, because most real-world IaC trouble starts there.

## OpenTofu and Terraform

Terraform, from HashiCorp, made this model popular. Its configuration language is HCL, and its plugins, called **providers**, translate resources into API calls for AWS, Cloudflare, GitHub, Stripe and hundreds of other services.

In August 2023 HashiCorp moved Terraform from the open-source Mozilla Public License to the Business Source License, which restricts offering it as part of a competing product. In response, a group of companies forked the last open-source version. The fork became **OpenTofu**, run by the Linux Foundation under the MPL licence, and it joined the CNCF as a sandbox project in 2025. IBM, which acquired HashiCorp in 2025, continues to develop Terraform.

What this means for you:

- **The language and the providers are shared.** OpenTofu reads `.tf` files and uses the same providers, including `hashicorp/aws`. Most Terraform knowledge transfers directly, and so do most job descriptions that say "Terraform".
- **The command is `tofu`** instead of `terraform`: `tofu init`, `tofu plan`, `tofu apply`.
- **The two have diverged since the fork.** OpenTofu added client-side state encryption, variables in backend configuration, provider `for_each`, the `enabled` meta-argument and a dynamic `prevent_destroy`. Terraform added its own features. Moving an existing Terraform project to OpenTofu is documented and usually simple; moving back gets harder the more OpenTofu-only features you use.
- **Licence.** For a team using the tool to manage its own infrastructure, the Terraform licence is usually not a problem. It matters for companies building products on top of it. Many teams pick OpenTofu because they prefer an open-source licence and a foundation-run project.

This module uses OpenTofu throughout. When a fact holds for both, the lessons say so.

## The alternatives a small team meets

| Tool | How you write it | State and engine | Fits when |
|---|---|---|---|
| **OpenTofu / Terraform** | HCL, a small declarative language | A state file in a backend you choose (S3 and others) | Many providers in one place (AWS plus DNS, GitHub, monitoring); the most common skill on the market |
| **Pulumi** | TypeScript, Python, Go and others | Pulumi Cloud or a self-managed backend such as S3 | You want loops, functions and tests in a language you know, and the team is comfortable reviewing infrastructure as program code |
| **AWS CDK** | TypeScript and others | Synthesises CloudFormation templates; AWS keeps the state | All-in on AWS and happy with CloudFormation's speed and rollback model |
| **SST** | A TypeScript `sst.config.ts` with high-level components | Uses Pulumi's engine, and Terraform providers bridged through Pulumi | A TypeScript app on AWS or Cloudflare where you want the app and its infrastructure defined together, with a fast local dev loop |

Honest trade-offs:

- **HCL is limited on purpose.** It has loops and conditionals, but no arbitrary code. That makes a plan predictable and a review readable. It also makes complex logic awkward.
- **A general-purpose language** (Pulumi, CDK, SST) feels natural to a TypeScript developer and allows real abstractions. The cost: the infrastructure is now the output of a program, so a reviewer has to run it in their head, and clever code ages badly.
- **CDK** inherits CloudFormation: slower deploys and AWS-only, but no state file to manage yourself and automatic rollback on failure.
- **SST** is the fastest path for a TypeScript product on AWS. It is also the most opinionated, and a smaller community than the others.

For a backend role at a startup, HCL with OpenTofu or Terraform is the safest skill to have. It is what most teams use, and the concepts (plan, state, modules, drift) carry over to every other tool.

## What belongs in IaC

Long-lived resources that should look the same tomorrow: buckets, queues, tables, roles, DNS records, alarms. Not data: the objects in a bucket and the rows in a table belong to the application, through the SDK. And not secrets' values, which lesson 5 covers. Module 11's rule still holds: infrastructure in code, data through the SDK, the console for looking.

## Common mistakes

- Treating IaC as a one-off script: running it once, then changing things in the console again.
- Managing the same resource from two places, such as OpenTofu and a deploy script, so each undoes the other.
- Choosing a general-purpose language tool to write clever abstractions nobody else can review.
- Assuming OpenTofu and Terraform are interchangeable forever. They share a base, but each has features the other lacks.

## Go deeper

- [OpenTofu introduction](https://opentofu.org/docs/intro/): what the tool is and how its workflow fits together.
- [Migrating from Terraform](https://opentofu.org/docs/intro/migration/): the supported paths from each Terraform version.
- [Pulumi documentation](https://www.pulumi.com/docs/): the model behind infrastructure in a general-purpose language.
- [AWS CDK developer guide](https://docs.aws.amazon.com/cdk/v2/guide/home.html): constructs, synthesis and CloudFormation.
- [SST documentation](https://sst.dev/docs/): components and how SST uses Pulumi and Terraform providers.
