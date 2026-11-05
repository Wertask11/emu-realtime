# Dock proof encoding: isolated research finding

No issue or message has been submitted upstream. This is a reviewable reproduction package, not a claim of a disclosed upstream security advisory or credential forgery.

## Reproduce

From the repository root after backend dependencies are installed:

```
node tools/passport-v2-tests/zkp-reproduction.mjs
node --test backend/passport-v2/zkp.test.mjs
```

Both use synthetic qualifications only. Output contains the byte length and acceptance booleans, never a private key, holder attributes, full credential or proof. The original failing TODO assertion remains unchanged from PR #272 at `737086c`.

Observed with crypto-wasm-ts 0.67.0 / WASM 0.33.0, 2026-11-05:

| Mutation | Accepted |
|---|---|
| Original | yes |
| Append 0, append nonzero bytes, append 32 bytes | yes |
| Truncate one byte | yes |
| Flip last bit | yes |
| Truncate 16 bytes, prefix zero, flip midpoint bit | no |
| Whitespace, invalid base58 character, empty encoding | no |

The raw presentation bytes are changed using the published `Presentation` / `CompositeProof` wrapper; the original trusted key, nonce, audience, signed constraints and accumulator are retained. Predicate, signature-core, audience and revocation negative tests remain separate and passing. Acceptance can vary by mutation location/serialization; these observations are not an exhaustive soundness proof.

## Upstream and alternatives reviewed

- Registry latest reported `@docknetwork/crypto-wasm` **0.35.0**. It was not blindly substituted for the TS library's pinned 0.33.0 backend.
- [Current upstream deserialize macro](https://github.com/docknetwork/crypto-wasm/blob/master/src/utils.rs): `CanonicalDeserialize::deserialize_compressed(&serz[..])`. The binding shown does not assert complete input consumption or export a strict canonical roundtrip. The current source and commit history were examined; a verified fix for this application profile was not established. Latest source review is not a binary test of 0.35.0.
- A bounded search of upstream issue titles/bodies found no identified fix. This does not prove no issue exists.
- AnonCreds was reviewed as an alternative predicate/anonymous-credential family ([source](https://github.com/anoncreds/anoncreds-rs)). Migrating requires a different schema, revocation/witness and Wallet profile plus mobile and independent security review. It was not installed or represented as interoperable.
- W3C BBS selective-disclosure suites alone do not supply the required signed age range predicate. SD-JWT can minimize attributes, but is not a ZKP and is linkable.

A Rust boundary using the **existing library's** canonical deserializer, a cursor with zero remainder, and canonical reserialization could address excess input; it also needs validation of unused/optional fields, bounds and all proof components. Implementing an unreviewed JS binary parser, suffix trimming, a guessed fixed length, or a hash of a noncanonical proof is not a safe substitute. No such workaround was shipped.

## Containment

RC rejects **all** `/zkp/*` requests before parsing/authentication and advertises no ZKP format. This includes trailing data, length modifications, truncation, whitespace/noncanonical strings and arbitrary JSON. Unsupported ZKP cannot enter through normal credential format negotiation or the fixed DCQL account response. The RC browser directory contains no Dock WASM bundle; its CSP does not grant WASM evaluation.

Research code remains in backend/tools, gated by local demo emulators plus `PASSPORT_ZKP_UNAUDITED_TEST_ONLY=true`. To build research assets separately, set `PASSPORT_ZKP_BUILD_DIR` to a `/tmp/...` directory for the build and local fixture. No production route serves those assets. The failing TODO remains a blocker for any future ZKP release, regardless of the non-ZKP RC result.
