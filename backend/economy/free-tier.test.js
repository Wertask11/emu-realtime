"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict");
const { fixture } = require("./fixture"),
  { configuration } = require("./config");
const { providerDay, createFreeTierGuard, LIMITS } = require("./free-tier");
async function ready(options) {
  const f = fixture(options);
  await f.seed();
  f.a = await f.actor();
  return f;
}
async function pay(f, key = "free-test-request-0001") {
  const q = await f.economy.service.quote(f.a, { goal: "コーヒーを学びたい" });
  return f.economy.service.submit(f.a, {
    quoteId: q.id,
    termsVersion: q.termsVersion,
    requestId: key,
    aiConsent: true,
    paymentConsent: true,
  });
}
function orders(f) {
  return Object.keys(f.db._dump("mitemiru_orders")).length;
}
test("free-only mode accepts attested Free without a paid billing contract, never infers project approval", async () => {
  const f = await ready();
  assert.equal(f.economy.service.config().enabled, true);
  assert.equal(f.economy.service.config().billingMode, "free-only");
  for (const tier of ["", "paid", "tier1"])
    assert.equal(
      configuration({ ...f.env, ECONOMY_GEMINI_BILLING_TIER: tier }, f.now())
        .enabled,
      false,
    );
  assert.equal(
    configuration({ ...f.env, ECONOMY_AI_PROJECT_ATTESTED: "false" }, f.now())
      .enabled,
    false,
  );
  assert.equal(
    configuration(
      { ...f.env, ECONOMY_EXPLORER_MODEL: "gemini-3.8-flash" },
      f.now(),
    ).enabled,
    false,
  );
});
test("Pacific provider date follows PST/PDT transitions independently from JST", () => {
  for (const [at, expected] of [
    ["2026-11-07T07:59:59Z", "2026-11-06"],
    ["2026-11-07T08:00:00Z", "2026-11-07"],
    ["2026-07-07T06:59:59Z", "2026-07-06"],
    ["2026-07-07T07:00:00Z", "2026-07-07"],
    ["2026-11-01T08:59:59Z", "2026-11-01"],
    ["2026-11-01T09:00:00Z", "2026-11-01"],
  ])
    assert.equal(providerDay(Date.parse(at)), expected);
});
test("third admission in a rolling minute never creates a payment; same-key retry consumes no extra quota", async () => {
  const f = await ready();
  const first = await pay(f);
  await pay(f, "free-test-request-0002");
  await assert.rejects(
    pay(f, "free-test-request-0003"),
    /AI_ADMISSION_RATE_LIMIT/,
  );
  assert.equal(orders(f), 2);
  const j = (await f.economy.service.ref("jobs", first.id).get()).data();
  const repeat = await f.economy.service.submit(f.a, {
    quoteId: j.quoteId,
    termsVersion: j.termsVersion,
    requestId: "free-test-request-0001",
    aiConsent: true,
    paymentConsent: true,
  });
  assert.equal(repeat.id, first.id);
  assert.equal(
    (
      await f.economy.service.ref("free_usage", providerDay(f.now())).get()
    ).data().count,
    2,
  );
  f.advance(60001);
  await pay(f, "free-test-request-0004");
  assert.equal(orders(f), 3);
});
test("parallel admissions share a transaction and cannot debit above the conservative minute cap", async () => {
  const f = await ready(),
    result = await Promise.allSettled(
      Array.from({ length: 5 }, (_, i) => pay(f, "parallel-free-request-" + i)),
    );
  assert.equal(result.filter((r) => r.status === "fulfilled").length, 2);
  assert.equal(orders(f), 2);
});
test("JST midnight does not reset the provider day reservation or allow a new charge at the PT cap", async () => {
  const f = await ready();
  f.advance(6 * 3600000);
  const bucket = providerDay(f.now());
  await f.economy.service
    .ref("free_usage", bucket)
    .set({ count: 20, reservedTokens: 100000 });
  f.advance(6 * 3600000 + 1);
  await f.economy.service.workerHealth(true);
  assert.equal(providerDay(f.now()), bucket);
  await assert.rejects(pay(f), /AI_PROVIDER_DAY_LIMIT/);
  assert.equal(orders(f), 0);
});
test("provider boundary after ledger payment refunds without inference", async () => {
  const f = await ready();
  f.advance(5 * 3600000 - 30000);
  await f.economy.service.workerHealth(true);
  const j = await pay(f);
  f.advance(60001);
  await f.economy.tick();
  assert.equal(f.calls(), 0);
  assert.equal((await f.economy.service.view(f.a, j.id)).state, "refunded");
});
test("local provider pacing retains a durable queued order and later completes with one payment", async () => {
  const f = await ready(),
    j = await pay(f);
  await f.economy.service.ref("system", "free-provider-window").set({
    recent: [
      { atMs: f.now(), operation: "generateContent" },
      { atMs: f.now(), operation: "generateContent" },
    ],
  });
  await f.economy.tick();
  assert.equal((await f.economy.service.view(f.a, j.id)).state, "queued");
  assert.equal(f.calls(), 0);
  f.advance(60001);
  await f.economy.tick();
  assert.equal((await f.economy.service.view(f.a, j.id)).state, "completed");
  assert.equal(orders(f), 1);
  assert.equal(f.calls(), 1);
});
for (const stage of ["countTokens", "generateContent"]) {
  for (const code of [400, 401, 403, 404, 429, 503])
    test(
      "provider " +
        code +
        " at " +
        stage +
        " stops new intake, refunds once and never switches model",
      async () => {
        const f = await ready({ providerStatus: code, failureStage: stage }),
          j = await pay(f);
        await f.economy.tick();
        await f.economy.tick();
        const got = await f.economy.service.view(f.a, j.id);
        assert.equal(got.state, "refunded");
        assert.equal(got.payment.refunded, true);
        const safety = (
          await f.economy.service.ref("system", "provider-safety").get()
        ).data();
        assert.equal(safety.stopped, true);
        assert.ok(safety.providerError);
        await assert.rejects(
          pay(f, "after-provider-stop-0001"),
          /SERVICE_DISABLED/,
        );
        assert.equal(orders(f), 1);
      },
    );
}
test("all provider HTTP calls use bounded persistent pacing; the third generation cannot escape", async () => {
  const f = await ready(),
    guard = createFreeTierGuard({ db: f.db, now: f.now }),
    id = "a".repeat(40),
    leaseToken = "test-lease";
  await f.economy.service.ref("jobs", id).set({
    state: "running",
    leaseToken,
    leaseUntilMs: f.now() + 300000,
    providerBucket: providerDay(f.now()),
  });
  for (let i = 0; i < 8; i++)
    await guard.beforeCall("countTokens", id, leaseToken);
  for (let i = 0; i < 2; i++)
    await guard.beforeCall("generateContent", id, leaseToken);
  await assert.rejects(
    guard.beforeCall("countTokens", id, leaseToken),
    /AI_PROVIDER_THROTTLED/,
  );
  assert.equal((await guard.snapshot()).recentHttpCalls, LIMITS.httpPerMinute);
  f.advance(60001);
  await guard.beforeCall("generateContent", id, leaseToken);
  assert.equal((await guard.snapshot()).recentHttpCalls, 1);
});
for (const stage of ["countTokens", "generateContent"])
  test(
    "timeout at " + stage + " refunds and keeps new intake stopped",
    async () => {
      const f = await ready({ providerTimeout: true, failureStage: stage }),
        j = await pay(f);
      await f.economy.tick();
      assert.equal((await f.economy.service.view(f.a, j.id)).state, "refunded");
      assert.equal((await f.economy.service.status()).service.enabled, false);
    },
  );
test("429 refund pending survives stopped-provider restart and only confirms an actual return", async () => {
  const f = await ready({ providerStatus: 429 }),
    j = await pay(f),
    refund = f.economy.service.payments.refund;
  f.economy.service.payments.refund = async () => {
    throw Error("local refund unavailable");
  };
  await f.economy.tick();
  assert.equal(
    (await f.economy.service.view(f.a, j.id)).state,
    "refund_pending",
  );
  f.economy.service.payments.refund = refund;
  await f.economy.tick();
  await f.economy.tick();
  const got = await f.economy.service.view(f.a, j.id);
  assert.equal(got.state, "refunded");
  assert.equal(got.payment.refunded, true);
  assert.equal((await f.economy.service.status()).service.enabled, false);
  assert.equal(orders(f), 1);
});
test("the final provider-day reservation can pay and execute while only new intake is closed", async () => {
  const f = await ready();
  await f.economy.service
    .ref("free_usage", providerDay(f.now()))
    .set({ count: 19, reservedTokens: 95000 });
  const j = await pay(f);
  assert.equal(j.state, "queued");
  assert.equal(j.payment.status, "paid");
  assert.equal((await f.economy.service.status()).service.enabled, false);
  await f.economy.tick();
  assert.equal((await f.economy.service.view(f.a, j.id)).state, "completed");
  assert.equal(f.calls(), 1);
  await assert.rejects(
    pay(f, "after-final-provider-slot"),
    /AI_PROVIDER_DAY_LIMIT/,
  );
  assert.equal(orders(f), 1);
});
