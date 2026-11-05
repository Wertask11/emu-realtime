# Isolated Passport tests

Run from repository root, Node 24, Python Playwright and `/usr/bin/chromium`. No production credentials or test writes to production. The fixture permits only loopback emulators and `demo-emu-knowledge-lab-passport2`. It reuses the existing actual-application fixture, auth middleware, identity service and Firebase SDK; reset=false preserves existing local emulator records. Never run with a Stripe secret.

```
npm ci --prefix backend --ignore-scripts
node tools/passport-v2-tests/build-wallet.cjs
npm test --prefix backend
node --require ./tools/passport-v2-tests/use-system-chromium.cjs --test tools/emu-tests/*.test.cjs
```

Emulator dependencies are in `tools/quest-tests/package-lock.json`. `npm ci --prefix tools/quest-tests` if missing. Auth 9199 / Firestore 8787 / hub 4405 / logging 4505 must be free; do not stop another task's emulators. Copy `tools/unified-navigation-tests/firebase.json` and `firestore.rules` to a temporary directory, changing the copied config's firestore.rules path from `../../firestore.rules` to `firestore.rules`. This avoids Firebase CLI's project-directory boundary error. Then start:

```
tools/quest-tests/node_modules/.bin/firebase emulators:start --only auth,firestore --project demo-emu-knowledge-lab-passport2 --config /tmp/YOUR_LOCAL_CONFIG/firebase.json
```

If needed configure `FIREBASE_EMULATORS_PATH` to an existing emulator binary cache and `XDG_CONFIG_HOME` to a writable temporary directory. These are local tooling paths, not credentials. In other terminals:

```
node --test tools/passport-v2-tests/rules.test.cjs
node tools/passport-v2-tests/fixture.cjs
python tools/passport-v2-tests/browser.py
```

Fixture: http://127.0.0.1:4240/test/native.html . Use the LOCAL login button; open Passport → certificate development entry. Synthetic users only. The issuer key is ephemeral; restarting the fixture invalidates old sandbox certificates. Retire/delete certificates created by a test rather than clearing user/project data. `PASSPORT_WIDTHS='[375,390]' python ...` selects a subset. The seven-width default pauses 60 seconds after each three widths to respect the real rate limit. Browser denies all non-loopback network and applies the actual new-page CSP in intercepted local responses. It tests issue, deny, approve, signature verification, revoke/delete, return and retained login; screenshots/results go to `/workspace/outputs/passport-v2-20261105`.

Independent OpenWallet Foundation SDK tests live in backend/passport-v2/router.test.mjs. They use synthetic HTTPS metadata routed by the test fetch callback to localhost only; no external wallet or production identity is contacted. Rules tests deny all client access including the legacy catch-all and nested paths. Backend security tests cover replay races, spoofing, consent withdrawal, unknown fields, invalid/expired/revoked proofs, device key loss, key-ring rotation and government mocks.

## Completion-phase tests

The root production gate remains forced off. Never point the fixture or these scripts at production.

```
node --test backend/passport-v2/kms.test.mjs backend/passport-v2/authorization.test.mjs backend/passport-v2/selective.test.mjs
# Synthetic-only, known deserialization gap explicitly acknowledged:
PASSPORT_TEST_PORT=4246 PASSPORT_ZKP_UNAUDITED_TEST_ONLY=true node tools/passport-v2-tests/fixture.cjs
python tools/passport-v2-tests/completion-browser.py
```

The browser script uses 4246, real local Firebase login, SD issuance/denial/approval, three synthetic predicates, all seven widths, same-page CSP and no non-loopback requests. It waits for each proof dialog to close, avoiding a stale success message being mistaken for completion. Outputs are under `/workspace/outputs/passport-completion-20261105`. Measurements are desktop Chromium at 390px with 6x CPU throttling; RSS samples include the full renderer, not just WASM. Physical mobile testing remains required.

`zkp.test.mjs` retains a deliberately failing TODO assertion named `RELEASE BLOCKER: Dock rejects appended proof bytes`. Test runner exits zero with TODO, so **inspect the TODO count, not only the process exit code**. This is not a green security release. The prototype must remain off by default pending upstream review/strict deserialization and external audit. Core tamper/invalid predicates/revocation are tested separately and pass.

`external-wallet.py` requires the actual unmodified walt.id Wallet API2 1.2.1 running on loopback 7280 (Java 21 product or Docker image `waltid/wallet-api2:latest`, pinned digest in report). Use dev-only loopback/auth/persistence settings, not an internet-facing wallet or real users. It creates a synthetic local wallet and P-256 key, receives SD-JWT, resolves an actual VP request, explicitly authorizes consent, presents, then checks replay/revocation rejection. It needs the local fixture at 4246. It never logs the offer code/PIN/token/credential/private key. The product test is pre-authorized issuance, not the separately tested authorization-code flow. A Java product installation was used in this environment; no product source/binary patch was made.

`independent-zkp-verifier.cjs` is a separate process calling the same published Dock library with public inputs only. It demonstrates process/secret separation, not independent implementation or external audit. Live KMS/cloud government/production TLS, formal conformance and physical-wallet UI tests are not simulated as successful.

## Account-proof RC1 (current)

Current scope/readiness: `docs/passport-v2/final-release-readiness.md` and `rc-profile.json`.

- `node tools/passport-v2-tests/run-rc-tests.cjs`: all backend test files except the **entire excluded ZKP experimental feature** (470 pass).
- `node tools/passport-v2-tests/run-rc-tests.cjs --all`: full backend, including the unchanged failing ZKP TODO (475 pass + 1 TODO). Run/report both, never count TODO as pass.
- `node tools/passport-v2-tests/zkp-reproduction.mjs`: synthetic mutation matrix, no credentials/proofs in output.
- `node --test tools/passport-v2-tests/rules.test.cjs tools/passport-v2-tests/rc-infrastructure.test.cjs tools/passport-v2-tests/managed-integration.test.cjs`: actual demo Auth/Firestore emulators; the native fixture must be running to seed synthetic accounts. Managed integration uses a nonextractable test key through the AWS SDK-shaped client, **not AWS**.
- `python tools/passport-v2-tests/rc-browser.py`: SD-JWT flow, keyboard Escape/Tab, seven widths, paced ten open/return cycles, reload/login restoration. No physical phone or screen-reader product is simulated as successful.

The normal build no longer generates or ships `zkp-wallet.js`, and production CSP does not grant WASM evaluation. The RC router rejects every ZKP endpoint before body parsing. To reproduce the **excluded** browser research experiment:

```
PASSPORT_ZKP_BUILD_DIR=/tmp/passport-zkp-research node tools/passport-v2-tests/build-wallet.cjs
PASSPORT_TEST_PORT=4246 PASSPORT_ZKP_UNAUDITED_TEST_ONLY=true PASSPORT_ZKP_BUILD_DIR=/tmp/passport-zkp-research node tools/passport-v2-tests/fixture.cjs
python tools/passport-v2-tests/completion-browser.py
```

Research code is not a release fix. The original TODO still blocks any ZKP release.

Fresh-environment fixture prerequisites: the native fixture serves `/tmp/knowledge-lab-ethers.js` and `/tmp/knowledge-lab-socket.js`. Copy the installed `backend/node_modules/ethers/dist/ethers.umd.min.js` and `backend/node_modules/socket.io-client/dist/socket.io.min.js` to those paths if absent (do not overwrite another task's files). Firebase CLI's emulator cache must be writable; use `FIREBASE_EMULATORS_PATH=/tmp/...` and `XDG_CONFIG_HOME=/tmp/...` if needed. Keep HTTPS verification enabled when downloading the official emulator JAR.

All final logs and images: `/workspace/outputs/passport-rc-20261105/`. Nothing in these scripts deploys Rules, merges main, modifies production users, or creates a real KMS key. Live IAM/KMS, public infrastructure, long-duration soak, real devices, independent audit/legal and government approval remain outside the completed internal RC validation.
