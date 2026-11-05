# Passport 2.0 Phase 0 audit — 2026-11-05

Baseline: origin/main `8ac3dd3aee221267fd115a61196a75c4b663b74d` (PR #270). Dedicated local branch `feat/passport-2-vc-20261105`, initially clean. Audit and planned files reported before functional implementation. No production writes or deployments.

## Existing system

- `backend/identity.js`, `identity-router.js`: fixed random SP- SchoolPark ID; private `sp_auth_links` maps Firebase UID / verified wallet to `sp_identities`. Google UID, LINE custom UID and wallet custom UID can map to one SPID. Link tickets are expiring/single-use. Preserve all mappings, duplicate review and wallet signatures.
- `backend/server.js`, `verified-platform.js`, `wallet-signature.js`: Firebase Admin verifies bearer tokens; verified server-owned account and claims supply identity. ethers verifies wallet signatures. Never trust request UID/address.
- `backend/kyc.js`: adult self-declaration, operator manual verification (`dialogue`, `document_shown`, `other`). Private free-form notes also enter audit logs. NOT government authentication; do not copy notes or self-declared age into VCs.
- Passport `frontend/public/index.html`: KYC and World ID Coming Soon. No operative World ID / VC / DID / OpenID4VC / ZKP / JPKI implementation found.
- `firestore.rules`: private identity/KYC collections but broad catch-all grants access to unexcluded collections. New `passport_v2_.*` must be excluded from fallback AND explicitly denied. Admin SDK bypasses Rules.
- Existing Firebase-managed browser auth and local account metadata must remain intact. No new token/VC/private key in URLs, localStorage, logs or analytics. New page excludes analytics and client-errors scripts. Legacy backend logs some wallet/transaction data; KYC notes are free-form. This audit does not certify historical logs as PII-free. New module uses fixed error codes only.
- Existing official pass, sky, City, EMUER, billing and Quest remain authoritative. VCs confer none of their permissions.
- CommonJS Node backend, node:test, static frontend, Vercel/Render deployment, Auth/Firestore emulator tests. Main may auto-deploy: no push/merge/Rules publication in this task.

## Standards / external dependencies

Reviewed official W3C GitHub REC snapshots (VC Data Model 2.0, VC JOSE/COSE, Bitstring Status List) and official OpenID `1.0-final` VCI/VP tags. VCI main currently contains editor errata. VC2 JOSE uses direct payload, not old `vc` wrapper; initial Data Integrity ldp_vc profile avoids mislabelling legacy JWT VC as VC2.

Direct official specification domains are blocked by environment network policy. Five-domain environment change draft saved, not published; official GitHub sources accessible. Digital Agency formal API/terms and connection approval have NOT been verified. No government result, production signer or external wallet account available. Government issuance and ZKP must remain disabled.

## Planned files (reported before functional implementation)

- `backend/passport-v2/`: schema, maintained cryptographic suite, issuer/verifier, trust, revocation, private storage, consent/replay, router/OpenID adapters; tests.
- `backend/package.json`, lockfile: maintained crypto libraries and independent OpenID client SDK.
- `backend/server.js`: isolated route and bounded/sanitized parser; no auth/financial engine changes.
- `frontend/public/passport-v2/`: certificate and explicit presentation consent UI, device keys; no analytics. `frontend/public/index.html`: gated entry only.
- `frontend/vercel.json`: scoped proxy/privacy headers.
- `firestore.rules`: server-only namespace, emulator verified, NOT published.
- `tools/passport-v2-tests/`, `docs/passport-v2/`: isolated tests, standards/compatibility, government/ZKP, recovery and operations.

## Migration / risk / sequence

No old data migration/deletion. New namespace, default disabled. Initial credential proves account access only, not legal identity/KYC/age/pass/City permission. SPID remains private. Only opaque subject and narrow assertion disclosed. Pin contexts and trust; no arbitrary external URL resolution. Standard libraries, bounded input, expiring single-use nonce and atomic consumption. Consent binds recipient/purpose/actual complete disclosure. Refusal never presents. Signed credentials are correlatable; not ZKP/cryptographic selective disclosure.

Sequence: baseline tests → schema/crypto → persistence/consent/revocation → protocol adapters → UI → Rules/integration/regression. Public release requires managed issuer keys, Rules review, real external-wallet compatibility, privacy/legal review and operational recovery readiness. Government assurance additionally requires formal approval and real results.
