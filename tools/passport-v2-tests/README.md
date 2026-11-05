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
