locals {
  name_prefix = "${var.project}-${var.environment}"

  tags = {
    Project     = var.project
    Environment = var.environment
    ManagedBy   = "opentofu"
  }
}

# --- Uploads bucket ---------------------------------------------------------

resource "aws_s3_bucket" "uploads" {
  bucket = "${local.name_prefix}-uploads"
}

resource "aws_s3_bucket_public_access_block" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  # Noncurrent-version rules only make sense once versioning is on.
  depends_on = [aws_s3_bucket_versioning.uploads]

  rule {
    id     = "tidy-up"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = var.noncurrent_version_days
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

# --- Jobs queue with a dead-letter queue -----------------------------------

resource "aws_sqs_queue" "jobs_dlq" {
  name = "${local.name_prefix}-jobs-dlq"

  # Longer than the source queue: a message keeps its age when it moves here.
  message_retention_seconds = 1209600
}

resource "aws_sqs_queue" "jobs" {
  name                       = "${local.name_prefix}-jobs"
  visibility_timeout_seconds = 60
  message_retention_seconds  = 345600

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.jobs_dlq.arn
    maxReceiveCount     = var.max_receive_count
  })
}

# --- Configuration the app reads at start-up -------------------------------

resource "aws_ssm_parameter" "jobs_queue_url" {
  name        = "/${var.project}/${var.environment}/jobs-queue-url"
  description = "URL of the jobs queue, read by the API and the worker."
  type        = "String"
  value       = aws_sqs_queue.jobs.url
}
