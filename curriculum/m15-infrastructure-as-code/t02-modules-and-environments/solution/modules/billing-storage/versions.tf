# A module says which providers it needs. It never configures them:
# the root module (envs/dev, envs/prod) owns the provider block.
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}
