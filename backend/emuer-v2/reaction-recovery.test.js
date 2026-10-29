"use strict";

/* 取りこぼした Good・Change の報酬（10/1 以降）を、運営が数えてから作り直す（10/29 オーナー決定）。

   画面が JSON の印を付けずに送っていたので、Good・Change を受け取った投稿者への報酬が
   記録されていなかった。押した人の一覧は投稿に押した順で残っているので、そこから作り直す。
     - 10/1 より前の分は移行のときに別の台帳へ記録し直してある。その数より後ろの人だけを作る
     - 10/1 以降にできた投稿は全員。自分の投稿に押したものは作らない
     - 10/1 より前の投稿で、移行のときの控えが無いものは作らずに「要確認」
     - すでにある報酬（ふだんの記録で届いたもの）は作らない。何度押しても二重にならない
     - 数えたときと数が変わっていたら作らない */
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const ethers = require("ethers");
const { makeFirestore } = require("../fake-firestore");
const { createEmuerV2Router } = require("./router");

const addr = () => ethers.Wallet.createRandom().address.toLowerCase();
const OP = addr(), AUTHOR = addr(), AUTHOR2 = addr();
const X = [addr(), addr(), addr(), addr(), addr()];
const keyOf = (postId, action, actor) => JSON.stringify(["emuer-v2", "reaction", action, postId, actor]);
const idOf = key => ethers.utils.keccak256(ethers.utils.toUtf8Bytes(key));

async function setup() {
  const db = makeFirestore({
    posts: {
      // 10/1 より前の投稿。移行のときは Good 2・Change 0 だった。そのあと X[2] が Good、X[3] が Change
      a: { title: "早起きの話", address: AUTHOR, createdAt: new Date("2026-09-20T00:00:00Z"), goodUsers: [X[0], X[1], X[2]], changeUsers: [X[3]], goodCount: 3, changeCount: 1 },
      // 10/1 以降の投稿。自分で押したぶんは作らない
      b: { title: "本の読み方", address: AUTHOR2, createdAt: new Date("2026-10-10T00:00:00Z"), goodUsers: [X[0], AUTHOR2], changeUsers: [] },
      // 10/1 より前の投稿で、移行のときの控えが無い（数が合わず保留にしたもの）
      c: { title: "保留の投稿", address: AUTHOR, createdAt: new Date("2026-09-25T00:00:00Z"), goodUsers: [X[1]], changeUsers: [] },
      // 10/1 以降で、ふだんの記録で届いていたもの
      d: { title: "届いていた投稿", address: AUTHOR, createdAt: new Date("2026-10-12T00:00:00Z"), goodUsers: [X[4]], changeUsers: [] },
      e: { title: "反応の無い投稿", address: AUTHOR, createdAt: new Date("2026-10-13T00:00:00Z"), goodUsers: [], changeUsers: [] }
    },
    emuer_v2_backfill: { a: { postId: "a", goodCount: 2, changeCount: 0, status: "ready" } },
    emuer_v2_rewards: {
      [idOf(keyOf("d", "good", X[4]))]: { kind: "good-received", recipient: AUTHOR, amount: "1", status: "pending", key: keyOf("d", "good", X[4]) }
    }
  });
  const router = createEmuerV2Router({
    db, signer: ethers.Wallet.createRandom(),
    contract: { hasRole: async () => true, claimPaid: async () => ethers.BigNumber.from(0) },
    env: { EMUER_V2_ENABLED: "true", EMUER_V2_OPERATOR_ADDRESSES: OP },
    identity: { knowledgeParticipants: async () => ({ ok: true }) },
    requireFirebaseUser: (req, res, next) => { req.identity = { uid: "u", walletAddress: String(req.headers["x-wallet"] || "") }; next(); },
    requireOwnAddress: (req, res, next) => next()
  }).router;
  const app = express();
  app.use(express.json());
  app.use("/v2", router);
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (who, method, path, body) => {
    const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json", "x-wallet": who },
      body: method === "GET" ? undefined : JSON.stringify(body || {}) });
    return { status: r.status, body: await r.json() };
  };
  return { db, call, close: () => server.close() };
}

test("数える：10/1 以降のぶんだけを、まだ無いものだけ数える。控えの無い古い投稿は要確認に出す", async () => {
  const t = await setup();
  try {
    assert.equal((await t.call(AUTHOR, "GET", "/v2/admin/reaction-recovery")).status, 403, "運営だけ");
    const r = await t.call(OP, "GET", "/v2/admin/reaction-recovery");
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.scannedPosts, 5);
    assert.deepEqual([r.body.missingGood, r.body.missingChange, r.body.missingEmuer, r.body.authors], [2, 1, 3, 2]);
    assert.deepEqual(r.body.review.map(x => [x.postId, x.reason]), [["c", "10/1より前の投稿で、移行のときの数の控えが無い"]]);
    assert.deepEqual(r.body.sample.map(x => [x.postId, x.action]).sort(), [["a", "change"], ["a", "good"], ["b", "good"]]);
    assert.equal(Object.keys(t.db._dump("emuer_v2_rewards")).length, 1, "数えるだけでは何も作らない");
  } finally { t.close(); }
});

test("作り直す：数えた数を添えたときだけ作る。作った報酬は投稿した人の「未請求の報酬」に出て、二度目は何も作らない", async () => {
  const t = await setup();
  try {
    const stale = await t.call(OP, "POST", "/v2/admin/reaction-recovery", { expectedMissing: 5 });
    assert.equal(stale.status, 409); assert.equal(stale.body.error, "RECOVERY_CHANGED");
    assert.equal((await t.call(OP, "POST", "/v2/admin/reaction-recovery", {})).status, 409, "数を添えないと作らない");
    const r = await t.call(OP, "POST", "/v2/admin/reaction-recovery", { expectedMissing: 3 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual([r.body.created, r.body.authors], [3, 2]);
    const rows = t.db._dump("emuer_v2_rewards");
    const made = Object.values(rows).filter(x => x.recovered);
    assert.deepEqual(made.map(x => [x.postId, x.kind, x.recipient, x.actor, x.amount, x.status]).sort(), [
      ["a", "change-received", AUTHOR, X[3], "1", "pending"],
      ["a", "good-received", AUTHOR, X[2], "1", "pending"],
      ["b", "good-received", AUTHOR2, X[0], "1", "pending"]
    ].sort());
    assert.ok(made.every(x => x.recoveredBy === OP));
    // 鍵はふだんの記録と同じ。あとから押した人の画面が送り直しても、二重にならない
    assert.ok(rows[idOf(keyOf("a", "good", X[2]))]);
    assert.equal((await t.call(OP, "GET", "/v2/admin/reaction-recovery")).body.missingEmuer, 0);
    const again = await t.call(OP, "POST", "/v2/admin/reaction-recovery", { expectedMissing: 0 });
    assert.equal(again.body.created, 0);
    // 投稿した人の「未請求の報酬」に出る
    const list = await t.call(AUTHOR, "GET", "/v2/rewards?address=" + AUTHOR);
    assert.deepEqual(list.body.rewards.map(x => x.kind).sort(), ["change-received", "good-received", "good-received"]);
  } finally { t.close(); }
});
