"use strict";
// Separate local project: never reset real-Gemini verification receipts or call Google.
process.env.LAB_EMULATOR_PROJECT = "demo-emu-knowledge-lab-feedback";
const { createFixture } = require("./fixture.cjs");
createFixture({
  port: 4202,
  aiEnv: {
    GEMINI_API_KEY: "emulator-only-model-list",
    GEMINI_FREE_TIER_CONFIRMED: "true",
    KNOWLEDGE_LAB_AI_ENABLED: "true",
  },
  aiFetcher: async (_, options) => {
    if (options.method !== "GET") throw Error("NO_GENERATION_IN_UI_TEST");
    return new Response(
      JSON.stringify({
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
      }),
      { status: 200 },
    );
  },
})
  .then(async (f) => {
    const response = await f.call("POST", "/admin/index", "owner", {});
    if (response.status !== 200) throw Error("LOCAL_INDEX_START_FAILED");
    await f.api.service.waitForRebuild();
    console.log(
      "LOCAL feedback UI on 127.0.0.1:4202; model listing is MOCK; no generation",
    );
  })
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
