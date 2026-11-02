"use strict";
/* 投稿の記録（post-audit.js、11/2 オーナーから）。
   覚えの無い投稿を調べたとき、どの端末から書いたかが分からなかった。投稿・書き直しのときに、
   端末の種類・OS・ブラウザ・ログインの方法とその時刻・時刻を残し、運営だけが見られるようにする。
   IP・位置・本文は残さない。本人の名義の投稿だけを受ける。 */
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { makeFirestore } = require("./fake-firestore");
const { createPostAuditRouter, describeDevice } = require("./post-audit");

const ME = "0x" + "a".repeat(40), CHES = "0x" + "c".repeat(40), OTHER = "0x" + "b".repeat(40), OWNER = "0x" + "d".repeat(40);
const IPHONE_LINE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.17.0";
const PC_CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

async function setup() {
  const db = makeFirestore({ posts: {
    p1: { address: CHES, title: "日本だよね？", body: "本文は残さない", createdAt: Date.parse("2026-11-01T09:04:16Z") },
    p2: { address: OTHER, title: "ほかの人" }
  } });
  let who = { uid: "line:U1", walletAddress: ME, account: { walletAddress: ME, chesAddress: CHES }, signInProvider: "custom", loginMethod: "line", authTimeMs: Date.parse("2026-10-20T00:00:00Z") };
  const app = express();
  app.use(express.json());
  app.use("/api/post-audit", createPostAuditRouter({
    db, now: () => Date.parse("2026-11-01T09:04:18Z"),
    requireFirebaseUser: (req, res, next) => { req.identity = who; next(); },
    requireOwner: (req, res, next) => (who.walletAddress === OWNER ? next() : res.status(403).json({ error: "OWNER_ONLY" }))
  }).router);
  const server = await new Promise(r => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  const base = "http://127.0.0.1:" + server.address().port + "/api/post-audit";
  const post = (body, ua) => fetch(base, { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": ua || IPHONE_LINE }, body: JSON.stringify(body) }).then(async r => ({ status: r.status, body: await r.json() }));
  const admin = q => fetch(base + "/admin" + q).then(async r => ({ status: r.status, body: await r.json() }));
  return { db, post, admin, as: v => { who = v; }, close: () => server.close() };
}

test("投稿したら、端末の種類・ブラウザ・ログインの方法と時刻を残す（本文・IP は残さない）", async () => {
  const t = await setup();
  try {
    assert.equal((await t.post({ postId: "p1" })).status, 200);
    const rows = Object.values(t.db._dump("emu_post_audit"));
    assert.equal(rows.length, 1);
    const r = rows[0];
    assert.equal(r.postId, "p1"); assert.equal(r.kind, "create"); assert.equal(r.address, CHES); assert.equal(r.uid, "line:U1");
    assert.deepEqual(r.device, { type: "スマホ", os: "iPhone (iOS)", browser: "LINE のアプリ内ブラウザ" });
    assert.equal(r.signInProvider, "line");
    assert.equal(r.authTimeMs, Date.parse("2026-10-20T00:00:00Z"), "いつログインしたか（直前に新しくログインしたかが分かる）");
    assert.equal(r.postCreatedAtMs, Date.parse("2026-11-01T09:04:16Z"));
    assert.equal(r.recordedAtMs, Date.parse("2026-11-01T09:04:18Z"));
    assert.ok(r.expireAt, "1年で消してよい印");
    assert.equal("body" in r || JSON.stringify(r).includes("本文は残さない"), false, "本文は残さない");
    assert.equal(JSON.stringify(r).match(/\b\d{1,3}(\.\d{1,3}){3}\b/), null, "IP は残さない");
    // 同じ投稿の2回目は増やさない（最初のものを残す）
    assert.equal((await t.post({ postId: "p1" }, PC_CHROME)).body.already, true);
    assert.equal(Object.keys(t.db._dump("emu_post_audit")).length, 1);
    // 書き直しは、そのたびに残す
    assert.equal((await t.post({ postId: "p1", kind: "edit" }, PC_CHROME)).status, 200);
    assert.equal(Object.keys(t.db._dump("emu_post_audit")).length, 2);
  } finally { t.close(); }
});

test("ほかの人の投稿・無い投稿・おかしな ID は受けない", async () => {
  const t = await setup();
  try {
    assert.equal((await t.post({ postId: "p2" })).status, 403);
    assert.equal((await t.post({ postId: "nothing" })).status, 404);
    assert.equal((await t.post({ postId: "../x" })).status, 400);
    assert.equal(Object.keys(t.db._dump("emu_post_audit")).length, 0);
  } finally { t.close(); }
});

test("見られるのは運営だけ。投稿ID・名義で引ける", async () => {
  const t = await setup();
  try {
    await t.post({ postId: "p1" });
    assert.equal((await t.admin("?postId=p1")).status, 403, "本人でも運営でなければ見られない");
    t.as({ uid: "wallet:owner", walletAddress: OWNER, account: { walletAddress: OWNER } });
    const byPost = await t.admin("?postId=p1");
    assert.equal(byPost.status, 200);
    assert.equal(byPost.body.records[0].signIn, "LINE");
    assert.equal(byPost.body.records[0].device.type, "スマホ");
    assert.equal((await t.admin("?address=" + CHES)).body.records.length, 1);
    assert.equal((await t.admin("?address=" + OTHER)).body.records.length, 0);
    assert.equal((await t.admin("?address=bad")).status, 400);
  } finally { t.close(); }
});

test("端末の読み取り", () => {
  assert.deepEqual(describeDevice(PC_CHROME), { type: "パソコン", os: "Windows", browser: "Chrome" });
  assert.deepEqual(describeDevice("Mozilla/5.0 (Linux; Android 14; SH-M26) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36"), { type: "スマホ", os: "Android", browser: "Chrome" });
  assert.deepEqual(describeDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"), { type: "パソコン", os: "Mac", browser: "Safari" });
  assert.deepEqual(describeDevice(""), { type: "不明", os: "不明", browser: "不明" });
});

/* 投稿を消す（11/2 オーナーから）。本人は自分の投稿、運営はどの投稿でも。消した記録を残す */
const { createPostDeleteRouter } = require("./post-audit");
async function setupDelete() {
  const db = makeFirestore({ posts: {
    mine: { address: CHES, title: "日本だよね？", body: "本文", createdAt: Date.parse("2026-11-01T09:04:16Z"), goodCount: 0 },
    theirs: { address: OTHER, title: "ほかの人", body: "x", goodCount: 2 },
    lab: { address: ME, title: "ラボ", knowledgeLab: true }
  } });
  let who = { uid: "line:U1", walletAddress: ME, account: { walletAddress: ME, chesAddress: CHES }, loginMethod: "line", authTimeMs: 1 };
  const app = express();
  app.use(express.json());
  app.use("/api/posts", createPostDeleteRouter({
    db, now: () => Date.parse("2026-11-02T01:00:00Z"),
    requireFirebaseUser: (req, res, next) => { req.identity = who; next(); },
    isOwner: identity => identity.walletAddress === OWNER
  }).router);
  const server = await new Promise(r => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  const del = (id, body) => fetch("http://127.0.0.1:" + server.address().port + "/api/posts/" + id + "/delete",
    { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": IPHONE_LINE }, body: JSON.stringify(body || {}) }).then(async r => ({ status: r.status, body: await r.json() }));
  return { db, del, as: v => { who = v; }, close: () => server.close() };
}

test("本人は自分の投稿を消せる（CHES の名義の投稿も）。消した記録が残る（本文は残さない）", async () => {
  const t = await setupDelete();
  try {
    const r = await t.del("mine");
    assert.equal(r.status, 200); assert.equal(r.body.by, "author");
    assert.equal(t.db._dump("posts").mine, undefined, "消えた");
    const rec = Object.values(t.db._dump("emu_post_audit"));
    assert.equal(rec.length, 1);
    assert.equal(rec[0].kind, "delete"); assert.equal(rec[0].by, "author"); assert.equal(rec[0].title, "日本だよね？");
    assert.equal(rec[0].device.type, "スマホ"); assert.equal(rec[0].signInProvider, "line");
    assert.equal(JSON.stringify(rec[0]).includes("本文"), false);
    // もう無いものは「消えている」とだけ返す
    assert.equal((await t.del("mine")).body.already, true);
  } finally { t.close(); }
});

test("ほかの人の投稿・知識ラボの投稿は、本人としては消せない", async () => {
  const t = await setupDelete();
  try {
    assert.equal((await t.del("theirs")).status, 403);
    assert.equal((await t.del("lab")).status, 403);
    assert.equal((await t.del("bad%20id")).status, 400, "おかしな ID");
    assert.ok(t.db._dump("posts").theirs && t.db._dump("posts").lab, "残っている");
    assert.equal(Object.keys(t.db._dump("emu_post_audit")).length, 0);
  } finally { t.close(); }
});

test("運営はどの投稿でも消せる。理由を残す", async () => {
  const t = await setupDelete();
  try {
    t.as({ uid: "wallet:owner", walletAddress: OWNER, account: { walletAddress: OWNER } });
    const r = await t.del("theirs", { reason: "不適切な内容" });
    assert.equal(r.status, 200); assert.equal(r.body.by, "owner");
    assert.equal(t.db._dump("posts").theirs, undefined);
    const rec = Object.values(t.db._dump("emu_post_audit"))[0];
    assert.equal(rec.by, "owner"); assert.equal(rec.reason, "不適切な内容"); assert.equal(rec.goodCount, 2); assert.equal(rec.address, OTHER);
    assert.equal((await t.del("lab")).status, 200, "運営は知識ラボの投稿も消せる");
  } finally { t.close(); }
});
