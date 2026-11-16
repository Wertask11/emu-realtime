terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.100.0" }
  }
}
variable "role_id" { type = string }
variable "key_arn" {
  type = string
  validation {
    condition     = can(regex("^arn:aws:kms:[a-z0-9-]+:[0-9]{12}:key/[a-f0-9-]{36}$", var.key_arn))
    error_message = "A single immutable key ARN is required; aliases and wildcards are forbidden."
  }
}
variable "kms_vpc_endpoint_id" { type = string }
resource "aws_iam_role_policy" "pinned_key" {
  role = var.role_id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    {
      Effect    = "Allow", Action = ["kms:DescribeKey", "kms:GetPublicKey"], Resource = var.key_arn,
      Condition = { StringEquals = { "aws:SourceVpce" = var.kms_vpc_endpoint_id } }
    },
    {
      Effect = "Allow", Action = "kms:Sign", Resource = var.key_arn,
      Condition = { StringEquals = {
        "aws:SourceVpce"  = var.kms_vpc_endpoint_id,
        "kms:MessageType" = "DIGEST", "kms:SigningAlgorithm" = "ECDSA_SHA_256"
      } }
    }
  ] })
}
