"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict");
const { serviceOrderGuard } = require("./shop-guard"),
  { makeFirestore } = require("../fake-firestore");
const id = "agent_" + "a".repeat(40);
function check(db, path, authenticate = (req, res, next) => next()) {
  return new Promise((resolve) => {
    let code;
    serviceOrderGuard(db, authenticate)(
      { method: "POST", path },
      {
        status(n) {
          code = n;
          return this;
        },
        json(body) {
          resolve({ code, body });
        },
      },
      () => resolve({ next: true }),
    );
  });
}
test("reserved service order prefix cannot race a missing order into weak shop confirmation", async () => {
  const db = makeFirestore();
  const r = await check(db, "/orders/" + id + "/confirm");
  assert.equal(r.code, 409);
  assert.equal(r.body.error, "SERVICE_ORDER_MANAGED");
});
test("existing ledger service administration stays reachable; wallet services reject public/admin mutations", async () => {
  const db = makeFirestore(),
    r = db.collection("mitemiru_orders").doc(id);
  await r.set({ storeType: "agent_service", method: "emuer_ledger" });
  assert.equal((await check(db, "/admin/orders/" + id + "/refund")).next, true);
  await r.set({ storeType: "agent_service", method: "emuer_chain" });
  for (const p of ["/orders/", "/admin/orders/"])
    assert.equal((await check(db, p + id + "/refund")).code, 409);
});
test("ordinary shops bypass no authentication; reserved paths authenticate before any private read", async () => {
  const db = makeFirestore();
  db._breakAll("must not read");
  assert.equal((await check(db, "/orders/ordinary/confirm")).next, true);
  const r = await check(db, "/orders/" + id + "/confirm", (req, res) =>
    res.status(401).json({ error: "AUTH_REQUIRED" }),
  );
  assert.equal(r.code, 401);
});
