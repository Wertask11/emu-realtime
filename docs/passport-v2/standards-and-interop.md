# Standards and compatibility — 2026-11-05

> 現在のRC判定・ZKP除外・公式資料再確認は [final-release-readiness.md](final-release-readiness.md) を参照。この文書は前フェーズの記録を含みます。

## Normative baselines

| Standard | Canonical publication | Reviewed official source |
|---|---|---|
| W3C VC Data Model 2.0 | https://www.w3.org/TR/vc-data-model-2.0/ | https://github.com/w3c/vc-data-model/blob/main/transitions/2025/REC/index.html |
| W3C VC JOSE/COSE | https://www.w3.org/TR/vc-jose-cose/ | https://github.com/w3c/vc-jose-cose/blob/main/transitions/REC/index.html |
| W3C Bitstring Status List | https://www.w3.org/TR/vc-bitstring-status-list/ | https://github.com/w3c/vc-bitstring-status-list/blob/main/transitions/2025/REC/index.html |
| OpenID4VCI 1.0 Final | https://openid.net/specs/openid-4-verifiable-credential-issuance-1_0.html | https://github.com/openid/OpenID4VCI/blob/1.0-final/openid-4-verifiable-credential-issuance-1_0.md |
| OpenID4VP 1.0 Final | https://openid.net/specs/openid-4-verifiable-presentations-1_0.html | https://github.com/openid/OpenID4VP/blob/1.0-final/openid-4-verifiable-presentations-1_0.md |

Direct official-site access is blocked by this session's network policy. Reviewed official GitHub publications; VCI `1.0-final` is used, not main's errata editor draft. Downloaded source hashes are in `spec-source-hashes.json`. This is a tested constrained application profile, not a certification of every optional feature or a W3C/OpenID conformance award.

## Chosen profile and alternatives

Issuer: HTTPS controller URI with locally pinned public Multikey documents. Holder: fresh per-credential P-256 `did:key`. Data Model 2.0 + `DataIntegrityProof` / `ecdsa-rdfc-2019`, OpenID format `ldp_vc`. Digital Bazaar libraries perform canonicalization, signatures, verification and status-list encoding. JOSE performs OpenID proof JWTs (ES256); no handwritten cryptography. Contexts are bundled/pinned, never fetched from arbitrary credential URLs.

| Option | Benefit | Limit / decision |
|---|---|---|
| HTTPS controller (chosen) | Pin known institution/key without a DID network | HTTPS origin operational control and trust distribution still required |
| did:web issuer | Familiar domain-hosted DID document | Domain takeover/rotation/caching need policy; NOT implemented as a live resolver |
| did:key holder (chosen) | No network DID discovery; fresh local key | Cannot rotate the DID; revoke/reissue after loss; repeated credential correlatable |
| did:ion / did:ethr | Decentralized updates / ecosystem | Network, cost and correlation implications; not implemented |
| VC2 JOSE `vc+jwt` | Simple compact JOSE packaging | VC2 direct payload differs from old `vc` wrapper; legacy jwt_vc_json must not be mislabelled |
| SD-JWT VC (implemented) | Selective attribute disclosure with holder KB-JWT | Separate from JSON-LD VC2; app-specific revocation, not a predicate ZKP |
| BBS+ / Bulletproofs++ prototype | Hidden signed-attribute predicates and accumulator membership | Experimental Dock profile, known deserialization issue; not W3C BBS suite or OpenID format |

## Wire behavior actually tested

VC2 first context, explicit versioned application context, types, issuer, opaque UUID/holder key, validFrom/validUntil, mandatory revocation and proof are checked. Unknown credential/subject fields are rejected. Only accountAccess=true / assurance=platform-account / schemaVersion=1 are issuable. No SPID, Firebase UID, email, LINE subject, wallet address, government verification, DOB, age or personal number in the credential.

- VCI: path-based well-known discovery; private authenticated offer creation; pre-authorized code + eight-digit tx_code; five-minute code/token/nonce; five PIN attempts; hashes of secrets at rest; one-use scoped access token; public nonce endpoint; `proofs.jwt` with typ/audience/iat/nonce; final `credentials:[{credential:...}]` response. A spent token is not retried after issuance failure: request a new offer. No code/PIN/token in deep-link URLs or logs. External SDK emits duplicate legacy user_pin: accepted only if identical to required tx_code; it never substitutes for it. TLS is deliberately local-only here and is a production blocker.
- VP: pinned verifier identity/purpose/callback, DCQL account query, direct_post shape, full-credential disclosure screen, explicit consent, holder-signed VP bound to nonce/client_id, state lookup using a hash, atomic one-use request consumption and revocation recheck. Public receiver needs no Firebase login, but cannot accept a presentation without the authenticated holder's prior approval. Presentation content is not saved in logs or history. The built-in UI presents only to this sandbox receiver. Arbitrary request_uri fetch / callback forwarding / third-party verifier registration is unsupported.
- Status: signed bulk revocation list, 131,072 entries, random nonreused indices, standard multibase/GZIP, issuer/key/signature/freshness checks; revoked bits fail verification. Minimum five-minute status credential validity, no per-person status endpoint. No status-check-based login or entitlement grant.

## Compatibility evidence and limits

Independent OpenWallet Foundation `@openid4vc/openid4vci@0.9.2` detects V1 metadata and completes discovery → token → nonce → proof → credential over local HTTP with synthetic HTTPS metadata routed only to localhost. `@openid4vc/openid4vp@0.9.2` parses request and validates final DCQL response structure/state; Digital Bazaar plus application checks validate actual signature, trust, holder binding, revocation and consent. SDK structural validation alone is not cryptographic verification.

Actual unmodified walt.id Wallet API2 1.2.1 completed SD-JWT receipt and presentation, including replay and revoked-credential rejection, over loopback with synthetic accounts. Product image digest and exact limits are in [completion-report.md](completion-report.md). It was operated through product APIs, not a physical phone. VC2 LDP and the Dock ZKP prototype are not claimed interoperable with that product.

Authorization-code + S256 PKCE is implemented/tested for registered clients; the product test uses pre-authorized issuance. `/sd` discovery separates SD metadata from the LDP profile. The VP client ID uses `redirect_uri:` for unsigned requests and exact response URI. Unknown verifier registration and arbitrary callback forwarding remain unsupported. No deferred issuance, DPoP, encrypted response, mdoc or remote DID federation is exposed.

Ordinary account VC selection is whole disclosure. SD-JWT performs real claim selection, but its issuer JWT, holder key and opaque status reference remain correlatable. The synthetic ZKP profile proves ranges using published library primitives; it is not a standard OpenID credential format. Strict proof deserialization is unresolved and the release criterion remains a failing TODO. Never advertise ZKP as production-ready.
