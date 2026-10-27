"use strict";

/**
 * 運営からのギフト（emu-gift.js）のテスト。
 *
 * ここが緩むと、light をただで何度でも受け取れたり、払っている人や運営が渡した
 * 付与を短い体験で上書きしてしまったりする。確かめること:
 *   ・始まる時刻（2026-10-27 0:00 JST）より前は受け取れない
 *   ・見学の人だけが、1人1回、7日だけ受け取れる（連携した別のログインでも2回目は無い）
 *   ・生きている付与（運営・Founding など）や契約・公式パスがある人には渡さない
 *   ・延長はパスポートIDのある人が体験のあとに1回だけ申し込め、運営だけが決められる
 *   ・承認は、いまの体験の終わりから30日。もっと上の付与は下げない
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const { makeFirestore } = require("./fake-firestore");
const { createEntitlement } = require("./entitlement");
const { createEmuGiftRouter, GIFT_STARTS_AT, TRIAL_DAYS, EXTENSION_DAYS } = require("./emu-gift");

const DAY = 24 * 60 * 60 * 1000;
const realNow = Date.now;
// 偽の Firestore は日時を文字列などで返すことがあるので、ミリ秒にそろえて比べる。
const msOf = v => v instanceof Date ? v.getTime() : typeof v === "number" ? v : v && v.toDate ? v.toDate().getTime() : Date.parse(v);

/* 利用者は token の文字列がそのまま uid。"anon:" で始まるとゲスト（匿名）。
   spids: uid → SchoolPark ID。同じ番号の uid どうしは連携している。 */
async function setup({ at = GIFT_STARTS_AT + DAY, spids = {} } = {}) {
  let clock = at;
  Date.now = () => clock;
  const db = makeFirestore();
  const identity = {
    findByUid: async uid => spids[uid] || null,
    linkedUidsForUid: async uid => spids[uid] ? Object.keys(spids).filter(u => spids[u] === spids[uid]) : [uid],
  };
  const entitlement = createEntitlement({ db, identity });
  const requireFirebaseUser = (req, res, next) => {
    const token = String(req.headers.authorization || "").replace(/^Bearer /, "");
    if (!token) return res.status(401).json({ error: "AUTH_REQUIRED" });
    req.identity = { uid: token, walletAddress: "0x" + "0".repeat(40), account: { displayName: "名前 " + token },
      signInProvider: token.startsWith("anon:") ? "anonymous" : "custom" };
    next();
  };
  const requireOwner = (req, res, next) => req.headers["x-test-owner"] === "1"
    ? (req.identity = { uid: "owner" }, next()) : res.status(403).json({ error: "OWNER_ONLY" });
  const rateLimit = () => (req, res, next) => next();
  const app = express();
  app.use(express.json());
  app.use("/gift", createEmuGiftRouter({ db, requireFirebaseUser, requireOwner, entitlement, identity, rateLimit, now: () => Date.now() }));
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, { user, owner } = {}) => {
    const r = await fetch(base + path, { method,
      headers: { "Content-Type": "application/json", ...(user ? { Authorization: `Bearer ${user}` } : {}), ...(owner ? { "x-test-owner": "1" } : {}) },
      body: method === "GET" ? undefined : "{}" });
    return { status: r.status, body: await r.json() };
  };
  const grant = async uid => (await db.collection("entitlements").doc(uid).get()).data();
  const plan = async uid => { entitlement.forget(uid); return (await entitlement.getEntitlement(uid)).plan; };
  const close = () => { server.close(); Date.now = realNow; };
  return { db, call, grant, plan, close, advance: d => { clock += d; } };
}

test("before the start the gift is closed and cannot be claimed", async () => {
  const t = await setup({ at: GIFT_STARTS_AT - 1 });
  try {
    const s = await t.call("GET", "/gift/status", { user: "u1" });
    assert.equal(s.body.open, false); assert.equal(s.body.canClaim, false);
    assert.equal((await t.call("POST", "/gift/claim", { user: "u1" })).body.error, "NOT_STARTED");
    assert.equal(await t.grant("u1"), undefined, "nothing is written");
  } finally { t.close(); }
});

test("a guest claims light for 7 days once; it ends by itself", async () => {
  const t = await setup();
  try {
    assert.equal((await t.call("GET", "/gift/status", { user: "u1" })).body.canClaim, true);
    const r = await t.call("POST", "/gift/claim", { user: "u1" });
    assert.equal(r.status, 200); assert.equal(r.body.plan, "light");
    const g = await t.grant("u1");
    assert.equal(g.plan, "light"); assert.equal(g.source, "gift-trial");
    assert.equal(msOf(g.expiresAt) - msOf(g.startsAt), TRIAL_DAYS * DAY);
    assert.equal(await t.plan("u1"), "light");
    const again = await t.call("POST", "/gift/claim", { user: "u1" });
    assert.equal(again.status, 409); assert.equal(again.body.error, "ALREADY_CLAIMED");
    assert.equal((await t.call("GET", "/gift/status", { user: "u1" })).body.canClaim, false);
    t.advance(TRIAL_DAYS * DAY);
    assert.equal(await t.plan("u1"), "guest", "back to guest after 7 days");
    assert.equal((await t.call("POST", "/gift/claim", { user: "u1" })).body.error, "ALREADY_CLAIMED", "never a second trial");
  } finally { t.close(); }
});

test("another login linked to the same SchoolPark ID cannot claim again", async () => {
  const t = await setup({ spids: { line1: "SP-AAAA-BBBB-CCCC-DDDD", google1: "SP-AAAA-BBBB-CCCC-DDDD" } });
  try {
    assert.equal((await t.call("POST", "/gift/claim", { user: "line1" })).status, 200);
    const r = await t.call("POST", "/gift/claim", { user: "google1" });
    assert.equal(r.status, 409); assert.equal(r.body.error, "ALREADY_CLAIMED");
  } finally { t.close(); }
});

test("members are not given a trial, and a live grant is never overwritten", async () => {
  const t = await setup();
  try {
    await t.db.collection("subscriptions").doc("paid").set({ plan: "light", status: "active" });
    assert.equal((await t.call("GET", "/gift/status", { user: "paid" })).body.canClaim, false);
    assert.equal((await t.call("POST", "/gift/claim", { user: "paid" })).body.error, "ALREADY_MEMBER");
    const owner = { plan: "pro", source: "owner", startsAt: new Date(GIFT_STARTS_AT - DAY) };
    await t.db.collection("entitlements").doc("staff").set(owner);
    assert.equal((await t.call("POST", "/gift/claim", { user: "staff" })).body.error, "ALREADY_MEMBER");
    assert.equal((await t.grant("staff")).source, "owner");
    // 期限の切れた付与（Founding の6か月など）は、もう何も渡していないので体験を受け取れる。
    await t.db.collection("entitlements").doc("old").set({ plan: "light", source: "founding", expiresAt: new Date(GIFT_STARTS_AT - DAY) });
    assert.equal((await t.call("POST", "/gift/claim", { user: "old" })).status, 200);
    assert.equal((await t.call("POST", "/gift/claim", { user: "anon:x" })).body.error, "SIGN_IN_REQUIRED");
  } finally { t.close(); }
});

test("extension: Passport ID and trial first, once, decided only by the owner, +30 days from the trial's end", async () => {
  const SP = "SP-AAAA-BBBB-CCCC-DDDD";
  const t = await setup({ spids: { u1: SP } });
  try {
    assert.equal((await t.call("POST", "/gift/extension", { user: "nopass" })).body.error, "PASSPORT_REQUIRED");
    assert.equal((await t.call("POST", "/gift/extension", { user: "u1" })).body.error, "TRIAL_REQUIRED");
    await t.call("POST", "/gift/claim", { user: "u1" });
    const trialEnds = msOf((await t.grant("u1")).expiresAt);
    t.advance(2 * DAY);
    const r = await t.call("POST", "/gift/extension", { user: "u1" });
    assert.equal(r.status, 200); assert.equal(r.body.schoolParkId, SP, "the server's own ID is sent, never one typed in");
    assert.equal((await t.call("POST", "/gift/extension", { user: "u1" })).body.error, "ALREADY_REQUESTED");
    assert.equal((await t.call("GET", "/gift/admin/requests", { user: "u1" })).status, 403, "people cannot see the list");
    assert.equal((await t.call("POST", `/gift/admin/requests/${SP}/approve`, { user: "u1" })).status, 403, "or approve themselves");
    const list = await t.call("GET", "/gift/admin/requests", { owner: true });
    assert.equal(list.body.rows.length, 1); assert.equal(list.body.rows[0].schoolParkId, SP); assert.equal(list.body.trialsClaimed, 1);
    const ok = await t.call("POST", `/gift/admin/requests/${SP}/approve`, { owner: true });
    assert.equal(ok.status, 200);
    const g = await t.grant("u1");
    assert.equal(g.source, "gift-extension"); assert.equal(msOf(g.expiresAt), trialEnds + EXTENSION_DAYS * DAY);
    assert.equal((await t.call("GET", "/gift/status", { user: "u1" })).body.extensionStatus, "approved");
    assert.equal((await t.call("POST", `/gift/admin/requests/${SP}/approve`, { owner: true })).body.error, "NOT_PENDING", "approved once");
    t.advance(TRIAL_DAYS * DAY);
    assert.equal(await t.plan("u1"), "light", "still light after the trial week");
  } finally { t.close(); }
});

test("approval after the trial ended starts from now; rejection gives nothing; a stronger grant is kept", async () => {
  const t = await setup({ spids: { late: "SP-LATE-0000-0000-0001", no: "SP-NNNN-0000-0000-0002", vip: "SP-VVVV-0000-0000-0003" } });
  try {
    for (const u of ["late", "no", "vip"]) await t.call("POST", "/gift/claim", { user: u });
    t.advance(10 * DAY);
    for (const u of ["late", "no", "vip"]) await t.call("POST", "/gift/extension", { user: u });
    const now = Date.now();
    await t.call("POST", "/gift/admin/requests/SP-LATE-0000-0000-0001/approve", { owner: true });
    assert.equal(msOf((await t.grant("late")).expiresAt), now + EXTENSION_DAYS * DAY);
    await t.call("POST", "/gift/admin/requests/SP-NNNN-0000-0000-0002/reject", { owner: true });
    assert.equal(await t.plan("no"), "guest");
    assert.equal((await t.call("GET", "/gift/status", { user: "no" })).body.extensionStatus, "rejected");
    await t.db.collection("entitlements").doc("vip").set({ plan: "plus", source: "admin", startsAt: new Date(now - DAY) });
    const kept = await t.call("POST", "/gift/admin/requests/SP-VVVV-0000-0000-0003/approve", { owner: true });
    assert.equal(kept.body.keptStronger, true);
    assert.equal((await t.grant("vip")).plan, "plus", "never lowered to light");
    assert.equal((await t.call("POST", "/gift/admin/requests/x/maybe", { owner: true })).status, 400);
  } finally { t.close(); }
});
