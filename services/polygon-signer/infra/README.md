# Approved-environment provisioning preparation

**Not applied. No AWS account, key, role, bucket, trail, service or endpoint was created.**
Terraform 1.9.8 / AWS provider 5.100.0 are pinned/tested. `terraform test` uses a mocked provider and **plan only**. Real apply and its costs require Founder approval. Do not run `apply` as a setup/test step.

This module prepares a nonexportable secp256k1 SIGN_VERIFY key, a dedicated ECS task workload role, a pinned-key IAM policy, a separate incident-stop principal, private-endpoint conditions, and versioned/TLS-only/private S3 plus integrity-validated regional CloudTrail management-event delivery. It does not launch a container, buy private connectivity, create Google federation, assign Polygon roles, fund POL, or enable intake.

## Offline validation

```
terraform init -backend=false
terraform fmt -check -recursive
terraform validate
terraform test
```

No real AWS credentials are needed by the mock tests. `prevent_destroy` on key/role/bucket remains in the actual module. Tests use plan rather than weakening this safeguard for teardown. `.terraform/`, plans, state and actual tfvars are ignored; commit the provider lockfile. Never place API tokens, ADC secrets or private keys in Terraform variables/state.

## Inputs to approve together

- AWS account/region and existing administrator and incident role ARNs. Separate these from the signing workload. Administrator can change the key policy; this is an ultimate trust boundary, not a cryptographic separation from a malicious administrator.
- Existing private KMS VPC endpoint ID. Its DNS/routes/endpoint policy and the workload's `aws:SourceVpce` condition must be verified in the actual network. Merely matching an endpoint ID's syntax proves no connectivity.
- Unique audit bucket and explicit retention days agreed with counsel. The 90-day fixture in tests is **not** the production retention decision. CloudTrail is regional and includes management events (including KMS); account-wide event volume, existing trails, S3 requests/storage and deletion policy need cost/privacy review. Versioning and signed digests are not an immutable archive or protection against an AWS administrator.
- Dedicated private runtime and authenticated TLS proxy/tunnel from Render. `server.js` still binds loopback. Do not expose the signer publicly or add KMS permissions to the main backend. This module does not establish Render-to-AWS private reachability.
- Container image pinned by digest, a separate execution role, approved secret injection, and Google workload federation/ADC. No long-lived AWS keys or Firebase private key copies. Firestore server IAM bypasses Rules and is not collection-level ownership isolation; its actual scope needs review.

The `permissions` child module permits DescribeKey/GetPublicKey and Sign DIGEST/ECDSA_SHA_256 against one immutable ARN, through the approved endpoint. `Resource="*"` inside the **key policy** means this one key; the workload **IAM policy** uses the exact ARN. No grant creation, key administration or general signing endpoint is delegated to the workload. Existing `identity.js` rejects static keys/profiles.

The role assumes ECS task credentials (mode `container`); no task is launched by this module. An EC2 or OIDC workload needs a separately reviewed trust policy rather than silently reusing this role. Apply must run as an approved key administrator able to retain PutKeyPolicy access. Review saved plan/resource list and lockfile before approval.

## Actual connection acceptance, after separate approval

Use `node ../live-acceptance.js` **inside the approved private runtime**, with explicit isolated test-key approval, `POLYGON_KMS_ISOLATED_TEST_KEY=true`, `POLYGON_KMS_TEST_KEY_ARN`, `POLYGON_KMS_TEST_ADDRESS`, a different configured production key/operator, AWS_REGION and workload identity. It validates DescribeKey/GetPublicKey without signing by default. These are still real AWS API calls: obtain approval first.

Only after isolated signing-cost approval set `POLYGON_KMS_TEST_SIGN_APPROVED=true` and add `--approved-sign-test`. It performs one synthetic signature with an isolated key and verifies recovery locally. Gas limit 1 cannot execute on Polygon. It has no provider/broadcast function and never outputs signed bytes. This does not test a production refund, key's contract role, private ingress, actual CloudTrail delivery or production policy attestation.

Actual checks still required: reject requests outside the private endpoint; prove unrelated workload denied; inspect effective IAM/key policies; validate pinned public address; disable isolated key and verify rejection including cache; re-enable only under approved recovery; verify CloudTrail event and digest, alert delivery, least-privilege Google identity and runtime ingress. Record key ARN/public address, UTC/JST times, approval and fixed outcome codes only. Never log credentials or signed raw bytes. Granting a production REFUND_ROLE remains a separate on-chain approval.

ECC key rotation is manual: stop intake, reconcile old pending nonce/gas/refunds, provision approved new key, review address/role/POL, test it, then retire old authority. Do not switch aliases while pending signatures exist. Existing operations runbook describes the three stop modes. No automated disable/enable/role grant is run by this module or acceptance tool.
