# Passport 2.0 development architecture

Existing Firebase login → existing identity.findByUid → stable existing SchoolPark ID → private account record. No new identity resolution, user merge, entitlements, pass issuance or EMUER action. Missing existing SPID fails closed; anonymous auth rejected. Read/write through Admin SDK only; Rules explicitly exclude the new prefix from the legacy catch-all.

| Component | Responsibility |
|---|---|
| crypto.mjs | W3C profile bounds, pinned document loader, maintained Data Integrity, holder signing and status verification |
| service.mjs | Version 1 account proof, private grant/consent/replay workflow, atomic status allocation/revocation |
| storage.cjs | Firestore transactions; hash-owned private account documents, hashed grants/state and TTL timestamps |
| router.cjs | Local-emulator gate, reused Firebase authorization, isolated bounded JSON/form parsers, fixed errors, request budget |
| government.mjs | Explicitly unconnected readiness, fixed-scenario mock with no credential |
| frontend/public/passport-v2 | Isolated user UI, whole-disclosure confirmation, device WebCrypto/IndexedDB, no telemetry |
| tools/passport-v2-tests | Browser bundle source/build, isolated actual-app fixture, Rules/browser tests |

VC schema and context are versioned public static resources (`schemas/account-v1.json`, `contexts/account-v1.jsonld`). They contain definitions only, no credentials or people. Actual issuance validates the narrow version-1 profile, and independent JSON Schema validation is tested. No JSON Schema credentialSchema proof-format extension is claimed. Later schema changes need a new version/configuration/context; no silent change to v1 meaning.

Only `passport_v2_accounts`, `passport_v2_status`, `passport_v2_tickets` are introduced. Account doc includes private signed VCs, minimal holder public-key metadata, bounded consent history and short-lived pending requests. It never stores holder private keys, raw proof JWTs, raw access/PIN/preauthorized codes or received VP bodies. Status list allocation/revocation and account updates share a transaction; signed output is returned only after commit. Completed/refused requests do not consume the active-request quota. Firestore cannot store arrays directly inside arrays: DCQL wire objects are constructed for the response, not stored in account documents.

| API under /api/passport-v2 | Authorization / use |
|---|---|
| GET capabilities | Always available; false flags outside local sandbox |
| GET metadata, oauth-metadata, issuer, status/account-v1 | Enabled sandbox only; public non-person metadata / bulk status |
| POST nonce | Public, bounded, single-use five-minute challenge |
| POST token | Expiring code + PIN; code single-use, five attempts |
| POST credential | One-use scoped access token + ES256 key-possession JWT + fresh nonce |
| POST response | Public standard vp_token/state body; prior holder consent + holder signature mandatory |
| GET credentials | Existing verified Firebase login + existing SPID ownership |
| POST offers, requests, consent, revoke, delete, history/delete | Same existing login/SPID; body cannot select a user |

Discovery paths: `/.well-known/openid-credential-issuer/api/passport-v2` and `/.well-known/oauth-authorization-server/api/passport-v2`. Every new API response is no-store; query parameters rejected. Privacy headers on new page/API, static self-hosted module bundle and restrictive CSP. Main Passport gets only a capabilities-gated entry; all existing authentication/pricing/payment routes preserved. Existing global CORS stays unchanged; arbitrary browser wallet origins are not admitted.

Private browser calls use the current parent Firebase user in a same-origin iframe and recheck account on every operation; token is transient in memory/header. Nonextractable keys live only in IndexedDB. Successful HTTP issuance without successful device key storage triggers revocation. Failing transport never displays success. Scope is account access, not legal identity or any existing service permission.
