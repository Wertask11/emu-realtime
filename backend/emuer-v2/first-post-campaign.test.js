"use strict";

/* 初投稿キャンペーン（10/29 オーナーから）。
   初めて知識を公開したら、その場で 100 EMUER を「受け取る前のEMUER」に入れる。公式ショップでそのまま使える。
     ・パスポートごとに1回（同じパスポートの別のアカウントで投稿しても2回目は出ない）
     ・期間は 2026/10/29 0:00 から 11/28 いっぱい（日本時間）
     ・前に投稿したことがある人は対象外。投稿の中身はサーバーで読み直す */
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const ethers = require("ethers");
const { makeFirestore } = require("../fake-firestore");
const { createEmuerV2Router } = require("./router");

const W = ethers.Wallet.createRandom().address.toLowerCase();
const C = ethers.Wallet.createRandom().address.toLowerCase();
const OTHER = ethers.Wallet.createRandom().address.toLowerCase();   // 同じパスポートの別のアカウント（LINE）
const STRANGER = ethers.Wallet.createRandom().address.toLowerCase();
const at = s => Date.parse(s);   // 試験用の Firestore は Date を文字列にするので、日時は数で持つ
const IN_CAMPAIGN = at("2026-10-30T12:00:00+09:00");

async function setup({ posts = {}, passport = "SP-0001", now = IN_CAMPAIGN, uid = "u1", identityOf } = {}) {
  const db = makeFirestore({
    posts,
    ches_accounts: { u2: { walletAddress: OTHER, chesAddress: OTHER } }
  });
  const ids = identityOf || { u1: { walletAddress: W, account: { walletAddress: W, chesAddress: C } },
    u2: { walletAddress: OTHER, account: { walletAddress: OTHER, chesAddress: OTHER } } };
  let who = uid;
  const router = createEmuerV2Router({
    db, signer: ethers.Wallet.createRandom(),
    contract: { hasRole: async () => true, claimPaid: async () => ethers.BigNumber.from(0) },
    env: { EMUER_V2_ENABLED: "true" },
    identity: {
      findByUid: async u => (passport && ["u1", "u2"].includes(u) ? passport : null),
      linkedUidsForUid: async u => (passport ? ["u1", "u2"] : [u])
    },
    requireFirebaseUser: (req, res, next) => { req.identity = { uid: who, ...ids[who] }; next(); },
    requireOwnAddress: (req, res, next) => next()
  }).router;
  const app = express();
  app.use(express.json());
  app.use("/v2", router);
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const realNow = Date.now;
  Date.now = () => now;
  const call = async (postId) => {
    const r = await fetch(base + "/v2/activity/first-post", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ postId }) });
    return { status: r.status, body: await r.json() };
  };
  return {
    db, call, as: u => { who = u; },
    rewards: () => Object.values(db._dump("emuer_v2_rewards")),
    close: () => { Date.now = realNow; server.close(); }
  };
}

test("期間中の初めての投稿で、100 EMUER が「受け取る前のEMUER」に入る。押し直しても1回だけ", async () => {
  const t = await setup({ posts: { p1: { address: W, title: "はじめての知識", createdAt: at("2026-10-30T11:00:00+09:00") } } });
  try {
    const r = await t.call("p1");
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.amount, "100");
    const rows = t.rewards();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, "first-post"); assert.equal(rows[0].status, "pending");
    assert.equal(rows[0].recipient, W); assert.equal(rows[0].amount, "100");
    assert.equal(rows[0].amountWei, (100n * 10n ** 18n).toString());
    assert.equal(rows[0].authorizedUntilMs, undefined, "署名の期限を付けない（すぐ公式ショップで使える）");
    const again = await t.call("p1");
    assert.equal(again.status, 200); assert.equal(again.body.alreadyRecorded, true);
    assert.equal(t.rewards().length, 1);
  } finally { t.close(); }
});

test("CHES の名義（LINE・Google）で書いた投稿でも受け取れる", async () => {
  const t = await setup({ posts: { p1: { address: C, title: "x", createdAt: at("2026-10-30T11:00:00+09:00") } } });
  try {
    assert.equal((await t.call("p1")).status, 200);
    assert.equal(t.rewards()[0].recipient, W);
  } finally { t.close(); }
});

test("パスポートごとに1回。同じパスポートの別のアカウントの投稿では、2回目は出ない", async () => {
  const t = await setup({ posts: {
    p1: { address: W, title: "a", createdAt: at("2026-10-30T11:00:00+09:00") },
    p2: { address: OTHER, title: "b", createdAt: at("2026-10-31T11:00:00+09:00") }
  } });
  try {
    assert.equal((await t.call("p1")).status, 200);
    t.as("u2");
    const r = await t.call("p2");
    assert.equal(r.status, 200); assert.equal(r.body.alreadyRecorded, true);
    assert.equal(t.rewards().length, 1);
  } finally { t.close(); }
});

test("前に投稿したことがある人は対象外（別のアカウントの名義で書いたものも数える）", async () => {
  // 古い投稿にはチェックサム表記（大文字まじり）の名義もある
  for (const before of [W, C, OTHER, ethers.utils.getAddress(W)]) {
    const t = await setup({ posts: {
      old: { address: before, title: "前の", createdAt: at("2026-09-24T10:00:00+09:00") },
      p1: { address: W, title: "a", createdAt: at("2026-10-30T11:00:00+09:00") }
    } });
    try {
      const r = await t.call("p1");
      assert.equal(r.status, 409, before); assert.equal(r.body.error, "NOT_FIRST_POST");
      assert.equal(t.rewards().length, 0);
    } finally { t.close(); }
  }
});

test("期間中に2つ投稿したら、2つ目からの送り直しでは出ない（最初の投稿で受け取る）", async () => {
  const t = await setup({ posts: {
    p1: { address: W, title: "a", createdAt: at("2026-10-30T11:00:00+09:00") },
    p2: { address: W, title: "b", createdAt: at("2026-10-30T11:30:00+09:00") }
  } });
  try {
    assert.equal((await t.call("p2")).body.error, "NOT_FIRST_POST");
    assert.equal((await t.call("p1")).status, 200);
  } finally { t.close(); }
});

test("他の人の投稿・無い投稿・パスポートが無い人・期間の外は受け取れない", async () => {
  const posts = {
    theirs: { address: STRANGER, title: "x", createdAt: at("2026-10-30T11:00:00+09:00") },
    early: { address: W, title: "x", createdAt: at("2026-10-28T23:59:00+09:00") },
    late: { address: W, title: "x", createdAt: at("2026-11-29T00:00:00+09:00") }
  };
  let t = await setup({ posts });
  try {
    assert.equal((await t.call("theirs")).body.error, "FIRST_POST_NOT_VERIFIED");
    assert.equal((await t.call("nothing")).body.error, "POST_NOT_FOUND");
    assert.equal((await t.call("early")).body.error, "OUTSIDE_CAMPAIGN");
    assert.equal((await t.call("../x")).status, 400);
  } finally { t.close(); }
  t = await setup({ posts, now: at("2026-12-05T00:00:00+09:00") });
  try { assert.equal((await t.call("late")).body.error, "CAMPAIGN_NOT_ACTIVE"); } finally { t.close(); }
  t = await setup({ posts, now: at("2026-10-28T20:00:00+09:00") });
  try { assert.equal((await t.call("early")).body.error, "CAMPAIGN_NOT_ACTIVE"); } finally { t.close(); }
  t = await setup({ posts: { p1: { address: W, title: "x", createdAt: IN_CAMPAIGN - 1000 } }, passport: null });
  try { assert.equal((await t.call("p1")).body.error, "PASSPORT_REQUIRED"); } finally { t.close(); }
  assert.equal(t.rewards().length, 0);
});

test("期間の最後の日に投稿して、送り直しが期間の後に届いても受け取れる", async () => {
  const t = await setup({ posts: { p1: { address: W, title: "x", createdAt: at("2026-11-28T23:50:00+09:00") } },
    now: at("2026-11-30T09:00:00+09:00") });
  try { assert.equal((await t.call("p1")).status, 200); } finally { t.close(); }
});
