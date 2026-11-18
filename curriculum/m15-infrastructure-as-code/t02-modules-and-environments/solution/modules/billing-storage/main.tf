locals {
  prefix = "acme-${var.environment}"

  # The same tags the copy-pasted configuration had, so the plan stays empty.
  tags = {
    Environment = var.environment
    Team        = "billing"
  }
}

resource "aws_s3_bucket" "invoices" {
  bucket = "${local.prefix}-invoices"
  tags   = local.tags

  # Invoices are records we must keep. A plan that would delete this bucket fails.
  lifecycle {
    prevent_destroy = true
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
  name                      = "${local.prefix}-invoice-jobs-dlq"
  message_retention_seconds = 1209600
  tags                      = local.tags
}

resource "aws_sqs_queue" "invoice_jobs" {
  name                       = "${local.prefix}-invoice-jobs"
  visibility_timeout_seconds = var.jobs_visibility_timeout_seconds
  message_retention_seconds  = var.jobs_retention_seconds

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.invoice_jobs_dlq.arn
    maxReceiveCount     = 5
  })

  tags = local.tags
}
