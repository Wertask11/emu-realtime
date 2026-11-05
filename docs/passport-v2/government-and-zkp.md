# Government authentication and ZKP readiness

> 現在のRC判定・ZKP除外・公式資料再確認は [final-release-readiness.md](final-release-readiness.md) を参照。この文書は前フェーズの記録を含みます。

## Government authentication

Digital Agency portal attempted: https://developers.digital.go.jp/documents/auth-and-sign/ . Session policy denied outbound access before the page could be verified. The owner reported saving/publishing the official-host setting. The selected running environment still did not include those hosts in its effective allowlist and returned tunnel 403 on the final retry. Treat runtime propagation as unconfirmed; do not claim the owner failed to configure it. No formal API specification, current terms, service agreement, connection approval, test credentials, certificate chain or assurance mapping can be confirmed from this environment. Do not interpret a public GitHub example or successful mock as approval.

Before connection: confirm the correct Digital Agency/JPKI service and specification/version; permitted relying party and issuer roles; application/approval, provider contracts and key custody; approved test environment; signature certificate chain and revocation validation; consent, purpose limitation, retention/deletion, incident response, age/minor rules, applicable personal-information and electronic-signature legal requirements. Have qualified counsel review actual intended operation and claims. This list is a readiness plan, not a legal finding of compliance.

`government.mjs` is a pure mock result evaluator only. Every result has governmentVerified=false and credential=null, even scenario=success. It accepts only a fixed scenario enum. No endpoint collects My Number (12 digits), document image, name, DOB or government result. There is no government credential type or issuer path. Existing adult self-declaration / operator verification / World ID Coming Soon cannot authorize government issuance.

## Authoritative production use cases (not connected)

| Use case | Minimum authoritative attributes / issuer | Candidate proof | Tracking / status concerns |
|---|---|---|---|
| Age threshold | Verified birth date or trusted age-threshold credential; approved identity provider | Predicate/range proof against trusted signed DOB, or issued threshold boolean with selective disclosure | Self-declared adult flag insufficient. Avoid revealing DOB, stable UID, reusable nullifier; define audience-bound nonce, short validity and privacy-preserving revocation |
| Identity checked | Assurance level, approved verification source/time, expiry; approved provider | Proof of membership in valid verified set or selectively disclosed signed assertion | Operator manual check is a different assurance. Issuer trust, freshness, revoked verification and repeat linkage require review |
| City shop approval | Real operator approval, scope, expiry; SchoolPark authorized City approver | Signed approval membership / scoped predicate | VC must not mint City rights or substitute for existing API authorization. Revoked shop approval must be reflected. Avoid stable shop/person identifiers where not required |

## Implemented synthetic prototype and release blocker

`zkp-issuer.mjs` issues fixed synthetic credentials only. `zkp-proof.mjs` uses published Dock BBS+ signature knowledge, Bulletproofs++ signed-attribute range proofs and positive VB accumulator membership. A proves a hidden signed birth date within an age bound, B/C prove signed qualification values; all prove validity bounds and current membership. No real age/government/City qualification is issued or service authorization granted.

Generation/verification, false predicates, expiry, revocation, audience alteration, core-proof mutation and randomized proofs were tested. A separate verifier process uses only public input but the **same library**, not an independent cryptographic implementation/audit. Browser measurements use desktop Chromium at mobile viewport with CPU throttling, not a real phone.

The library accepts appended bytes and some tail mutations in proof serialization. Qualification forgery was not demonstrated, but strict deserialization is unresolved. A failing TODO release test preserves this finding. The default local environment and all production environments disable it; explicit local `PASSPORT_ZKP_UNAUDITED_TEST_ONLY=true` permits synthetic research only. Upstream review, canonical deserialization, external audit, stronger witness-update privacy and physical-device tests are required before public use.

This experimental Dock composite format is not a W3C BBS cryptosuite or standard OpenID credential format. It uses published primitives, not custom cryptography. No complete unlinkability claim: issuer/witness retrieval, schema/expiry cohorts and network metadata can correlate activity. A threshold SD-JWT is an alternative with different privacy properties, **not** a ZKP.

Current official API terms, exact auth/sign result attributes, direct vs accredited-provider eligibility, API/provider fees, approvals and legal basis remain unverified. The [completion report](completion-report.md) lists applications, contracts, credentials, consent, minimization, statutory review and deployment prerequisites. Do not infer approval from a GitHub sample or successful mock.
