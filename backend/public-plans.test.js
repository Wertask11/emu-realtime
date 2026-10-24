"use strict";
/* 投稿の書き手のプラン名を返す窓口（POST /api/billing/public-plans）。
   ログインは要らない。返すのはプラン名だけで、1回に60人まで。 */
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { createBillingRouter } = require("./billing");

async function serve(plans) {
  const asked = [];
  const app = express();
  app.use(express.json());
  app.use("/api/billing", createBillingRouter({
    db: null, requireFirebaseUser: (q, s, n) => n(), requireOwner: (q, s, n) => n(),
    rateLimit: () => (q, s, n) => n(),
    entitlement: { memberPlanOfAddress: async a => { asked.push(a); return plans[a] || null; } }
  }).router);
  const server = await new Promise(r => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  const call = (body) => fetch("http://127.0.0.1:" + server.address().port + "/api/billing/public-plans", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    .then(async r => ({ status: r.status, body: await r.json() }));
  return { call, asked, close: () => server.close() };
}

test("書き手ごとのプラン名を返す。無い人は null（画面には何も出さない）", async () => {
  const A = "0x" + "a".repeat(40), B = "0x" + "b".repeat(40);
  const s = await serve({ [A]: "plus" });
  try {
    const r = await s.call({ addresses: [A.toUpperCase().replace("0X", "0x"), B, "not-an-address", A] });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.plans, { [A]: "plus", [B]: null });
    assert.deepEqual(s.asked.sort(), [A, B], "形の違う名義は聞かない・同じ人は1回");
  } finally { s.close(); }
});

test("一度に聞けるのは60人まで。形が違えば断る", async () => {
  const s = await serve({});
  try {
    const many = Array.from({ length: 61 }, (_, i) => "0x" + String(i).padStart(40, "0"));
    assert.equal((await s.call({ addresses: many })).status, 400);
    assert.equal((await s.call({ addresses: "0xabc" })).status, 400);
    assert.equal(s.asked.length, 0);
  } finally { s.close(); }
});
