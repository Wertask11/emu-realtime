terraform {
  required_version = ">= 1.9.8, < 2.0.0"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.100.0" }
  }
}

# Provisioning is NOT authorized. No service is started by this module.
# Apply only after the plan, KMS/CloudTrail/S3 fees and network have been approved.
provider "aws" { region = var.region }

variable "region" { type = string }
variable "account_id" {
  type = string
  validation {
    condition     = can(regex("^[0-9]{12}$", var.account_id))
    error_message = "An approved AWS account ID is required."
  }
}
variable "name" { type = string }
variable "administrator_role_arn" {
  type = string
  validation {
    condition     = can(regex("^arn:aws:iam::${var.account_id}:role/[A-Za-z0-9+=,.@_/-]+$", var.administrator_role_arn))
    error_message = "An approved administrator role in the same account is required."
  }
}
variable "incident_role_arn" {
  type = string
  validation {
    condition     = can(regex("^arn:aws:iam::${var.account_id}:role/[A-Za-z0-9+=,.@_/-]+$", var.incident_role_arn)) && var.incident_role_arn != var.administrator_role_arn
    error_message = "A separate incident role in the same account is required."
  }
}
variable "kms_vpc_endpoint_id" {
  type = string
  validation {
    condition     = can(regex("^vpce-[a-f0-9]+$", var.kms_vpc_endpoint_id))
    error_message = "An existing approved private KMS endpoint is required."
  }
}
variable "audit_bucket_name" { type = string }
variable "audit_retention_days" {
  type = number
  validation {
    condition     = var.audit_retention_days >= 1 && floor(var.audit_retention_days) == var.audit_retention_days
    error_message = "An explicitly approved integer retention period is required."
  }
}

locals {
  trail_arn = "arn:aws:cloudtrail:${var.region}:${var.account_id}:trail/${var.name}"
  administrative_actions = [
    "kms:DescribeKey", "kms:GetKeyPolicy", "kms:PutKeyPolicy", "kms:ListResourceTags",
    "kms:TagResource", "kms:UntagResource", "kms:EnableKey", "kms:DisableKey",
    "kms:ScheduleKeyDeletion", "kms:CancelKeyDeletion", "kms:UpdateKeyDescription"
  ]
}

resource "aws_iam_role" "signer" {
  name = var.name
  assume_role_policy = jsonencode({
    Version = "2012-10-17", Statement = [{
      Effect = "Allow", Principal = { Service = "ecs-tasks.amazonaws.com" }, Action = "sts:AssumeRole",
      Condition = {
        StringEquals = { "aws:SourceAccount" = var.account_id },
        ArnLike      = { "aws:SourceArn" = "arn:aws:ecs:${var.region}:${var.account_id}:*" }
      }
    }]
  })
  lifecycle { prevent_destroy = true }
}

resource "aws_kms_key" "operator" {
  description              = "SchoolPark scoped Polygon operator; activation requires independent gates"
  key_usage                = "SIGN_VERIFY"
  customer_master_key_spec = "ECC_SECG_P256K1"
  deletion_window_in_days  = 30
  # ECC keys require the manual address/role/pending-order rotation procedure.
  enable_key_rotation = false
  policy = jsonencode({
    Version = "2012-10-17", Statement = [
      {
        Sid       = "AdministrationWithoutSigning", Effect = "Allow",
        Principal = { AWS = var.administrator_role_arn },
        Action    = local.administrative_actions, Resource = "*"
      },
      {
        Sid       = "EmergencyStopWithoutSigning", Effect = "Allow",
        Principal = { AWS = var.incident_role_arn },
        Action    = ["kms:DescribeKey", "kms:DisableKey"], Resource = "*"
      },
      {
        Sid       = "PrivatePinnedWorkloadRead", Effect = "Allow",
        Principal = { AWS = aws_iam_role.signer.arn },
        Action    = ["kms:DescribeKey", "kms:GetPublicKey"], Resource = "*",
        Condition = { StringEquals = { "aws:SourceVpce" = var.kms_vpc_endpoint_id } }
      },
      {
        Sid       = "PrivateDigestSigning", Effect = "Allow",
        Principal = { AWS = aws_iam_role.signer.arn }, Action = "kms:Sign", Resource = "*",
        Condition = { StringEquals = {
          "aws:SourceVpce"  = var.kms_vpc_endpoint_id,
          "kms:MessageType" = "DIGEST", "kms:SigningAlgorithm" = "ECDSA_SHA_256"
        } }
      }
    ]
  })
  lifecycle {
    prevent_destroy = true
    precondition {
      condition     = var.administrator_role_arn != aws_iam_role.signer.arn && var.incident_role_arn != aws_iam_role.signer.arn
      error_message = "Workload cannot administer or stop its own key."
    }
  }
}

module "permissions" {
  source              = "./modules/permissions"
  role_id             = aws_iam_role.signer.id
  key_arn             = aws_kms_key.operator.arn
  kms_vpc_endpoint_id = var.kms_vpc_endpoint_id
}

resource "aws_s3_bucket" "audit" {
  bucket        = var.audit_bucket_name
  force_destroy = false
  lifecycle { prevent_destroy = true }
}
resource "aws_s3_bucket_public_access_block" "audit" {
  bucket                  = aws_s3_bucket.audit.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_versioning" "audit" {
  bucket = aws_s3_bucket.audit.id
  versioning_configuration { status = "Enabled" }
}
resource "aws_s3_bucket_server_side_encryption_configuration" "audit" {
  bucket = aws_s3_bucket.audit.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}
resource "aws_s3_bucket_lifecycle_configuration" "audit" {
  bucket = aws_s3_bucket.audit.id
  rule {
    id     = "approved-retention"
    status = "Enabled"
    filter {}
    expiration { days = var.audit_retention_days }
    noncurrent_version_expiration { noncurrent_days = var.audit_retention_days }
  }
}
resource "aws_s3_bucket_policy" "audit" {
  bucket = aws_s3_bucket.audit.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    {
      Effect    = "Deny", Principal = "*", Action = "s3:*",
      Resource  = [aws_s3_bucket.audit.arn, "${aws_s3_bucket.audit.arn}/*"],
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    },
    {
      Effect    = "Allow", Principal = { Service = "cloudtrail.amazonaws.com" },
      Action    = "s3:GetBucketAcl", Resource = aws_s3_bucket.audit.arn,
      Condition = { StringEquals = { "aws:SourceArn" = local.trail_arn } }
    },
    {
      Effect    = "Allow", Principal = { Service = "cloudtrail.amazonaws.com" },
      Action    = "s3:PutObject", Resource = "${aws_s3_bucket.audit.arn}/AWSLogs/${var.account_id}/*",
      Condition = { StringEquals = { "aws:SourceArn" = local.trail_arn, "s3:x-amz-acl" = "bucket-owner-full-control" } }
    }
  ] })
}
resource "aws_cloudtrail" "operator" {
  name                          = var.name
  s3_bucket_name                = aws_s3_bucket.audit.id
  enable_logging                = true
  enable_log_file_validation    = true
  include_global_service_events = false
  is_multi_region_trail         = false
  event_selector {
    include_management_events        = true
    read_write_type                  = "All"
    exclude_management_event_sources = [] # Do not exclude kms.amazonaws.com.
  }
  depends_on = [aws_s3_bucket_policy.audit, aws_s3_bucket_public_access_block.audit]
}

output "key_arn" { value = aws_kms_key.operator.arn }
output "workload_role_arn" { value = aws_iam_role.signer.arn }
output "audit_trail_arn" { value = aws_cloudtrail.operator.arn }
