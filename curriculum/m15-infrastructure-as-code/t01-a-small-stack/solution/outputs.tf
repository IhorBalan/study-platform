output "uploads_bucket" {
  description = "Name of the uploads bucket."
  value       = aws_s3_bucket.uploads.bucket
}

output "jobs_queue_url" {
  description = "URL of the jobs queue."
  value       = aws_sqs_queue.jobs.url
}

output "jobs_dlq_arn" {
  description = "ARN of the dead-letter queue, for an alarm on its depth."
  value       = aws_sqs_queue.jobs_dlq.arn
}

output "jobs_queue_url_parameter" {
  description = "SSM parameter that holds the queue URL."
  value       = aws_ssm_parameter.jobs_queue_url.name
}
