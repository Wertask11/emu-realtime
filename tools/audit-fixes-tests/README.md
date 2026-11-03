# F01–F14 regression checks

Base: latest main `d095a90` (2026-11-03). No production writes.

- `backend/dialogue-socket.test.js`: real Socket.IO server/clients, synthetic identity/booking records; malformed input, anonymous access, forged wallet, cross-booking live/history/replies, completion, expiry, dedup, rate/history/connection limits.
- `backend/dialogue-call.test.js`: real HTTP routes with local records; voice URL required, owner-only call-link repair, existing fields preserved, supplemental text cannot mark attendance.
- `copy.test.cjs`: retired features, pricing/guarantee preservation, Japanese-only language and mobile help.
- `browser.py`: real application/Auth/Firestore on **localhost**; UID switch, research discard/save, browser history, keyboard, profile, membership links and authenticated/unauthenticated chat isolation. No external AI, Stripe charge, token issuance or production operations.

Run:

```sh
node --test backend/dialogue-socket.test.js backend/dialogue-call.test.js tools/audit-fixes-tests/copy.test.cjs tools/unified-navigation-tests/*.test.cjs
# Start existing local Firestore :8787 and Auth :9199 as described in ../unified-navigation-tests/README.md.
node tools/audit-fixes-tests/fixture.cjs
python tools/audit-fixes-tests/browser.py
```

The fixture reuses the `demo-emu-knowledge-lab-unified` namespace without clearing records. Test posts/notes/bookings are local only. Never point the fixture at production; existing project/host guards remain enforced.

For existing application regression flows, run the scripts in `../unified-navigation-tests/` with `UNIFIED_BASE=http://127.0.0.1:4221` and an isolated output directory. Run mutation flows sequentially with the read-only snapshot checks so they do not change each other's comparison data.
