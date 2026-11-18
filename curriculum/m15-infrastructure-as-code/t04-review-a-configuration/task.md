A teammate opens a pull request with the first OpenTofu configuration for the reports service. It is meant for production and will be applied by everyone on the team. Review it as you would on GitHub: find the problems, say why each one matters, and propose a fix. Write 400 to 800 words. Short HCL in your fixes is welcome.

## The configuration

```hcl
# reports/main.tf. State: terraform.tfstate is committed next to this file
# so everyone has the latest copy.

terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
    }
  }
}

provider "aws" {
  region = "us-east-1"
}

variable "db_password" {
  type    = string
  default = "Reports-2026-prod!"
}

variable "queue_names" {
  type    = list(string)
  default = ["render", "email", "archive"]
}

resource "aws_s3_bucket" "reports" {
  bucket        = "reports-prod"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "reports" {
  bucket                  = aws_s3_bucket.reports.id
  block_public_acls       = false
  block_public_policy     = false
  ignore_public_acls      = false
  restrict_public_buckets = false
}

resource "aws_s3_bucket_policy" "reports" {
  bucket = aws_s3_bucket.reports.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = "*"
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.reports.arn}/*"
    }]
  })
}

resource "aws_sqs_queue" "jobs" {
  count = length(var.queue_names)
  name  = "reports-${var.queue_names[count.index]}"
}

resource "aws_ssm_parameter" "db_password" {
  name  = "/reports/prod/db-password"
  type  = "String"
  value = var.db_password
}

resource "aws_iam_role_policy" "worker" {
  name = "reports-worker"
  role = "reports-worker"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "*"
      Resource = "*"
    }, {
      Effect   = "Allow"
      Action   = ["sqs:ReceiveMessage", "sqs:DeleteMessage"]
      Resource = "arn:aws:sqs:us-east-1:123456789012:reports-render"
    }]
  })
}
```

The pull request description says: "Reports are shared with customers by link, so the bucket is readable. Next sprint we will drop the email queue because email moves to the notifications service."

## What to cover

1. **Problems.** List every problem you find, most severe first. For each, say what goes wrong and when (on the next apply, during an incident, in six months), and give a concrete fix.
2. **The email queue.** Say exactly what the plan would show if `"email"` were removed from `queue_names`, and how you would change the code so that removing it touches only that queue. Say how to move the existing queues to the new addresses without recreating them.
3. **The shared bucket.** The product need (customers open reports by link) is real. Propose a design that meets it without a public bucket.
4. **Priorities.** Which two problems must be fixed before this merges, and which can be follow-ups?

## What is assessed

How many of the planted problems you find, whether your explanation of each is correct, and whether your fixes would work. There are no automated checks.
