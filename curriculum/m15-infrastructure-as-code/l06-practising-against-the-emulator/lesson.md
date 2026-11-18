---
title: Practising against the emulator
skills: [iac-local-practice]
---

Learning IaC on a real AWS account is slow and a little nerve-racking: every apply takes real time, a forgotten resource costs money, and a mistake in a shared account affects other people. The lab's AWS emulator (Floci, from module 11) answers the same APIs on `http://localhost:4566`, so you can create, break, rename and destroy as often as you like. This lesson shows how to point the AWS provider at it, explains each setting, lists what an emulator cannot tell you, and ends with a walkthrough to run on your own machine.

## Pointing the provider at the emulator

The provider's documentation has a guide to custom service endpoints, with an example for local emulators. Adapted to the lab:

```hcl
variable "aws_endpoint" {
  type        = string
  description = "Base URL of the AWS API."
  default     = "http://localhost:4566"
}

provider "aws" {
  region = "us-east-1"

  s3_use_path_style           = true
  skip_credentials_validation = true
  skip_metadata_api_check     = true
  skip_requesting_account_id  = true

  endpoints {
    s3  = var.aws_endpoint
    sqs = var.aws_endpoint
    ssm = var.aws_endpoint
  }
}
```

What each setting does, and why the emulator needs it:

- **`endpoints`** overrides the URL for each listed service. Services you do not list still go to real AWS, so list every service the configuration uses. Taking the URL from a variable keeps the value in one place and lets a teammate on a different port override it.
- **`s3_use_path_style`** sends `http://localhost:4566/bucket-name/key` instead of `http://bucket-name.localhost:4566/key`. The second form needs DNS for every bucket name, which a local machine does not have.
- **`skip_credentials_validation`** skips the STS call that checks your keys at start-up.
- **`skip_requesting_account_id`** skips the calls that discover your account id. The provider docs warn that some resources then build ARNs with an empty account id; the resources in this module return their ARNs from the API, so they are unaffected.
- **`skip_metadata_api_check`** stops the provider from looking for EC2 instance metadata, which does not exist on your laptop.

Credentials still have to be present, but any value works. Export them instead of writing them into the file, so the configuration never learns the habit:

```sh
export AWS_ACCESS_KEY_ID=test
export AWS_SECRET_ACCESS_KEY=test
```

There is a second option. The provider also reads the `AWS_ENDPOINT_URL` environment variable, the same one the SDK uses in module 11. With `export AWS_ENDPOINT_URL=http://localhost:4566`, the `endpoints` block can go. The `skip_*` and path-style settings are still needed, and an endpoint set only in your shell is invisible to whoever reads the code next. For this module's tasks, keep the explicit `endpoints` block with a variable.

## Keeping emulator settings out of production

These settings are wrong for a real account: skipping credential validation hides a misconfigured profile, and a leftover endpoint would send production calls to a laptop. Options, from simplest:

- Keep a separate root directory, `envs/local`, whose provider block has the emulator settings, and call the same modules as `envs/dev` and `envs/prod`. This is the environment layout from lesson 4, with the emulator as one more environment.
- Keep local state for that directory. It is disposable, and nobody else uses it.

The S3 backend can also point at an emulator (`endpoints { s3 = ... }`, `use_path_style` and the same `skip_*` settings exist on the backend), which is handy for practising `init -migrate-state`. Native locking with `use_lockfile` depends on conditional writes, so check that your emulator supports them before trusting the lock.

## What an emulator does not tell you

An emulator implements the API, not AWS. A clean apply against it proves less than it seems.

- **Permissions.** The lab's emulator accepts any credentials and does not enforce IAM. A missing `sqs:SendMessage` in a role's policy shows up only on real AWS.
- **Coverage and fidelity.** The AWS provider makes many API calls per resource, including reads of settings you never configured. If the emulator lacks one, the plan fails with an error that real AWS would never give. The reverse also happens: the emulator accepts a value AWS would reject.
- **Global and account rules.** Bucket names are unique across all of AWS; the emulator only checks your local copy. Organisation policies, service quotas and region availability are not simulated.
- **Time and consistency.** Real AWS applies some changes asynchronously, and lifecycle rules run roughly once a day. Locally, everything is instant.
- **Cost.** Nothing locally tells you that a NAT gateway or a provisioned table costs money every hour.

Use the emulator for what it is good at: learning the language, reading plans, trying refactors with `moved` and `import`, and fast feedback on a module. Then plan against a real dev account before anything reaches production. OpenTofu also has a built-in test framework (`tofu test` with `.tftest.hcl` files) for asserting on plans and applies, worth a look once your modules grow.

## Practise on your own

This walkthrough was written from the OpenTofu and AWS provider documentation and **was not run in the environment that produced this course**. Run it on your own machine. If a step behaves differently, the documentation linked below is the authority.

**1. Install OpenTofu** with the method for your system from the installation guide, then check it with `tofu version`.

**2. Start the emulator and set credentials.**

```sh
pnpm lab up aws
export AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_REGION=us-east-1
mkdir -p ~/tofu-practice && cd ~/tofu-practice
```

**3. Write the configuration.** Put the `variable` and `provider` blocks above into `providers.tf`, the `terraform` block with `required_providers` from lesson 2 into `versions.tf`, and this into `main.tf`:

```hcl
resource "aws_s3_bucket" "practice" {
  bucket = "tofu-practice-uploads"
}

resource "aws_sqs_queue" "jobs_dlq" {
  name                      = "tofu-practice-jobs-dlq"
  message_retention_seconds = 1209600
}

resource "aws_sqs_queue" "jobs" {
  name                       = "tofu-practice-jobs"
  visibility_timeout_seconds = 60

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.jobs_dlq.arn
    maxReceiveCount     = 5
  })
}

resource "aws_ssm_parameter" "jobs_queue_url" {
  name  = "/tofu-practice/jobs-queue-url"
  type  = "String"
  value = aws_sqs_queue.jobs.url
}
```

**4. Initialise, plan and apply.**

```sh
tofu init
tofu fmt
tofu validate
tofu plan -out=practice.tfplan
tofu apply practice.tfplan
```

The plan should list four resources to create and none to change or destroy. Notice which values are `(known after apply)`: the queue's ARN and URL, and therefore the parameter's value.

**5. Look at the result** with the CLI, which reads `AWS_ENDPOINT_URL` or takes `--endpoint-url`:

```sh
aws --endpoint-url http://localhost:4566 sqs list-queues
aws --endpoint-url http://localhost:4566 ssm get-parameter --name /tofu-practice/jobs-queue-url
tofu state list
```

**6. Experiments.** Plan after each one and predict the result before you read it.

- Change `visibility_timeout_seconds` to 90. Expect an update in place.
- Rename the jobs queue. Expect a replacement, and see the parameter change because the URL changes. Revert it.
- Rename the resource from `jobs` to `work` in the code only. Expect a destroy and a create. Add a `moved` block from `aws_sqs_queue.jobs` to `aws_sqs_queue.work` and plan again.
- Change the timeout with the CLI (`aws sqs set-queue-attributes`). Run `tofu plan` to see the drift, then `tofu plan -refresh-only` to see it described as drift.
- Run `tofu state rm aws_ssm_parameter.jobs_queue_url`, then plan: OpenTofu wants to create a parameter that exists. Add an `import` block with the parameter's name as `id` and plan again.

**7. Clean up** with `tofu destroy`. Then do the module's first task, which extends this stack with variables, tags, a lifecycle rule and outputs.

## Common mistakes

- Listing only some services in `endpoints`, so a data source quietly calls real AWS with your real credentials.
- Credentials written into the provider block "because it is only the emulator".
- Emulator settings in the same provider block that is used for real accounts.
- Treating a clean local apply as proof that permissions and quotas are fine.

## Go deeper

- [Installing OpenTofu](https://opentofu.org/docs/intro/install/): packages for each operating system.
- [Custom service endpoints](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/guides/custom-service-endpoints): every endpoint key, environment variables and the local emulator example.
- [AWS provider configuration](https://registry.terraform.io/providers/hashicorp/aws/latest/docs): the `skip_*` settings and `s3_use_path_style`.
- [tofu test](https://opentofu.org/docs/cli/commands/test/): testing modules with `.tftest.hcl` files.
