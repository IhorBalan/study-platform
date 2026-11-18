# Copied from a blog post. It worked on the author's laptop.
# TODO: make it fit the brief in task.md.
provider "aws" {
  region     = "us-east-1"
  access_key = "test"
  secret_key = "test"

  endpoints {
    s3 = "http://localhost:4566"
  }
}
