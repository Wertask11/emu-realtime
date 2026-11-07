"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict");
const { crossFixture } = require("./search/test-support");
const { profile, DOMAINS, PURPOSE } = require("./search/profile");
const { hash } = require("./config");
const { plan, rank } = require("./search/planner");
const targets = require("../../frontend/public/economy/targets");
const { createAgent } = require("./agent");
const { resolve } = require("./search/synthesis");
function totals(f) {
  return (
    Object.values(f.db._dump("emuer_v2_rewards"))
      .filter((v) => v.status === "pending")
      .reduce((n, v) => n + BigInt(v.amountWei), 0n) /
    10n ** 18n
  );
}
test("all cross-domain and private flags are OFF by default; independent source flags are explicit", () => {
  assert.equal(profile({}), null);
  assert.equal(profile({ ECONOMY_CROSS_DOMAIN_ENABLED: "true" }), null);
  assert.deepEqual(
    profile({
      ECONOMY_CROSS_DOMAIN_ENABLED: "true",
      ECONOMY_SOURCE_GUILD: "true",
    }).domains,
    ["guild"],
  );
});
test("predefined concepts find semantic candidates without lexical matches or sending arbitrary personal words", async () => {
  const f = await crossFixture();
  const goal = "美容師の架空テスト太郎としての経験を誰かの役に立てたい",
    bundle = await f.registry.collect(f.a, goal, profile(f.env));
  assert.ok(bundle.sources.some((s) => s.domain === "knowledge_lab"));
  assert.ok(bundle.sources.some((s) => s.kind === "guild"));
  assert.ok(bundle.sources.some((s) => s.kind === "service_guide"));
  const j = await f.economy.service.submit(f.a, await f.request(goal));
  await f.economy.tick();
  const done = await f.economy.service.view(f.a, j.id);
  assert.equal(done.state, "completed");
  assert.ok(done.result.steps.length);
  assert.ok(done.result.comparisons.length);
  assert.ok(new Set(done.result.results.map((s) => s.domain)).size > 1);
  const payload = JSON.stringify(f.payloads);
  assert.ok(
    !/架空テスト太郎|SP-AAAA|PRIVATE|OTHER-PERSON|experience|challenge/.test(
      payload,
    ),
  );
  assert.ok(payload.includes("美容"));
  assert.equal(totals(f), 95n);
});
test("public visibility, author AI refusal, private documents, and expired products are excluded even with stale index entries", async () => {
  const f = await crossFixture(),
    b = await f.registry.collect(
      f.a,
      "美容師の経験とWeb3商品を比較したい",
      profile(f.env),
    );
  for (const id of ["refused", "private", "draft", "expired", "privateproduct"])
    assert.ok(!b.sources.some((s) => s.id === id));
  assert.ok(
    f.reads
      .filter((r) =>
        ["sp_guilds", "sp_quests", "mitemiru_products"].includes(r.collection),
      )
      .every(
        (r) =>
          r.fields &&
          !r.fields.some((k) => /member|participant|wallet|uid|author/.test(k)),
      ),
  );
  assert.equal(f.db._count("knowledge_lab_metrics"), 0);
});
test("operator review is separate from public/author consent, expires, and binds the exact current text", async () => {
  const f = await crossFixture(),
    r = f.db
      .collection("emuer_v2_agent_source_approvals")
      .doc(hash("knowledge_lab:experience"));
  await r.set({ aiUseApproved: false }, { merge: true });
  let b = await f.registry.collect(
    f.a,
    "美容師としての経験を残したい",
    profile(f.env),
  );
  assert.ok(!b.sources.some((s) => s.id === "experience"));
  await r.set(
    { aiUseApproved: true, validUntilMs: f.now() - 1 },
    { merge: true },
  );
  b = await f.registry.collect(f.a, "美容師の経験を残す", profile(f.env));
  assert.ok(!b.sources.some((s) => s.id === "experience"));
  await r.set({ validUntilMs: f.now() + 100000 }, { merge: true });
  await f.db
    .collection("posts")
    .doc("experience")
    .set({ body: "変更後の本文" }, { merge: true });
  b = await f.registry.collect(f.a, "美容師の経験を残す", profile(f.env));
  assert.ok(!b.sources.some((s) => s.id === "experience"));
});
test("a failing source is isolated and reported, never represented as searched successfully", async () => {
  const f = await crossFixture();
  f.registry.adapters.quest.list = async () => {
    throw Error("PRIVATE-ERROR-MUST-NOT-LEAVE");
  };
  const j = await f.economy.service.submit(f.a, await f.request());
  await f.economy.tick();
  const done = await f.economy.service.view(f.a, j.id);
  assert.equal(done.state, "completed");
  assert.equal(
    done.result.coverage.find((x) => x.domain === "quest").state,
    "unavailable",
  );
  assert.ok(done.result.limitations.some((v) => v.includes("クエスト")));
  assert.ok(!JSON.stringify(done).includes("PRIVATE-ERROR"));
});
test("same request retries charge once; changing quote conflicts, and scope change rejects before payment", async () => {
  const f = await crossFixture(),
    b = await f.request();
  const jobs = await Promise.all([
    f.economy.service.submit(f.a, b),
    f.economy.service.submit(f.a, b),
  ]);
  assert.equal(jobs[0].id, jobs[1].id);
  assert.equal(totals(f), 95n);
  await f.economy.tick();
  assert.equal(f.calls(), 1);
  const q = await f.request();
  await assert.rejects(
    f.economy.service.submit(f.a, { ...q, requestId: b.requestId }),
    /IDEMPOTENCY_KEY_CONFLICT/,
  );
  f.env.ECONOMY_SOURCE_CITY = "false";
  await assert.rejects(
    f.economy.service.submit(f.a, {
      ...q,
      requestId: "different-request-00001",
    }),
    /QUOTE_EXPIRED_OR_CHANGED/,
  );
  assert.equal(totals(f), 95n);
});
for (const name of ["missing cross consent", "Free", "Light"])
  test(name + " is rejected without debit", async () => {
    const f = await crossFixture();
    let a = f.a,
      b;
    if (name === "missing cross consent") {
      b = await f.request();
      delete b.searchConsentVersion;
      await assert.rejects(
        f.economy.service.submit(a, b),
        /QUOTE_EXPIRED_OR_CHANGED/,
      );
    } else {
      f.entitlement.getEntitlement = async () => ({
        plan: name === "Free" ? "guest" : "light",
      });
      await assert.rejects(
        f.economy.service.quote(a, { goal: "Web3" }),
        /SERVICE_NOT_ELIGIBLE/,
      );
    }
    assert.equal(totals(f), 100n);
  });
test("cross switch OFF preserves old Guild jobs, but refunds a paid cross job before any provider call", async () => {
  const f = await crossFixture();
  const j = await f.economy.service.submit(f.a, await f.request());
  f.env.ECONOMY_CROSS_DOMAIN_ENABLED = "false";
  await f.economy.tick();
  const done = await f.economy.service.view(f.a, j.id);
  assert.equal(done.state, "refunded");
  assert.equal(f.calls(), 0);
  assert.equal(totals(f), 100n);
  const q = await f.economy.service.quote(f.a, { goal: "コーヒーを学ぶ" });
  assert.equal(q.searchProfile, null);
  const old = await f.economy.service.submit(f.a, {
    quoteId: q.id,
    termsVersion: q.termsVersion,
    requestId: "legacy-profile-request-0001",
    paymentConsent: true,
    aiConsent: true,
  });
  f.env.ECONOMY_CROSS_DOMAIN_ENABLED = "true";
  await f.economy.tick();
  assert.equal((await f.economy.service.view(f.a, old.id)).state, "completed");
});
for (const status of [429, 404, 503])
  test("Gemini " + status + " causes full refund and safety stop", async () => {
    const f = await crossFixture({ providerStatus: status }),
      j = await f.economy.service.submit(f.a, await f.request());
    await f.economy.tick();
    assert.equal((await f.economy.service.view(f.a, j.id)).state, "refunded");
    assert.equal(totals(f), 100n);
    assert.equal((await f.economy.service.status()).service.enabled, false);
  });
test("Gemini timeout refunds and preserves durable history", async () => {
  const f = await crossFixture({ providerTimeout: true }),
    j = await f.economy.service.submit(f.a, await f.request());
  await f.economy.tick();
  assert.equal((await f.economy.service.view(f.a, j.id)).state, "refunded");
  assert.equal((await f.economy.service.history(f.a)).length, 1);
  assert.equal(totals(f), 100n);
});
test("withdrawn permission removes saved references and dependent proposals without rewriting the original result", async () => {
  const f = await crossFixture(),
    j = await f.economy.service.submit(
      f.a,
      await f.request("美容師としての経験を残す"),
    );
  await f.economy.tick();
  const original = (await f.economy.service.ref("jobs", j.id).get()).data()
    .result;
  await f.db
    .collection("posts")
    .doc("experience")
    .set({ visibility: "private" }, { merge: true });
  const seen = await f.economy.service.view(f.a, j.id);
  assert.ok(!seen.result.results.some((s) => s.id === "experience"));
  assert.ok(
    seen.result.steps.every(
      (s) => !s.references.includes("knowledge_lab:experience"),
    ),
  );
  assert.ok(original.results.some((s) => s.id === "experience"));
});
test("own balances/achievements need explicit permissions and never enter provider payload or someone else records", async () => {
  const f = await crossFixture();
  const unallowed = await f.registry.privateContext(f.a, {});
  assert.equal(unallowed.achievements.state, "not_consented");
  assert.equal(unallowed.balance.state, "not_consented");
  const c = await f.registry.privateContext(f.a, {
    balance: true,
    achievements: true,
  });
  assert.equal(c.balance.spendable, "100");
  assert.equal(c.achievements.starRecords, 1);
  assert.equal(c.achievements.questCertificateRecords, 1);
  const j = await f.economy.service.submit(
    f.a,
    await f.request("今のEMUERで何ができる？", {
      balanceConsent: true,
      achievementsConsent: true,
    }),
  );
  await f.economy.tick();
  const done = await f.economy.service.view(f.a, j.id);
  assert.equal(done.state, "completed");
  assert.equal(done.result.privateContext.balance.applied, true);
  assert.ok(
    !/PRIVATE-LABEL|OTHER-PERSON|SP-AAAA|spendable|achievements|wallet|95/.test(
      JSON.stringify(f.payloads),
    ),
  );
  assert.equal(done.result.privateContext.achievements.starRecords, 1);
  await assert.rejects(
    f.economy.service.view(await f.actor("bob"), j.id),
    /JOB_NOT_FOUND/,
  );
});
test("unknown IDs, URLs and unsupported write actions from the provider are rejected", async () => {
  const f = await crossFixture(),
    b = await f.registry.collect(f.a, "Web3を試したい", profile(f.env));
  const rows = b.sources.map((s, i) => ({ ...s, key: "s" + i }));
  for (const value of [
    {
      matches: [{ key: "made-up", evidence: "summary" }],
      steps: [],
      comparisons: [],
    },
    {
      matches: [
        { key: "s0", evidence: "summary", url: "https://evil.invalid" },
      ],
      steps: [],
      comparisons: [],
    },
    {
      matches: [{ key: "s0", evidence: "summary" }],
      steps: [{ key: "s0", action: "auto_purchase" }],
      comparisons: [],
    },
  ])
    assert.throws(() => resolve(value, rows), /AI_INVALID/);
  assert.equal(targets.allowed("https://evil.invalid"), false);
  assert.equal(
    targets.allowed("/?lab=library&labPost=valid&token=leak"),
    false,
  );
  assert.equal(
    targets.allowed(
      "/schoolpark/dao.html?screen=experiments&explorerQuest=valid",
    ),
    true,
  );
});
test("oversized semantic candidates fail inside the existing 5000-token reservation, with no generation or charge retained", async () => {
  const f = await crossFixture({ countTokens: 4000 }),
    j = await f.economy.service.submit(f.a, await f.request());
  await f.economy.tick();
  assert.equal(f.calls(), 0);
  assert.equal((await f.economy.service.view(f.a, j.id)).state, "refunded");
  assert.equal(totals(f), 100n);
});
test("current access/AI consent is rechecked after token preflight before generation", async () => {
  let f;
  f = await crossFixture({
    onCount: async () => {
      await f.db
        .collection("posts")
        .doc("experience")
        .set({ visibility: "private" }, { merge: true });
    },
  });
  const j = await f.economy.service.submit(
    f.a,
    await f.request("美容師の経験を残す"),
  );
  await f.economy.tick();
  assert.equal(f.calls(), 0);
  assert.equal((await f.economy.service.view(f.a, j.id)).state, "refunded");
});
test("single-domain mode, content origin binding, bounded output and topic synonyms remain explicit", async () => {
  const f = await crossFixture({
    env: {
      ...Object.fromEntries(
        Object.keys(DOMAINS)
          .filter((d) => d !== "guild")
          .map((d) => ["ECONOMY_SOURCE_" + d.toUpperCase(), "false"]),
      ),
    },
  });
  const b = await f.registry.collect(
    f.a,
    "分散型の技術を勉強して試したい",
    profile(f.env),
  );
  assert.ok(b.sources.length);
  assert.ok(b.sources.every((s) => s.kind === "guild"));
  assert.ok(b.sources.length <= 12);
  assert.ok(
    plan("ヘアサロンで働いた経験を共有したい").topics.includes("beauty"),
  );
  const s = await f.registry.adapters.service.get("posting");
  await f.db
    .collection("emuer_v2_agent_source_approvals")
    .doc(hash(s.key))
    .set({ originHash: "changed" }, { merge: true });
  assert.equal(await f.registry.reviewed(s), null);
  assert.equal(targets.target("service_guide", "__proto__"), null);
  assert.equal(targets.target("service_guide", "toString"), null);
});
test("disabling new cross search leaves previously paid history readable with fresh source checks", async () => {
  const f = await crossFixture(),
    j = await f.economy.service.submit(f.a, await f.request());
  await f.economy.tick();
  f.env.ECONOMY_CROSS_DOMAIN_ENABLED = "false";
  const done = await f.economy.service.view(f.a, j.id);
  assert.equal(done.state, "completed");
  assert.ok(done.result.results.length);
  assert.ok(done.result.limitations.some((s) => s.includes("新規受付は停止")));
  assert.equal(f.calls(), 1);
});
