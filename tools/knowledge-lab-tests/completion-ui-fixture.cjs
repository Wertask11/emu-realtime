"use strict";
// UI and persistence verification ONLY. Gemini responses and vectors are MOCKS, not real API proof.
const { CLAIM_KEYS } = require("../../backend/knowledge-lab/gemini");
const reply = (value) => new Response(JSON.stringify(value), { status: 200 });
async function providerMock(url, opts) {
  if (opts.method === "GET")
    return reply({
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
  const input = JSON.parse(opts.body),
    vector = (text) =>
      Array.from({ length: 768 }, (_, i) =>
        i === (text.includes("教育") ? 0 : 1) ? 1 : 0,
      );
  if (url.endsWith(":batchEmbedContents"))
    return reply({
      embeddings: input.requests.map((r) => ({
        values: vector(r.content.parts[0].text),
      })),
    });
  if (url.endsWith(":embedContent"))
    return reply({
      embedding: { values: vector(input.content.parts[0].text) },
    });
  const src = JSON.parse(input.contents[0].parts[0].text).sources;
  const claim = (s, text) => ({
    text,
    citations: [{ sourceId: s.id, quote: s.body.slice(0, 20) }],
  });
  const result = Object.fromEntries(
    CLAIM_KEYS.map((k) => [
      k,
      [claim(src[0], "UI検証用の模擬応答。実APIの分析ではありません。")],
    ]),
  );
  result.summaries = src.map((s) =>
    claim(s, "入力した検証用記録の要点（模擬応答）"),
  );
  return reply({
    candidates: [
      {
        finishReason: "STOP",
        content: { parts: [{ text: JSON.stringify(result) }] },
      },
    ],
    usageMetadata: {
      promptTokenCount: 100,
      candidatesTokenCount: 100,
      totalTokenCount: 200,
    },
  });
}
require("./native-fixture.cjs")
  .main({
    aiEnv: {
      GEMINI_API_KEY: "emulator-provider-mock-key",
      GEMINI_FREE_TIER_CONFIRMED: "true",
      KNOWLEDGE_LAB_AI_ENABLED: "true",
    },
    aiFetcher: providerMock,
  })
  .then(() =>
    console.log(
      "LOCAL Auth/Firestore; MOCK Gemini provider. Never use this as live API or Production proof.",
    ),
  )
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
