# Founder Quest #000

## Data and compatibility

- Existing `sp_quests` remains the sole Quest collection. Existing automatic IDs are unchanged.
- `questNumber` is an integer, displayed with a minimum of three digits (`0` → `#000`, `1000` → `#1000`). No numbering from array order or document count.
- `sp_quest_numbers/{number}` permanently reserves a number for one document. `sp_quest_counters/quests` allocates the next number. Both are protected explicitly, including exclusion from the existing catch-all Rules.
- The Quest, number reservation and counter increment must commit in one transaction. Rules validate all three. Concurrent stale-counter permission failures are retried only after a verified counter advance.
- `sp_quests/founder-quest-000` is the only Founder. Admin creates it together with reservation 0, counter 1 and the Founder participation record. Owner is the explicitly supplied SchoolPark passport `0x8ab838ebb2e3bf160bc61b7182d348a8500b35f7`.
- Only #000 has `kind: founder`, `founderSections`, `founderVersion` and `founderHash`. Six full-text sections total about 160 kB. UI renders them as plain text in expandable sections. No HTML from the source is executed.
- Budget `0` JPY, need `1`, `closesAt: null`. Client cannot edit, close, delete, join, withdraw or log activity against #000. It stays outside the ordinary activity list, tasks and completion flow.
- The parent loader separately fetches the fixed Founder ID, so it persists beyond the latest-30 query. Home and Quest list display a distinct permanent banner.
- Both existing issuing forms retain their five limits (120/200/400/400/400), budget, deadline and participant settings. Only persistence gains atomic numbering. Ordinary participation/logging/closing remains unchanged.
- Before activation (counter absent), existing unnumbered issuing behavior is preserved for safe staged rollout. After activation, unnumbered creates are denied; refreshed clients issue #001 onward. Old browser tabs must reload before issuing. No historic Quest is silently renumbered.

## Source

The complete user-supplied source is provided to the seed tool as an external JSON file; it is not committed to this public repository. `source-manifest.json` records its canonical JSON SHA-256 and six section lengths. The author-owned paper was retrieved from https://note.com/paberuuu11/n/nb4417c69b0c6 on 2026-09-10. The seed refuses any file with a different hash. Public tests use explicitly synthetic placeholder text, never the user's life narrative.

## Deploy and activate

1. Run tests below. Deploy the frontend commit via the existing Vercel main integration.
2. Authenticate Firebase CLI using the project's existing authorized operator account. Deploy the reviewed Rules: `npx firebase-tools deploy --only firestore:rules --project emusch-2a111`.
3. In an environment with existing authorized Google Application Default Credentials and backend dependencies (`npm ci --prefix backend`), run `node tools/seed-founder-quest.cjs --apply --source /secure/path/founder-quest-000.json`.
4. The seed script first reads the actual active Rules release and verifies exact content against the reviewed file. If verification fails it makes no writes. Then it atomically creates #000, its one Founder participant and the sequence. Running it again verifies the same source and state without overwriting anything or incrementing the counter.
5. Reload Production, verify exactly one #000, open all six sections at 375px, and verify normal issuing in the emulator (do not create artificial #001 in Production).

No credentials, bootstrap HTTP endpoint or automatic privileged deployment is added. Rules deployment and the actual seed require Firebase access; GitHub/Vercel deployment alone does not publish Firestore Rules or data.

## Tests

```sh
npm ci --prefix tools/quest-tests
tools/quest-tests/node_modules/.bin/firebase emulators:exec --only firestore --project demo-schoolpark-quests 'cd tools/quest-tests && node --test quest.test.cjs'
npm ci --prefix backend
npm test --prefix backend
```

The test preview at `tools/quest-tests/preview.html` uses local fixtures only, with selectable 375/768/1280px iframe widths. It never writes to Production. The original DAO generator already omits some hand-edited current features; the existing deployed DAO was patched directly and its Founder transformation is also included in the generator. Do not regenerate the entire DAO to deploy this patch.
