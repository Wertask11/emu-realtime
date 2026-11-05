const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const { randomBytes } = require("node:crypto");
// Never use application credentials or another project for infrastructure tests.
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8787";
const admin = require("../../backend/node_modules/firebase-admin");
const app = admin.initializeApp(
  { projectId: "demo-emu-knowledge-lab-passport2" },
  "passport-rc-infra",
);
const db = app.firestore(),
  realm = randomBytes(32).toString("hex");
after(() => app.delete());
test("real emulator shares transaction rate budget and realm-scoped retention deletes only expired records", async () => {
  const { sharedRateLimit } = await import(
    "../../backend/passport-v2/rate-limit.mjs"
  );
  const { firestoreOperations } = await import(
    "../../backend/passport-v2/trust.mjs"
  );
  const cfg = { db, realm, hmacKey: randomBytes(32), limit: 4 };
  const a = sharedRateLimit(cfg),
    b = sharedRateLimit(cfg);
  const result = await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      (i % 2 ? a : b)("synthetic-infrastructure-subject"),
    ),
  );
  assert.equal(result.filter(Boolean).length, 4);
  const col = db.collection("passport_v2_tickets");
  const expired = col.doc(realm + "-expired"),
    live = col.doc(realm + "-live"),
    other = col.doc(realm + "-other-realm");
  await expired.set({ realm, expiresAt: new Date(0) });
  await live.set({ realm, expiresAt: new Date(Date.now() + 3600000) });
  await other.set({ realm: "other", expiresAt: new Date(0) });
  const ops = firestoreOperations(db, { realm });
  assert.equal((await ops.cleanup()).dryRun, true);
  assert.equal((await expired.get()).exists, true);
  await ops.cleanup({ dryRun: false });
  assert.equal((await expired.get()).exists, false);
  assert.equal((await live.get()).exists, true);
  assert.equal((await other.get()).exists, true);
  await live.delete();
  await other.delete();
});
