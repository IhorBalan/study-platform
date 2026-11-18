variable "environment" {
  type        = string
  description = "Deployment environment. Part of every name and tag."

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be dev, staging or prod."
  }
}

variable "project" {
  type        = string
  description = "Short project name used as the first part of resource names."
  default     = "orders"
}

variable "region" {
  type        = string
  description = "AWS region."
  default     = "us-east-1"
}

variable "aws_endpoint" {
  type        = string
  description = "Base URL of the AWS API. The lab emulator listens on http://localhost:4566."
  default     = "http://localhost:4566"
}

variable "max_receive_count" {
  type        = number
  description = "Receives before a message moves to the dead-letter queue."
  default     = 5
}

variable "noncurrent_version_days" {
  type        = number
  description = "Days an overwritten or deleted upload version is kept."
  default     = 30
}
