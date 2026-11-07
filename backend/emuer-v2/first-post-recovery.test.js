"use strict";

/* 取りこぼした初投稿キャンペーンの報酬を、運営が数えてから作る（11/7 創業者承認）。
     - Knowledge Lab で最初に公開した人（申し込みが届かず、あとの投稿は「初めてではない」と断られた）に作る
     - ふだんの申し込みと同じ決まり：パスポートの最初の投稿（どの名義でも）が期間内で、今も公開中
     - 期間より前に投稿していた人・もう受け取っている人には作らない
     - 最初の投稿を取り下げた人、名義からパスポートを決められない人は「要確認」（作らない）
     - 数えたときと数が変わっていたら作らない。何度押しても二重にならない。運営だけ */
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const ethers = require("ethers");
const { makeFirestore } = require("../fake-firestore");
const { createEmuerV2Router } = require("./router");

const addr = () => ethers.Wallet.createRandom().address.toLowerCase();
const OP = addr(), LAB = addr(), LAB_LINE = addr(), OLD = addr(), DONE = addr(), WITHDRAWN = addr(), UNKNOWN = addr(), LATE = addr();
const at = s => new Date(s);
const keyOf = spid => JSON.stringify(["emuer-v2", "first-post-campaign-2026-10", spid]);
const idOf = key => ethers.utils.keccak256(ethers.utils.toUtf8Bytes(key));
const SPID = { [LAB]: "SP-LAB", [LAB_LINE]: "SP-LAB", [OLD]: "SP-OLD", [DONE]: "SP-DONE", [WITHDRAWN]: "SP-WD", [LATE]: "SP-LATE" };

async function setup() {
  const db = makeFirestore({
    posts: {
      // Lab で最初に公開（申し込みが届いていない）。そのあと LINE の名義で通常の投稿
      "kl-first": { title: "Lab の初投稿", address: LAB, createdAt: at("2026-10-31T10:00:00+09:00"), knowledgeLab: { revision: 1 } },
      later: { title: "あとの通常投稿", address: LAB_LINE, createdAt: at("2026-11-02T10:00:00+09:00") },
      // 期間より前に投稿していた人（初めてではない）
      old1: { title: "前からの投稿", address: OLD, createdAt: at("2026-10-01T10:00:00+09:00") },
      old2: { title: "期間内の投稿", address: OLD, createdAt: at("2026-11-01T10:00:00+09:00") },
      // ふだんの申し込みで、もう受け取っている人
      done: { title: "受け取り済み", address: DONE, createdAt: at("2026-10-30T10:00:00+09:00") },
      // 最初の投稿を取り下げた人
      wd: { title: "取り下げ", address: WITHDRAWN, createdAt: at("2026-10-30T09:00:00+09:00"), visibility: "private", knowledgeLab: { tombstone: true } },
      wd2: { title: "次の投稿", address: WITHDRAWN, createdAt: at("2026-11-03T09:00:00+09:00") },
      // 名義からパスポートを決められない人
      unknown: { title: "誰か分からない", address: UNKNOWN, createdAt: at("2026-11-01T09:00:00+09:00") },
      // 期間のあと（11/29 以降）の投稿
      late: { title: "期間のあと", address: LATE, createdAt: at("2026-11-29T10:00:00+09:00") }
    },
    emuer_v2_rewards: { [idOf(keyOf("SP-DONE"))]: { kind: "first-post", key: keyOf("SP-DONE"), recipient: DONE, amount: "100", status: "pending" } }
  });
  const router = createEmuerV2Router({
    db, signer: ethers.Wallet.createRandom(),
    contract: { hasRole: async () => true, claimPaid: async () => ethers.BigNumber.from(0) },
    env: { EMUER_V2_ENABLED: "true", EMUER_V2_OPERATOR_ADDRESSES: OP },
    identity: { spidForAddress: async a => SPID[String(a).toLowerCase()] || null },
    requireFirebaseUser: (req, res, next) => { req.identity = { uid: "u", walletAddress: String(req.headers["x-wallet"] || "") }; next(); },
    requireOwnAddress: (req, res, next) => next()
  }).router;
  const app = express();
  app.use(express.json());
  app.use("/v2", router);
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (who, method, body) => {
    const r = await fetch(base + "/v2/admin/first-post-recovery", { method, headers: { "Content-Type": "application/json", "x-wallet": who },
      body: method === "GET" ? undefined : JSON.stringify(body || {}) });
    return { status: r.status, body: await r.json() };
  };
  return { db, call, rewards: () => Object.values(db._dump("emuer_v2_rewards")), close: () => server.close() };
}

test("数える：Lab で最初に公開した人だけが取りこぼし。前から投稿していた人・受け取り済み・期間外は数えない。取り下げ・不明は要確認", async () => {
  const t = await setup();
  try {
    assert.equal((await t.call(LAB, "GET")).status, 403, "運営だけ");
    const r = await t.call(OP, "GET");
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.missing, 1);
    assert.equal(r.body.missingEmuer, 100);
    assert.deepEqual(r.body.sample.map(s => s.postId), ["kl-first"]);
    assert.equal(r.body.sample[0].recipient, LAB);
    assert.deepEqual(r.body.review.map(x => x.postId).sort(), ["unknown", "wd"]);
    assert.equal(t.rewards().length, 1, "数えるだけでは作らない");
  } finally { t.close(); }
});

test("作る：確かめた数と同じときだけ作る。ふだんの申し込みと同じ鍵なので、何度押しても二重にならない", async () => {
  const t = await setup();
  try {
    const stale = await t.call(OP, "POST", { expectedMissing: 3 });
    assert.equal(stale.status, 409); assert.equal(stale.body.error, "RECOVERY_CHANGED");
    assert.equal(t.rewards().length, 1);
    const r = await t.call(OP, "POST", { expectedMissing: 1 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.created, 1); assert.equal(r.body.emuer, 100);
    const row = t.rewards().find(x => x.key === keyOf("SP-LAB"));
    assert.equal(row.kind, "first-post"); assert.equal(row.recipient, LAB); assert.equal(row.amount, "100");
    assert.equal(row.status, "pending"); assert.equal(row.postId, "kl-first"); assert.equal(row.recovered, true);
    assert.equal(row.recoveredBy, OP);
    // もう一度数えると 0。押しても増えない
    assert.equal((await t.call(OP, "GET")).body.missing, 0);
    assert.equal((await t.call(OP, "POST", { expectedMissing: 0 })).body.created, 0);
    assert.equal(t.rewards().length, 2);
  } finally { t.close(); }
});
