# Government authentication and ZKP readiness

## Government authentication

Digital Agency portal attempted: https://developers.digital.go.jp/documents/auth-and-sign/ . Session policy denied outbound access before the page could be verified. An environment draft adding official hosts was saved but has not been published. No formal API specification, current terms, service agreement, connection approval, test credentials, certificate chain or assurance mapping can be confirmed from this environment. Do not interpret a public GitHub example or successful mock as approval.

Before connection: confirm the correct Digital Agency/JPKI service and specification/version; permitted relying party and issuer roles; application/approval, provider contracts and key custody; approved test environment; signature certificate chain and revocation validation; consent, purpose limitation, retention/deletion, incident response, age/minor rules, applicable personal-information and electronic-signature legal requirements. Have qualified counsel review actual intended operation and claims. This list is a readiness plan, not a legal finding of compliance.

`government.mjs` is a pure mock result evaluator only. Every result has governmentVerified=false and credential=null, even scenario=success. It accepts only a fixed scenario enum. No endpoint collects My Number (12 digits), document image, name, DOB or government result. There is no government credential type or issuer path. Existing adult self-declaration / operator verification / World ID Coming Soon cannot authorize government issuance.

## Future ZKP use cases (not implemented)

| Use case | Minimum authoritative attributes / issuer | Candidate proof | Tracking / status concerns |
|---|---|---|---|
| Age threshold | Verified birth date or trusted age-threshold credential; approved identity provider | Predicate/range proof against trusted signed DOB, or issued threshold boolean with selective disclosure | Self-declared adult flag insufficient. Avoid revealing DOB, stable UID, reusable nullifier; define audience-bound nonce, short validity and privacy-preserving revocation |
| Identity checked | Assurance level, approved verification source/time, expiry; approved provider | Proof of membership in valid verified set or selectively disclosed signed assertion | Operator manual check is a different assurance. Issuer trust, freshness, revoked verification and repeat linkage require review |
| City shop approval | Real operator approval, scope, expiry; SchoolPark authorized City approver | Signed approval membership / scoped predicate | VC must not mint City rights or substitute for existing API authorization. Revoked shop approval must be reflected. Avoid stable shop/person identifiers where not required |

Before implementation choose a maintained, independently audited proof system and wallet profile; define security model, circuit/proof parameters and trusted setup if relevant; test soundness, malicious inputs, replay, unlinkability, issuer/verifier collusion, holder binding, revocation privacy and mobile performance. BBS/SD-JWT attribute disclosure does not automatically implement predicates. A revealed threshold boolean is not a ZKP. No new cryptographic algorithm or custom circuit is shipped here, and UI/API capabilities always report zkp=false.
