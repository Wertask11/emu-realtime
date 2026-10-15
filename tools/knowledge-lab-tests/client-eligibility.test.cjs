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
function instance(env, projectId = "production-example") {
  return createAI({
    db: { projectId },
    service: { ref: () => ({ get: async () => ({ data: () => control }) }) },
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
test("a production client cannot infer or embed on key/free-tier confirmation alone", async () => {
  const ai = instance({});
  const s = await ai.status();
  assert.equal(s.configured, true);
  assert.equal(s.available, false);
  assert.equal(s.semanticAvailable, false);
  await assert.rejects(ai.requireEnabled(), /AI_CLIENT_ELIGIBILITY_REQUIRED/);
  await assert.rejects(
    ai.requireEnabled("embedding"),
    /AI_CLIENT_ELIGIBILITY_REQUIRED/,
  );
});
test("only explicit operator configuration or the isolated demo emulator satisfies the client gate", async () => {
  assert.equal(
    (await instance({ GEMINI_CLIENT_ELIGIBILITY_CONFIRMED: "true" }).status())
      .available,
    true,
  );
  assert.equal(
    (await instance({ FIRESTORE_EMULATOR_HOST: "127.0.0.1:8787" }).status())
      .available,
    false,
  );
  assert.equal(
    (
      await instance(
        { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8787" },
        "demo-emu-knowledge-lab",
      ).status()
    ).available,
    true,
  );
  assert.equal(
    (
      await instance(
        { FIRESTORE_EMULATOR_HOST: "remote.invalid:8787" },
        "demo-emu-knowledge-lab",
      ).status()
    ).available,
    false,
  );
});
