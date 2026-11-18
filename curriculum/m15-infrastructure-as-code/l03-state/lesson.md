---
title: State
skills: [iac-state]
---

State is OpenTofu's memory: the record that connects `aws_sqs_queue.jobs` in your code to one real queue in one account. Lose it, and OpenTofu no longer knows it created anything. Let two people write it at once, and it forgets things that exist. Leave it readable, and anyone can read the secrets inside it. Most painful IaC incidents are state incidents, so this lesson covers what state holds, where to keep it, how to lock and encrypt it, and how to repair it when it disagrees with reality.

## What state holds

After an apply, OpenTofu writes a JSON document with, for every managed resource:

- its **address** (`aws_sqs_queue.jobs`, or `module.billing.aws_s3_bucket.invoices["eu"]`);
- the **provider** that manages it;
- the real object's **id** (a queue URL, a bucket name) and **every attribute** the provider returned, including ARNs, computed defaults and any secret you passed in;
- the **dependencies** between resources, so a destroy can run in the right order even after the code that described them is gone.

It also holds the root module's outputs, a serial number that increases on every write, and a lineage id that identifies this state's history.

Why keep this at all, when the tool could look everything up? Because names are not identities. A configuration says "a queue called `orders-prod-jobs`". Without state, OpenTofu could not tell whether a queue with that name is the one it created, one somebody else created, or one it should create now. State is the mapping from address to object. A plan reads the real attributes of every object in state (the **refresh**), compares them with the configuration, and proposes changes.

## Why state is sensitive

Every attribute is in state in plain text. The AWS provider's own documentation for `aws_ssm_parameter` warns that a `SecureString`'s unencrypted value is stored in the state. The same goes for an RDS password set through a variable, a generated key, or a token passed to any provider. Treat the state file as a secret: whoever can read it can read everything in it.

Two consequences:

- **Never commit state to git.** Add `*.tfstate` and `*.tfstate.*` to `.gitignore`, along with the `.terraform/` directory. Do commit `.terraform.lock.hcl`.
- **Keep secrets out of state where you can.** Lesson 5 covers how: let AWS generate and rotate secrets, create them outside OpenTofu and reference them by name, or use write-only arguments (OpenTofu 1.11 and later, where the provider offers them, such as `value_wo` on `aws_ssm_parameter`) that are sent to the API but never stored.

## Remote state and locking

By default state is a local file, `terraform.tfstate`. That works for one person learning. For a team it fails in three ways: each laptop has its own copy, nobody knows which is current, and nothing stops two applies at once.

A **backend** stores state somewhere shared. On AWS that is usually S3:

```hcl
terraform {
  backend "s3" {
    bucket       = "acme-tofu-state"
    key          = "orders/prod/terraform.tfstate"
    region       = "eu-west-1"
    encrypt      = true
    use_lockfile = true
  }
}
```

- `key` is the path of this configuration's state inside the bucket. Every root module and environment gets its own key.
- `encrypt` turns on server-side encryption of the state object.
- `use_lockfile` turns on **locking**: before any operation that writes state, OpenTofu creates a lock object next to the state using an S3 conditional write, and other runs wait or fail until it is released. This native S3 locking arrived in OpenTofu 1.10. Older setups use a DynamoDB table (`dynamodb_table`) for the same job, and OpenTofu still supports that.
- Turn on **versioning** for the state bucket. Every write keeps the previous version, which is your undo button. Block public access and limit who can read it.

The state bucket itself has to exist before any configuration can use it. Teams create it once, by hand or from a tiny separate configuration with local state, and then never touch it.

Moving existing local state into a new backend is `tofu init -migrate-state`. Changing backend settings later needs `tofu init -reconfigure` or `-migrate-state`, depending on whether the state should move.

### What a missing lock costs

Without a lock, two runs can both read state version 41, both change AWS, and both write. The second write replaces the first. Anything the first run created is now missing from state: it exists in AWS, but OpenTofu has no record of it, so the next plan tries to create it again. The task "Two applies, one state file" walks through exactly this.

If a run crashes and leaves a lock behind, `tofu force-unlock LOCK_ID` removes it. Run it only once you are certain the run holding the lock is dead.

## State encryption in OpenTofu

S3's `encrypt` protects the object at rest inside AWS, but anyone with read access to the bucket still gets plain text. OpenTofu can encrypt state and plan files on the client, before they leave the machine. This is one of the features OpenTofu added after the fork.

```hcl
variable "state_passphrase" {
  type      = string
  sensitive = true
}

terraform {
  encryption {
    key_provider "pbkdf2" "main" {
      passphrase = var.state_passphrase # at least 16 characters
    }

    method "aes_gcm" "main" {
      keys = key_provider.pbkdf2.main
    }

    state {
      method   = method.aes_gcm.main
      enforced = true
    }

    plan {
      method   = method.aes_gcm.main
      enforced = true
    }
  }
}
```

`enforced = true` refuses to write unencrypted data. An `aws_kms` key provider uses a KMS key instead of a passphrase, which is the better choice on AWS because access is controlled and logged by IAM. Two warnings from the docs: back up your keys, because state encrypted with a lost key is unreadable, and switching an existing project to encryption needs a migration step with a `fallback` block. Encryption also does not hide values from the person running `tofu`.

## Changing addresses without changing reality

Code gets refactored. When an address changes, OpenTofu by default sees one resource disappear and another appear, and plans a destroy and a create. Three blocks tell it what you meant instead.

**`moved`**: the object is the same, only its address changed.

```hcl
moved {
  from = aws_s3_bucket.invoices
  to   = module.billing.aws_s3_bucket.invoices
}
```

The plan then shows the move and no replacement. Keep the block until every state that had the old address has been applied, then delete it.

**`import`**: an object exists in AWS but not in state. Write the resource block, then:

```hcl
import {
  to = aws_sqs_queue.exports
  id = "https://sqs.eu-west-1.amazonaws.com/123456789012/orders-prod-exports"
}
```

The plan shows an import plus any changes needed to make the object match your code. Each resource's documentation says what its import id is (a queue URL, a parameter name, a bucket name). `tofu plan -generate-config-out=generated.tf` (marked experimental) can draft the resource block for you, as a starting point to clean up.

**`removed`**: stop managing an object without destroying it, for example when another team takes it over.

```hcl
removed {
  from = aws_sqs_queue.legacy
  lifecycle {
    destroy = false
  }
}
```

The `tofu state mv`, `tofu state rm` and `tofu import` commands do the same jobs from the command line, but they change state immediately with no plan and no review. Prefer the blocks: they go through a pull request and show up in the plan.

## When state and reality disagree

| What happened | What the plan shows | What to do |
|---|---|---|
| A setting was changed in the console | An update back to the coded value | Decide which value is right. Put it in code, or let the apply revert it. `tofu plan -refresh-only` shows only the drift, and applying it records reality in state without changing AWS. |
| A resource was deleted in the console | A create | Fine for an empty queue. For data, restore it first (S3 versioning, a backup), then import it. |
| A resource exists but is missing from state | A create, which may fail with "already exists" | Import it. Never delete the real one so that OpenTofu can recreate it. |
| State itself was overwritten or corrupted | Creates for things that exist, or nonsense | Stop applies. Restore an earlier version from the state bucket's versioning, then plan and reconcile. |

Before any repair, take a copy: `tofu state pull > backup.tfstate`. Then make the plan empty, one step at a time, reviewing each plan. The goal is always the same: a plan that says `No changes`.

## Common mistakes

- State in git, or in a bucket the whole company can read.
- A remote backend without locking, or two environments sharing one `key`.
- Deleting a resource by hand so that OpenTofu "recreates it cleanly", losing its data.
- Renaming a resource or moving it into a module without a `moved` block.
- Running `tofu state rm` or `force-unlock` to make an error go away without understanding it.

## Go deeper

- [State](https://opentofu.org/docs/language/state/): purpose, format and remote state.
- [S3 backend](https://opentofu.org/docs/language/settings/backends/s3/): every option, including `use_lockfile` and migrating from DynamoDB locking.
- [State and plan encryption](https://opentofu.org/docs/language/state/encryption/): key providers, methods, migration and pitfalls.
- [Refactoring with moved blocks](https://opentofu.org/docs/language/modules/develop/refactoring/): moves within and between modules.
- [Importing resources](https://opentofu.org/docs/language/import/): `import` blocks and generating configuration.
