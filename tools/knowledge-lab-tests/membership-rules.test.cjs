"use strict";
const { test, before, after } = require("node:test");
const fs = require("node:fs");
const { initializeTestEnvironment, assertFails, assertSucceeds } = require("../quest-tests/node_modules/@firebase/rules-unit-testing");
const fb = require("../quest-tests/node_modules/firebase/firestore");
const assert = require("node:assert/strict");
let env;
const spid = "SP-MEMBER-TEST", aa = "0x1111111111111111111111111111111111111111", ba = "0x2222222222222222222222222222222222222222";
const key = () => { const d = new Date(Date.now() + 9 * 3600000); return spid + "_r_m" + d.getUTCFullYear() + "-" + (d.getUTCMonth() + 1); };
before(async () => {
  // Only move the policy date in this isolated Rules test to exercise the future
  // branch with emulator server time. The release file keeps November 1 intact.
  const rules = fs.readFileSync("firestore.rules", "utf8").replaceAll("timestamp.date(2026, 11, 1)", "timestamp.date(2026, 10, 1)");
  env = await initializeTestEnvironment({ projectId: "demo-emu-membership-rules", firestore: { host: "127.0.0.1", port: 8787, rules } });
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async c => {
    const db = c.firestore();
    for (const [uid, address] of [["original", aa], ["linked", ba]])
      await fb.setDoc(fb.doc(db, "ches_verified_accounts", uid), { walletAddress: address, chesAddress: address, spid });
    await fb.setDoc(fb.doc(db, "ches_verified_accounts", "free"), { walletAddress: aa, chesAddress: aa });
    await fb.setDoc(fb.doc(db, "sp_identities", spid), { membershipSources: { grantUid: "original", subscriptionUid: "original" } });
    await fb.setDoc(fb.doc(db, "entitlements", "original"), { plan: "light" });
    await fb.setDoc(fb.doc(db, "plan_usage", key()), { post: 0, transitionCredits: { post: 2 }, migratedUids: ["original", "linked"] });
  });
});
after(async () => { await env?.cleanup(); });
async function post(uid, id, address, used) {
  const db = env.authenticatedContext(uid).firestore(), batch = fb.writeBatch(db);
  batch.update(fb.doc(db, "plan_usage", key()), { post: used });
  batch.set(fb.doc(db, "posts", id), { address, title: "LOCAL RULES", body: "ローカルテストのみ", createdAt: new Date(), goodUsers: [], changeUsers: [], goodCount: 0, changeCount: 0 });
  return batch.commit();
}
test("linked Passport can use live original grant and the same canonical post counter", async () => {
  await assertSucceeds(post("original", "one", aa, 1));
  await assertSucceeds(post("linked", "two", ba, 2));
  for (let i = 3; i <= 7; i++) await assertSucceeds(post("linked", "post-" + i, ba, i));
  await assertFails(post("original", "eighth", aa, 8));
});
test("client cannot forge linked entitlement pointers, migration markers or carry credits", async () => {
  const db = env.authenticatedContext("linked").firestore();
  await assertFails(fb.updateDoc(fb.doc(db, "sp_identities", spid), { membershipSources: { grantUid: "victim" } }));
  await assertFails(fb.updateDoc(fb.doc(db, "plan_usage", key()), { transitionCredits: { post: 9000 } }));
  await assertFails(fb.updateDoc(fb.doc(db, "plan_usage", key()), { migratedUids: [] }));
  await assertFails(fb.setDoc(fb.doc(db, "plan_counts", spid), { drafts: 0, migratedUids: ["original"] }));
  await assertFails(fb.setDoc(fb.doc(db, "plan_counts", spid), { drafts: 1 }));
});
test("old per-login counters and other Passport counters cannot bypass the shared counter", async () => {
  const db = env.authenticatedContext("linked").firestore();
  await assertFails(fb.setDoc(fb.doc(db, "plan_usage", key().replace(spid, "linked")), { post: 1 }));
  await assertFails(fb.setDoc(fb.doc(db, "plan_counts", "someone-else"), { drafts: 1 }));
});
test("free user can keep one draft; a second is denied while editing remains allowed", async () => {
  const db = env.authenticatedContext("free").firestore();
  let batch = fb.writeBatch(db);
  batch.set(fb.doc(db, "plan_counts", "free"), { drafts: 1 });
  batch.set(fb.doc(db, "knowledge_drafts", "first"), { owner: aa, title: "一件目" });
  await assertSucceeds(batch.commit());
  batch = fb.writeBatch(db);
  batch.update(fb.doc(db, "plan_counts", "free"), { drafts: 2 });
  batch.set(fb.doc(db, "knowledge_drafts", "second"), { owner: aa, title: "二件目" });
  await assertFails(batch.commit());
  await assertSucceeds(fb.updateDoc(fb.doc(db, "knowledge_drafts", "first"), { title: "編集" }));
});
test("revoked grant is read live instead of trusting a stale copied rank", async () => {
  await env.withSecurityRulesDisabled(async c => { await fb.deleteDoc(fb.doc(c.firestore(), "entitlements", "original")); });
  await assertFails(post("linked", "revoked", ba, 8));
  assert.ok(fs.readFileSync("firestore.rules", "utf8").includes("timestamp.date(2026, 11, 1)"));
});
