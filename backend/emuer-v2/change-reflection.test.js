"use strict";

/* 改善案を「反映した」ときの報酬（11/11 点検）。
   前は改善案の記録1件ごとに 1 EMUER を作っていた。記録は何件でも作れ、最初から
   「採用済み・反映済み」の形でも作れたので、投稿者と組めば（同じ人の2つのアカウントでも）
   報酬を何件でも作れた。
     ・出すのは、その投稿に実際に改善案を送った人（投稿の changeUsers に入っている人）だけ
     ・投稿1件 × 提案した人1人 につき1回
     ・自分の別の名義からの提案には出さない
     ・投稿の名義は、ウォレットでもアプリが作ったアドレスでも本人 */
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const ethers = require("ethers");
const { makeFirestore } = require("../fake-firestore");
const { createEmuerV2Router } = require("./router");

const AUTHOR = ethers.Wallet.createRandom().address.toLowerCase();
const AUTHOR_CHES = ethers.Wallet.createRandom().address.toLowerCase();
const HELPER = ethers.Wallet.createRandom().address.toLowerCase();
const OUTSIDER = ethers.Wallet.createRandom().address.toLowerCase();
const NOW = Date.parse("2026-11-11T12:00:00+09:00");
const change = (postId, from, extra) => ({ postId, fromAddress: from, status: "accepted", reflectedBy: AUTHOR, reflectedAt: NOW, ...(extra || {}) });

async function setup(seed) {
  const db = makeFirestore(seed);
  let who = "author";
  const ids = { author: { walletAddress: AUTHOR, account: { walletAddress: AUTHOR, chesAddress: AUTHOR_CHES } },
    helper: { walletAddress: HELPER, account: { walletAddress: HELPER, chesAddress: HELPER } } };
  const router = createEmuerV2Router({
    db, signer: ethers.Wallet.createRandom(),
    contract: { hasRole: async () => true, claimPaid: async () => ethers.BigNumber.from(0) },
    env: { EMUER_V2_ENABLED: "true" },
    identity: { findByUid: async () => null, linkedUidsForUid: async u => [u] },
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
  Date.now = () => NOW;
  return {
    db, as: u => { who = u; },
    call: async (postId, changeId) => {
      const r = await fetch(base + "/v2/activity/change-reflection", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ postId, changeId }) });
      return { status: r.status, body: await r.json() };
    },
    rewards: () => Object.values(db._dump("emuer_v2_rewards")),
    close: () => { Date.now = realNow; server.close(); }
  };
}

test("実際に改善案を送った人の提案を反映したら、その人に 1 EMUER。開き直して何度呼んでも増えない", async () => {
  const s = await setup({
    posts: { p1: { address: AUTHOR, title: "朝の音読", changeUsers: [HELPER] } },
    post_changes: { c1: change("p1", HELPER) }
  });
  try {
    const first = await s.call("p1", "c1");
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(s.rewards().length, 1);
    assert.equal(s.rewards()[0].recipient, HELPER);
    assert.equal(s.rewards()[0].amount, "1");
    assert.equal(s.rewards()[0].kind, "change-reflected");
    assert.equal((await s.call("p1", "c1")).status, 200);
    assert.equal(s.rewards().length, 1);
  } finally { s.close(); }
});

test("改善案の記録を何件作っても、投稿1件につき1人1回だけ", async () => {
  const s = await setup({
    posts: { p1: { address: AUTHOR, title: "t", changeUsers: [HELPER] }, p2: { address: AUTHOR, title: "t2", changeUsers: [HELPER] } },
    post_changes: { c1: change("p1", HELPER), c2: change("p1", HELPER), c3: change("p1", HELPER), d1: change("p2", HELPER) }
  });
  try {
    for (const id of ["c1", "c2", "c3", "c1"]) assert.equal((await s.call("p1", id)).status, 200);
    assert.equal(s.rewards().length, 1, "同じ投稿・同じ人には1回だけ");
    assert.equal((await s.call("p2", "d1")).status, 200);
    assert.equal(s.rewards().length, 2, "別の投稿は別に数える");
  } finally { s.close(); }
});

test("改善案を送っていない人（changeUsers に居ない人）の記録には出さない", async () => {
  const s = await setup({
    posts: { p1: { address: AUTHOR, title: "t", changeUsers: [] } },
    post_changes: { c1: change("p1", OUTSIDER) }
  });
  try {
    const out = await s.call("p1", "c1");
    assert.equal(out.status, 409);
    assert.equal(out.body.error, "REFLECTION_NOT_VERIFIED");
    assert.equal(s.rewards().length, 0);
  } finally { s.close(); }
});

test("自分の別の名義からの提案・他人の投稿・採用前・反映前には出さない", async () => {
  const s = await setup({
    posts: { p1: { address: AUTHOR, title: "t", changeUsers: [AUTHOR_CHES, HELPER] }, p9: { address: OUTSIDER, title: "t", changeUsers: [HELPER] } },
    post_changes: {
      self: change("p1", AUTHOR_CHES), others: change("p9", HELPER, { reflectedBy: OUTSIDER }),
      pending: change("p1", HELPER, { status: "pending" }), unreflected: change("p1", HELPER, { reflectedAt: null }),
      forged: change("p1", HELPER, { reflectedBy: HELPER })
    }
  });
  try {
    for (const [post, id] of [["p1", "self"], ["p9", "others"], ["p1", "pending"], ["p1", "unreflected"], ["p1", "forged"]]) {
      assert.equal((await s.call(post, id)).status, 409, id);
    }
    assert.equal(s.rewards().length, 0);
    s.as("helper");   // 提案した本人が自分で呼んでも出ない（呼べるのは投稿した本人）
    assert.equal((await s.call("p1", "forged")).status, 409);
    assert.equal(s.rewards().length, 0);
  } finally { s.close(); }
});

test("アプリが作った名義で書いた投稿でも、本人が反映すれば出る。前の鍵で作ってある報酬は二重にしない", async () => {
  const s = await setup({
    posts: { p1: { address: AUTHOR_CHES, title: "t", changeUsers: [HELPER] }, p2: { address: AUTHOR, title: "t", changeUsers: [HELPER] } },
    post_changes: { c1: change("p1", HELPER, { reflectedBy: AUTHOR_CHES }), old: change("p2", HELPER) }
  });
  try {
    assert.equal((await s.call("p1", "c1")).status, 200);
    assert.equal(s.rewards().length, 1);
    // 前の鍵（改善案ごと）で作ってあったもの
    const oldKey = JSON.stringify(["emuer-v2", "change-reflection", "p2", "old"]);
    const oldId = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(oldKey));
    await s.db.collection("emuer_v2_rewards").doc(oldId).set({ claimId: oldId, key: oldKey, kind: "change-reflected", recipient: HELPER, amount: "1", status: "pending" });
    const again = await s.call("p2", "old");
    assert.equal(again.status, 200);
    assert.equal(again.body.rewardId, oldId);
    assert.equal(s.rewards().length, 2, "前の報酬をそのまま返し、新しく作らない");
  } finally { s.close(); }
});
