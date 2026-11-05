# Operations, retention and recovery

> 現在のRC判定・ZKP除外・公式資料再確認は [final-release-readiness.md](final-release-readiness.md) を参照。この文書は前フェーズの記録を含みます。

This branch is **development only**. Runtime gate requires PASSPORT_V2_ENABLED=true, PASSPORT_V2_SANDBOX=true, APP_ENV=local, NODE_ENV other than production, demo-* Firebase project and loopback Auth/Firestore emulators. PASSPORT_V2_SANDBOX_BASE must be a loopback URL. Every other deployment returns disabled; existing Passport remains unchanged. `servicePromise` dependency injection is for isolated tests only, never environment-controlled.

## Keys and trust

Sandbox issuer key: WebCrypto P-256 nonextractable private CryptoKey, memory only. Restart changes it and old sandbox credentials fail closed. This is deliberately NOT production key storage. A KMS SDK adapter and fail-closed trust/audit preparation now exist; production enabling remains unsupported pending real KMS/IAM validation, operational deployment and approval. No private issuer key in environment variables, repository, browser, Firestore or logs.

Holder keys: per credential, WebCrypto nonextractable P-256; structured-cloned into IndexedDB under current Firebase UID + credential ID. No key seed/export or bearer persistence. Browser/site data deletion loses keys. Shared login methods retain SPID but a different UID may not find this device key; authenticate and revoke/reissue, never auto-merge device stores. Same-origin malicious JavaScript can invoke a nonextractable key: nonextractable is not an XSS cure. Dedicated page has restrictive CSP, no analytics/client-error collector and no untrusted HTML rendering.

Issuer trust is explicit configured issuer + public key ring; requests cannot add issuer keys or verifier entries. Key rotation: supply new signer and retain previous public keys for valid old VCs; old private signer is not needed to verify. Key compromise: remove key from trusted ring to reject all its proofs, revoke affected credentials, distribute updated trust/status and reissue after existing-login authentication. Prepared public-key distribution and compromise/emergency controls are implemented; actual KMS rotation/distribution operations remain a release blocker. No public trust federation is claimed.

## User recovery and deletion

Device lost: log in with an already linked LINE/Google/etc method using existing account recovery, revoke old certificate, generate a new device key and certificate. SchoolPark ID stays unchanged. Login recovery itself is not reimplemented. A lost issuer key cannot be recovered from a holder's login. No new identity proof is manufactured by this flow.

Consent: fixed registered recipient/purpose + actual full VC or supported SD-JWT selected claims + holder binding shown before approval. No approval = no receiver acceptance. Pending consent can be denied/withdrawn; history deletion withdraws unfinished consents. Successful presentation cannot be undone in copies already delivered; receiver retention must be covered by a real agreement before external operation. No server callback forwarding is implemented.

Delete credential: permanently revoke its nonreused status index, erase saved signed VC / holder public-key material from private account record and delete local device key. Retain a minimal private tombstone (random credential ID, status index, revoked/deleted) to maintain revocation/account recovery. History (last 50 actions) contains fixed event type, time, recipient/purpose and random references; no presentation body or personal attributes. User can delete history; this does not erase counterpart records. Server retains signed account VCs privately until deletion; bulk status list is the only public status representation.

Ticket/nonce validity: five minutes, enforced synchronously regardless of cleanup. Tickets have expiresAt TTL field; a production TTL policy has NOT been configured. Expired requests/nonces are pruned on subsequent activity, not by an always-running deletion job. A retention/TTL cleanup policy and tombstone retention period must be decided and tested before production. This is not a claim of automatic physical erasure after five minutes.

Sandbox limits: 20 undeleted credentials per account, 1,000 total issuance slots per status list, 10 active presentation requests/account, 100 active global nonces, 60 requests/IP/minute and bounded rate bucket count. Firestore serializes per-account and global status allocation; this is a sandbox capacity, not a production scalability claim. Failed issuance consumes access token; create a new offer rather than retrying it.

No migration of SchoolPark ID, auth links, wallet, subscription, pass, sky, City, EMUER, Quest or old KYC data. Publish new server-only Rules before any future production activation, and verify both exclusion from broad fallback and direct deny. Do not publish Rules or merge/deploy automatically from this branch.

## Managed deployment preparation (not activated)

Use `prepareManagedPassport` with an injected AWS KMS SDK client using workload identity, not a secret private key. Its explicit key ARN must be enabled ECC_NIST_P256 SIGN_VERIFY from AWS_KMS/AWS_CLOUDHSM, with pinned public key. A standard dedicated HSM outside this adapter is not implemented. CloudHSM integration itself is untested.

Rules must be reviewed and published **before** generating a fresh 64-hex storage realm and initializing its private control record. Never trust documents preseeded while an old fallback Rule was permissive. The service fails closed if control is absent/malformed, emergencyStop is not explicitly false, a key is compromised, or key dates are invalid/expired. The new namespaces are client-denied; Admin access remains subject to IAM.

Rotate by provisioning a new nonextractable key, checking its public pin, deploying the new signer and retaining prior uncompromised public keys until their certificates expire. Stop/compromise by controlled administrative update, remove compromised keys from published trust, invalidate affected credentials and reissue after existing authentication. No automatic privileged control-writing endpoint was added. Operational updates and recovery drills require explicit approval. Bulk signed status caching is 60 seconds internally with immediate local revocation invalidation; a distributed verifier may retain a still-valid signed status for up to its five-minute validity window.

`firestoreOperations.cleanup` is a bounded dry-run-first function for expired tickets/audits. It is realm-scoped and requires a Firestore index for realm + expiresAt. It is NOT scheduled or published TTL. Prepared audit retention is 90 days, adjustable after legal approval. Existing tombstones persist for status/recovery; final lifetime and physical deletion job remain release conditions. No claim of automatic data erasure is made.

The ZKP prototype additionally requires `PASSPORT_ZKP_UNAUDITED_TEST_ONLY=true` and local demo emulators. This explicitly acknowledges a known trailing-proof-byte validation issue; it never overrides the production gate. BBS+ issuer secrets and synthetic attributes remain ephemeral local-test material, not KMS-protected production qualifications. Never store real personal data in this prototype.

Live KMS credentials, managed realm initialization, Rules publication, TTL, control updates, government integration and production activation have not been performed. See [completion report](completion-report.md) for the full release sequence and blockers.
