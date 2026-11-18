---
title: IaC in a team
skills: [iac-team-practice]
---

A configuration that one person applies from a laptop works until a second person joins. Then two laptops have different provider versions, someone applies an old branch, and a hotfix made during an incident is silently reverted a week later. The fix is the same one you use for application code: changes go through a pull request, a machine runs them, and humans review what the machine is about to do. This lesson sets that up, with least-privilege credentials, automated policy checks, secrets kept out of code and state, and guard rails for the resources you can never get back.

## The pipeline: plan on the pull request, apply on merge

```text
pull request ──► fmt check, validate, lint ──► plan per environment ──► plan posted for review
merge to main ──► plan again ──► apply to dev ──► (approval) ──► apply to prod
```

- **On every pull request**, CI runs `tofu fmt -check -recursive`, `tofu validate` and a `tofu plan` for each affected environment, and posts the plan where reviewers see it (a pull request comment or the job summary). The reviewer approves the plan, not only the code.
- **On merge**, CI plans again from `main` and applies. Prod waits for a manual approval, using a GitHub environment with required reviewers.
- **Nobody applies from a laptop.** Laptops can plan with a read-only role for quick feedback. Applies happen in one place, so there is one history of what ran.
- **One apply at a time per environment.** A `concurrency` group in the workflow queues applies instead of running them in parallel. State locking (lesson 3) is the second line of defence.

A trimmed job, following the security practices from module 14 (pin every action to a full commit SHA; the tags below are shortened for reading):

```yaml
jobs:
  plan-prod:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write   # lets the job request an OIDC token
    concurrency:
      group: tofu-prod
      cancel-in-progress: false
    defaults:
      run:
        working-directory: infra/envs/prod
    steps:
      - uses: actions/checkout@v7
      - uses: opentofu/setup-opentofu@v2
        with:
          tofu_version: 1.13.0
      - uses: aws-actions/configure-aws-credentials@v6
        with:
          role-to-assume: arn:aws:iam::111111111111:role/tofu-plan-prod
          aws-region: eu-west-1
      - run: tofu init -input=false
      - run: tofu plan -input=false -out=prod.tfplan
      - run: tofu show -no-color prod.tfplan > plan.txt
```

`cancel-in-progress: false` matters: cancelling an apply half-way leaves AWS partly changed and the lock held.

## Credentials: OIDC and two roles

The job above holds no AWS keys. GitHub issues a short-lived OIDC token for the run, and AWS exchanges it for temporary credentials of a role whose trust policy names your repository. Module 11 introduced roles and module 14 the workflow side.

Use at least two roles per account:

- **A plan role** with read-only access (plus read and lock access on the state bucket). Any pull request may assume it.
- **An apply role** with the permissions the configuration needs, which only runs from `main` in an approved environment. The trust policy checks the token's subject claim:

```json
"Condition": {
  "StringEquals": {
    "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
    "token.actions.githubusercontent.com:sub": "repo:acme/orders:environment:prod"
  }
}
```

A pull request from a branch cannot assume the prod apply role, so it cannot change prod however its workflow file is edited.

The apply role is powerful, because it creates IAM roles and policies. Keep it out of reach of anything except the apply job, and make the configuration itself follow least privilege: generate policies from references, not wildcards.

```hcl
data "aws_iam_policy_document" "worker" {
  statement {
    actions   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:ChangeMessageVisibility"]
    resources = [aws_sqs_queue.jobs.arn]
  }
}
```

## Policy checks

Reviewers miss things in a 300-line plan. Automated checks do not get tired:

- **Static scanners** such as Checkov or Trivy read the `.tf` files and flag known risks: a public bucket, an unencrypted queue, `"Action": "*"`.
- **Plan checks** read the machine-readable plan from `tofu show -json prod.tfplan` and enforce your own rules, with Open Policy Agent (via Conftest) or a short script. The most valuable rule for a small team is simple: fail when the plan deletes or replaces anything, unless the pull request carries a label such as `allow-destroy`.
- **Drift detection**: a scheduled job runs `tofu plan -detailed-exitcode` every night. Exit code 0 means no changes, 2 means changes are pending, and 1 means an error. A 2 on `main` means someone changed something outside the pipeline.

## Secrets

The rule from lesson 3: whatever passes through OpenTofu lands in state. In order of preference:

1. **Let AWS generate the secret.** For example, RDS can create and rotate the master password in Secrets Manager itself (`manage_master_user_password = true` on `aws_db_instance`), so no password ever passes through your configuration.
2. **Create the container, not the value.** Declare the `aws_secretsmanager_secret` (name, KMS key, access policy) in code, and set the value outside OpenTofu, by a person or a rotation function. The app reads it by name, as in module 11.
3. **Write-only arguments.** OpenTofu 1.11 and later support arguments that are sent to the API and never stored in state or plan files, such as `value_wo` on `aws_ssm_parameter`. Use them when a provider offers them.
4. **A sensitive variable from CI.** `TF_VAR_db_password` from a CI secret, with `sensitive = true`. It stays out of the repository, but it is still in state, so the state must be encrypted and access-controlled.

Never: a secret as a variable default, in a committed `.tfvars` file, or as a `String` SSM parameter.

## Safety rails

Some resources hold data you cannot get back. Make destroying them hard on purpose.

```hcl
resource "aws_s3_bucket" "invoices" {
  bucket = "acme-prod-invoices"

  lifecycle {
    prevent_destroy = true
  }
}
```

`prevent_destroy` makes any plan that would delete the resource fail with an error, including a replacement caused by a renamed argument or a forgotten `moved` block. Since OpenTofu 1.12 its value can come from a variable, so a module can protect prod by default and let a throwaway dev stack opt out. It does not help if the resource block itself is deleted from the code, because the setting goes with it. Add the cloud's own protection as a second layer: S3 versioning, `deletion_protection` on databases, and backups.

Other `lifecycle` settings you will meet:

- `create_before_destroy = true`: create the replacement first, then delete the old one. Useful for things referenced by others, such as a launch template; impossible when the name must be unique.
- `ignore_changes = [...]`: stop managing an argument that something else legitimately changes, such as a desired count set by autoscaling. Overusing it hides drift.

Habits that complete the picture: small pull requests, one concern per plan; `-target` only during incidents, followed by a full plan; and any manual console change during an incident turned into a pull request the same day, so the next apply does not revert it.

## Common mistakes

- Applies from laptops and from CI against the same state.
- One all-powerful role used for both plan and apply, assumable from any branch.
- Reviewing the code diff but not the plan.
- Passing secrets through variables and believing `sensitive = true` keeps them out of state.
- Relying on `prevent_destroy` alone for a database, with no deletion protection or backups.

## Go deeper

- [OIDC in AWS for GitHub Actions](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws): the identity provider, trust policy and workflow settings.
- [The lifecycle meta-argument](https://opentofu.org/docs/language/meta-arguments/lifecycle/): `prevent_destroy`, `create_before_destroy`, `ignore_changes` and more.
- [Write-only attributes](https://opentofu.org/docs/language/ephemerality/write-only-attributes/): keeping values out of state.
- [Sensitive data in state](https://opentofu.org/docs/language/state/sensitive-data/): what is stored and how to protect it.
- [tofu plan](https://opentofu.org/docs/cli/commands/plan/): `-detailed-exitcode`, `-out` and planning modes.
