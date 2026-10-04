"use strict";
/* みてみる（交換所）のテスト。
   守りたいこと:
     - 金額はサーバーの商品から決まる。画面からの金額は効かない
     - EMUER はプランと回数枠を守る。無料プランは払えない
     - 未変換の EMUER は一度しか使えない。署名を出したばかりの報酬は使わない。おつりが出る
     - 鎖・JPYC・カードは、支払いが確かめられたときだけ paid になる。同じ送金は二度使えない
     - 在庫と取り置き、期限切れ、取消、返金で数がずれない */
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { makeFirestore } = require("./fake-firestore");
const { createMitemiruRouter, JPYC } = require("./mitemiru");

const UNIT = 10n ** 18n;
const W = (n) => (BigInt(n) * UNIT).toString();
const ALICE = "0x" + "a".repeat(40);
const OWNER = "0x" + "f".repeat(40);
const RECEIVER = "0x1c156b6a8caa6772430eda2cbb0d20cf41b9cfe4";

function setup(opts) {
  const o = opts || {};
  const db = makeFirestore(o.seed || {});
  let clock = Date.parse("2026-11-14T13:00:00+09:00");
  const chain = {
    id: (v) => "0x" + require("node:crypto").createHash("sha256").update(v).digest("hex"),
    ready: true, paid: {}, orders: {}, txs: {},
    async signerReady() { return this.ready; },
    async jpycDecimals() { return 18; },
    async claimPaid(id) { if (o.chainDown) throw new Error("rpc"); return BigInt(this.paid[id] || 0); },
    async exchangeOrder(id) { return this.orders[id] || { buyer: "0x" + "0".repeat(40), productId: "0x", paid: 0n, refunded: false }; },
    async signOrder(v) { return "sig:" + v.orderId; },
    async tokenTransfers(hash, token) { assert.equal(token, JPYC); return this.txs[hash] || { found: false }; }
  };
  const stripe = o.noStripe ? null : {
    sessions: {}, refunds: [],
    checkout: { sessions: {
      create: async (p) => { const id = "cs_" + Object.keys(stripe.sessions).length; stripe.sessions[id] = { id, url: "https://pay/" + id, payment_status: "unpaid", status: "open", metadata: p.metadata, params: p }; return stripe.sessions[id]; },
      retrieve: async (id) => stripe.sessions[id],
      expire: async (id) => { stripe.sessions[id].status = "expired"; }
    } },
    refunds: { create: async (p) => { stripe.refundsMade = (stripe.refundsMade || []).concat([p]); return { id: "re_1" }; } }
  };
  const plans = Object.assign({ alice: "light", bob: "guest", owner: "pro" }, o.plans || {});
  const users = { alice: ALICE, bob: "0x" + "b".repeat(40), owner: OWNER };
  const requireFirebaseUser = (req, res, next) => {
    const uid = req.headers["x-test-user"];
    if (!uid) return res.status(401).json({ error: "AUTH_REQUIRED" });
    req.identity = { uid, walletAddress: users[uid], account: {} };
    next();
  };
  const requireOwner = (req, res, next) => requireFirebaseUser(req, res, () =>
    req.identity.uid === "owner" ? next() : res.status(403).json({ error: "OWNER_ONLY" }));
  const m = createMitemiruRouter({
    db, chain, stripe, env: {}, now: () => clock, emuerEnabled: () => o.emuerOff ? false : true,
    requireFirebaseUser, requireOwner, isOwner: (i) => i.uid === "owner",
    entitlement: { getEntitlement: async (uid) => ({ plan: plans[uid] || "guest" }) }
  });
  const app = express();
  app.use(express.json());
  app.use("/api/mitemiru", m.router);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/mitemiru`;
  async function call(user, method, path, body) {
    const r = await fetch(base + path, { method, headers: Object.assign({ "content-type": "application/json" }, user ? { "x-test-user": user } : {}), body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json() };
  }
  return { db, chain, stripe, m, call, close: () => server.close(), advance: (ms) => { clock += ms; }, now: () => clock };
}

async function makeProduct(t, extra) {
  const r = await t.call("owner", "POST", "/admin/products", Object.assign({
    name: "ステッカー引換券", fulfillment: "解剖フェス会場で手渡し", cancelPolicy: "受け取り前なら運営都合のときのみ全額返金",
    prices: { EMUER: 50, JPYC: 300, JPY: 300 }, cashAtVenue: true, stock: 2, status: "live"
  }, extra || {}));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.product.id;
}
function seedRewards(db, list) {
  list.forEach((amount, i) => db.collection("emuer_v2_rewards").doc("0xr" + i).set({
    claimId: "0xr" + i, recipient: ALICE, uid: "alice", amountWei: W(amount), amount: String(amount),
    status: "pending", createdAt: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString()
  }));
}

test("運営だけが商品を出せる。価格・提供方法・取消条件がない商品は出せない", async () => {
  const t = setup();
  try {
    assert.equal((await t.call("alice", "POST", "/admin/products", { name: "x" })).status, 403);
    const bad = await t.call("owner", "POST", "/admin/products", { name: "x", fulfillment: "手渡し", prices: { EMUER: 10 } });
    assert.equal(bad.body.error, "CANCEL_POLICY_REQUIRED");
    const noPrice = await t.call("owner", "POST", "/admin/products", { name: "x", fulfillment: "手渡し", cancelPolicy: "なし", prices: {} });
    assert.equal(noPrice.body.error, "PRICE_REQUIRED");
    const draft = await makeProduct(t, { status: "draft" });
    const list = await t.call(null, "GET", "/products");
    assert.equal(list.body.products.length, 0, "下書きは並べない");
    await t.call("owner", "PUT", "/admin/products/" + draft, { status: "live" });
    const live = await t.call(null, "GET", "/products");
    assert.deepEqual(live.body.products[0].methods, ["emuer_ledger", "emuer_chain", "jpyc", "jpy_card", "jpy_cash"]);
    assert.equal(live.body.products[0].remaining, 2);
  } finally { t.close(); }
});

test("未変換のEMUERで払うと、報酬は使用済みになり、おつりが新しい報酬になる。回数も1回消費する", async () => {
  const t = setup();
  try {
    const pid = await makeProduct(t);
    seedRewards(t.db, [1, 1, 100]);
    const me = await t.call("alice", "GET", "/me");
    assert.equal(me.body.emuer.unconverted, "102");
    const r = await t.call("alice", "POST", "/orders", { productId: pid, method: "emuer_ledger", amount: 1 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.order.status, "paid");
    assert.equal(r.body.order.amount, 50, "金額は商品から。画面の amount は無視");
    assert.match(r.body.order.pickupCode, /^[A-Z2-9]{6}$/);
    const rewards = t.db._dump("emuer_v2_rewards");
    assert.equal(rewards["0xr0"].status, "spent");
    assert.equal(rewards["0xr2"].status, "spent");
    const change = Object.values(rewards).find(x => x.kind === "mitemiru-change");
    assert.equal(change.amountWei, W(52));
    assert.equal(change.status, "pending");
    const usage = Object.values(t.db._dump("emuer_v2_access_usage"));
    assert.equal(usage[0].used, 1);
    // Light は月1回。2回目は断る
    const again = await t.call("alice", "POST", "/orders", { productId: pid, method: "emuer_ledger" });
    assert.equal(again.body.error, "PERIOD_LIMIT_REACHED");
    assert.equal((await t.call("alice", "GET", "/me")).body.emuer.unconverted, "52");
  } finally { t.close(); }
});

test("無料プランはEMUERで払えない。円とJPYCは払える", async () => {
  const t = setup();
  try {
    const pid = await makeProduct(t);
    const r = await t.call("bob", "POST", "/orders", { productId: pid, method: "emuer_ledger" });
    assert.equal(r.status, 403);
    assert.equal(r.body.error, "PLAN_REQUIRED");
    const cash = await t.call("bob", "POST", "/orders", { productId: pid, method: "jpy_cash" });
    assert.equal(cash.status, 200);
    assert.equal(cash.body.order.status, "pending_payment");
    assert.equal(cash.body.order.pickupCode, null, "払う前は引換コードを出さない");
    assert.match(cash.body.order.waitingCode, /^[A-Z2-9]{6}$/);
  } finally { t.close(); }
});

test("署名を出したばかりの報酬と、鎖で受け取り済みの報酬は使わない", async () => {
  const t = setup();
  try {
    const pid = await makeProduct(t);
    seedRewards(t.db, [30, 30, 30]);
    await t.db.collection("emuer_v2_rewards").doc("0xr0").set({ authorizedUntilMs: t.now() + 10 * 60 * 1000 }, { merge: true });
    t.chain.paid["0xr1"] = W(30);
    const r = await t.call("alice", "POST", "/orders", { productId: pid, method: "emuer_ledger" });
    assert.equal(r.body.error, "INSUFFICIENT_EMUER");
    assert.equal(t.db._dump("emuer_v2_rewards")["0xr1"].status, "claimed");
    assert.equal(t.db._dump("emuer_v2_rewards")["0xr0"].status, "pending");
    assert.equal(t.db._count("mitemiru_orders"), 0);
  } finally { t.close(); }
});

test("鎖に聞けないときは、未変換からは払わない", async () => {
  const t = setup({ chainDown: true });
  try {
    const pid = await makeProduct(t);
    seedRewards(t.db, [100]);
    const r = await t.call("alice", "POST", "/orders", { productId: pid, method: "emuer_ledger" });
    assert.equal(r.status, 503);
    assert.equal(t.db._dump("emuer_v2_rewards")["0xr0"].status, "pending");
  } finally { t.close(); }
});

test("同時に2回押しても、同じ報酬は一度しか使えない", async () => {
  const t = setup({ plans: { alice: "pro" } });
  try {
    const pid = await makeProduct(t, { stock: null });
    seedRewards(t.db, [50]);
    const [a, b] = await Promise.all([
      t.call("alice", "POST", "/orders", { productId: pid, method: "emuer_ledger" }),
      t.call("alice", "POST", "/orders", { productId: pid, method: "emuer_ledger" })
    ]);
    const ok = [a, b].filter(x => x.status === 200);
    assert.equal(ok.length, 1, JSON.stringify([a.body, b.body]));
    assert.equal(t.db._count("mitemiru_orders"), 1);
  } finally { t.close(); }
});

test("ウォレットのEMUERは、鎖の上で支払いが確かめられたときだけpaidになる", async () => {
  const t = setup();
  try {
    const pid = await makeProduct(t);
    const r = await t.call("alice", "POST", "/orders", { productId: pid, method: "emuer_chain" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const ex = r.body.exchange;
    assert.equal(ex.price, W(50));
    assert.equal(ex.contract, "0x9c102cC3016C70767082b60196565878D9314864");
    const id = r.body.order.id;
    assert.equal((await t.call("alice", "POST", `/orders/${id}/confirm`)).body.error, "CHAIN_PAYMENT_NOT_FOUND");
    t.chain.orders[ex.orderId] = { buyer: ALICE, productId: ex.productId, paid: BigInt(W(49)), refunded: false };
    assert.equal((await t.call("alice", "POST", `/orders/${id}/confirm`)).body.error, "CHAIN_PAYMENT_MISMATCH");
    t.chain.orders[ex.orderId].paid = BigInt(W(50));
    const ok = await t.call("alice", "POST", `/orders/${id}/confirm`);
    assert.equal(ok.body.order.status, "paid");
    const p = t.db._dump("mitemiru_products")[pid];
    assert.equal(p.sold, 1); assert.equal(p.reserved, 0);
    assert.equal(Object.values(t.db._dump("emuer_v2_access_usage"))[0].used, 1, "成功したときに回数を使う");
  } finally { t.close(); }
});

test("JPYCは送金の記録を確かめる。足りない・別の宛先・使い回しは通さない", async () => {
  const t = setup();
  try {
    const pid = await makeProduct(t, { stock: null });
    const r = await t.call("bob", "POST", "/orders", { productId: pid, method: "jpyc" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.order.jpyc.receiver, RECEIVER);
    assert.equal(r.body.order.jpyc.amountWei, W(300));
    const id = r.body.order.id;
    const bob = "0x" + "b".repeat(40);
    const h1 = "0x" + "1".repeat(64), h2 = "0x" + "2".repeat(64);
    t.chain.txs[h1] = { found: true, ok: true, confirmations: 5, transfers: [{ from: bob, to: RECEIVER, value: BigInt(W(299)), logIndex: 3 }] };
    assert.equal((await t.call("bob", "POST", `/orders/${id}/confirm`, { txHash: h1 })).body.error, "TRANSFER_NOT_FOUND");
    t.chain.txs[h2] = { found: true, ok: true, confirmations: 1, transfers: [{ from: bob, to: RECEIVER, value: BigInt(W(300)), logIndex: 0 }] };
    assert.equal((await t.call("bob", "POST", `/orders/${id}/confirm`, { txHash: h2 })).body.error, "TX_PENDING");
    t.chain.txs[h2].confirmations = 3;
    assert.equal((await t.call("bob", "POST", `/orders/${id}/confirm`, { txHash: h2 })).body.order.status, "paid");
    // 同じ送金で別の注文は払えない
    const r2 = await t.call("bob", "POST", "/orders", { productId: pid, method: "jpyc" });
    const reuse = await t.call("bob", "POST", `/orders/${r2.body.order.id}/confirm`, { txHash: h2 });
    assert.equal(reuse.body.error, "TX_ALREADY_USED");
  } finally { t.close(); }
});

test("カードはStripeで払い終えたときだけpaid。Webhookでも確認でも一度だけ数える", async () => {
  const t = setup();
  try {
    const pid = await makeProduct(t);
    const r = await t.call("bob", "POST", "/orders", { productId: pid, method: "jpy_card" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.match(r.body.order.stripeUrl, /^https:\/\/pay\//);
    const session = Object.values(t.stripe.sessions)[0];
    assert.equal(session.params.line_items[0].price_data.unit_amount, 300);
    assert.equal((await t.call("bob", "POST", `/orders/${r.body.order.id}/confirm`)).body.error, "CARD_NOT_PAID");
    session.payment_status = "paid"; session.payment_intent = "pi_1";
    const handled = await t.m.handleStripeEvent({ type: "checkout.session.completed", data: { object: session } });
    assert.equal(handled, true);
    const again = await t.call("bob", "POST", `/orders/${r.body.order.id}/confirm`);
    assert.equal(again.body.order.status, "paid");
    await t.m.handleStripeEvent({ type: "checkout.session.completed", data: { object: session } });
    assert.equal(t.db._dump("mitemiru_products")[pid].sold, 1);
    // 月額会員のイベントは扱わない
    assert.equal(await t.m.handleStripeEvent({ type: "checkout.session.completed", data: { object: { metadata: {} } } }), false);
  } finally { t.close(); }
});

test("在庫は取り置きを含めて数える。期限が過ぎた取り置きは戻る。取消でも戻る", async () => {
  const t = setup();
  try {
    const pid = await makeProduct(t, { stock: 1 });
    const a = await t.call("bob", "POST", "/orders", { productId: pid, method: "jpy_cash" });
    assert.equal(a.status, 200);
    assert.equal((await t.call("alice", "POST", "/orders", { productId: pid, method: "jpy_cash" })).body.error, "SOLD_OUT");
    await t.call("bob", "POST", `/orders/${a.body.order.id}/cancel`);
    const b = await t.call("alice", "POST", "/orders", { productId: pid, method: "jpy_cash" });
    assert.equal(b.status, 200);
    t.advance(7 * 60 * 60 * 1000);
    const c = await t.call("bob", "POST", "/orders", { productId: pid, method: "jpy_cash" });
    assert.equal(c.status, 200, "期限切れの取り置きは外れる");
    assert.equal(t.db._dump("mitemiru_orders")[b.body.order.id].status, "expired");
  } finally { t.close(); }
});

test("会場の流れ: 引換コードで探し、現金を受け取り、渡す。利用者の画面に引換コードが出る", async () => {
  const t = setup();
  try {
    const pid = await makeProduct(t);
    const r = await t.call("bob", "POST", "/orders", { productId: pid, method: "jpy_cash" });
    const code = r.body.order.waitingCode;
    assert.equal((await t.call("bob", "POST", `/admin/orders/${r.body.order.id}/cash-paid`, {})).status, 403);
    const found = await t.call("owner", "GET", "/admin/orders?code=" + code.toLowerCase());
    assert.equal(found.body.orders.length, 1);
    const done = await t.call("owner", "POST", `/admin/orders/${r.body.order.id}/cash-paid`, { fulfill: true });
    assert.equal(done.body.order.status, "fulfilled");
    const mine = await t.call("bob", "GET", "/orders");
    assert.equal(mine.body.orders[0].pickupCode, code);
    assert.equal(mine.body.orders[0].status, "fulfilled");
  } finally { t.close(); }
});

test("未変換で払った注文の返金は、同じ額の新しい報酬で返し、回数の消費も取り消す", async () => {
  const t = setup();
  try {
    const pid = await makeProduct(t);
    seedRewards(t.db, [50]);
    const r = await t.call("alice", "POST", "/orders", { productId: pid, method: "emuer_ledger" });
    const refund = await t.call("owner", "POST", `/admin/orders/${r.body.order.id}/refund`, { note: "在庫切れ" });
    assert.equal(refund.status, 200, JSON.stringify(refund.body));
    const back = Object.values(t.db._dump("emuer_v2_rewards")).find(x => x.kind === "mitemiru-refund");
    assert.equal(back.amountWei, W(50));
    assert.equal(Object.values(t.db._dump("emuer_v2_access_usage"))[0].used, 0);
    assert.equal(t.db._dump("mitemiru_products")[pid].sold, 0);
    assert.equal((await t.call("owner", "POST", `/admin/orders/${r.body.order.id}/refund`, {})).body.error, "ALREADY_DONE");
  } finally { t.close(); }
});

test("ウォレットのEMUERの返金は、鎖の上で返したことを確かめてから記録する", async () => {
  const t = setup();
  try {
    const pid = await makeProduct(t);
    const r = await t.call("alice", "POST", "/orders", { productId: pid, method: "emuer_chain" });
    const ex = r.body.exchange;
    t.chain.orders[ex.orderId] = { buyer: ALICE, productId: ex.productId, paid: BigInt(W(50)), refunded: false };
    await t.call("alice", "POST", `/orders/${r.body.order.id}/confirm`);
    const before = await t.call("owner", "POST", `/admin/orders/${r.body.order.id}/refund`, {});
    assert.equal(before.body.error, "CHAIN_REFUND_NOT_CONFIRMED");
    t.chain.orders[ex.orderId].refunded = true;
    assert.equal((await t.call("owner", "POST", `/admin/orders/${r.body.order.id}/refund`, {})).body.order.status, "refunded");
  } finally { t.close(); }
});

test("EMUER v2 が止まっているときは、EMUERの支払いを並べない", async () => {
  const t = setup({ emuerOff: true });
  try {
    const pid = await makeProduct(t);
    const list = await t.call(null, "GET", "/products");
    assert.deepEqual(list.body.products[0].methods, ["jpyc", "jpy_card", "jpy_cash"]);
    assert.equal((await t.call("alice", "POST", "/orders", { productId: pid, method: "emuer_ledger" })).body.error, "METHOD_NOT_AVAILABLE");
  } finally { t.close(); }
});

test("みてみるのコレクションは、包括ルールから外れている（ブラウザから書けない）", () => {
  const rules = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "firestore.rules"), "utf8");
  assert.match(rules, /!coll\.matches\('mitemiru_\.\*'\)/,
    "mitemiru_* が包括ルールの除外に入っていない（誰でも注文を支払い済みにできてしまう）");
});
