"use strict";
// Synthetic local project only. Does not reset genuine Gemini receipts/counters.
process.env.LAB_EMULATOR_PROJECT = "demo-emu-knowledge-lab-membership";
process.env.LAB_AUTH_EMULATOR_HOST = "127.0.0.1:9399";
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { createFixture } = require("./fixture.cjs");
const { createService } = require("../../backend/knowledge-lab/service");
const { linkIdFor } = require("../../backend/identity");
const policy = require("../../backend/membership-policy");
const express = require("../../backend/node_modules/express");
let f, service, alice, bob, guest, ids;
let clock = Date.parse("2026-11-02T03:00:00Z");
const realNow = Date.now;
/* 時計を決めた時刻に止める。ただし Firestore の通信（grpc・gax）には本物の時刻を返す。
   @grpc/grpc-js 1.14.6 から、締切の計算に Date.now を使うようになり、止めた時計が
   本物より先（11月）だと、どの読み書きも「締切切れ 0.000s」で落ちていた。 */
const COMM = /[\\/]node_modules[\\/](?:@grpc|google-gax|@google-cloud)[\\/]/;
function fakeNow() { return COMM.test(new Error().stack || "") ? realNow() : clock; }
async function at(time, fn) { const prev = clock; clock = time; Date.now = fakeNow; try { return await fn(); } finally { Date.now = realNow; clock = prev; } }
async function plan(a, value) { await f.db.collection("entitlements").doc(a.uid).set({ plan: value, source: "local-only" }); f.entitlement.forget(a.uid); }
const actor = role => ({ ...f.users[role], owner: role === "owner", walletAddress: f.users[role].account.walletAddress.toLowerCase() });
before(async () => {
  f = await createFixture(); alice = actor("alice"); bob = actor("bob"); guest = actor("guest");
  service = createService({ db: f.db, identity: f.identity, entitlement: f.entitlement, isOwner: a => !!a.owner, now: () => clock });
  ids = [];
  for (const [key, field] of [["source-a", "field-education"], ["source-b", "field-life"]])
    ids.push((await service.savePost(alice, { key, title: key, body: "LOCAL ONLY: 機能枠と本人性のテストです。", visibility: "public", facets: { field: [field] } })).id);
});
after(async () => { Date.now = realNow; await f?.close(); });
function note(a, key, extra = {}) {
  return service.saveNote(a, { key, title: "LOCAL機能枠", fields: ["field-education", "field-life"], sourceIds: ids, visibility: "private", ...extra });
}
test("free member gets one private draft without permission to publish; edits preserve the slot", async () => {
  await at(clock, async () => {
    const a = await service.savePost(guest, { key: "free-draft", title: "下書き", body: "LOCAL ONLY", visibility: "private", facets: {} });
    await assert.rejects(service.savePost(guest, { key: "second-draft", title: "二件目", body: "LOCAL ONLY", visibility: "private", facets: {} }), /LIBRARY_FULL/);
    await service.savePost(guest, { key: "edit-draft", id: a.id, revision: 1, title: "編集", body: "LOCAL ONLY", visibility: "private", facets: {} });
    await assert.rejects(service.savePost(guest, { key: "publish-draft", id: a.id, revision: 2, title: "公開", body: "LOCAL ONLY", visibility: "public", facets: {} }), /PLAN_LIMIT_REACHED/);
    assert.equal((await service.storageUsage(guest)).used.drafts, 1);
  });
});
test("new note caps apply transactionally; over-cap old notes retain editing/history/archive/restore", async () => {
  await at(clock, async () => {
    await service.ref("limits", guest.spid).set({ notes: 2 }, { merge: true });
    const results = await Promise.allSettled([note(guest, "last-a"), note(guest, "last-b")]);
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    assert.match(results.find(r => r.status === "rejected").reason.message, /NOTE_LIMIT/);
    const n = results.find(r => r.status === "fulfilled").value;
    await service.ref("limits", guest.spid).set({ notes: 99 }, { merge: true });
    await note(guest, "edit-existing", { id: n.id, revision: 1, question: "保持枠を超えても編集する" });
    await service.archiveNote(guest, n.id, 2);
    await service.restoreNote(guest, n.id, 3);
    assert.equal((await service.note(n.id, guest)).archived, false);
    assert.ok((await service.noteHistory(guest, n.id, {})).items.length >= 1);
    await assert.rejects(note(guest, "over-cap"), /NOTE_LIMIT/);
  });
});
test("bookmarks at cap can be re-saved or removed without deleting existing data", async () => {
  await at(clock, async () => {
    await service.ref("limits", guest.spid).set({ saved: 9 }, { merge: true });
    await service.saveBookmark(guest, ids[0], true);
    await service.saveBookmark(guest, ids[0], true);
    await assert.rejects(service.saveBookmark(guest, ids[1], true), /SAVED_LIMIT/);
    await service.saveBookmark(guest, ids[0], false);
    await service.saveBookmark(guest, ids[1], true);
    assert.equal((await service.storageUsage(guest)).used.saved, 10);
  });
});
test("limits are not reduced before November; downgrade keeps owned notes", async () => {
  await at(policy.EFFECTIVE_AT - 1, async () => {
    await service.ref("limits", guest.spid).set({ saved: 99 }, { merge: true });
    await service.saveBookmark(guest, ids[0], true);
    assert.equal((await service.storageUsage(guest)).limits.saved, 1000);
  });
});
async function link(uid, spid) {
  const canonical = await f.identity.readIdentity(spid);
  const links = [...canonical.links.filter(l => l.subject !== uid), { kind: "fb", subject: uid, linkId: linkIdFor("fb", uid) }];
  await f.db.collection("sp_auth_links").doc(linkIdFor("fb", uid)).set({ kind: "fb", subject: uid, spid });
  await f.db.collection("sp_identities").doc(spid).set({ links }, { merge: true });
  await f.db.collection("ches_verified_accounts").doc(uid).set({ spid }, { merge: true });
  f.entitlement.forget(uid);
}
test("reciprocal Passport binding shares subscription; forged editable SPID and one-way links do not", async () => {
  await f.db.collection("subscriptions").doc(alice.uid).set({ plan: "pro", status: "active", currentPeriodEnd: new Date("2026-12-01T00:00:00Z") });
  await f.db.collection("ches_accounts").doc(bob.uid).set({ spid: alice.spid }, { merge: true });
  f.entitlement.forget(bob.uid);
  assert.equal((await f.entitlement.getEntitlement(bob.uid)).plan, "plus");
  await link(guest.uid, alice.spid);
  const ent = await f.entitlement.getEntitlement(guest.uid);
  assert.equal(ent.plan, "pro"); assert.equal(ent.schoolParkId, alice.spid);
  const rec = await f.identity.readIdentity(alice.spid);
  assert.equal(rec.membershipSources.subscriptionUid, alice.uid);
  await f.db.collection("sp_auth_links").doc(linkIdFor("fb", guest.uid)).set({ spid: guest.spid }, { merge: true });
  f.entitlement.forget(guest.uid);
  assert.equal((await f.entitlement.getEntitlement(guest.uid)).plan, "guest");
});
test("November migration is retry-safe and login changes share monthly and retained counters", async () => {
  await at(clock, async () => {
    await link(guest.uid, alice.spid);
    await f.db.collection("subscriptions").doc(alice.uid).set({ plan: "light", status: "active", currentPeriodEnd: new Date("2026-11-15T00:00:00Z") });
    await plan(alice, "light");
    await f.db.collection("plan_usage").doc(alice.uid + "_p2026-10-15").set({ post: 3 });
    await f.db.collection("plan_counts").doc(alice.uid).set({ drafts: 7 });
    f.entitlement.forget(alice.uid);
    const ent = await f.entitlement.getEntitlement(alice.uid);
    const shared = f.db.collection("plan_usage").doc(alice.spid + "_r_m2026-11");
    assert.equal((await shared.get()).data().transitionCredits.post, 2);
    const initial = (await f.db.collection("plan_counts").doc(alice.spid).get()).data().drafts;
    assert.ok(initial >= 7);
    f.entitlement.forget(guest.uid);
    await f.entitlement.getEntitlement(guest.uid);
    assert.equal((await f.db.collection("plan_counts").doc(alice.spid).get()).data().drafts, initial);
    const a = await f.entitlement.consume(alice.uid, "post");
    const g = await f.entitlement.consume(guest.uid, "post");
    assert.equal(a.used + 1, g.used); assert.equal(g.limit, 7);
    assert.equal((await f.entitlement.usageWindow(guest.uid)).key, "m2026-11");
    clock = Date.parse("2026-11-30T14:59:59.999Z");
    f.entitlement.forget(alice.uid);
    await f.entitlement.getEntitlement(alice.uid);
    clock += 2; // Cached qualification must not skip December's initialization.
    const december = await f.entitlement.consume(alice.uid, "post");
    assert.equal(december.used, 1);
    assert.equal(december.limit, 5, "November carry is never granted twice");
    assert.equal((await f.entitlement.usageWindow(alice.uid)).key, "m2026-12");
  });
});
test("checkout refuses already entitled users before any Stripe creation; linked billing remains on original owner", async () => {
  Date.now = realNow;
  process.env.STRIPE_PRICE_LIGHT = "price_local_light"; process.env.STRIPE_PRICE_PLUS = "price_local_plus"; process.env.STRIPE_PRICE_PRO = "price_local_pro";
  const calls = [];
  const stripeClient = { customers: { create: async () => { calls.push("customer"); return { id: "cus_local" }; } },
    checkout: { sessions: { create: async () => { calls.push("checkout"); return { url: "https://checkout.stripe.com/local-test" }; } } },
    subscriptions: { retrieve: async () => ({ status: "active", metadata: { plan: "light" }, current_period_end: 1794700800 }) } };
  const billing = require("../../backend/billing").createBillingRouter({ db: f.db, identity: f.identity, entitlement: f.entitlement, stripeClient,
    requireFirebaseUser: f.middleware.requireFirebaseUser, requireOwner: f.middleware.requireOwner, rateLimit: f.middleware.rateLimit });
  f.app.use("/test/billing", express.json(), billing.router);
  await f.db.collection("subscriptions").doc(alice.uid).set({ status: "canceled", plan: "light" });
  await f.db.collection("subscriptions").doc(guest.uid).delete();
  f.entitlement.forget(alice.uid);
  const r = await fetch(f.base + "/test/billing/checkout", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + f.users.guest.token }, body: JSON.stringify({ plan: "light" }) });
  assert.equal(r.status, 409); assert.equal((await r.json()).error, "ALREADY_ENTITLED"); assert.deepEqual(calls, []);
});
