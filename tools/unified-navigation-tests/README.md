# Unified navigation regression

Run from the repository root. No production writes, chain transactions, Stripe checkout, or Gemini generation are involved. The fixture is bound to localhost and fixes its project to `demo-emu-knowledge-lab-unified`. It uses the repository's actual Auth, Firestore Rules, existing APIs and native HTML. Missing optional integrations return 503 instead of fabricated success.

Dependencies: backend dependencies, `tools/quest-tests` Firebase CLI/SDK dependencies, `tools/guild-tests` Playwright dependency, Python Playwright, Java and Chromium (`/usr/bin/chromium` in this workspace). These are existing repository test dependencies; there is no frontend bundler/build step.

If Auth 9199 / Firestore 8787 are not running, start them in a separate terminal:

```sh
node tools/quest-tests/node_modules/firebase-tools/lib/bin/firebase.js emulators:start --only auth,firestore --project demo-emu-knowledge-lab-unified --config tools/unified-navigation-tests/firebase.json
```

Then start the native fixture:

```sh
node tools/unified-navigation-tests/fixture.cjs
```

The fixture installs the **unchanged** current rules only into the localhost demo namespace, retains documents (`reset:false`), and creates seed records only when absent. Existing emulator accounts are reused. Production secrets must not be present: the underlying fixture rejects a Stripe secret. Browser tests abort every non-local request, including analytics.

Run the UI suite and isolated City regression:

```sh
node --test tools/unified-navigation-tests/*.test.cjs
python tools/unified-navigation-tests/first-entry.py
python tools/unified-navigation-tests/browser.py
python tools/unified-navigation-tests/interactions.py
python tools/unified-navigation-tests/compatibility.py
CITY_CHROMIUM_PATH=/usr/bin/chromium node --test tools/guild-tests/city.test.cjs
```

- `first-entry.py`: first City entry stays on City without starting the unrelated Quest guide; captures the four game entries.
- `browser.py`: actual native login; five visible navigation buttons at 375 / 390 / 412 / 768 / 1280 / 1440 / 1920px; matching search/practice card layout; stored posts/wisdom; read-only navigation produces no joins, citations, publications or rewards; no horizontal overflow/page errors.
- `interactions.py`: original game URLs and elevator storage; Passport/profile/Reizo; Knowledge Lab/Text; actual Quest join, three report types, server-created wisdom card and citation. It writes only local test records. Each run creates a new local Quest/citation fixture and retains earlier runs; no cleanup deletes are performed. The approval/chain reward integration stays disabled; existing backend tests exercise its business logic.
- `compatibility.py`: authenticated existing plus billing display (no checkout), new guide registration, old guide retirement, original post form publication and actual keyword search. Each publication uses a distinct title.
- `navigation.test.cjs`: access denial, concurrent opens, account changes and navigation race cancellation.
- `city-entry.test.cjs`: same original game/elevator dispatcher and denial/session handling.

Results/screenshots default to `/workspace/outputs/unified-emu-20261102`; override `UNIFIED_OUTPUT` for another directory. `UNIFIED_BASE` may point to another localhost port only. Optional gift/ranking calls are deliberately unavailable in this fixture and are listed as fixture 503s in the output, separately from tested API failures.

For Knowledge Lab's existing API regression, use a **separate** `demo-emu-knowledge-lab-regression` Auth emulator on 9299 with the existing `LAB_EMULATOR_PROJECT` / `LAB_AUTH_EMULATOR_HOST` settings. That older suite resets its own namespace. As of 2026-11-02, four tests still assume UID-based quota documents; both baseline main `6b0d03c` and this branch produce the same 12 passes / 4 failures after the existing Passport quota transition. Do not change production rights or Rules to make those old assumptions pass.
