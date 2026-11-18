# The prod environment. envs/dev/main.tf is a copy of this file with a few values changed.
# State is local (terraform.tfstate in this directory, not committed).

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
  region     = "eu-west-1"
  access_key = "AKIAIOSFODNN7EXAMPLE"
  secret_key = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
}

resource "aws_s3_bucket" "invoices" {
  bucket = "acme-prod-invoices"

  tags = {
    Environment = "prod"
    Team        = "billing"
  }
}

resource "aws_s3_bucket_versioning" "invoices" {
  bucket = aws_s3_bucket.invoices.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_public_access_block" "invoices" {
  bucket = aws_s3_bucket.invoices.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_sqs_queue" "invoice_jobs_dlq" {
  name                      = "acme-prod-invoice-jobs-dlq"
  message_retention_seconds = 1209600

  tags = {
    Environment = "prod"
    Team        = "billing"
  }
}

resource "aws_sqs_queue" "invoice_jobs" {
  name                       = "acme-prod-invoice-jobs"
  visibility_timeout_seconds = 120
  message_retention_seconds  = 1209600

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.invoice_jobs_dlq.arn
    maxReceiveCount     = 5
  })

  tags = {
    Environment = "prod"
    Team        = "billing"
  }
}

output "invoices_bucket" {
  value = aws_s3_bucket.invoices.bucket
}

output "invoice_jobs_queue_url" {
  value = aws_sqs_queue.invoice_jobs.url
}
