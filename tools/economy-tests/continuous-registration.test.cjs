"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  { hash, SERVICE } = require("../../backend/economy/config"),
  b = require("./continuous-registration.cjs");
const d = {
  founderApproved: true,
  mode: "continuous",
  approvalRef: "isolated_continuation_20261116",
  startedAtMs: 2000,
  historicalTrialEndMs: 1000,
  price: 5,
  personDaily: 3,
  globalDaily: 20,
  concurrency: 2,
  dailyTokens: 100000,
  requestTokens: 5000,
  paymentSource: "ledger",
  polygonEnabled: false,
};
test("continuous decision cannot change price, budgets, payment source or infer Founder approval", () => {
  for (const p of [
    { founderApproved: false },
    { price: 0 },
    { personDaily: 4 },
    { globalDaily: 21 },
    { concurrency: 3 },
    { dailyTokens: 200000 },
    { paymentSource: "polygon_wallet" },
    { polygonEnabled: true },
  ])
    assert.throws(() => b.decision({ ...d, ...p }), /UNCONFIRMED/);
  assert.equal(
    b.product(
      {
        status: "live",
        prices: { EMUER: 5 },
        termsVersion: SERVICE.termsVersion,
      },
      d,
    ).intakeEnabled,
    false,
  );
});
test("only a previously verified qualified subject with the actual trial-bound expiry is continued", () => {
  const e = {
    adultVerified: true,
    providerAllowed: true,
    verifiedAtMs: 500,
    validUntilMs: 1000,
  };
  const before = JSON.stringify(e);
  assert.equal(
    b.eligibility(e, "subject", "pro", d).sourceGrantHash,
    require("../../backend/economy/continuous-authorization").eligibilityGrantHash(
      e,
    ),
  );
  assert.equal(JSON.stringify(e), before);
  for (const bad of [
    { ...e, adultVerified: false },
    { ...e, providerAllowed: false },
    { ...e, validUntilMs: 999 },
    { ...e, revokedAtMs: 1 },
    { ...e, verifiedAtMs: 0 },
  ])
    assert.throws(() => b.eligibility(bad, "subject", "pro", d));
  assert.throws(() => b.eligibility(e, "subject", "light", d));
});
test("official guild continuation is exact-content, non-mutating and never extends the historical expiry", () => {
  const g = require("../../frontend/public/schoolpark/guild-store").OFFICIAL[0],
    s = {
      kind: "guild",
      id: g.id,
      key: "guild:" + g.id,
      title: g.name,
      summary: g.concept,
    },
    r = {
      piiReviewed: true,
      aiUseApproved: true,
      validUntilMs: 1000,
      contentHash: hash([s.title, s.summary]),
    },
    before = JSON.stringify(r);
  assert.equal(b.source(s, r, null, d, 2000).category, "A");
  assert.equal(JSON.stringify(r), before);
  assert.throws(() => b.source({ ...s, summary: "edited" }, r, null, d, 2000));
  assert.throws(() =>
    b.source(s, { ...r, aiUseApproved: false }, null, d, 2000),
  );
  assert.throws(() => b.source(s, r, { visibility: "private" }, d, 2000));
});
test("third-party knowledge cannot inherit official continuation even with a previous AI approval", () => {
  const s = {
      kind: "knowledge_lab",
      key: "knowledge_lab:post",
      title: "公開投稿",
      summary: "第三者の経験",
    },
    r = {
      reviewCategory: "B",
      piiReviewed: true,
      aiUseApproved: true,
      validUntilMs: 1000,
      contentHash: hash([s.title, s.summary]),
    };
  assert.throws(() => b.source(s, r, null, d, 2000), /THIRD_PARTY/);
});
