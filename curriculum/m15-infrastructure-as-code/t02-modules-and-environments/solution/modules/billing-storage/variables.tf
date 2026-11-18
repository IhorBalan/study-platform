variable "environment" {
  type        = string
  description = "Environment name, used in resource names and tags."

  validation {
    condition     = contains(["dev", "prod"], var.environment)
    error_message = "environment must be dev or prod."
  }
}

variable "jobs_visibility_timeout_seconds" {
  type        = number
  description = "How long a received job stays hidden from other workers."
  default     = 60
}

variable "jobs_retention_seconds" {
  type        = number
  description = "How long an unprocessed job is kept in the jobs queue."
  default     = 345600
}
