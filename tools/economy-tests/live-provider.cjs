"use strict";
// Opt-in single inference. Only repository-owned, non-personal public Guild text is sent.
// No production Firebase, payments, wallets, user data or deployment.
if (process.env.EXPLORER_LIVE_TEST_APPROVED !== "true")
  throw Error("EXPLICIT_LOCAL_LIVE_TEST_REQUIRED");
const { createAgent } = require("../../backend/economy/agent");
const { configuration } = require("../../backend/economy/config");
const fs = require("node:fs");
(async () => {
  const env = {
    ...process.env,
    ECONOMY_EXPLORER_MODEL:
      process.env.ECONOMY_EXPLORER_MODEL || "gemini-3.5-flash-lite",
  };
  if (!env.GEMINI_API_KEY) throw Error("PROVIDER_NOT_CONFIGURED");
  const sources =
    require("../../frontend/public/schoolpark/guild-store").OFFICIAL.map(
      (g) => ({
        key: "guild:" + g.id,
        kind: "guild",
        id: g.id,
        title: g.name,
        summary: g.concept,
        target: "/schoolpark/dao.html?screen=experiments&explorerGuild=" + g.id,
      }),
    );
  let providerStatus = null;
  const run = createAgent({
    env,
    config: () => configuration(env),
    fetcher: async (...args) => {
      const r = await fetch(...args);
      providerStatus = r.status;
      return r;
    },
  });
  const evidence = {
    provider: "real Gemini API",
    model: env.ECONOMY_EXPLORER_MODEL,
    source: "repository public Guild definitions",
    productionDataAccess: false,
    productionPayment: false,
  };
  try {
    const result = await run(
      "学んだ知識を実際に試し、学びを深める場所を探したい",
      sources,
    );
    evidence.success = true;
    evidence.results = result.results;
  } catch (e) {
    evidence.success = false;
    evidence.error = /^[A-Z_]+$/.test(e.message)
      ? e.message
      : "PROVIDER_CONNECTION_FAILED";
  }
  evidence.httpStatus = providerStatus;
  fs.writeFileSync(
    "/tmp/emuer-stage2-live-provider.json",
    JSON.stringify(evidence, null, 2),
  );
  console.log(JSON.stringify(evidence));
  if (!evidence.success) process.exitCode = 1;
})();
