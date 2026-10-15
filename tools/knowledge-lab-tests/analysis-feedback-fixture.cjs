"use strict";
// Isolated mock-provider namespace. Never reset live-Gemini receipts or real quotas.
process.env.LAB_EMULATOR_PROJECT = "demo-emu-knowledge-lab-analysis-ui";
process.env.LAB_AUTH_EMULATOR_HOST = "127.0.0.1:9299";
const { createFixture } = require("./fixture.cjs");
const { providerMock } = require("./completion-ui-fixture.cjs");
let generationCalls = 0;
createFixture({
  port: 4204,
  aiEnv: {
    GEMINI_API_KEY: "emulator-mock-only",
    GEMINI_FREE_TIER_CONFIRMED: "true",
    KNOWLEDGE_LAB_AI_ENABLED: "true",
  },
  aiFetcher: async (url, options) => {
    if (options.method === "POST" && url.endsWith(":generateContent"))
      generationCalls++;
    return providerMock(url, options);
  },
})
  .then(async (f) => {
    for (const [id, field, consent] of [
      ["feedback-education", "field-education", true],
      ["feedback-it", "field-it", true],
      ["feedback-unconsented", "field-family", false],
    ]) {
      await f.db
        .collection("posts")
        .doc(id)
        .set({
          title:
            id === "feedback-unconsented"
              ? "LOCAL：AI利用に未同意の知識"
              : "LOCAL：" + id,
          body: "AuthとFirestoreエミュレーター内だけの検証記録です。元資料を保存してから比較した経験を使います。",
          address: f.users.bob.account.walletAddress,
          authorSchoolParkId: f.users.bob.spid,
          visibility: "public",
          createdAt: new Date(),
          knowledgeLab: {
            revision: 1,
            facets: { field: [field] },
            aiUseConsent: { allowed: consent },
          },
        });
    }
    const configured = await f.call("PUT", "/admin/ai", "owner", {
      model: "gemini-test-flash",
      embeddingModel: "gemini-embedding-001",
      freeTierAttested: true,
    });
    if (configured.status !== 200) throw Error("LOCAL_MOCK_CONFIG_FAILED");
    await f.call("POST", "/admin/index", "owner", {});
    await f.api.service.waitForRebuild();
    f.app.get("/test/provider-count", (_, res) =>
      res.json({ generationCalls, provider: "MOCK, never real Gemini" }),
    );
    console.log(
      "LOCAL consent/feedback UI on 127.0.0.1:4204; Auth 9299; Gemini MOCK only",
    );
  })
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
