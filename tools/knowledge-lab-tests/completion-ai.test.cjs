"use strict";
// Provider responses here are mocks, for safety/regression only. These are NOT real Gemini success evidence.
const { test, before, after } = require("node:test"),
  assert = require("node:assert/strict");
const { createFixture } = require("./fixture.cjs"),
  {
    createGemini,
    validateAnalysis,
    makeSources,
    CLAIM_KEYS,
  } = require("../../backend/knowledge-lab/gemini");
let f,
  alice,
  owner,
  ids,
  run,
  requests = [],
  malformed = false,
  quota = false;
const actor = (role) => ({
  ...f.users[role],
  walletAddress: f.users[role].account.walletAddress.toLowerCase(),
  owner: role === "owner",
});
const response = (d) =>
  new Response(JSON.stringify(d), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
async function mock(url, opts) {
  requests.push({ url, method: opts.method });
  assert.equal(url.includes("emulator-provider-key"), false);
  assert.equal(opts.headers["x-goog-api-key"], "emulator-provider-key");
  if (url.includes("models?page"))
    return response({
      models: [
        {
          name: "models/gemini-test-flash",
          supportedGenerationMethods: ["generateContent"],
        },
        {
          name: "models/gemini-embedding-001",
          supportedGenerationMethods: ["embedContent"],
        },
      ],
    });
  if (quota)
    return new Response(
      JSON.stringify({
        error: { message: "do not expose raw body or credentials" },
      }),
      { status: 429 },
    );
  const data = JSON.parse(opts.body),
    input = JSON.parse(data.contents[0].parts[0].text);
  const analysis = Object.fromEntries(CLAIM_KEYS.map((k) => [k, []]));
  analysis.summaries = input.sources.map((s) => ({
    text: "投稿の要点",
    citations: [{ sourceId: s.id, quote: s.body.slice(0, 12) }],
  }));
  analysis.hypotheses = [
    {
      text: "異なる現場でも小さく試せるかという未検証の問い",
      citations: [
        {
          sourceId: input.sources[0].id,
          quote: input.sources[0].body.slice(0, 12),
        },
      ],
    },
  ];
  analysis.cautions = [
    {
      text: "条件は現場ごとに異なる。検証が必要。",
      citations: [
        {
          sourceId: input.sources[1].id,
          quote: input.sources[1].body.slice(0, 12),
        },
      ],
    },
  ];
  if (malformed)
    analysis.hypotheses[0].citations[0].sourceId = "invented-source";
  return response({
    candidates: [
      {
        finishReason: "STOP",
        content: { parts: [{ text: JSON.stringify(analysis) }] },
      },
    ],
    usageMetadata: {
      promptTokenCount: 100,
      candidatesTokenCount: 200,
      totalTokenCount: 300,
    },
  });
}
before(async () => {
  f = await createFixture({
    aiEnv: {
      GEMINI_API_KEY: "emulator-provider-key",
      GEMINI_FREE_TIER_CONFIRMED: "true",
      KNOWLEDGE_LAB_AI_ENABLED: "true",
    },
    aiFetcher: mock,
  });
  alice = actor("alice");
  owner = actor("owner");
  ids = [];
  for (const [i, field] of ["field-education", "field-it"].entries()) {
    ids.push(
      (
        await f.api.service.savePost(alice, {
          key: "ai-source-" + i,
          title: "現場で小さく試した経験" + i,
          body: "現場で小さく試してから準備を整えました。これは自己申告の経験です。",
          visibility: "public",
          aiUseConsent: true,
          facets: { field: [field] },
        })
      ).id,
    );
  }
});
after(async () => {
  await f?.close();
});
const input = () => ({
  sourceIds: ids,
  fields: ["field-education", "field-it"],
  externalAIConsent: true,
});
test("AI disabled by default and absence of free-tier attestation prevents provider calls", async () => {
  const provider = createGemini({
    env: { GEMINI_API_KEY: "unused" },
    fetcher: () => {
      throw Error("MUST_NOT_CALL");
    },
  });
  assert.equal(provider.configured(), false);
  await assert.rejects(
    provider.analyze("gemini-test-flash", [], []),
    /AI_DISABLED/,
  );
  assert.equal(
    (await f.call("POST", "/ai/analyze", "alice", input())).status,
    503,
  );
});
test("only Owner configures actual listed models; no paid-model or fake-model fallback", async () => {
  const config = {
    model: "gemini-test-flash",
    embeddingModel: "gemini-embedding-001",
    freeTierAttested: true,
  };
  assert.equal((await f.call("PUT", "/admin/ai", "alice", config)).status, 403);
  assert.equal(
    (
      await f.call("PUT", "/admin/ai", "owner", {
        ...config,
        freeTierAttested: false,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.call("PUT", "/admin/ai", "owner", {
        ...config,
        model: "gemini-pro",
      })
    ).status,
    400,
  );
  assert.equal((await f.call("PUT", "/admin/ai", "owner", config)).status, 200);
});
test("private, non-consenting and obvious sensitive sources are rejected before provider inference", async () => {
  const p = {
    id: "source",
    title: "知識",
    body: "知識の本文です",
    visibility: "public",
    knowledgeLab: { aiUseConsent: { allowed: true } },
  };
  for (const bad of [
    { ...p, visibility: "private" },
    { ...p, knowledgeLab: {} },
    { ...p, body: "連絡先 test@example.com" },
  ])
    assert.throws(
      () => makeSources([p, bad], Date.now()),
      /AI_SOURCE_CONSENT_REQUIRED|AI_SENSITIVE_SOURCE/,
    );
  assert.equal(
    (
      await f.call("POST", "/ai/analyze", "alice", {
        ...input(),
        externalAIConsent: false,
      })
    ).status,
    403,
  );
});
test("real emulator sources feed mock provider; output retains exact citations, model and unverified status", async () => {
  const result = await f.call("POST", "/ai/analyze", "alice", input());
  assert.equal(result.status, 200);
  run = result.body;
  assert.equal(run.origin, "ai-hypothesis");
  assert.equal(run.verification, "unverified");
  assert.equal(run.model, "gemini-test-flash");
  assert.ok(
    run.analysis.hypotheses[0].citations.every((c) => ids.includes(c.sourceId)),
  );
  assert.equal(run.sources[0].body, undefined);
  assert.equal((await f.call("GET", "/ai/runs/" + run.id, "bob")).status, 404);
});
test("cache uses the same Passport and actual source version; no second inference call", async () => {
  const before = requests.filter((r) => r.method === "POST").length;
  const again = await f.call("POST", "/ai/analyze", "alice", input());
  assert.equal(again.status, 200);
  assert.equal(again.body.cacheHit, true);
  assert.equal(requests.filter((r) => r.method === "POST").length, before);
});
test("automatic field retrieval uses real consenting public posts and reports missing sources instead of inventing them", async () => {
  await f.api.service.rebuild(owner);
  await f.api.service.waitForRebuild();
  const automatic = await f.call("POST", "/ai/analyze", "owner", {
    ...input(),
    sourceIds: [],
  });
  assert.equal(automatic.status, 200);
  assert.deepEqual(
    automatic.body.sources.map((s) => s.id).sort(),
    [...ids].sort(),
  );
  const before = requests.length;
  const missing = await f.call("POST", "/ai/analyze", "owner", {
    sourceIds: [],
    fields: ["field-money", "field-beauty"],
    externalAIConsent: true,
  });
  assert.equal(missing.status, 409);
  assert.equal(missing.body.error, "AI_INSUFFICIENT_CONSENTED_SOURCES");
  assert.equal(requests.length, before);
});
test("research saves AI provenance, retains it across human edits and private history", async () => {
  const data = {
    key: "ai-note-save",
    title: "AIからの研究ノート",
    sourceIds: ids,
    fields: input().fields,
    visibility: "private",
    aiRunId: run.id,
    hypothesis: "人間が確認して編集した未検証の仮説",
  };
  const save = await f.call("PUT", "/notes", "alice", data);
  assert.equal(save.status, 200);
  const n = (await f.call("GET", "/notes/" + save.body.id, "alice")).body;
  assert.equal(n.aiModel, "gemini-test-flash");
  assert.deepEqual(n.aiAnalysis, run.analysis);
  const edit = await f.call("PUT", "/notes", "alice", {
    ...data,
    key: "ai-note-edit",
    id: n.id,
    revision: 1,
    result: "実践した結果の自己申告",
  });
  assert.equal(edit.status, 200);
  assert.equal(
    (await f.call("GET", "/notes/" + n.id + "/history", "bob")).status,
    404,
  );
  assert.equal(
    (await f.call("PUT", "/notes", "bob", { ...data, key: "stolen-run" }))
      .status,
    404,
  );
});
test("fabricated citations and invented quotes never become a valid analysis", () => {
  const src = { id: "known", title: "検証する", body: "元の本文そのもの" };
  const data = Object.fromEntries(CLAIM_KEYS.map((k) => [k, []]));
  data.summaries = [
    { text: "要点", citations: [{ sourceId: "known", quote: src.body }] },
  ];
  data.hypotheses = [
    {
      text: "未検証仮説",
      citations: [{ sourceId: "invented", quote: "架空の引用" }],
    },
  ];
  data.cautions = data.summaries;
  assert.throws(() => validateAnalysis(data, [src]), /AI_INVALID_CITATION/);
  data.hypotheses[0].citations = [
    { sourceId: "known", quote: "存在しない原文" },
  ];
  assert.throws(() => validateAnalysis(data, [src]), /AI_INVALID_CITATION/);
});
test("forced reanalysis creates an immutable new generation and an explicit manual continuation preserves previous AI provenance in history", async () => {
  const refreshed = await f.call("POST", "/ai/analyze", "alice", {
    ...input(),
    forceRefresh: true,
    key: "generation-2",
  });
  assert.equal(refreshed.status, 200);
  assert.notEqual(refreshed.body.id, run.id);
  const repeat = await f.call("POST", "/ai/analyze", "alice", {
    ...input(),
    forceRefresh: true,
    key: "generation-2",
  });
  assert.equal(repeat.body.id, refreshed.body.id);
  assert.deepEqual(
    (await f.call("GET", "/ai/runs/" + run.id, "alice")).body.analysis,
    run.analysis,
  );
  const saved = await f.call("PUT", "/notes", "alice", {
    key: "manual-branch-source",
    title: "手動へ続ける研究",
    sourceIds: ids,
    fields: input().fields,
    aiRunId: run.id,
    hypothesis: "AIを確認した仮説",
  });
  assert.equal(saved.status, 200);
  const changed = {
    key: "manual-branch-edit",
    id: saved.body.id,
    revision: 1,
    title: "元知識を選び直す",
    sourceIds: ids,
    fields: [...input().fields, "field-mind"],
    hypothesis: "人が更新した仮説",
  };
  assert.equal((await f.call("PUT", "/notes", "alice", changed)).status, 409);
  assert.equal(
    (await f.call("PUT", "/notes", "alice", { ...changed, aiRunId: null }))
      .status,
    200,
  );
  const history = await f.call(
    "GET",
    "/notes/" + saved.body.id + "/history",
    "alice",
  );
  assert.equal(history.body.current.aiRunId, undefined);
  assert.equal(history.body.items[0].previous.aiRunId, run.id);
  assert.deepEqual(history.body.items[0].previous.aiAnalysis, run.analysis);
});
test("revoking source consent invalidates run access and cache retrieval", async () => {
  const p = (await f.call("GET", "/posts/" + ids[0], "alice")).body;
  await f.api.service.savePost(alice, {
    key: "revoke-ai",
    id: p.id,
    revision: p.revision,
    title: p.title,
    body: p.body,
    facets: p.facets,
    visibility: "public",
    aiUseConsent: false,
  });
  assert.equal(
    (await f.call("GET", "/ai/runs/" + run.id, "alice")).status,
    403,
  );
});
test("global semaphore and daily quota cannot be bypassed by parallel requests or retries", async () => {
  const b = f.api.ai.budget;
  let started = 0,
    ready,
    release;
  const begun = new Promise((r) => (ready = r)),
    held = new Promise((r) => (release = r));
  const slow = async () => {
    if (++started === 2) ready();
    await held;
    return { usage: { totalTokens: 1 } };
  };
  const active = [
    b.call(owner, "embedding", slow),
    b.call(owner, "embedding", slow),
  ];
  await begun;
  await assert.rejects(b.call(owner, "embedding", slow), /AI_BUSY/);
  release();
  await Promise.all(active);
  await f.api.service
    .ref(
      "ai_user_usage",
      require("../../backend/knowledge-lab/model").hash([
        new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10),
        owner.spid,
      ]),
    )
    .set({ analysis: 3 }, { merge: true });
  await assert.rejects(b.call(owner, "analysis", slow), /AI_DAILY_LIMIT/);
});
test("Owner stop refuses new executions without contacting the provider", async () => {
  assert.equal(
    (await f.call("PUT", "/admin/ai", "owner", { stopped: true })).status,
    200,
  );
  const before = requests.length;
  assert.equal(
    (await f.call("POST", "/ai/analyze", "alice", input())).status,
    503,
  );
  assert.equal(requests.length, before);
});
