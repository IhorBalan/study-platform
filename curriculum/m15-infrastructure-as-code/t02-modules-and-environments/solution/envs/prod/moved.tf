# These resources already exist and are in this environment's state under
# their old addresses. Each moved block tells OpenTofu to rename the address
# in state instead of destroying the old object and creating a new one.
# Remove the blocks once every copy of the state has been applied with them.

moved {
  from = aws_s3_bucket.invoices
  to   = module.billing_storage.aws_s3_bucket.invoices
}

moved {
  from = aws_s3_bucket_versioning.invoices
  to   = module.billing_storage.aws_s3_bucket_versioning.invoices
}

moved {
  from = aws_s3_bucket_public_access_block.invoices
  to   = module.billing_storage.aws_s3_bucket_public_access_block.invoices
}

moved {
  from = aws_sqs_queue.invoice_jobs_dlq
  to   = module.billing_storage.aws_sqs_queue.invoice_jobs_dlq
}

moved {
  from = aws_sqs_queue.invoice_jobs
  to   = module.billing_storage.aws_sqs_queue.invoice_jobs
}
