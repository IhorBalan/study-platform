terraform {
  required_version = ">= 1.10.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # One state file per environment, in a versioned bucket, locked with a lock
  # object next to the state (use_lockfile needs OpenTofu 1.10 or later).
  backend "s3" {
    bucket       = "acme-tofu-state"
    key          = "billing/prod/terraform.tfstate"
    region       = "eu-west-1"
    encrypt      = true
    use_lockfile = true
  }
}

# Credentials come from the environment: a role assumed through OIDC in CI,
# or an SSO session on a laptop. Never from this file.
provider "aws" {
  region = "eu-west-1"
}

module "billing_storage" {
  source = "../../modules/billing-storage"

  environment = "prod"
  jobs_visibility_timeout_seconds = 120
  jobs_retention_seconds          = 1209600
}

output "invoices_bucket" {
  value = module.billing_storage.invoices_bucket
}

output "invoice_jobs_queue_url" {
  value = module.billing_storage.invoice_jobs_queue_url
}
