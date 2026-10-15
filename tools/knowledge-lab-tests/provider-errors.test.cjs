"use strict";
// Fault injection regression; never counted as real Gemini evidence.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createGemini } = require("../../backend/knowledge-lab/gemini");
for (const [status, code] of [
  [400, "AI_PROVIDER_REQUEST_REJECTED"],
  [401, "AI_PROVIDER_AUTH_FAILED"],
  [403, "AI_PROVIDER_AUTH_FAILED"],
  [404, "AI_MODEL_UNAVAILABLE"],
  [429, "AI_FREE_QUOTA_EXHAUSTED"],
  [500, "AI_PROVIDER_UNAVAILABLE"],
  [503, "AI_PROVIDER_UNAVAILABLE"],
]) {
  test(`provider HTTP ${status} has a safe, actionable error classification`, async () => {
    let generations = 0;
    const provider = createGemini({
      env: {
        GEMINI_API_KEY: "local-fault-test-key",
        GEMINI_FREE_TIER_CONFIRMED: "true",
        KNOWLEDGE_LAB_AI_ENABLED: "true",
      },
      fetcher: async (url) => {
        if (url.endsWith("models?pageSize=100"))
          return new Response(
            JSON.stringify({
              models: [
                {
                  name: "models/gemini-listed-flash",
                  supportedGenerationMethods: ["generateContent"],
                },
              ],
            }),
          );
        generations++;
        return new Response(
          JSON.stringify({
            error: {
              message: "PRIVATE_PROVIDER_ERROR_MUST_NOT_ESCAPE",
            },
          }),
          { status },
        );
      },
    });
    await assert.rejects(
      provider.analyze("gemini-listed-flash", [], []),
      (e) => {
        assert.equal(e.message, code);
        assert.equal(e.status, status === 429 ? 429 : 502);
        assert.equal(
          JSON.stringify(e).includes("PRIVATE_PROVIDER_ERROR"),
          false,
        );
        return true;
      },
    );
    assert.equal(generations, 1);
  });
}
