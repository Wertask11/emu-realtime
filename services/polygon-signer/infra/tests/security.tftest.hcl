mock_provider "aws" {}

variables {
  region                 = "ap-northeast-1"
  account_id             = "123456789012"
  name                   = "isolated-operator-plan"
  administrator_role_arn = "arn:aws:iam::123456789012:role/KeyAdmin"
  incident_role_arn      = "arn:aws:iam::123456789012:role/IncidentStop"
  kms_vpc_endpoint_id    = "vpce-0123456789abcdef0"
  audit_bucket_name      = "isolated-operator-audit-not-created"
  audit_retention_days   = 90 # Test fixture, not approved production retention.
}

run "private_secp256k1_and_audit_policy" {
  command = plan # No apply, including mocked apply; preserve prevent_destroy.
  override_resource {
    target = aws_kms_key.operator
    values = { arn = "arn:aws:kms:ap-northeast-1:123456789012:key/11111111-1111-1111-1111-111111111111" }
  }
  override_resource {
    target = aws_iam_role.signer
    values = { arn = "arn:aws:iam::123456789012:role/isolated-operator-plan" }
  }
  assert {
    condition     = aws_kms_key.operator.customer_master_key_spec == "ECC_SECG_P256K1" && aws_kms_key.operator.key_usage == "SIGN_VERIFY"
    error_message = "Ethereum-compatible nonexportable SIGN_VERIFY key required."
  }
  assert {
    condition     = !contains(local.administrative_actions, "kms:Sign") && !contains(local.administrative_actions, "kms:CreateGrant")
    error_message = "Administration and emergency role must not be signers."
  }
  assert {
    condition     = aws_cloudtrail.operator.enable_logging && aws_cloudtrail.operator.enable_log_file_validation && length(one(aws_cloudtrail.operator.event_selector).exclude_management_event_sources) == 0
    error_message = "KMS management events and validated audit delivery required."
  }
  assert {
    condition     = aws_s3_bucket_public_access_block.audit.block_public_policy && !aws_s3_bucket.audit.force_destroy
    error_message = "Audit storage must not be public or force-deleted."
  }
}

run "pinned_workload_permissions" {
  command = plan
  module { source = "./modules/permissions" }
  variables {
    role_id = "isolated-workload-role"
    key_arn = "arn:aws:kms:ap-northeast-1:123456789012:key/11111111-1111-1111-1111-111111111111"
  }
  assert {
    condition     = alltrue([for s in jsondecode(aws_iam_role_policy.pinned_key.policy).Statement : s.Resource == var.key_arn])
    error_message = "Workload permissions must be pinned to one key ARN."
  }
  assert {
    condition     = jsondecode(aws_iam_role_policy.pinned_key.policy).Statement[1].Condition.StringEquals["aws:SourceVpce"] == var.kms_vpc_endpoint_id && jsondecode(aws_iam_role_policy.pinned_key.policy).Statement[1].Condition.StringEquals["kms:MessageType"] == "DIGEST"
    error_message = "Private endpoint and DIGEST constraints required."
  }
}
