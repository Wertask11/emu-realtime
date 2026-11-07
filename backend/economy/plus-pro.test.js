"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { fixture } = require("./fixture");
const { configuration } = require("./config");
const { createEntitlement } = require("../entitlement");
const { makeFirestore } = require("../fake-firestore");

test("a configured guest/light tier cannot widen the paid request plans", () => {
  const c = configuration({ ECONOMY_EXPLORER_PLANS: "guest,light,plus,pro" });
  assert.deepEqual(c.plans, ["plus", "pro"]);
  assert.ok(configuration({ ECONOMY_EXPLORER_PLANS: "guest,light" }).blockers.includes("ELIGIBILITY_UNCONFIGURED"));
});

for (const plan of ["guest", "light", "plus", "pro"]) {
  test(`${plan}: server membership decides before creating a quote or payment`, async () => {
    const f = fixture({ env: { ECONOMY_EXPLORER_PLANS: "guest,light,plus,pro" } });
    await f.seed();
    f.entitlement.getEntitlement = async (_uid, _account, opts) => {
      assert.equal(opts.fresh, true);
      return { plan };
    };
    const a = await f.actor();
    const request = () => f.economy.service.quote(a, { goal: "知識を試す", plan: "pro" });
    if (["plus", "pro"].includes(plan)) assert.equal((await request()).price, 5);
    else {
      await assert.rejects(request(), /SERVICE_NOT_ELIGIBLE/);
      assert.equal((await f.db.collection("emuer_v2_agent_quotes").get()).size, 0);
    }
    assert.equal((await f.db.collection("mitemiru_orders").get()).size, 0);
  });
}

test("downgrade between quote and consent creates no job or charge", async () => {
  const f = fixture(); await f.seed(); const a = await f.actor();
  const q = await f.economy.service.quote(a, { goal: "知識を試す" });
  f.entitlement.getEntitlement = async () => ({ plan: "light" });
  await assert.rejects(f.economy.service.submit(a, { quoteId: q.id, termsVersion: q.termsVersion,
    requestId: "downgrade-before-payment", paymentConsent: true, aiConsent: true }), /SERVICE_NOT_ELIGIBLE/);
  assert.equal((await f.db.collection("emuer_v2_agent_jobs").get()).size, 0);
  assert.equal((await f.db.collection("mitemiru_orders").get()).size, 0);
});

test("membership lost after payment returns the ledger payment without calling AI", async () => {
  const f = fixture(); await f.seed(); const a = await f.actor();
  const q = await f.economy.service.quote(a, { goal: "知識を試す" });
  const j = await f.economy.service.submit(a, { quoteId: q.id, termsVersion: q.termsVersion,
    requestId: "downgrade-after-payment", paymentConsent: true, aiConsent: true });
  f.entitlement.getEntitlement = async () => ({ plan: "guest" });
  await f.economy.tick();
  assert.equal((await f.economy.service.view(a, j.id)).state, "refunded");
  assert.equal(f.calls(), 0);
});

test("fresh membership bypasses a cached grant after expiry; default callers keep existing cache behavior", async () => {
  const db = makeFirestore();
  await db.collection("entitlements").doc("test-member").set({ plan: "plus", startsAt: new Date(0), expiresAt: new Date(Date.now() + 60000) });
  const e = createEntitlement({ db });
  assert.equal((await e.getEntitlement("test-member")).plan, "plus");
  await db.collection("entitlements").doc("test-member").set({ plan: "plus", startsAt: new Date(0), expiresAt: new Date(Date.now() - 1000) });
  assert.equal((await e.getEntitlement("test-member")).plan, "plus");
  assert.equal((await e.getEntitlement("test-member", undefined, { fresh: true })).plan, "guest");
});

test("fresh membership invalidates only the subject's cached official-pass proof", async () => {
  let cachedPass = true;
  const e = createEntitlement({ db: makeFirestore(), identity: {
    findByUid: async () => "SP-AAAA-AAAA-AAAA-AAAA",
    holdsOfficialPassForUid: async () => cachedPass,
    forget: (spid) => { assert.equal(spid, "SP-AAAA-AAAA-AAAA-AAAA"); cachedPass = false; },
  } });
  const account = { walletAddress: "0x" + "a".repeat(40) };
  assert.equal((await e.getEntitlement("test-pass-holder", account)).plan, "plus");
  assert.equal((await e.getEntitlement("test-pass-holder", account, { fresh: true })).plan, "guest");
});
