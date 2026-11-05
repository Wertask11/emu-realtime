# Operations, retention and recovery

This branch is **development only**. Runtime gate requires PASSPORT_V2_ENABLED=true, PASSPORT_V2_SANDBOX=true, APP_ENV=local, NODE_ENV other than production, demo-* Firebase project and loopback Auth/Firestore emulators. PASSPORT_V2_SANDBOX_BASE must be a loopback URL. Every other deployment returns disabled; existing Passport remains unchanged. `servicePromise` dependency injection is for isolated tests only, never environment-controlled.

## Keys and trust

Sandbox issuer key: WebCrypto P-256 nonextractable private CryptoKey, memory only. Restart changes it and old sandbox credentials fail closed. This is deliberately NOT production key storage. Production enabling is unsupported until a managed KMS/HSM signing adapter, access audit, key backup policy, compromise handling and operational approval are added. No private issuer key in environment variables, repository, browser, Firestore or logs.

Holder keys: per credential, WebCrypto nonextractable P-256; structured-cloned into IndexedDB under current Firebase UID + credential ID. No key seed/export or bearer persistence. Browser/site data deletion loses keys. Shared login methods retain SPID but a different UID may not find this device key; authenticate and revoke/reissue, never auto-merge device stores. Same-origin malicious JavaScript can invoke a nonextractable key: nonextractable is not an XSS cure. Dedicated page has restrictive CSP, no analytics/client-error collector and no untrusted HTML rendering.

Issuer trust is explicit configured issuer + public key ring; requests cannot add issuer keys or verifier entries. Key rotation: supply new signer and retain previous public keys for valid old VCs; old private signer is not needed to verify. Key compromise: remove key from trusted ring to reject all its proofs, revoke affected credentials, distribute updated trust/status and reissue after existing-login authentication. Actual production rotation/distribution/KMS automation remains a release blocker. No public trust federation is claimed.

## User recovery and deletion

Device lost: log in with an already linked LINE/Google/etc method using existing account recovery, revoke old certificate, generate a new device key and certificate. SchoolPark ID stays unchanged. Login recovery itself is not reimplemented. A lost issuer key cannot be recovered from a holder's login. No new identity proof is manufactured by this flow.

Consent: fixed registered recipient/purpose + full actual VC + holder signature shown before approval. No approval = no receiver acceptance. Pending consent can be denied/withdrawn; history deletion withdraws unfinished consents. Successful presentation cannot be undone in copies already delivered; receiver retention must be covered by a real agreement before external operation. No server callback forwarding is implemented.

Delete credential: permanently revoke its nonreused status index, erase saved signed VC / holder public-key material from private account record and delete local device key. Retain a minimal private tombstone (random credential ID, status index, revoked/deleted) to maintain revocation/account recovery. History (last 50 actions) contains fixed event type, time, recipient/purpose and random references; no presentation body or personal attributes. User can delete history; this does not erase counterpart records. Server retains signed account VCs privately until deletion; bulk status list is the only public status representation.

Ticket/nonce validity: five minutes, enforced synchronously regardless of cleanup. Tickets have expiresAt TTL field; a production TTL policy has NOT been configured. Expired requests/nonces are pruned on subsequent activity, not by an always-running deletion job. A retention/TTL cleanup policy and tombstone retention period must be decided and tested before production. This is not a claim of automatic physical erasure after five minutes.

Sandbox limits: 20 undeleted credentials per account, 1,000 total issuance slots per status list, 10 active presentation requests/account, 100 active global nonces, 60 requests/IP/minute and bounded rate bucket count. Firestore serializes per-account and global status allocation; this is a sandbox capacity, not a production scalability claim. Failed issuance consumes access token; create a new offer rather than retrying it.

No migration of SchoolPark ID, auth links, wallet, subscription, pass, sky, City, EMUER, Quest or old KYC data. Publish new server-only Rules before any future production activation, and verify both exclusion from broad fallback and direct deny. Do not publish Rules or merge/deploy automatically from this branch.
