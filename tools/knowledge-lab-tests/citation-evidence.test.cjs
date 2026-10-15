"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  createGemini,
  evidenceSources,
  resolveAnalysis,
  validateAnalysis,
  CLAIM_KEYS,
} = require("../../backend/knowledge-lab/gemini");
const sources = [
  {
    id: "real-a",
    title: "整えてみた記録",
    body: "疲れていたので、まず休む時間を取りました。\n　予定を一つ減らしたら、少し落ち着きました。「少しずつ」でよさそうです。🌱",
  },
  {
    id: "real-b",
    title: "学ぶ機会の違い",
    body: "学べる条件は人それぞれだと気づきました。相手の事情を聞いて、無理なく試せる方法を考えています。",
  },
];
function answer(evidence) {
  const claim = (s) => ({
    text: "検証が必要な考えです。",
    citations: [{ sourceId: s.id, evidenceId: s.evidence.at(-1).id }],
  });
  return Object.fromEntries(
    CLAIM_KEYS.map((k) => [
      k,
      k === "summaries" ? evidence.map(claim) : [claim(evidence[0])],
    ]),
  );
}
test("server resolves every evidence ID to an exact original excerpt, without model transcription", async () => {
  let sent;
  const provider = createGemini({
    env: {
      GEMINI_API_KEY: "mock-only-key",
      GEMINI_FREE_TIER_CONFIRMED: "true",
      KNOWLEDGE_LAB_AI_ENABLED: "true",
    },
    fetcher: async (url, opts) => {
      if (opts.method === "GET")
        return Response.json({
          models: [
            {
              name: "models/gemini-test-flash",
              supportedGenerationMethods: ["generateContent"],
            },
          ],
        });
      sent = JSON.parse(opts.body);
      const input = JSON.parse(sent.contents[0].parts[0].text);
      assert.ok(
        input.sources.every(
          (s) => !Object.hasOwn(s, "body") && s.evidence.length,
        ),
      );
      return Response.json({
        candidates: [
          {
            finishReason: "STOP",
            content: {
              parts: [{ text: JSON.stringify(answer(input.sources)) }],
            },
          },
        ],
        usageMetadata: { totalTokenCount: 30 },
      });
    },
  });
  const result = await provider.analyze("gemini-test-flash", [], sources);
  const citationSchema =
    sent.generationConfig.responseSchema.properties.hypotheses.items.properties
      .citations.items;
  assert.deepEqual(citationSchema.required, ["sourceId", "evidenceId"]);
  assert.deepEqual(
    citationSchema.properties.sourceId.enum,
    sources.map((s) => s.id),
  );
  assert.ok(!Object.hasOwn(citationSchema.properties, "quote"));
  for (const claims of Object.values(result.analysis))
    for (const claim of claims)
      for (const c of claim.citations) {
        const s = sources.find((s) => s.id === c.sourceId);
        assert.ok(s.body.includes(c.quote) || s.title.includes(c.quote));
        assert.deepEqual(Object.keys(c).sort(), ["quote", "sourceId"]);
      }
  assert.equal(
    result.analysis.hypotheses[0].citations[0].quote,
    sources[0].body,
  );
  assert.equal(result.usage.totalTokens, 30);
});
test("invented evidence, cross-source IDs, and model-written quotes still fail closed", () => {
  const evidence = evidenceSources(sources);
  for (const citation of [
    { sourceId: sources[0].id, evidenceId: "invented" },
    { sourceId: "invented", evidenceId: evidence[0].evidence[0].id },
    { sourceId: sources[1].id, evidenceId: evidence[0].evidence[0].id },
    {
      sourceId: sources[0].id,
      evidenceId: evidence[0].evidence[0].id,
      quote: "AIが言い換えた文章",
    },
    { sourceId: sources[0].id, quote: sources[0].body },
  ]) {
    const value = answer(evidence);
    value.hypotheses[0].citations = [citation];
    assert.throws(
      () => resolveAnalysis(value, sources, evidence),
      /AI_INVALID_CITATION/,
    );
  }
  const value = answer(evidence);
  value.summaries.pop();
  assert.throws(
    () => resolveAnalysis(value, sources, evidence),
    /AI_MISSING_SOURCE_SUMMARY/,
  );
});
test("bounded Japanese/Unicode excerpts preserve original characters and cannot grow schema per sentence", () => {
  const s = {
    id: "long",
    title: "長い原文",
    body: "🌱a。\n".repeat(700).slice(0, 3000),
  };
  const evidence = evidenceSources([s])[0].evidence;
  assert.ok(evidence.length <= 32);
  for (const e of evidence) {
    assert.ok(e.quote.length <= 400 && e.quote.length >= 3);
    assert.ok(s.body.includes(e.quote) || s.title.includes(e.quote));
    assert.ok(e.quote.isWellFormed());
  }
  assert.throws(
    () => evidenceSources([{ id: "tiny", title: "a", body: "b" }]),
    /AI_SOURCE_EVIDENCE_MISSING/,
  );
});
test("restored quotations remain subject to the independent original-text validation", () => {
  const evidence = evidenceSources(sources),
    value = answer(evidence);
  evidence[0].evidence.at(-1).quote = "存在しない原文";
  assert.throws(
    () => resolveAnalysis(value, sources, evidence),
    /AI_INVALID_CITATION/,
  );
  assert.throws(
    () => validateAnalysis({ summaries: [] }, sources),
    /AI_INVALID_OUTPUT/,
  );
});
