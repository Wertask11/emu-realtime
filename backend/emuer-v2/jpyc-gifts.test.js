"use strict";
/* 12月の挑戦納めカレンダーの JPYC（11/28 オーナー決定）。
   特別な日（12/5・15 は 10、12/25 は 30、12/31 は 50 JPYC）にログインボーナスを受け取った人へ、JPYC を「受け取る予定」として記録する。
   12月の合計は 10,000 JPYC まで。運営があとでまとめて送る。鍵の無いアドレス（LINE・Google）には送らず、アドレスを登録してもらう。 */
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const ethers = require("ethers");
const { makeFirestore } = require("../fake-firestore");
const { createEmuerV2Router } = require("./router");
const { chesOf, DAYS, BUDGET } = require("./jpyc-gifts");

const REAL = ethers.Wallet.createRandom().address.toLowerCase();
async function setup({ uid = "u1", wallet = REAL, seed = {}, owner = false } = {}) {
  const db = makeFirestore(seed);
  const router = createEmuerV2Router({
    db, signer: ethers.Wallet.createRandom(),
    contract: { hasRole: async () => true, claimPaid: async () => ethers.BigNumber.from(0) },
    env: { EMUER_V2_ENABLED: "true", EMUER_V2_OPERATOR_ADDRESSES: owner ? wallet : "0x" + "9".repeat(40) },
    identity: { knowledgeParticipants: async () => ({ ok: true }) },
    requireFirebaseUser: (req, res, next) => { req.identity = { uid, walletAddress: wallet, account: { chesAddress: chesOf(uid) } }; next(); },
    requireOwnAddress: (req, res, next) => next()
  }).router;
  const app = express(); app.use(express.json()); app.use("/v2", router);
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body) => {
    const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json" }, body: method === "GET" ? undefined : JSON.stringify(body || {}) });
    return { status: r.status, body: await r.json() };
  };
  return { db, call, close: () => server.close() };
}
async function on(iso, fn) { const real = Date.now; Date.now = () => Date.parse(iso); try { return await fn(); } finally { Date.now = real; } }

test("決めた額：12/5・12/15 は 10、12/25 は 30、12/31 は 50 JPYC。12月の合計は 10,000 JPYC まで", () => {
  assert.deepEqual({ ...DAYS }, { "2026-12-05": 10, "2026-12-15": 10, "2026-12-25": 30, "2026-12-31": 50 });
  assert.equal(BUDGET["2026-12"], 10000);
});

test("12/25：ウォレットの人はログインボーナス（10 EMUER）と一緒に 30 JPYC を「受け取る予定」に。2回押しても1件", () => on("2026-12-25T03:00:00Z", async () => {
  const t = await setup();
  try {
    const st = await t.call("GET", "/v2/daily/login/status?address=" + REAL);
    assert.equal(st.body.jpycToday, 30);
    const r = await t.call("POST", "/v2/daily/login", { address: REAL, claim: false });
    assert.equal(r.body.amount, "10");
    assert.deepEqual(r.body.jpyc, { day: "2026-12-25", amountJpyc: 30, status: "pending", needsAddress: false, address: REAL.slice(0, 6) + "…" + REAL.slice(-4), sent: false });
    await t.call("POST", "/v2/daily/login", { address: REAL, claim: false });
    const gifts = t.db._dump("emuer_v2_jpyc_gifts");
    assert.equal(Object.keys(gifts).length, 1);
    assert.equal(Object.values(gifts)[0].address, REAL);
    assert.equal(t.db._dump("emuer_v2_jpyc_budget")["2026-12"].totalJpyc, 30);
    const mine = await t.call("GET", "/v2/jpyc/mine?address=" + REAL);
    assert.equal(mine.body.walletOk, true);
    assert.deepEqual(mine.body.gifts.map((g) => [g.day, g.amountJpyc, g.status]), [["2026-12-25", 30, "pending"]]);
  } finally { t.close(); }
}));

test("LINE・Google の人（鍵の無いアドレス）には送らない。アドレスを登録すると「送る予定」になる", () => on("2026-12-31T03:00:00Z", async () => {
  const ches = chesOf("u2");
  const t = await setup({ uid: "u2", wallet: ches });
  try {
    const r = await t.call("POST", "/v2/daily/login", { address: ches, claim: false });
    assert.equal(r.body.amount, "20");
    assert.equal(r.body.jpyc.amountJpyc, 50);
    assert.equal(r.body.jpyc.status, "needs_address");
    assert.equal(Object.values(t.db._dump("emuer_v2_jpyc_gifts"))[0].address, "", "鍵の無いアドレスは記録しない");
    assert.equal((await t.call("POST", "/v2/jpyc/address?address=" + ches, { jpycAddress: ches })).status, 400, "鍵の無いアドレスは登録できない");
    assert.equal((await t.call("POST", "/v2/jpyc/address?address=" + ches, { jpycAddress: "0x123" })).status, 400);
    const ok = await t.call("POST", "/v2/jpyc/address?address=" + ches, { jpycAddress: REAL });
    assert.equal(ok.body.filled, 1);
    const row = Object.values(t.db._dump("emuer_v2_jpyc_gifts"))[0];
    assert.equal(row.status, "pending"); assert.equal(row.address, REAL);
  } finally { t.close(); }
}));

test("ふだんの日は JPYC なし。12月の上限を超える分は配らない（EMUER は配る）", async () => {
  await on("2026-12-09T03:00:00Z", async () => {
    const t = await setup();
    try {
      const r = await t.call("POST", "/v2/daily/login", { address: REAL, claim: false });
      assert.equal(r.body.amount, "2"); assert.equal(r.body.jpyc, null);
      assert.equal(Object.keys(t.db._dump("emuer_v2_jpyc_gifts")).length, 0);
    } finally { t.close(); }
  });
  await on("2026-12-25T03:00:00Z", async () => {
    const t = await setup({ seed: { emuer_v2_jpyc_budget: { "2026-12": { totalJpyc: 9980 } } } });
    try {
      const r = await t.call("POST", "/v2/daily/login", { address: REAL, claim: false });
      assert.equal(r.body.amount, "10", "EMUER はいつもどおり");
      assert.deepEqual(r.body.jpyc, { amountJpyc: 0, soldOut: true });
      assert.equal(Object.keys(t.db._dump("emuer_v2_jpyc_gifts")).length, 0);
      assert.equal(t.db._dump("emuer_v2_jpyc_budget")["2026-12"].totalJpyc, 9980, "上限を超えて記録しない");
    } finally { t.close(); }
  });
});

test("運営：まとめて送る一覧（送る先と額）と、送ったら取引の記録を付けて「送り済み」に。運営でない人は見られない", () => on("2026-12-05T03:00:00Z", async () => {
  const t = await setup({ owner: true });
  try {
    await t.call("POST", "/v2/daily/login", { address: REAL, claim: false });
    const list = await t.call("GET", "/v2/admin/jpyc-gifts");
    assert.equal(list.body.pending.length, 1);
    assert.deepEqual(list.body.totals, { pending: 10, needsAddress: 0, sent: 0 });
    const id = list.body.pending[0].id;
    assert.equal(list.body.pending[0].address, REAL);
    assert.equal((await t.call("POST", "/v2/admin/jpyc-gifts/" + id + "/sent", { txHash: "0x12" })).status, 400);
    assert.equal((await t.call("POST", "/v2/admin/jpyc-gifts/" + id + "/sent", { txHash: "0x" + "a".repeat(64) })).body.ok, true);
    assert.deepEqual((await t.call("GET", "/v2/admin/jpyc-gifts")).body.totals, { pending: 0, needsAddress: 0, sent: 10 });
    assert.equal((await t.call("POST", "/v2/admin/jpyc-gifts/" + id + "/sent", { txHash: "0x" + "b".repeat(64) })).status, 409, "二重に送り済みにしない");
  } finally { t.close(); }
  const u = await setup({ owner: false });
  try { assert.equal((await u.call("GET", "/v2/admin/jpyc-gifts")).status, 403); } finally { u.close(); }
}));
