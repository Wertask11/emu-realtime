"use strict";

/* プランの変更は、差額の支払いが通ったときだけ（11/11 点検）。
   前は支払いの結果を見ずに新しいプランを写していた。払えないカードのまま light から pro へ
   変えると、契約は pro のまま「支払い再試行中」になり、その間は会員として扱われた。 */
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const { makeFirestore } = require("./fake-firestore");

process.env.STRIPE_PRICE_LIGHT = process.env.STRIPE_PRICE_LIGHT || "price_light";
process.env.STRIPE_PRICE_PLUS = process.env.STRIPE_PRICE_PLUS || "price_plus";
process.env.STRIPE_PRICE_PRO = process.env.STRIPE_PRICE_PRO || "price_pro";
process.env.STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID || "price_pro";
const { createBillingRouter } = require("./billing");

async function setup(updateImpl) {
  const db = makeFirestore({ subscriptions: { u1: { uid: "u1", plan: "light", status: "active", stripeSubscriptionId: "sub_1", stripeCustomerId: "cus_1" } } });
  const calls = [];
  const live = { id: "sub_1", customer: "cus_1", status: "active", metadata: { uid: "u1", plan: "light" },
    items: { data: [{ id: "si_1", price: { id: "price_light" }, current_period_end: 1800000000 }] } };
  const stripeClient = { subscriptions: {
    retrieve: async () => live,
    update: async (id, params) => { calls.push(params); return updateImpl(live, params); }
  } };
  const pass = (req, res, next) => next();
  const billing = createBillingRouter({
    db, stripeClient, webhookPath: "/webhook", rateLimit: () => pass, requireOwner: pass,
    requireFirebaseUser: (req, res, next) => { req.identity = { uid: "u1", walletAddress: "0x" + "a".repeat(40), account: {} }; next(); },
    entitlement: { forget() {} }
  });
  const app = express();
  app.use(express.json());
  app.use("/b", billing.router);
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const change = async (plan) => {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/b/change-plan`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan }) });
    return { status: r.status, body: await r.json() };
  };
  return { db, calls, change, plan: () => db._dump("subscriptions").u1.plan, status: () => db._dump("subscriptions").u1.status, close: () => server.close() };
}

test("支払いが通れば、今までどおりプランが変わる。Stripe には「通らなければ変えない」と伝えている", async () => {
  const s = await setup((live, p) => ({ ...live, status: "active", metadata: p.metadata, items: { data: [{ ...live.items.data[0], price: { id: p.items[0].price } }] } }));
  try {
    const out = await s.change("pro");
    assert.equal(out.status, 200, JSON.stringify(out.body));
    assert.equal(out.body.plan, "pro");
    assert.equal(s.plan(), "pro");
    assert.equal(s.calls[0].payment_behavior, "error_if_incomplete");
    assert.equal(s.calls[0].proration_behavior, "always_invoice");
  } finally { s.close(); }
});

test("カードの支払いが通らなければ、プランは変わらない（PAYMENT_FAILED）", async () => {
  const s = await setup(() => { throw Object.assign(new Error("Your card was declined."), { type: "StripeCardError", statusCode: 402, code: "card_declined" }); });
  try {
    const out = await s.change("pro");
    assert.equal(out.status, 402);
    assert.equal(out.body.error, "PAYMENT_FAILED");
    assert.equal(s.plan(), "light", "払えていないのに pro になっている");
    assert.equal(s.status(), "active");
  } finally { s.close(); }
});

test("支払い待ちの状態で返ってきても、新しいプランとしては写さない", async () => {
  const s = await setup((live, p) => ({ ...live, status: "past_due", metadata: p.metadata }));
  try {
    const out = await s.change("pro");
    assert.equal(out.status, 402);
    assert.equal(out.body.error, "PAYMENT_FAILED");
    assert.equal(s.plan(), "light");
  } finally { s.close(); }
});

test("カード以外の失敗は、今までどおり CHANGE_FAILED", async () => {
  const s = await setup(() => { throw new Error("network"); });
  try {
    const out = await s.change("plus");
    assert.equal(out.status, 500);
    assert.equal(out.body.error, "CHANGE_FAILED");
    assert.equal(s.plan(), "light");
  } finally { s.close(); }
});
