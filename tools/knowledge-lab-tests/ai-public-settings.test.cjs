"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createAI } = require("../../backend/knowledge-lab/ai-service");
const control = {
  stopped: false,
  freeTierAttested: true,
  model: "gemini-listed-flash",
  embeddingModel: "gemini-embedding-001",
};
function instance(env = {}, settings = control) {
  return createAI({
    db: { projectId: "production-example" },
    service: { ref: () => ({ get: async () => ({ data: () => settings }) }) },
    env: {
      GEMINI_API_KEY: "local-test-key",
      GEMINI_FREE_TIER_CONFIRMED: "true",
      KNOWLEDGE_LAB_AI_ENABLED: "true",
      ...env,
    },
    fetcher: () => {
      throw Error("PROVIDER_MUST_NOT_BE_CONTACTED");
    },
  });
}
test("production AI follows the explicit environment and Owner model settings without an additional release switch", async () => {
  const ai = instance();
  const s = await ai.status();
  assert.equal(s.configured, true);
  assert.equal(s.available, true);
  assert.equal(s.semanticAvailable, true);
  assert.deepEqual(await ai.requireEnabled(), control);
});
test("Owner stop, missing credentials and free-tier/environment stops still prevent inference", async () => {
  for (const ai of [
    instance({}, { ...control, stopped: true }),
    instance({}, { ...control, freeTierAttested: false }),
    instance({ KNOWLEDGE_LAB_AI_ENABLED: "false" }),
    instance({ GEMINI_FREE_TIER_CONFIRMED: "false" }),
    instance({ GEMINI_API_KEY: "" }),
  ]) {
    assert.equal((await ai.status()).available, false);
    assert.equal((await ai.status()).semanticAvailable, false);
    await assert.rejects(ai.requireEnabled(), /AI_DISABLED/);
    await assert.rejects(ai.requireEnabled("embedding"), /AI_DISABLED/);
  }
});
