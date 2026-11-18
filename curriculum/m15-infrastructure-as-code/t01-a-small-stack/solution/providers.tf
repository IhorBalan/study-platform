# Credentials are not set here. The provider reads AWS_ACCESS_KEY_ID and
# AWS_SECRET_ACCESS_KEY from the environment (any value works for the emulator).
provider "aws" {
  region = var.region

  # The emulator has no STS, IAM or instance metadata to check credentials
  # against, and it serves buckets by path rather than by sub-domain.
  s3_use_path_style           = true
  skip_credentials_validation = true
  skip_metadata_api_check     = true
  skip_requesting_account_id  = true

  endpoints {
    s3  = var.aws_endpoint
    sqs = var.aws_endpoint
    ssm = var.aws_endpoint
  }

  default_tags {
    tags = local.tags
  }
}
