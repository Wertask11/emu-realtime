"use strict";
/* 体験チケット（11/10）。注文IDと引換コードが合うときだけ見られる・個人の情報は出さない・
   お店の暗証番号で1回だけ使用済みにできる・間違いが続くと止まる・暗証番号はハッシュだけ残す。 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { makeFirestore } = require("./fake-firestore");
const { createTicketRouter } = require("./shop-tickets");

async function serve(seed) {
  const db = makeFirestore(seed);
  const app = express();
  const requireOwner = (req, res, next) => (req.headers["x-owner"] === "1" ? ((req.identity = { uid: "owner" }), next()) : res.status(403).end());
  app.use("/t", createTicketRouter({ db, requireOwner }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = "http://127.0.0.1:" + server.address().port + "/t";
  const call = async (method, path, body, owner) => {
    const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(owner ? { "x-owner": "1" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  return { db, call, close: () => new Promise((r) => server.close(r)) };
}
const seed = () => ({
  mitemiru_shops: { cafe: { name: "まちのカフェ", storeType: "real_partner" } },
  mitemiru_orders: {
    o1: { productName: "コーヒー1杯", shopId: "cafe", status: "paid", delivery: "pickup", pickupCode: "AB12CD", uid: "u1", passportId: "SP-1" },
    o2: { productName: "ステッカー", shopId: "cafe", status: "paid", delivery: "ship", pickupCode: "ZZ99ZZ" },
    o3: { productName: "未払い", shopId: "cafe", status: "pending_payment", delivery: "pickup", pickupCode: "QQ11QQ" }
  }
});

test("チケットは注文IDと引換コードが合うときだけ見られる。配送の品・未払いはチケットにならない。個人の情報は出さない", async () => {
  const s = await serve(seed());
  try {
    const ok = await s.call("GET", "/o1?c=ab12cd");
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body.ticket, { productName: "コーヒー1杯", choice: "", shopName: "まちのカフェ", status: "unused", usedAt: null, delivery: "pickup", code: "AB12CD" });
    assert.ok(!JSON.stringify(ok.body).includes("u1") && !JSON.stringify(ok.body).includes("SP-1"));
    assert.equal((await s.call("GET", "/o1?c=XXXXXX")).status, 404);
    assert.equal((await s.call("GET", "/o2?c=ZZ99ZZ")).status, 404);
    assert.equal((await s.call("GET", "/o3?c=QQ11QQ")).status, 404);
  } finally { await s.close(); }
});

test("お店の暗証番号で1回だけ使用済みにする。暗証番号はハッシュだけ。間違いが5回続くと止まる", async () => {
  const s = await serve(seed());
  try {
    assert.equal((await s.call("POST", "/o1/use", { code: "AB12CD", pin: "1234" })).body.error, "STAFF_PIN_NOT_SET");
    assert.equal((await s.call("POST", "/admin/staff/cafe", { pin: "1234" })).status, 403, "運営だけが決める");
    assert.equal((await s.call("POST", "/admin/staff/cafe", { pin: "12" }, true)).body.error, "PIN_4_TO_8_DIGITS");
    assert.equal((await s.call("POST", "/admin/staff/cafe", { pin: "4321" }, true)).status, 200);
    const stored = s.db._dump("mitemiru_ticket_staff").cafe;
    assert.ok(stored.pinHash && stored.salt && !JSON.stringify(stored).includes("4321"), "番号そのものは残さない");

    assert.equal((await s.call("POST", "/o1/use", { code: "AB12CD", pin: "0000" })).body.error, "WRONG_PIN");
    const used = await s.call("POST", "/o1/use", { code: "AB12CD", pin: "4321" });
    assert.equal(used.status, 200);
    assert.equal(used.body.ticket.status, "used");
    const order = s.db._dump("mitemiru_orders").o1;
    assert.equal(order.status, "fulfilled");
    assert.equal(order.fulfilledBy, "ticket-staff:cafe");
    const again = await s.call("POST", "/o1/use", { code: "AB12CD", pin: "4321" });
    assert.equal(again.status, 409);
    assert.equal(again.body.error, "ALREADY_USED");

  } finally { await s.close(); }
  const t = await serve({ ...seed(), mitemiru_orders: { o9: { productName: "x", shopId: "cafe", status: "paid", delivery: "pickup", pickupCode: "PP22PP" } } });
  try {
    await t.call("POST", "/admin/staff/cafe", { pin: "4321" }, true);
    for (let i = 0; i < 5; i++) assert.equal((await t.call("POST", "/o9/use", { code: "PP22PP", pin: "9999" })).body.error, "WRONG_PIN");
    assert.equal((await t.call("POST", "/o9/use", { code: "PP22PP", pin: "4321" })).body.error, "TOO_MANY_TRIES", "正しい番号でも、しばらく受け付けない");
  } finally { await t.close(); }
});
