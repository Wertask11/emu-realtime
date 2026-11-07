"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict");
const { fixture } = require("./fixture");
const { configuration } = require("./config");
test("provider receives fixed intent and ephemeral aliases, never raw goal or source ID", async () => {
  const { createAgent } = require("./agent"), requests = [];
  const run = createAgent({
    env: { GEMINI_API_KEY: "isolated-test" },
    config: () => ({ model: "gemini-3.5-flash-lite", reserveTokens: 5000 }),
    fetcher: async (url, options) => {
      requests.push(options.body);
      return { ok: true, text: async () => JSON.stringify(url.endsWith(":countTokens")
        ? { totalTokens: 100 }
        : { usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10, totalTokenCount: 110 }, candidates: [{ content: { parts: [{ text: JSON.stringify({ matches: [{ key: "s0", evidence: "summary" }] }) }] } }] }) };
    },
  });
  const result = await run("架空テスト太郎、架空町一丁目でギルドを試したい", [{
    key: "guild:internal-source-id", id: "internal-source-id", kind: "guild",
    title: "実践を学ぶ", summary: "学びを試す活動", target: "/local-only",
  }]);
  assert.equal(requests.length, 2);
  for (const raw of requests) {
    assert.ok(!/架空テスト太郎|架空町|internal-source-id|local-only/.test(raw));
    const request = JSON.parse(raw), payload = request.generateContentRequest || request,
      input = JSON.parse(payload.contents[0].parts[0].text);
    assert.equal(input.goalType, "practice");
    assert.equal(input.goalDescription, "学んだ知識を実際に試すため、活動する場所（ギルド）やクエストの候補を探す。");
    assert.equal(input.sources[0].key, "s0");
    assert.equal(Object.hasOwn(input, "goal"), false);
  }
  assert.equal(result.results[0].id, "internal-source-id");
});
test("an empty provider selection remains empty; no candidate is invented", async () => {
  const { createAgent } = require("./agent");
  const run = createAgent({
    env: { GEMINI_API_KEY: "isolated-test" },
    config: () => ({ model: "gemini-3.5-flash-lite", reserveTokens: 5000 }),
    fetcher: async (url) => ({ ok: true, text: async () => JSON.stringify(
      url.endsWith(":countTokens") ? { totalTokens: 100 } : {
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 4, totalTokenCount: 104 },
        candidates: [{ content: { parts: [{ text: '{"matches":[]}' }] } }],
      },
    ) }),
  });
  const result = await run("イベントのチケットを探したい", [{
    key: "guild:learn", kind: "guild", id: "learn", title: "LEARN Guild",
    summary: "知識を、やってみるに変える。", target: "/local-only",
  }]);
  assert.deepEqual(result.results, []);
  assert.equal(result.outcome, "success");
  assert.equal(result.usage.providerCalled, true);
});
async function ready(opts) {
  const f = fixture(opts);
  await f.seed();
  f.a = await f.actor();
  return f;
}
async function body(f, key = "release-request-00001") {
  const q = await f.economy.service.quote(f.a, { goal: "コーヒーを学びたい" });
  return {
    requestId: key,
    quoteId: q.id,
    termsVersion: q.termsVersion,
    paymentConsent: true,
    aiConsent: true,
  };
}
async function pay(f, key) {
  return f.economy.service.submit(f.a, await body(f, key));
}
test("Founder approved daily budget is 100k, per-request reservation 5k and seven-day trial", async () => {
  const f = await ready(),
    c = f.economy.service.config();
  assert.equal(c.tokenBudget, 100000);
  assert.equal(c.reserveTokens, 5000);
  assert.equal(c.trialEndMs - c.trialStartMs, 7 * 86400000);
  assert.equal(
    configuration(
      { ...f.env, ECONOMY_EXPLORER_DAILY_TOKEN_BUDGET: "655360" },
      f.now(),
    ).enabled,
    false,
  );
  for (const name of [
    "ECONOMY_AI_BILLING_ATTESTED",
    "ECONOMY_AI_PROJECT_ATTESTED",
    "ECONOMY_BUDGET_APPROVAL_REF",
    "ECONOMY_GEMINI_PROJECT_ID",
  ])
    assert.equal(
      configuration({ ...f.env, [name]: "" }, f.now()).enabled,
      false,
    );
});
test("missing/expired trial, self-declared adulthood and stale worker never debit a user", async () => {
  const f = await ready();
  f.advance(7 * 86400000);
  await assert.rejects(body(f), /SERVICE_DISABLED/);
  assert.deepEqual(f.db._dump("mitemiru_orders"), {});
  const g = await ready();
  await g.economy.service
    .ref("eligibility", require("./config").hash(g.a.spid))
    .set({ adultDeclared: true, adultVerified: false }, { merge: true });
  await assert.rejects(body(g), /AI_AUDIENCE_NOT_VERIFIED/);
  const h = await ready();
  h.advance(90001);
  await assert.rejects(body(h), /WORKER_UNHEALTHY/);
  assert.deepEqual(h.db._dump("mitemiru_orders"), {});
});
test("reported input/output usage is recorded once separately from City and Lab", async () => {
  const f = await ready(),
    j = await pay(f);
  await f.economy.tick();
  await f.economy.tick();
  const u = (await f.economy.service.ref("usage", "2026-11-06").get()).data();
  assert.equal(u.reservedTokens, 5000);
  assert.equal(u.observedTokens, 110);
  assert.equal(u.inputTokens, 100);
  assert.equal(u.outputTokens, 10);
  assert.equal((await f.economy.service.view(f.a, j.id)).state, "completed");
  assert.deepEqual(f.db._dump("knowledge_lab_ai_usage"), {});
  assert.deepEqual(f.db._dump("emuer_v2_access_usage"), {});
});
test("exhausted token budget refuses before order/payment creation", async () => {
  const f = await ready();
  await f.economy.service
    .ref("usage", "2026-11-06")
    .set({ count: 0, reservedTokens: 100000, observedTokens: 80000 });
  await assert.rejects(pay(f), /AI_BUDGET_LIMIT/);
  assert.deepEqual(f.db._dump("mitemiru_orders"), {});
});
test("oversized prompt refuses before inference, paid attempt is fully refunded", async () => {
  const f = await ready({ countTokens: 4000 }),
    j = await pay(f);
  await f.economy.tick();
  assert.equal(f.calls(), 0);
  assert.equal((await f.economy.service.view(f.a, j.id)).state, "refunded");
});
test("unknown provider usage or usage beyond target freezes new admissions and refunds", async () => {
  for (const usageMetadata of [
    {},
    {
      promptTokenCount: 100,
      candidatesTokenCount: 5001,
      totalTokenCount: 5101,
    },
  ]) {
    const f = await ready({ usageMetadata }),
      j = await pay(f);
    await f.economy.tick();
    assert.equal((await f.economy.service.view(f.a, j.id)).state, "refunded");
    assert.equal((await f.economy.service.status()).service.enabled, false);
    await assert.rejects(body(f, "new-request-after-stop"), /SERVICE_DISABLED/);
    const u = (await f.economy.service.ref("usage", "2026-11-06").get()).data();
    assert.equal(u.reservedTokens, 5000);
    assert.ok(u.unknownCalls === 1 || u.observedTokens === 5101);
  }
});
test("read-only public status needs no authentication or database and exposes no credentials", async () => {
  const f = await ready({ env: { ECONOMY_EXPLORER_ENABLED: "false" } });
  f.db.collection = () => {
    throw Error("MUST_NOT_READ_DB");
  };
  const server = f.app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  try {
    const r = await fetch(
        "http://127.0.0.1:" + server.address().port + "/api/economy/status",
      ),
      d = await r.json();
    assert.equal(r.status, 200);
    assert.equal(d.service.enabled, false);
    assert.equal(d.service.dailyTokens, 100000);
    assert.equal(d.walletPaymentEnabled, false);
    assert.equal(d.externalExchangeExecutable, false);
    assert.ok(!JSON.stringify(d).includes("isolated-test"));
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
});
test("worker failure closes readiness and recovery refreshes heartbeat without recharging", async () => {
  const f = await ready(),
    j = await pay(f),
    original = f.economy.service.tick;
  f.economy.service.tick = async () => {
    throw Error("not for logs");
  };
  await f.economy.tick();
  assert.equal(
    (await f.economy.service.ref("system", "worker-health").get()).data()
      .healthy,
    false,
  );
  await assert.rejects(body(f, "after-worker-failure"), /WORKER_UNHEALTHY/);
  f.economy.service.tick = original;
  await f.economy.tick();
  assert.equal((await f.economy.service.view(f.a, j.id)).state, "completed");
  assert.equal(Object.keys(f.db._dump("mitemiru_orders")).length, 1);
});
test("source withdrawal during token preflight prevents the inference call and refunds", async () => {
  const f = await ready();
  let scans = 0;
  f.economy.service.sources.candidates = async () =>
    ++scans === 1 ? [f.source] : [];
  const j = await pay(f);
  await f.economy.tick();
  assert.equal(f.calls(), 0);
  assert.equal((await f.economy.service.view(f.a, j.id)).state, "refunded");
});
