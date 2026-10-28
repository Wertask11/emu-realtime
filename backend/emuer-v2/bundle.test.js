"use strict";

/* 未請求の報酬を、まとめて1回で受け取る（POST /rewards/bundle）。

   1件ずつ受け取ると、そのたびに MetaMask の承認とガス代がかかる。
   まとめた合計を1枚の札にして、1回で受け取れるようにした。
   ここが緩むと、まとめた札と元の札の両方で受け取れて、二重に払ってしまう。 */
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const ethers = require("ethers");
const { makeFirestore } = require("../fake-firestore");
const { createEmuerV2Router, CONTRACT } = require("./router");

const UNIT = 10n ** 18n;
const ME = ethers.Wallet.createRandom().address.toLowerCase();
const OTHER = ethers.Wallet.createRandom().address.toLowerCase();

const reward = (amount, extra = {}) => ({
  schema: "emuer-v2-reward-v1", kind: "reaction", recipient: ME, amount: String(amount),
  amountWei: (BigInt(amount) * UNIT).toString(), status: "pending", createdAt: new Date(), ...extra
});

async function setup(rows, { paid = {}, chainFails = false, people = { ok: true } } = {}) {
  const db = makeFirestore({ emuer_v2_rewards: rows });
  const signer = ethers.Wallet.createRandom();
  const contract = {
    hasRole: async () => true,
    claimPaid: async id => { if (chainFails) throw new Error("rpc"); return ethers.BigNumber.from(String(paid[id] || 0)); }
  };
  const router = createEmuerV2Router({
    db, signer, contract,
    env: { EMUER_V2_ENABLED: "true" },
    identity: { knowledgeParticipants: async () => people },
    requireFirebaseUser: (req, res, next) => { req.identity = { uid: "u1", walletAddress: ME }; next(); },
    requireOwnAddress: (req, res, next) => next()
  }).router;
  const app = express();
  app.use(express.json());
  app.use("/v2", router);
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path) => {
    const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json" }, body: method === "GET" ? undefined : "{}" });
    return { status: r.status, body: await r.json() };
  };
  return { db, signer, call, close: () => server.close() };
}

function recover(reward) {
  return ethers.utils.verifyTypedData(
    { name: "Emuer", version: "2", chainId: 137, verifyingContract: CONTRACT },
    { Reward: [
      { name: "claimId", type: "bytes32" }, { name: "recipient", type: "address" },
      { name: "totalAmount", type: "uint256" }, { name: "deadline", type: "uint256" }
    ] },
    { claimId: reward.claimId, recipient: reward.recipient, totalAmount: reward.totalAmount, deadline: reward.deadline },
    reward.authorization
  );
}

test("未請求のぶんを合計して1枚の札にし、元の報酬はまとめ済みにする", async () => {
  const t = await setup({ a: reward(3), b: reward(10), c: reward(1, { recipient: OTHER }) });
  try {
    const r = await t.call("POST", "/v2/rewards/bundle");
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.count, 2);
    assert.equal(r.body.amount, "13");
    assert.equal(r.body.reward.totalAmount, (13n * UNIT).toString());
    assert.equal(r.body.reward.recipient, ethers.utils.getAddress(ME));
    assert.equal(recover(r.body.reward), t.signer.address, "サーバーの鍵で署名されていません");
    const rows = t.db._dump("emuer_v2_rewards");
    assert.equal(rows.a.status, "bundled"); assert.equal(rows.b.status, "bundled");
    assert.equal(rows.a.bundleClaimId, r.body.reward.claimId);
    assert.equal(rows.c.status, "pending", "他の人の報酬は入れない");
    const bundle = rows[r.body.reward.claimId];
    assert.equal(bundle.kind, "bundle"); assert.equal(bundle.status, "pending");
    assert.deepEqual(bundle.members, ["a", "b"]);
    assert.ok(bundle.authorizedUntilMs >= r.body.reward.deadline * 1000, "みてみるが期限内にまとめた札を使わないように");
  } finally { t.close(); }
});

test("まとめたあとは、元の報酬に1件ずつの札を出さない。一覧にはまとめた札だけが出る", async () => {
  const t = await setup({ a: reward(3), b: reward(10) });
  try {
    const first = await t.call("POST", "/v2/rewards/bundle");
    assert.equal(first.status, 200);
    const single = await t.call("POST", "/v2/rewards/a/authorization");
    assert.equal(single.status, 409); assert.equal(single.body.error, "REWARD_BUNDLED");
    const again = await t.call("POST", "/v2/rewards/bundle");
    assert.equal(again.status, 409); assert.equal(again.body.error, "NOTHING_TO_BUNDLE", "まとめた札はまだ期限内なので、もう一度まとめない");
    const list = await t.call("GET", "/v2/rewards");
    assert.deepEqual(list.body.rewards.map(x => x.claimId), [first.body.reward.claimId]);
    assert.equal(list.body.rewards[0].memberCount, 2);
    // まとめた札は、同じ札でもう一度署名をもらえる（MetaMask で断った・一部だけ払われたとき）
    const bundled = await t.call("POST", "/v2/rewards/" + first.body.reward.claimId + "/authorization");
    assert.equal(bundled.status, 200);
    assert.equal(bundled.body.reward.totalAmount, (13n * UNIT).toString());
  } finally { t.close(); }
});

test("札を出したばかりのもの・鎖の上で一部でも受け取ったものは入れない", async () => {
  const t = await setup({
    a: reward(3), live: reward(5, { authorizedUntilMs: Date.now() + 10 * 60 * 1000 }),
    part: reward(7, { claimId: "0xpart" }), old: reward(2, { authorizedUntilMs: Date.now() - 5 * 60 * 1000 })
  }, { paid: { "0xpart": 1 } });
  try {
    const r = await t.call("POST", "/v2/rewards/bundle");
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.amount, "5");
    const rows = t.db._dump("emuer_v2_rewards");
    assert.equal(rows.live.status, "pending"); assert.equal(rows.part.status, "pending");
    assert.equal(rows.a.status, "bundled"); assert.equal(rows.old.status, "bundled");
  } finally { t.close(); }
});

test("鎖に聞けないときは、まとめない", async () => {
  const t = await setup({ a: reward(3), b: reward(4) }, { chainFails: true });
  try {
    const r = await t.call("POST", "/v2/rewards/bundle");
    assert.equal(r.status, 503); assert.equal(r.body.error, "CHAIN_UNAVAILABLE");
    const rows = t.db._dump("emuer_v2_rewards");
    assert.equal(rows.a.status, "pending"); assert.equal(rows.b.status, "pending");
  } finally { t.close(); }
});

test("知識の募集の報酬は、1件ずつと同じ確認を通ったものだけを入れる", async () => {
  const t = await setup({ a: reward(3), k: reward(50, { kind: "knowledge-answer", requestId: "q1", answerId: "ans1" }) });
  try {
    // 募集も回答も見つからない → 入れない
    const r = await t.call("POST", "/v2/rewards/bundle");
    assert.equal(r.status, 200);
    assert.equal(r.body.amount, "3");
    assert.equal(t.db._dump("emuer_v2_rewards").k.status, "pending");
  } finally { t.close(); }
  const ok = await setup({ k: reward(50, { kind: "knowledge-answer", requestId: "q1", answerId: "ans1" }) });
  try {
    await ok.db.collection("knowledge_requests").doc("q1").set({ status: "awarded", acceptedAnswerId: "ans1" });
    await ok.db.collection("knowledge_answers").doc("ans1").set({ requestId: "q1", answerAuthor: ME, status: "accepted" });
    const r = await ok.call("POST", "/v2/rewards/bundle");
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.amount, "50");
  } finally { ok.close(); }
});

test("まとめるものが無ければ 409", async () => {
  const t = await setup({ s: reward(3, { status: "spent" }), c: reward(3, { status: "claimed" }) });
  try {
    const r = await t.call("POST", "/v2/rewards/bundle");
    assert.equal(r.status, 409); assert.equal(r.body.error, "NOTHING_TO_BUNDLE");
  } finally { t.close(); }
});
