"use strict";
const { test, before, after } = require("node:test"),
  assert = require("node:assert/strict");
const { createFixture } = require("./fixture.cjs");
let f;
before(async () => {
  f = await createFixture({ crossDomain: true });
});
after(async () => {
  await f?.close();
});
async function q(role = "alice", extra = {}) {
  const r = await f.call(role, "POST", "/quotes", {
    goal: "コーヒーを学んで実際に試したい",
    ...extra,
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.quote;
}
async function pay(quote, key) {
  return f.call("alice", "POST", "/jobs", {
    quoteId: quote.id,
    termsVersion: quote.termsVersion,
    searchConsentVersion: quote.searchProfile.version,
    paymentConsent: true,
    aiConsent: true,
    balanceConsent: quote.contextPermissions.balance,
    achievementsConsent: quote.contextPermissions.achievements,
    requestId: key,
  });
}
test("native Lab service contract is read-only and cross-domain results come from real emulator documents", async () => {
  const before = (await f.db.collection("knowledge_lab_activity").get()).size;
  const quote = await q(),
    job = await pay(quote, "native-cross-accepted-0001");
  assert.equal(job.status, 200);
  await f.economy.tick();
  const result = await f.call("alice", "GET", "/jobs/" + job.body.job.id);
  assert.equal(result.body.job.state, "completed");
  assert.ok(result.body.job.result.steps.length);
  assert.ok(result.body.job.result.comparisons.length);
  assert.ok(
    new Set(result.body.job.result.results.map((s) => s.domain)).size >= 3,
  );
  assert.ok(
    result.body.job.result.results.every(
      (s) =>
        s.permission.operatorReviewed &&
        s.permission.authorAIConsent &&
        s.permission.public,
    ),
  );
  assert.equal(
    (await f.db.collection("knowledge_lab_activity").get()).size,
    before,
  );
  assert.equal(
    (await f.call("bob", "GET", "/jobs/" + job.body.job.id)).status,
    404,
  );
  assert.equal(
    JSON.stringify(f.providerPayloads).includes("economy-coffee-public"),
    false,
  );
});
test("native private-context API requires auth and explicit permission, rejects forged identity, and returns only own projected counts", async () => {
  assert.equal(
    (await f.call(null, "POST", "/context", { balanceConsent: true })).status,
    401,
  );
  assert.equal(
    (await f.call("guest", "POST", "/context", { balanceConsent: true }))
      .status,
    403,
  );
  assert.equal(
    (await f.call("light", "POST", "/context", { balanceConsent: true }))
      .status,
    403,
  );
  let r = await f.call("alice", "POST", "/context", {});
  assert.equal(r.body.context.balance.state, "not_consented");
  assert.equal(r.body.context.achievements.state, "not_consented");
  r = await f.call("alice", "POST", "/context", {
    balanceConsent: true,
    achievementsConsent: true,
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.context.achievements.starRecords, 1);
  assert.equal(r.body.context.achievements.questCertificateRecords, 1);
  assert.ok(
    !/PRIVATE-LABEL|OTHER-PERSON|SP-|wallet|mintedTo/.test(
      JSON.stringify(r.body),
    ),
  );
  assert.equal(
    (
      await f.call("alice", "POST", "/context", {
        achievementsConsent: true,
        spid: f.users.bob.spid,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.call("alice", "POST", "/context", {
        balanceConsent: true,
        uid: f.users.bob.uid,
      })
    ).status,
    400,
  );
});
test("native author-consent withdrawal removes saved references and associated steps while preserving history", async () => {
  await f.db
    .collection("posts")
    .doc("economy-coffee-public")
    .set(
      { knowledgeLab: { revision: 1, aiUseConsent: { allowed: false } } },
      { merge: true },
    );
  const list = await f.call("alice", "GET", "/jobs");
  const id = list.body.jobs[0].id;
  const r = await f.call("alice", "GET", "/jobs/" + id);
  assert.ok(
    !r.body.job.result.results.some((s) => s.id === "economy-coffee-public"),
  );
  assert.ok(
    r.body.job.result.steps.every(
      (s) => !s.references.includes("knowledge_lab:economy-coffee-public"),
    ),
  );
  assert.equal((await f.db.collection("emuer_v2_agent_jobs").get()).size, 1);
});
test("switching only cross search OFF restores original Guild quotes without changing price or user eligibility", async () => {
  // The registry and service share this config object; no Rules or canonical Lab data is changed.
  const env = f.economy.service.config();
  assert.equal(env.price, 5);
  const me = await f.call("pro", "GET", "/me");
  assert.equal(me.body.eligibility.eligible, true);
  const registry = f.economy.service.sources.cross;
  const a = await f.economy.service.actor({
    uid: f.users.alice.uid,
    account: f.users.alice.account,
    walletAddress: f.users.alice.account.walletAddress,
  });
  const snapshot = env.searchProfile;
  const material = await registry.collect(
    a,
    "知識を学ぶギルドを探したい",
    snapshot,
  );
  assert.ok(
    material.sources.some((s) => s.kind === "guild" && s.id === "learn"),
  );
  f.env.ECONOMY_CROSS_DOMAIN_ENABLED = "false";
  const legacy = await q("pro");
  assert.equal(legacy.price, 5);
  assert.equal(legacy.searchProfile, null);
  const original = await f.economy.service.sources.candidates(
    a,
    "知識を学ぶギルドを探す",
  );
  assert.ok(original.some((s) => s.kind === "guild" && s.id === "learn"));
});
