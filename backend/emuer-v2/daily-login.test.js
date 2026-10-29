"use strict";

/* 今日のぶん（+1 EMUER）を、MetaMask の無いところでも受け取れるか（10/29 オーナーから）。

   LINE・Google のアプリ内ブラウザには MetaMask が無い。前は、押すと
   サーバーが報酬を作って署名まで出し、そのあと画面が「missing provider」で止まっていた。
   報酬は作られるのに、署名の期限（15分）のあいだは公式ショップでも使えなかった。

   いまは claim:false で、報酬を「待っている報酬」として作るだけにする（署名は出さない）。
   ウォレットに移す前のEMUERとして、すぐ公式ショップで使える。 */
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const ethers = require("ethers");
const { makeFirestore } = require("../fake-firestore");
const { createEmuerV2Router } = require("./router");

const ME = ethers.Wallet.createRandom().address.toLowerCase();

async function setup({ signerReady = true } = {}) {
  const db = makeFirestore({});
  const router = createEmuerV2Router({
    db, signer: ethers.Wallet.createRandom(),
    contract: { hasRole: async () => signerReady, claimPaid: async () => ethers.BigNumber.from(0) },
    env: { EMUER_V2_ENABLED: "true" },
    identity: { knowledgeParticipants: async () => ({ ok: true }) },
    requireFirebaseUser: (req, res, next) => { req.identity = { uid: "u1", walletAddress: ME }; next(); },
    requireOwnAddress: (req, res, next) => next()
  }).router;
  const app = express();
  app.use(express.json());
  app.use("/v2", router);
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body) => {
    const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json" }, body: method === "GET" ? undefined : JSON.stringify(body || {}) });
    return { status: r.status, body: await r.json() };
  };
  return { db, call, close: () => server.close() };
}

test("MetaMask が無いときは、今日のぶんを作るだけにする。署名を出さないので、すぐ公式ショップで使える", async () => {
  const t = await setup();
  try {
    const r = await t.call("POST", "/v2/daily/login", { address: ME, claim: false });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.recorded, true); assert.equal(r.body.amount, "1");
    assert.equal(r.body.reward, undefined, "署名は返さない");
    const rows = Object.values(t.db._dump("emuer_v2_rewards"));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, "login"); assert.equal(rows[0].status, "pending"); assert.equal(rows[0].recipient, ME);
    assert.equal(rows[0].authorizedUntilMs, undefined, "署名の期限を付けない（付けると15分は使えない）");
    // 同じ日にもう一度押しても、1つのまま
    assert.equal((await t.call("POST", "/v2/daily/login", { address: ME, claim: false })).status, 200);
    assert.equal(Object.keys(t.db._dump("emuer_v2_rewards")).length, 1);
    assert.equal((await t.call("GET", "/v2/daily/login/status?address=" + ME)).body.claimedToday, true);
    // 未請求の報酬の一覧にも出る（MetaMask のあるところから、あとで受け取れる）
    const list = await t.call("GET", "/v2/rewards?address=" + ME);
    assert.deepEqual(list.body.rewards.map(x => [x.kind, x.amount]), [["login", "1"]]);
  } finally { t.close(); }
});

test("MetaMask があるときは、これまでどおり署名まで出す", async () => {
  const t = await setup();
  try {
    const r = await t.call("POST", "/v2/daily/login", { address: ME });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.body.reward && r.body.reward.authorization, "署名を返す");
    assert.ok(Object.values(t.db._dump("emuer_v2_rewards"))[0].authorizedUntilMs > Date.now());
  } finally { t.close(); }
});

test("署名の鍵が使えないときでも、作るだけなら受け付ける", async () => {
  const t = await setup({ signerReady: false });
  try {
    assert.equal((await t.call("POST", "/v2/daily/login", { address: ME })).status, 503);
    const r = await t.call("POST", "/v2/daily/login", { address: ME, claim: false });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(Object.keys(t.db._dump("emuer_v2_rewards")).length, 1);
  } finally { t.close(); }
});
