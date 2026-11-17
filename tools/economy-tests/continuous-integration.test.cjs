"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  { createFixture } = require("./fixture.cjs"),
  { TASKS, VERSION } = require("../../backend/economy/tasks");
async function quote(f, type, role = "pro") {
  const r = await f.call(role, "POST", "/quotes", {
    goal: "コーヒーの経験を整理してWeb3クエスト・ギルド・City商品を比較したい",
    taskType: type,
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.quote;
}
const body = (q) => ({
  quoteId: q.id,
  termsVersion: q.termsVersion,
  requestId: "native-continuous-work-0001",
  paymentConsent: true,
  aiConsent: true,
  searchConsentVersion: q.searchProfile?.version,
  workConsentVersion: VERSION,
});
for (const type of Object.keys(TASKS))
  test(
    "native continuous " +
      type +
      ": authenticated quote/pay/save/replay with historical trial unchanged",
    async () => {
      const f = await createFixture({
        crossDomain: true,
        phase3: true,
        phase4: true,
        continuous: true,
      });
      try {
        const status = (await f.call("pro", "GET", "/me")).body;
        assert.equal(status.service.serviceMode, "continuous");
        assert.equal(status.service.trialEndMs, 1794638926671);
        assert.equal(status.walletPayment.enabled, false);
        const q = await quote(f, type);
        assert.equal(q.price, 5);
        const b = body(q),
          p = await Promise.all([
            f.call("pro", "POST", "/jobs", b),
            f.call("pro", "POST", "/jobs", b),
          ]);
        assert.ok(
          p.every((x) => x.status === 200),
          JSON.stringify(p),
        );
        assert.equal(p[0].body.job.id, p[1].body.job.id);
        await f.economy.tick();
        const id = p[0].body.job.id,
          j = await f.call("pro", "GET", "/jobs/" + id);
        assert.equal(j.body.job.state, "completed");
        assert.equal(j.body.job.payment.amount, 5);
        const a = await f.call("pro", "GET", "/artifacts/" + id);
        assert.equal(a.status, 200);
        assert.equal(a.body.artifact.artifactType, type);
        assert.equal(
          (await f.call("bob", "GET", "/artifacts/" + id)).status,
          404,
        );
        const history = await f.call("pro", "GET", "/jobs");
        assert.equal(history.body.jobs.length, 1);
        assert.equal((await f.db.collection("mitemiru_orders").get()).size, 1);
      } finally {
        await f.close();
      }
    },
  );
test("native continuous Free/Light denied, Plus/Pro allowed and expired membership immediately rejected", async () => {
  const f = await createFixture({ continuous: true });
  try {
    for (const role of ["guest", "light"]) {
      const r = await f.call(role, "POST", "/quotes", { goal: "学びたい" });
      assert.equal(r.status, 403);
      assert.equal(r.body.error, "SERVICE_NOT_ELIGIBLE");
    }
    for (const role of ["alice", "pro"])
      assert.equal(
        (await f.call(role, "POST", "/quotes", { goal: "学びたい" })).status,
        200,
      );
    await f.db
      .collection("entitlements")
      .doc(f.users.pro.uid)
      .set({
        plan: "pro",
        source: "emulator-test",
        startsAt: new Date(0),
        expiresAt: new Date(Date.now() - 1),
      });
    assert.equal(
      (await f.call("pro", "POST", "/quotes", { goal: "学びたい" })).status,
      403,
    );
    assert.equal((await f.db.collection("mitemiru_orders").get()).size, 0);
  } finally {
    await f.close();
  }
});
test("native product intake pause after payment keeps paid generation and full failure refund operational", async () => {
  const f = await createFixture({
    crossDomain: true,
    phase3: true,
    continuous: true,
    providerDown: true,
  });
  try {
    const q = await quote(f, "quest_plan"),
      r = await f.call("pro", "POST", "/jobs", body(q));
    assert.equal(r.status, 200);
    const ref = f.economy.service.ref(
        "products",
        "agent_schoolpark-explorer-v1",
      ),
      p = (await ref.get()).data();
    await ref.set(
      { offering: { ...p.offering, intakeEnabled: false } },
      { merge: true },
    );
    assert.equal(
      (await f.call("pro", "POST", "/quotes", { goal: "別の依頼" })).status,
      503,
    );
    await f.economy.tick();
    await f.economy.tick();
    const done = await f.call("pro", "GET", "/jobs/" + r.body.job.id);
    assert.equal(done.body.job.state, "refunded");
    assert.equal(done.body.job.payment.status, "refunded");
    assert.equal((await f.db.collection("mitemiru_orders").get()).size, 1);
  } finally {
    await f.close();
  }
});

test("separate service instances keep native durable idempotency without a shared in-flight map", async () => {
  const f = await createFixture({ continuous: true });
  try {
    const q = (await f.call("pro", "POST", "/quotes", { goal: "学びたい" }))
        .body.quote,
      b = body(q),
      u = f.users.pro;
    const second = require("../../backend/economy/service").createEconomy({
      db: f.db,
      identity: f.identity,
      entitlement: f.entitlement,
      payments: f.commerce.servicePayments,
      sources: f.economy.service.sources,
      agent: {},
      env: f.env,
    });
    const a = await second.actor({
        uid: u.uid,
        account: u.account,
        walletAddress: u.account.walletAddress,
      }),
      jobs = await Promise.all([
        f.economy.service.submit(a, b),
        second.submit(a, b),
      ]);
    assert.equal(jobs[0].id, jobs[1].id);
    assert.equal((await f.db.collection("mitemiru_orders").get()).size, 1);
    assert.equal(
      (await f.db.collection("emuer_v2_agent_usage").get()).docs
        .find((d) => d.data().reservedTokens)
        ?.data().count,
      1,
    );
  } finally {
    await f.close();
  }
});
