"use strict";
// Isolated tests only. Never imported by server.js. No production credentials or network writes.
const { makeFirestore } = require("../fake-firestore");
const { createMitemiruRouter } = require("../mitemiru");
const { createEconomyRouter } = require("./router");
const { SERVICE, hash } = require("./config");
const { createAgent } = require("./agent");
const express = require("express");
const SPID = "SP-AAAA-AAAA-AAAA-AAAA",
  WALLET = "0x" + "a".repeat(40);
function fixture(options = {}) {
  const db = options.db || makeFirestore();
  let clock = Date.parse("2026-11-06T03:00:00Z"),
    calls = 0;
  const now = () => clock;
  const env = {
    ECONOMY_EXPLORER_ENABLED: "true",
    ECONOMY_WORKER_ENABLED: "true",
    ECONOMY_AI_TERMS_ATTESTED: "true",
    ECONOMY_AI_AUDIENCE_ATTESTED: "true",
    ECONOMY_AI_SOURCE_USE_ATTESTED: "true",
    ECONOMY_AI_BUDGET_ATTESTED: "true",
    ECONOMY_AI_BILLING_ATTESTED: "true",
    ECONOMY_GEMINI_BILLING_TIER: "free",
    ECONOMY_AI_PROJECT_ATTESTED: "true",
    ECONOMY_GEMINI_PROJECT_ID: "demo-emu-economy",
    ECONOMY_BUDGET_APPROVAL_REF: "isolated-test-approval",
    ECONOMY_EXPLORER_TRIAL_START: "2026-11-05T15:00:00Z",
    ECONOMY_EXPLORER_DAILY_TOKEN_BUDGET: "100000",
    ECONOMY_EXPLORER_PLANS: "plus,pro",
    GEMINI_API_KEY: "isolated-test-placeholder",
    ...options.env,
  };
  const identity = {
    findByUid: async (uid) => (uid === "bob" ? "SP-BBBB-BBBB-BBBB-BBBB" : SPID),
    readIdentity: async () => ({ status: "active" }),
  };
  const entitlement = {
    getEntitlement: async (uid) => ({
      plan: uid === "guest" ? "guest" : "plus",
    }),
  };
  const chain = {
    id: (s) => "0x" + hash(s),
    claimPaid: async () => {
      if (options.rpcDown) throw Error("rpc");
      return 0n;
    },
    balanceOf: async () => "17000000000000000000",
  };
  const requireFirebaseUser = (req, res, next) => {
    if (!req.headers["x-test-user"])
      return res.status(401).json({ error: "AUTH_REQUIRED" });
    req.identity = {
      uid: req.headers["x-test-user"],
      walletAddress: WALLET,
      account: {},
    };
    next();
  };
  const commerce = createMitemiruRouter({
    db,
    identity,
    entitlement,
    chain,
    env,
    now,
    emuerEnabled: () => true,
    requireFirebaseUser,
    requireOwner: (req, res) => res.sendStatus(403),
  });
  const source = {
    key: "knowledge:coffee",
    id: "coffee",
    kind: "knowledge",
    title: "コーヒーを学ぶ",
    summary: "コーヒーの抽出温度を比べる経験知。",
    target: "/?lab=library&labPost=coffee",
  };
  const sources = options.sources || {
    candidates: async () => (options.empty ? [] : [source]),
    revalidate: async (a, g, r) => r,
  };
  const fetcher = async (url) => {
    if (
      options.providerTimeout &&
      (options.failureStage === "countTokens"
        ? url.endsWith(":countTokens")
        : url.endsWith(":generateContent"))
    )
      throw Object.assign(Error("isolated timeout; do not log"), {
        name: "TimeoutError",
      });
    if (
      options.providerStatus &&
      (options.failureStage === "countTokens"
        ? url.endsWith(":countTokens")
        : url.endsWith(":generateContent"))
    )
      return { ok: false, status: options.providerStatus };
    if (url.endsWith(":countTokens"))
      return {
        ok: true,
        text: async () =>
          JSON.stringify({ totalTokens: options.countTokens ?? 100 }),
      };
    calls++;
    if (options.providerDown) throw Error("provider secret must not leak");
    if (options.providerWait) await options.providerWait();
    return {
      ok: true,
      text: async () =>
        JSON.stringify({
          usageMetadata: options.usageMetadata || {
            promptTokenCount: 100,
            candidatesTokenCount: 10,
            totalTokenCount: 110,
          },
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify(
                      options.invalidOutput || {
                        matches: [{ key: "s0", evidence: "summary" }],
                      },
                    ),
                  },
                ],
              },
            },
          ],
        }),
    };
  };
  const agent = createAgent({
    env,
    config: () => require("./config").configuration(env, now()),
    fetcher,
  });
  const economy = createEconomyRouter({
    startWorker: false,
    isOwner: (a) => a.uid === "owner",
    requireOwner: (req, res, next) =>
      req.identity?.uid === "owner" ? next() : res.sendStatus(403),
    db,
    identity,
    entitlement,
    now,
    env,
    requireFirebaseUser,
    payments: options.payments || commerce.servicePayments,
    sources,
    agent,
  });
  async function seed() {
    await economy.service.workerHealth(true);
    await db
      .collection("emuer_v2_agent_products")
      .doc("agent_schoolpark-explorer-v1")
      .set({
        name: SERVICE.name,
        prices: { EMUER: 5 },
        status: "live",
        stock: null,
        termsVersion: SERVICE.termsVersion,
      });
    for (const spid of [SPID, "SP-BBBB-BBBB-BBBB-BBBB"])
      await db
        .collection("emuer_v2_agent_eligibility")
        .doc(hash(spid))
        .set({
          adultVerified: true,
          providerAllowed: true,
          validUntilMs: clock + 86400000,
        });
    await db
      .collection("emuer_v2_rewards")
      .doc("0x" + "1".repeat(64))
      .set({
        recipient: WALLET,
        uid: "alice",
        claimId: "0x" + "1".repeat(64),
        status: "pending",
        amountWei: String(BigInt(options.balance ?? 100) * 10n ** 18n),
        createdAt: new Date(0),
      });
  }
  const app = express();
  app.use(express.json({ limit: "4kb" }));
  app.use("/api/economy", economy.router);
  app.use("/api/mitemiru", commerce.router);
  return {
    db,
    env,
    identity,
    entitlement,
    commerce,
    chain,
    economy,
    source,
    app,
    now,
    seed,
    advance(ms) {
      clock += ms;
    },
    calls: () => calls,
    auth(uid = "alice") {
      return { uid, walletAddress: WALLET, account: {} };
    },
    async actor(uid) {
      return economy.service.actor(this.auth(uid));
    },
  };
}
module.exports = { fixture, SPID, WALLET };
