output "invoices_bucket" {
  description = "Name of the invoices bucket."
  value       = aws_s3_bucket.invoices.bucket
}

output "invoice_jobs_queue_url" {
  description = "URL of the invoice jobs queue."
  value       = aws_sqs_queue.invoice_jobs.url
}
