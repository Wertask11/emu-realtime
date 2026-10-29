"use strict";

/*
 * EMUER v2 gateway.
 *
 * The chain only accepts an EIP-712 authorisation from AUTHORIZER_ROLE.  This
 * module keeps the activity record in Firestore and returns a short-lived
 * authorisation to the self-custody wallet; it never sends a user-to-user
 * transfer and it never stores a private key in Firestore.
 */
const policy = require("./policy");
const { enabled } = require("./flags");

const CONTRACT = "0x9c102cC3016C70767082b60196565878D9314864";
const CHAIN_ID = 137;
const TREASURY = "0x1c156b6a8caa6772430eda2cbb0d20cf41b9cfe4";
const FOUNDER_QUEST_ID = "founder-quest-000";
/* 初投稿キャンペーン：2026/10/29 0:00 から 11/28 いっぱい（日本時間）。100 EMUER。
   画面の送り直しが期間後に届いても受けられるよう、3日だけ余白を持つ（投稿そのものは期間内に限る）。 */
const FIRST_POST_CAMPAIGN = {
  id: "first-post-campaign-2026-10", amount: 100,
  startMs: Date.parse("2026-10-29T00:00:00+09:00"), endMs: Date.parse("2026-11-29T00:00:00+09:00"),
  resendGraceMs: 3 * 24 * 60 * 60 * 1000
};
const ABI = [
  "function hasRole(bytes32 role,address account) view returns (bool)",
  "function claimPaid(bytes32) view returns (uint256)",
  "function claimAuthorizedTotal(bytes32) view returns (uint256)"
];

/* Keccak is intentionally computed by the server library at runtime.  The
 * deterministic input itself stays dependency-free so policy tests can run
 * without installing the web server. */
function rewardKey(uid, timestamp) { return policy.dailyRewardKey(uid, "login", timestamp); }

function createEmuerV2Router(deps) {
  const express = require("express");
  const ethers = require("ethers");
  const AUTHORIZER_ROLE = ethers.utils.id("AUTHORIZER_ROLE");
  const claimId = key => ethers.utils.keccak256(ethers.utils.toUtf8Bytes(key));
  const validAddress = value => ethers.utils.isAddress(String(value || ""));
  const router = express.Router();
  const db = deps.db;
  const requireFirebaseUser = deps.requireFirebaseUser;
  const requireOwnAddress = deps.requireOwnAddress;
  const entitlement = deps.entitlement;
  const identity = deps.identity || require('../identity').createIdentity({ db, ethers });
  const env = deps.env || process.env;
  const isEnabled = () => enabled(env);
  const operatorAddresses = new Set(String(env.EMUER_V2_OPERATOR_ADDRESSES || TREASURY)
    .split(",").map(value => String(value || "").trim().toLowerCase()).filter(validAddress));
  const rpcUrl = env.POLYGON_RPC_URL || "https://polygon-bor-rpc.publicnode.com";
  const privateKey = env.EMUER_V2_AUTHORIZER_PRIVATE_KEY || "";
  const provider = privateKey ? new ethers.providers.JsonRpcProvider(rpcUrl) : null;
  // テストからは、本物の鍵やチェーンの代わりを差し込める（本番は環境変数のとおり）。
  const signer = deps.signer || (provider ? new ethers.Wallet(privateKey, provider) : null);
  const contract = deps.contract || (provider ? new ethers.Contract(CONTRACT, ABI, provider) : null);

  async function signerReady() {
    if (!signer || !contract) return { ok: false, code: "AUTHORIZER_NOT_CONFIGURED" };
    const hasRole = await contract.hasRole(AUTHORIZER_ROLE, signer.address);
    return hasRole ? { ok: true } : { ok: false, code: "AUTHORIZER_ROLE_MISSING" };
  }
  async function signReward(record, fixedDeadline) {
    const deadline = fixedDeadline || Math.floor(Date.now() / 1000) + 15 * 60;
    const value = {
      claimId: record.claimId,
      recipient: ethers.utils.getAddress(record.recipient),
      totalAmount: record.amountWei,
      deadline
    };
    const signature = await signer._signTypedData(
      { name: "Emuer", version: "2", chainId: CHAIN_ID, verifyingContract: CONTRACT },
      { Reward: [
        { name: "claimId", type: "bytes32" }, { name: "recipient", type: "address" },
        { name: "totalAmount", type: "uint256" }, { name: "deadline", type: "uint256" }
      ] }, value
    );
    return { ...value, authorization: signature };
  }
  /* 受け取りの署名を出す前に、その報酬が「みてみる」で使われていないか確かめ、
     署名の期限を報酬に書いておく。みてみる（mitemiru.js）は、この期限が切れるまで
     その報酬を支払いに選ばない。署名を出したあとに同じ報酬で払われると、
     鎖の上でも受け取れてしまい、二重に使えるため。 */
  async function reserveAuthorization(ref, recipient) {
    const deadline = Math.floor(Date.now() / 1000) + 15 * 60;
    let row;
    await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error("REWARD_NOT_FOUND");
      row = snap.data() || {};
      if (String(row.recipient || "").toLowerCase() !== String(recipient || "").toLowerCase()) throw new Error("REWARD_NOT_OWNED");
      if (row.status === "spent") throw new Error("REWARD_SPENT");
      // まとめ受け取りに入ったものは、まとめた札のほうで受け取る（元の札も出すと二重に払える）
      if (row.status === "bundled") throw new Error("REWARD_BUNDLED");
      tx.set(ref, { authorizedUntilMs: Math.max(Number(row.authorizedUntilMs || 0), deadline * 1000), updatedAt: new Date() }, { merge: true });
    });
    return { row, deadline };
  }
  function reactionKey(postId, action, actor) {
    return JSON.stringify(["emuer-v2", "reaction", action, String(postId), String(actor).toLowerCase()]);
  }
  function reflectionKey(postId, changeId) {
    return JSON.stringify(["emuer-v2", "change-reflection", String(postId), String(changeId)]);
  }
  async function createReward({ key, kind, recipient, meta, amountEmuer = 1 }) {
    if (!Number.isSafeInteger(amountEmuer) || amountEmuer < 1) throw new Error("INVALID_REWARD_AMOUNT");
    const id = claimId(key);
    const ref = db.collection("emuer_v2_rewards").doc(id);
    let row;
    await db.runTransaction(async tx => {
      const previous = await tx.get(ref);
      if (previous.exists) { row = previous.data(); return; }
      row = {
        schema: "emuer-v2-reward-v1", kind, key, claimId: id,
        recipient: String(recipient).toLowerCase(), amountWei: (BigInt(amountEmuer) * policy.UNIT).toString(), amount: String(amountEmuer),
        status: "pending", ...meta, createdAt: new Date(), updatedAt: new Date()
      };
      tx.create(ref, row);
    });
    return row;
  }
  function requireOperator(req, res, next) {
    const address = String(req.identity && req.identity.walletAddress || "").toLowerCase();
    if (!operatorAddresses.has(address)) return res.status(403).json({ error: "OPERATOR_REQUIRED" });
    next();
  }
  function scopeRef(scopeType, scopeId) {
    return db.collection("emuer_v2_guild_quest_budgets").doc(`${scopeType}:${scopeId}`);
  }
  function cleanScope(body) {
    const scopeType = String(body.scopeType || "");
    const scopeId = String(body.scopeId || "").trim();
    if (!['guild', 'quest'].includes(scopeType) || !/^[A-Za-z0-9_-]{1,120}$/.test(scopeId)) return null;
    if (scopeType === "quest" && scopeId === FOUNDER_QUEST_ID) return null;
    return { scopeType, scopeId };
  }
  async function accessFor(req, action) {
    if (!entitlement) throw new Error("ENTITLEMENT_UNAVAILABLE");
    const current = await entitlement.getEntitlement(req.identity.uid, req.identity.account);
    const plan = current.plan;
    if (!['light', 'plus', 'pro'].includes(plan)) return { ok: false, code: "PLAN_REQUIRED", plan };
    const period = policy.period(plan, action, Date.now());
    if (period.limit === null) return { ok: true, plan, period, used: 0 };
    const ref = db.collection("emuer_v2_access_usage").doc(`${req.identity.uid}:${action}:${period.key}`);
    const snap = await ref.get();
    const used = snap.exists ? Number((snap.data() || {}).used || 0) : 0;
    return { ok: used < period.limit, code: used < period.limit ? null : "PERIOD_LIMIT_REACHED", plan, period, used, ref };
  }

  router.get("/config", (req, res) => res.json({
    enabled: isEnabled(), chainId: CHAIN_ID, contract: CONTRACT,
    startsAt: new Date(policy.START_MS).toISOString(), monthlyCap: "416000"
  }));

  router.get("/readiness", async (req, res) => {
    const active = policy.isActive(Date.now());
    let authorizer = { ok: false, code: "AUTHORIZER_NOT_CONFIGURED" };
    try { authorizer = await signerReady(); } catch (_) { authorizer = { ok: false, code: "AUTHORIZER_CHECK_FAILED" }; }
    res.json({ enabled: isEnabled(), active, startsAt: new Date(policy.START_MS).toISOString(), authorizer, contract: CONTRACT, chainId: CHAIN_ID });
  });

  router.get("/access/:action", requireFirebaseUser, async (req, res) => {
    if (!['convert', 'exchange'].includes(String(req.params.action))) return res.status(400).json({ error: "INVALID_ACTION" });
    if (!isEnabled()) return res.status(409).json({ error: "EMUER_V2_NOT_ACTIVE" });
    if (!db) return res.status(503).json({ error: "FIRESTORE_UNAVAILABLE" });
    try {
      const access = await accessFor(req, String(req.params.action));
      return res.json({ ok: access.ok, error: access.code || null, plan: access.plan, used: access.used || 0, limit: access.period && access.period.limit, period: access.period && access.period.key });
    } catch (error) { return res.status(503).json({ error: error.message === "ENTITLEMENT_UNAVAILABLE" ? error.message : "ACCESS_CHECK_FAILED" }); }
  });

  // Historical Good / received Change is deliberately the only past data that
  // can become EMUER.  The backfill job writes the verified total once; this
  // endpoint turns that one immutable legacy ledger amount into a v2 claim.
  router.post("/legacy/convert", requireFirebaseUser, requireOwnAddress, async (req, res) => {
    if (!isEnabled()) return res.status(409).json({ error: "EMUER_V2_NOT_ACTIVE" });
    if (!policy.isActive(Date.now())) return res.status(409).json({ error: "NOT_STARTED", startsAt: policy.START_MS });
    if (!db) return res.status(503).json({ error: "FIRESTORE_UNAVAILABLE" });
    const recipient = String(req.identity.walletAddress || "").toLowerCase();
    if (!validAddress(recipient)) return res.status(400).json({ error: "SELF_CUSTODY_WALLET_REQUIRED" });
    try {
      const access = await accessFor(req, "convert");
      if (!access.ok) return res.status(403).json({ error: access.code, plan: access.plan });
      const ledgerRef = db.collection("emuer_v2_unconverted_legacy").doc(recipient);
      let reward;
      await db.runTransaction(async tx => {
        const key = JSON.stringify(["emuer-v2", "legacy-good-change", recipient]);
        const id = claimId(key);
        const rewardRef = db.collection("emuer_v2_rewards").doc(id);
        const [ledgerSnap, usageSnap, rewardSnap] = await Promise.all([tx.get(ledgerRef), access.ref ? tx.get(access.ref) : Promise.resolve(null), tx.get(rewardRef)]);
        const ledger = ledgerSnap.exists ? ledgerSnap.data() || {} : {};
        const amountEmuer = Number(ledger.unconverted || 0);
        if (rewardSnap.exists) { reward = rewardSnap.data(); return; }
        if (!ledgerSnap.exists || ledger.status !== "identity_pending" || !Number.isSafeInteger(amountEmuer) || amountEmuer < 1) throw new Error("NO_VERIFIED_LEGACY_BALANCE");
        if (access.period.limit !== null && Number((usageSnap && usageSnap.data() || {}).used || 0) >= access.period.limit) throw new Error("PERIOD_LIMIT_REACHED");
        reward = { schema: "emuer-v2-reward-v1", kind: "legacy-good-change", key, claimId: id, recipient,
          amountWei: (BigInt(amountEmuer) * policy.UNIT).toString(), amount: String(amountEmuer), status: "pending",
          source: "verified-backfill", uid: req.identity.uid, legacyLedgerAddress: recipient,
          conversionPlan: access.plan, conversionPeriod: access.period.key, conversionLimit: access.period.limit,
          conversionSettled: false, createdAt: new Date(), updatedAt: new Date() };
        tx.create(rewardRef, reward);
      });
      return res.json({ ok: true, rewardId: reward.claimId, amount: reward.amount, plan: access.plan });
    } catch (error) {
      const code = String(error.message || "");
      if (["NO_VERIFIED_LEGACY_BALANCE", "PERIOD_LIMIT_REACHED"].includes(code)) return res.status(409).json({ error: code });
      if (code.includes("ALREADY_EXISTS")) return res.status(409).json({ error: "LEGACY_BALANCE_ALREADY_CONVERTED" });
      console.error("EMUER v2 legacy conversion error:", error.message); return res.status(500).json({ error: "LEGACY_CONVERSION_FAILED" });
    }
  });


  // A conversion only consumes its plan allowance after the chain confirms a
  // payment. A rejected MetaMask request therefore leaves the same claim
  // available to retry and does not spend the monthly/weekly allowance.
  router.post("/rewards/:claimId/settle-conversion", requireFirebaseUser, requireOwnAddress, async (req, res) => {
    if (!isEnabled()) return res.status(409).json({ error: "EMUER_V2_NOT_ACTIVE" });
    if (!policy.isActive(Date.now())) return res.status(409).json({ error: "NOT_STARTED", startsAt: policy.START_MS });
    if (!db || !contract) return res.status(503).json({ error: "EMUER_V2_UNAVAILABLE" });
    const id = String(req.params.claimId || "");
    const rewardRef = db.collection("emuer_v2_rewards").doc(id);
    try {
      const initial = await rewardRef.get();
      const row = initial.exists ? initial.data() || {} : {};
      const recipient = String(req.identity.walletAddress || "").toLowerCase();
      if (!initial.exists || row.kind !== "legacy-good-change" || row.recipient !== recipient || row.uid !== req.identity.uid) return res.status(404).json({ error: "CONVERSION_NOT_FOUND" });
      if (row.conversionSettled) return res.json({ ok: true, alreadySettled: true });
      const paid = await contract.claimPaid(row.claimId);
      if (paid.lte(0)) return res.status(409).json({ error: "CHAIN_CLAIM_NOT_CONFIRMED" });
      const ledgerRef = db.collection("emuer_v2_unconverted_legacy").doc(String(row.legacyLedgerAddress || recipient));
      const usageRef = row.conversionLimit === null ? null : db.collection("emuer_v2_access_usage").doc(`${row.uid}:convert:${row.conversionPeriod}`);
      await db.runTransaction(async tx => {
        const [rewardSnap, usageSnap] = await Promise.all([tx.get(rewardRef), usageRef ? tx.get(usageRef) : Promise.resolve(null)]);
        const current = rewardSnap.exists ? rewardSnap.data() || {} : {};
        if (!rewardSnap.exists || current.kind !== "legacy-good-change") throw new Error("CONVERSION_NOT_FOUND");
        if (current.conversionSettled) return;
        tx.update(rewardRef, { conversionSettled: true, conversionSettledAt: new Date(), updatedAt: new Date() });
        tx.set(ledgerRef, { status: "converted", convertedClaimId: id, convertedAt: new Date(), updatedAt: new Date() }, { merge: true });
        if (usageRef) tx.set(usageRef, { uid: row.uid, action: "convert", period: row.conversionPeriod, plan: row.conversionPlan, used: Number((usageSnap && usageSnap.data() || {}).used || 0) + 1, updatedAt: new Date() }, { merge: true });
      });
      return res.json({ ok: true, paidWei: paid.toString() });
    } catch (error) {
      const code = String(error.message || "");
      if (["CONVERSION_NOT_FOUND", "CHAIN_CLAIM_NOT_CONFIRMED"].includes(code)) return res.status(code === "CONVERSION_NOT_FOUND" ? 404 : 409).json({ error: code });
      console.error("EMUER v2 conversion settle error:", error.message); return res.status(500).json({ error: "CONVERSION_SETTLE_FAILED" });
    }
  });

  // Guild/Quest rewards are deliberately not automatic.  An operator first
  // publishes a fixed whole-EMUER budget and conditions; members then leave
  // contribution records; finally the operator allocates a verified amount.
  router.get("/guild-quest/budgets", async (req, res) => {
    if (!db) return res.status(503).json({ error: "FIRESTORE_UNAVAILABLE" });
    try {
      const snap = await db.collection("emuer_v2_guild_quest_budgets").where("status", "==", "published").limit(100).get();
      return res.json({ budgets: snap.docs.map(doc => {
        const row = doc.data() || {};
        return { id: doc.id, scopeType: row.scopeType, scopeId: row.scopeId, title: row.title || "", conditions: row.conditions || "", totalEmuer: row.totalEmuer || 0, allocatedEmuer: row.allocatedEmuer || 0, remainingEmuer: Math.max(0, Number(row.totalEmuer || 0) - Number(row.allocatedEmuer || 0)) };
      }) });
    } catch (error) { return res.status(500).json({ error: "BUDGET_LIST_FAILED" }); }
  });

  router.post("/guild-quest/budgets", requireFirebaseUser, requireOperator, async (req, res) => {
    if (!isEnabled()) return res.status(409).json({ error: "EMUER_V2_NOT_ACTIVE" });
    if (!db) return res.status(503).json({ error: "FIRESTORE_UNAVAILABLE" });
    const scope = cleanScope(req.body || {});
    const totalEmuer = Number(req.body && req.body.totalEmuer);
    const title = String(req.body && req.body.title || "").trim().slice(0, 160);
    const conditions = String(req.body && req.body.conditions || "").trim().slice(0, 2000);
    if (!scope || !Number.isSafeInteger(totalEmuer) || totalEmuer < 1 || totalEmuer > 416000 || !title || !conditions) return res.status(400).json({ error: "INVALID_BUDGET" });
    try {
      if (scope.scopeType === "quest") {
        const quest = await db.collection("sp_quests").doc(scope.scopeId).get();
        if (!quest.exists) return res.status(404).json({ error: "QUEST_NOT_FOUND" });
      }
      const ref = scopeRef(scope.scopeType, scope.scopeId);
      await ref.set({ schema: "emuer-v2-guild-quest-budget-v1", ...scope, title, conditions, totalEmuer, allocatedEmuer: 0,
        status: "published", publishedBy: String(req.identity.walletAddress).toLowerCase(), publishedAt: new Date(), updatedAt: new Date() });
      return res.json({ ok: true, id: ref.id });
    } catch (error) { console.error("EMUER v2 budget publish error:", error.message); return res.status(500).json({ error: "BUDGET_PUBLISH_FAILED" }); }
  });

  router.post("/guild-quest/contributions", requireFirebaseUser, requireOwnAddress, async (req, res) => {
    if (!isEnabled()) return res.status(409).json({ error: "EMUER_V2_NOT_ACTIVE" });
    if (!policy.isActive(Date.now())) return res.status(409).json({ error: "NOT_STARTED", startsAt: policy.START_MS });
    if (!db) return res.status(503).json({ error: "FIRESTORE_UNAVAILABLE" });
    const scope = cleanScope(req.body || {});
    const recipient = String(req.identity.walletAddress || "").toLowerCase();
    const evidenceLogId = String(req.body && req.body.evidenceLogId || "").trim();
    const note = String(req.body && req.body.note || "").trim().slice(0, 1000);
    if (!scope || !validAddress(recipient)) return res.status(400).json({ error: "INVALID_CONTRIBUTION" });
    try {
      const budget = await scopeRef(scope.scopeType, scope.scopeId).get();
      if (!budget.exists || (budget.data() || {}).status !== "published") return res.status(409).json({ error: "BUDGET_NOT_PUBLISHED" });
      if (scope.scopeType === "quest") {
        if (!evidenceLogId) return res.status(400).json({ error: "QUEST_LOG_REQUIRED" });
        const [quest, commit, log] = await Promise.all([
          db.collection("sp_quests").doc(scope.scopeId).get(),
          db.collection("sp_quests").doc(scope.scopeId).collection("commits").doc(recipient).get(),
          db.collection("sp_quests").doc(scope.scopeId).collection("logs").doc(evidenceLogId).get()
        ]);
        if (!quest.exists || !commit.exists || !log.exists || String((log.data() || {}).author || "").toLowerCase() !== recipient) return res.status(409).json({ error: "QUEST_CONTRIBUTION_NOT_VERIFIED" });
      }
      const key = JSON.stringify(["emuer-v2", "guild-quest-contribution", scope.scopeType, scope.scopeId, recipient, evidenceLogId || note]);
      const id = claimId(key);
      const ref = db.collection("emuer_v2_guild_quest_contributions").doc(id);
      await db.runTransaction(async tx => {
        const prior = await tx.get(ref);
        if (prior.exists) return;
        tx.create(ref, { schema: "emuer-v2-guild-quest-contribution-v1", key, ...scope, recipient, evidenceLogId, note, status: "submitted", submittedAt: new Date(), updatedAt: new Date() });
      });
      return res.json({ ok: true, contributionId: id });
    } catch (error) { console.error("EMUER v2 contribution error:", error.message); return res.status(500).json({ error: "CONTRIBUTION_RECORD_FAILED" }); }
  });

  router.get("/guild-quest/contributions", requireFirebaseUser, requireOperator, async (req, res) => {
    if (!db) return res.status(503).json({ error: "FIRESTORE_UNAVAILABLE" });
    try {
      const snap = await db.collection("emuer_v2_guild_quest_contributions").where("status", "==", "submitted").limit(100).get();
      return res.json({ contributions: snap.docs.map(doc => ({ id: doc.id, ...(doc.data() || {}) })) });
    } catch (error) { return res.status(500).json({ error: "CONTRIBUTION_LIST_FAILED" }); }
  });

  router.post("/guild-quest/contributions/:id/approve", requireFirebaseUser, requireOperator, async (req, res) => {
    if (!isEnabled()) return res.status(409).json({ error: "EMUER_V2_NOT_ACTIVE" });
    if (!policy.isActive(Date.now())) return res.status(409).json({ error: "NOT_STARTED", startsAt: policy.START_MS });
    if (!db) return res.status(503).json({ error: "FIRESTORE_UNAVAILABLE" });
    const amountEmuer = Number(req.body && req.body.amountEmuer);
    if (!Number.isSafeInteger(amountEmuer) || amountEmuer < 1 || amountEmuer > 416000) return res.status(400).json({ error: "INVALID_ALLOCATION" });
    const contributionRef = db.collection("emuer_v2_guild_quest_contributions").doc(String(req.params.id));
    try {
      let reward;
      await db.runTransaction(async tx => {
        const contributionSnap = await tx.get(contributionRef);
        if (!contributionSnap.exists) throw new Error("CONTRIBUTION_NOT_FOUND");
        const contribution = contributionSnap.data() || {};
        if (contribution.status !== "submitted") throw new Error("CONTRIBUTION_ALREADY_REVIEWED");
        if (contribution.scopeType === "quest") {
          const questSnap = await tx.get(db.collection("sp_quests").doc(contribution.scopeId));
          const quest = questSnap.exists ? questSnap.data() || {} : {};
          if (quest.series === "general" && Number(quest.questNumber) === 1 && quest.guildId === "learn")
            throw new Error("USE_QUEST_COMPLETION_APPROVAL");
        }
        const budgetRef = scopeRef(contribution.scopeType, contribution.scopeId);
        const budgetSnap = await tx.get(budgetRef);
        const budget = budgetSnap.exists ? budgetSnap.data() || {} : {};
        const allocated = Number(budget.allocatedEmuer || 0);
        const total = Number(budget.totalEmuer || 0);
        if (!budgetSnap.exists || budget.status !== "published" || allocated + amountEmuer > total) throw new Error("BUDGET_EXCEEDED");
        const rewardKey = JSON.stringify(["emuer-v2", "guild-quest-reward", contributionRef.id]);
        const rewardId = claimId(rewardKey);
        const rewardRef = db.collection("emuer_v2_rewards").doc(rewardId);
        const amountWei = (BigInt(amountEmuer) * policy.UNIT).toString();
        reward = { schema: "emuer-v2-reward-v1", kind: "guild-quest-contribution", key: rewardKey, claimId: rewardId,
          recipient: String(contribution.recipient).toLowerCase(), amountWei, amount: String(amountEmuer), status: "pending",
          scopeType: contribution.scopeType, scopeId: contribution.scopeId, contributionId: contributionRef.id, budgetTitle: budget.title || "", createdAt: new Date(), updatedAt: new Date() };
        tx.create(rewardRef, reward);
        tx.update(budgetRef, { allocatedEmuer: allocated + amountEmuer, updatedAt: new Date() });
        tx.update(contributionRef, { status: "approved", approvedEmuer: amountEmuer, approvedBy: String(req.identity.walletAddress).toLowerCase(), approvedAt: new Date(), rewardId, updatedAt: new Date() });
      });
      return res.json({ ok: true, rewardId: reward.claimId, amount: reward.amount });
    } catch (error) {
      const code = String(error.message || "");
      if (["CONTRIBUTION_NOT_FOUND", "CONTRIBUTION_ALREADY_REVIEWED", "BUDGET_EXCEEDED", "USE_QUEST_COMPLETION_APPROVAL"].includes(code)) return res.status(409).json({ error: code });
      console.error("EMUER v2 contribution approval error:", error.message); return res.status(500).json({ error: "CONTRIBUTION_APPROVAL_FAILED" });
    }
  });

  // The client uses this only to render the daily-login button.  The actual
  // claim remains protected by the signed /daily/login endpoint below.
  router.get("/daily/login/status", requireFirebaseUser, requireOwnAddress, async (req, res) => {
    if (!isEnabled()) return res.status(409).json({ error: "EMUER_V2_NOT_ACTIVE" });
    if (!db) return res.status(503).json({ error: "FIRESTORE_UNAVAILABLE" });
    const key = rewardKey(req.identity.uid, Date.now());
    const id = claimId(key);
    try {
      const reward = await db.collection("emuer_v2_rewards").doc(id).get();
      /* date は「その日」を返す欄。key は JSON の配列（["emuer-v2",...]）で
         コロンを含まないので、split(":") では切れず、鍵がまるごと出ていた。
         鍵は中の作りなので、外に出してはいけない。日付だけを返す。 */
      return res.json({ claimedToday: reward.exists, date: policy.dayKey(Date.now()) });
    } catch (error) {
      console.error("EMUER v2 login status error:", error.message);
      return res.status(500).json({ error: "REWARD_STATUS_FAILED" });
    }
  });

  // A reaction is only registered after Firestore shows that the signed-in
  // person actually reacted.  The author receives a pending 1-EMUER reward;
  // the reacting person never pays or transfers tokens to the author.
  router.post("/activity/reaction", requireFirebaseUser, requireOwnAddress, async (req, res) => {
    if (!isEnabled()) return res.status(409).json({ error: "EMUER_V2_NOT_ACTIVE" });
    if (!policy.isActive(Date.now())) return res.status(409).json({ error: "NOT_STARTED", startsAt: policy.START_MS });
    if (!db) return res.status(503).json({ error: "FIRESTORE_UNAVAILABLE" });
    const postId = String(req.body.postId || "").trim();
    const action = String(req.body.action || "");
    const actor = String(req.identity.walletAddress || "").toLowerCase();
    if (!postId || !["good", "change"].includes(action)) return res.status(400).json({ error: "INVALID_REACTION" });
    try {
      const post = await db.collection("posts").doc(postId).get();
      if (!post.exists) return res.status(404).json({ error: "POST_NOT_FOUND" });
      const data = post.data() || {};
      const author = String(data.address || "").toLowerCase();
      const actors = Array.isArray(action === "good" ? data.goodUsers : data.changeUsers)
        ? (action === "good" ? data.goodUsers : data.changeUsers).map(x => String(x).toLowerCase()) : [];
      if (!validAddress(author) || author === actor || !actors.includes(actor)) return res.status(409).json({ error: "REACTION_NOT_VERIFIED" });
      const row = await createReward({
        key: reactionKey(postId, action, actor), kind: action === "good" ? "good-received" : "change-received",
        recipient: author, meta: { postId, actor, postTitle: String(data.title || "").slice(0, 160) }
      });
      return res.json({ ok: true, rewardId: row.claimId, alreadyRecorded: !!row.createdAt });
    } catch (error) {
      console.error("EMUER v2 reaction reward error:", error.message);
      return res.status(500).json({ error: "REACTION_REWARD_FAILED" });
    }
  });

  // A Change proposer is rewarded only after the post author records what was
  // actually reflected.  `accepted` alone deliberately never reaches here.
  router.post("/activity/change-reflection", requireFirebaseUser, requireOwnAddress, async (req, res) => {
    if (!isEnabled()) return res.status(409).json({ error: "EMUER_V2_NOT_ACTIVE" });
    if (!policy.isActive(Date.now())) return res.status(409).json({ error: "NOT_STARTED", startsAt: policy.START_MS });
    if (!db) return res.status(503).json({ error: "FIRESTORE_UNAVAILABLE" });
    const postId = String(req.body.postId || "").trim();
    const changeId = String(req.body.changeId || "").trim();
    const actor = String(req.identity.walletAddress || "").toLowerCase();
    if (!postId || !changeId) return res.status(400).json({ error: "INVALID_CHANGE_REFLECTION" });
    try {
      const [postSnap, changeSnap] = await Promise.all([
        db.collection("posts").doc(postId).get(),
        db.collection("post_changes").doc(changeId).get()
      ]);
      if (!postSnap.exists || !changeSnap.exists) return res.status(404).json({ error: "CHANGE_OR_POST_NOT_FOUND" });
      const post = postSnap.data() || {};
      const change = changeSnap.data() || {};
      const author = String(post.address || "").toLowerCase();
      const proposer = String(change.fromAddress || "").toLowerCase();
      const reflectedBy = String(change.reflectedBy || "").toLowerCase();
      if (!validAddress(author) || !validAddress(proposer) || author !== actor || reflectedBy !== author ||
          String(change.postId || "") !== postId || change.status !== "accepted" || !change.reflectedAt) {
        return res.status(409).json({ error: "REFLECTION_NOT_VERIFIED" });
      }
      const row = await createReward({
        key: reflectionKey(postId, changeId), kind: "change-reflected", recipient: proposer,
        meta: { postId, changeId, postTitle: String(post.title || "").slice(0, 160), reflectedBy: author }
      });
      return res.json({ ok: true, rewardId: row.claimId });
    } catch (error) {
      console.error("EMUER v2 change reflection reward error:", error.message);
      return res.status(500).json({ error: "CHANGE_REFLECTION_REWARD_FAILED" });
    }
  });

  /* 取りこぼした Good・Change の報酬（10/1 以降）を数えて、作り直す（運営だけ）。

     画面が JSON の印を付けずに送っていたので、Good・Change を受け取った投稿者への報酬が
     記録されていなかった（10/29 に分かった）。押した人の一覧（goodUsers / changeUsers）は
     投稿に残っていて、押した順に並ぶ（arrayUnion は後ろに足す）。

     10/1 より前の分は、移行のときに別の台帳へ記録し直した（emuer_v2_backfill に、そのときの数）。
     その数より後ろにいる人が、10/1 以降に押した人。10/1 以降にできた投稿は、全員が対象。
     10/1 より前の投稿で、記録し直しの控えが無いもの（数が合わず保留にしたもの）は、
     どこからが 10/1 以降か分からないので、作らずに「要確認」として出す。

     作るときの鍵は、ふだんの記録と同じ（reactionKey）。だから二重にならず、
     何度押しても、まだ無いものだけができる。 */
  const RECOVERY_CUTOFF_MS = Date.parse("2026-09-30T15:00:00.000Z");
  const recoveryTsMs = v => !v ? 0 : typeof v.toMillis === "function" ? v.toMillis()
    : v instanceof Date ? v.getTime() : (Number.isFinite(Date.parse(String(v))) ? Date.parse(String(v)) : 0);
  function recoveryActors(list, author) {
    return [...new Set((Array.isArray(list) ? list : []).map(x => String(x || "").trim().toLowerCase())
      .filter(x => validAddress(x) && x !== author))];
  }
  async function scanReactionRecovery() {
    const [posts, snapshots] = await Promise.all([
      db.collection("posts").get(), db.collection("emuer_v2_backfill").get()
    ]);
    const before = new Map();
    snapshots.forEach(d => before.set(d.id, d.data() || {}));
    const candidates = [], review = [];
    let scanned = 0;
    posts.forEach(doc => {
      scanned += 1;
      const data = doc.data() || {};
      const author = String(data.address || "").toLowerCase();
      const good = recoveryActors(data.goodUsers, author), change = recoveryActors(data.changeUsers, author);
      if (!good.length && !change.length) return;
      const title = String(data.title || "").slice(0, 160);
      if (!validAddress(author)) { review.push({ postId: doc.id, title, reason: "投稿した人のアドレスが読めない" }); return; }
      const snap = before.get(doc.id);
      let goodFrom = 0, changeFrom = 0;
      if (snap) { goodFrom = Number(snap.goodCount || 0); changeFrom = Number(snap.changeCount || 0); }
      else if (recoveryTsMs(data.createdAt) < RECOVERY_CUTOFF_MS) {
        review.push({ postId: doc.id, title, reason: recoveryTsMs(data.createdAt) ? "10/1より前の投稿で、移行のときの数の控えが無い" : "投稿した日が読めない" });
        return;
      }
      good.slice(goodFrom).forEach(actor => candidates.push({ postId: doc.id, title, author, actor, action: "good" }));
      change.slice(changeFrom).forEach(actor => candidates.push({ postId: doc.id, title, author, actor, action: "change" }));
    });
    const missing = [];
    for (const c of candidates) {
      const snap = await db.collection("emuer_v2_rewards").doc(claimId(reactionKey(c.postId, c.action, c.actor))).get();
      if (!snap.exists) missing.push(c);
    }
    return { scanned, candidates: candidates.length, missing, review };
  }
  function recoverySummary(scan) {
    const good = scan.missing.filter(x => x.action === "good").length;
    return {
      scannedPosts: scan.scanned, checked: scan.candidates, missingGood: good, missingChange: scan.missing.length - good,
      missingEmuer: scan.missing.length, authors: new Set(scan.missing.map(x => x.author)).size,
      review: scan.review.slice(0, 50), reviewCount: scan.review.length,
      sample: scan.missing.slice(0, 20).map(x => ({ postId: x.postId, title: x.title, action: x.action, author: x.author }))
    };
  }
  router.get("/admin/reaction-recovery", requireFirebaseUser, requireOperator, async (req, res) => {
    if (!isEnabled()) return res.status(409).json({ error: "EMUER_V2_NOT_ACTIVE" });
    if (!db) return res.status(503).json({ error: "FIRESTORE_UNAVAILABLE" });
    try { return res.json({ ok: true, ...recoverySummary(await scanReactionRecovery()) }); }
    catch (error) { console.error("EMUER v2 reaction recovery scan error:", error.message); return res.status(500).json({ error: "REACTION_RECOVERY_FAILED" }); }
  });
  router.post("/admin/reaction-recovery", requireFirebaseUser, requireOperator, async (req, res) => {
    if (!isEnabled()) return res.status(409).json({ error: "EMUER_V2_NOT_ACTIVE" });
    if (!policy.isActive(Date.now())) return res.status(409).json({ error: "NOT_STARTED", startsAt: policy.START_MS });
    if (!db) return res.status(503).json({ error: "FIRESTORE_UNAVAILABLE" });
    try {
      const scan = await scanReactionRecovery();
      /* 数えたときと数が変わっていたら、作らずに数え直してもらう（確かめた数と違うものを出さない）。 */
      const expected = Number(req.body && req.body.expectedMissing);
      if (!Number.isSafeInteger(expected) || expected !== scan.missing.length) {
        return res.status(409).json({ error: "RECOVERY_CHANGED", ...recoverySummary(scan) });
      }
      let created = 0;
      for (const c of scan.missing) {
        const row = await createReward({
          key: reactionKey(c.postId, c.action, c.actor), kind: c.action === "good" ? "good-received" : "change-received",
          recipient: c.author, meta: { postId: c.postId, actor: c.actor, postTitle: c.title, recovered: true,
            recoveredBy: String(req.identity.walletAddress || "").toLowerCase() }
        });
        if (row && row.recovered) created += 1;
      }
      return res.json({ ok: true, created, authors: new Set(scan.missing.map(x => x.author)).size });
    } catch (error) {
      console.error("EMUER v2 reaction recovery error:", error.message);
      return res.status(500).json({ error: "REACTION_RECOVERY_FAILED" });
    }
  });

  // A public daily reflection is eligible once per Passport and JST day.  The
  // server rereads the saved day, so a client cannot reward a private or empty
  // draft by merely sending a request.
  router.post("/activity/public-reflection", requireFirebaseUser, requireOwnAddress, async (req, res) => {
    if (!isEnabled()) return res.status(409).json({ error: "EMUER_V2_NOT_ACTIVE" });
    if (!policy.isActive(Date.now())) return res.status(409).json({ error: "NOT_STARTED", startsAt: policy.START_MS });
    if (!db) return res.status(503).json({ error: "FIRESTORE_UNAVAILABLE" });
    const date = String(req.body.date || "");
    const today = policy.dayKey(Date.now());
    const recipient = String(req.identity.walletAddress || "").toLowerCase();
    if (date !== today || !validAddress(recipient)) return res.status(409).json({ error: "PUBLIC_REFLECTION_NOT_VERIFIED" });
    try {
      const day = await db.collection("ichinichi_days").doc(`${recipient}__${date}`).get();
      const data = day.exists ? day.data() || {} : {};
      if (!day.exists || data.visibility !== "public" || !String(data.learning || "").trim() || !data.sharedAt ||
          String(data.address || "").toLowerCase() !== recipient || String(data.date || "") !== date) {
        return res.status(409).json({ error: "PUBLIC_REFLECTION_NOT_VERIFIED" });
      }
      const row = await createReward({
        key: policy.dailyRewardKey(req.identity.uid, "public-reflection", Date.now()),
        kind: "public-reflection", recipient, meta: { date, dayId: day.id }
      });
      return res.json({ ok: true, rewardId: row.claimId });
    } catch (error) {
      console.error("EMUER v2 public reflection reward error:", error.message);
      return res.status(500).json({ error: "PUBLIC_REFLECTION_REWARD_FAILED" });
    }
  });

  /* 初投稿キャンペーン（10/29 オーナーから）。初めて知識を公開したら、その場で 100 EMUER を
     「受け取る前のEMUER」に入れる。公式ショップでそのまま使える。
       ・パスポートごとに1回。同じパスポートにつないだ別のアカウントで投稿しても、2回目は出ない
       ・期間中に公開した、そのパスポートの最初の投稿だけ（前に投稿したことがある人は対象外）
       ・送り直し（電波が切れたとき）に備えて、期間が終わってからも少しだけ受け付ける
     画面から来た postId は「どの投稿か」の手がかりにだけ使い、中身はサーバーで読み直す。 */
  const tsMs = v => v && typeof v.toMillis === "function" ? v.toMillis()
    : v instanceof Date ? v.getTime() : typeof v === "number" ? v : Date.parse(v) || 0;
  async function passportAddresses(req) {
    const own = [req.identity.walletAddress, req.identity.account && req.identity.account.walletAddress,
      req.identity.account && req.identity.account.chesAddress];
    const uids = (await identity.linkedUidsForUid(req.identity.uid)).filter(u => u !== req.identity.uid);
    const others = await Promise.all(uids.slice(0, 10).map(async uid => {
      const snap = await db.collection("ches_accounts").doc(String(uid)).get();
      const a = snap.exists ? snap.data() || {} : {};
      return [a.walletAddress, a.chesAddress];
    }));
    const forms = new Set();
    for (const value of [...own, ...others.flat()]) {
      if (!validAddress(value)) continue;
      forms.add(String(value).toLowerCase());
      forms.add(ethers.utils.getAddress(String(value)));
    }
    return [...forms].slice(0, 30);
  }
  router.get("/campaign/first-post", (req, res) => res.json({
    startsAt: new Date(FIRST_POST_CAMPAIGN.startMs).toISOString(),
    endsAt: new Date(FIRST_POST_CAMPAIGN.endMs).toISOString(),
    amount: FIRST_POST_CAMPAIGN.amount, active: Date.now() >= FIRST_POST_CAMPAIGN.startMs && Date.now() < FIRST_POST_CAMPAIGN.endMs
  }));
  router.post("/activity/first-post", requireFirebaseUser, requireOwnAddress, async (req, res) => {
    if (!isEnabled()) return res.status(409).json({ error: "EMUER_V2_NOT_ACTIVE" });
    if (!db) return res.status(503).json({ error: "FIRESTORE_UNAVAILABLE" });
    const t = Date.now();
    const c = FIRST_POST_CAMPAIGN;
    if (t < c.startMs || t >= c.endMs + c.resendGraceMs) return res.status(409).json({ error: "CAMPAIGN_NOT_ACTIVE" });
    const postId = String(req.body.postId || "").trim();
    const recipient = String(req.identity.walletAddress || "").toLowerCase();
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(postId) || !validAddress(recipient)) return res.status(400).json({ error: "INVALID_FIRST_POST" });
    try {
      const spid = await identity.findByUid(req.identity.uid);
      if (!spid) return res.status(409).json({ error: "PASSPORT_REQUIRED" });
      const key = JSON.stringify(["emuer-v2", c.id, spid]);
      const already = await db.collection("emuer_v2_rewards").doc(claimId(key)).get();
      if (already.exists) return res.json({ ok: true, alreadyRecorded: true, amount: String(already.data().amount || c.amount) });
      const post = await db.collection("posts").doc(postId).get();
      if (!post.exists) return res.status(404).json({ error: "POST_NOT_FOUND" });
      const data = post.data() || {};
      const own = [req.identity.walletAddress, req.identity.account && req.identity.account.walletAddress,
        req.identity.account && req.identity.account.chesAddress].map(a => String(a || "").toLowerCase()).filter(Boolean);
      const created = tsMs(data.createdAt);
      if (!own.includes(String(data.address || "").toLowerCase())) return res.status(409).json({ error: "FIRST_POST_NOT_VERIFIED" });
      if (!(created >= c.startMs && created < c.endMs)) return res.status(409).json({ error: "OUTSIDE_CAMPAIGN" });
      // このパスポートのどの名義でも、この投稿より前の投稿があれば「初めて」ではない
      const earlier = await db.collection("posts").where("address", "in", await passportAddresses(req))
        .where("createdAt", "<", data.createdAt).limit(1).get();
      if (!earlier.empty) return res.status(409).json({ error: "NOT_FIRST_POST" });
      const row = await createReward({
        key, kind: "first-post", recipient, amountEmuer: c.amount,
        meta: { postId, campaign: c.id, postTitle: String(data.title || "").slice(0, 160) }
      });
      return res.json({ ok: true, rewardId: row.claimId, amount: String(row.amount) });
    } catch (error) {
      console.error("EMUER v2 first post reward error:", error.message);
      return res.status(500).json({ error: "FIRST_POST_REWARD_FAILED" });
    }
  });

  // Saving several conclusions on one day still yields one EMUER.  The server
  // reads the stored conclusion and binds the daily reward to the Passport.
  router.post("/activity/discussion-conclusion", requireFirebaseUser, requireOwnAddress, async (req, res) => {
    if (!isEnabled()) return res.status(409).json({ error: "EMUER_V2_NOT_ACTIVE" });
    if (!policy.isActive(Date.now())) return res.status(409).json({ error: "NOT_STARTED", startsAt: policy.START_MS });
    if (!db) return res.status(503).json({ error: "FIRESTORE_UNAVAILABLE" });
    const conclusionId = String(req.body.conclusionId || "").trim();
    const recipient = String(req.identity.walletAddress || "").toLowerCase();
    if (!conclusionId || !validAddress(recipient)) return res.status(400).json({ error: "INVALID_DISCUSSION_CONCLUSION" });
    try {
      const snap = await db.collection("discussion_conclusions").doc(conclusionId).get();
      const data = snap.exists ? snap.data() || {} : {};
      const createdAt = data.createdAt && typeof data.createdAt.toDate === "function" ? data.createdAt.toDate().getTime() : 0;
      if (!snap.exists || String(data.author || "").toLowerCase() !== recipient || !String(data.topic || "").trim() ||
          !String(data.conclusion || "").trim() || !createdAt || policy.dayKey(createdAt) !== policy.dayKey(Date.now())) {
        return res.status(409).json({ error: "DISCUSSION_CONCLUSION_NOT_VERIFIED" });
      }
      const row = await createReward({
        key: policy.dailyRewardKey(req.identity.uid, "discussion-conclusion", Date.now()),
        kind: "discussion-conclusion", recipient,
        meta: { conclusionId, topic: String(data.topic).slice(0, 160) }
      });
      return res.json({ ok: true, rewardId: row.claimId });
    } catch (error) {
      console.error("EMUER v2 discussion conclusion reward error:", error.message);
      return res.status(500).json({ error: "DISCUSSION_CONCLUSION_REWARD_FAILED" });
    }
  });

  // Knowledge requests never debit the requester.  An adopted answer is
  // automatically approved only when the stored request/answer pass the
  // objective checks below; anything outside that shape receives no reward.
  router.post("/activity/knowledge-answer", requireFirebaseUser, requireOwnAddress, async (req, res) => {
    if (!isEnabled()) return res.status(409).json({ error: "EMUER_V2_NOT_ACTIVE" });
    if (!policy.isActive(Date.now())) return res.status(409).json({ error: "NOT_STARTED", startsAt: policy.START_MS });
    if (!db) return res.status(503).json({ error: "FIRESTORE_UNAVAILABLE" });
    const requestId = String(req.body.requestId || "").trim();
    const answerId = String(req.body.answerId || "").trim();
    const requester = String(req.identity.walletAddress || "").toLowerCase();
    if (!requestId || !answerId || !validAddress(requester)) return res.status(400).json({ error: "INVALID_KNOWLEDGE_ANSWER" });
    try {
      const [requestSnap, answerSnap] = await Promise.all([
        db.collection("knowledge_requests").doc(requestId).get(),
        db.collection("knowledge_answers").doc(answerId).get()
      ]);
      if (!requestSnap.exists || !answerSnap.exists) return res.status(404).json({ error: "REQUEST_OR_ANSWER_NOT_FOUND" });
      const request = requestSnap.data() || {};
      const answer = answerSnap.data() || {};
      const recipient = String(answer.answerAuthor || "").toLowerCase();
      const acceptedAt = request.awardedAt && typeof request.awardedAt.toDate === "function" ? request.awardedAt.toDate().getTime() : 0;
      const objectiveChecks = String(request.author || "").toLowerCase() === requester &&
        request.status === "awarded" && request.rewardPolicy === "emuer-v2-treasury-1" &&
        String(request.acceptedAnswerId || "") === answerId && String(request.acceptedAnswerAuthor || "").toLowerCase() === recipient &&
        answer.status === "accepted" && String(answer.requestId || "") === requestId &&
        validAddress(recipient) && recipient !== requester && acceptedAt >= policy.START_MS &&
        String(answer.experience || "").trim().length >= 10 && String(answer.knowledge || "").trim().length >= 10 &&
        String(answer.limits || "").trim().length >= 3;
      if (!objectiveChecks) return res.status(409).json({ error: "KNOWLEDGE_ANSWER_NOT_VERIFIED" });
      const participants = await identity.knowledgeParticipants(request, answer);
      if (!participants.ok) return res.status(409).json({ error: participants.code, review: 'identity-review-required' });
      const row = await createReward({
        key: JSON.stringify(["emuer-v2", "knowledge-answer", requestId, answerId]), kind: "knowledge-answer", recipient,
        meta: { requestId, answerId, question: String(request.question || "").slice(0, 160), review: "automatic-approved" }
      });
      await requestSnap.ref.set({ rewardReviewStatus: "automatic-approved", rewardReviewedAt: new Date() }, { merge: true });
      return res.json({ ok: true, rewardId: row.claimId, review: "automatic-approved" });
    } catch (error) {
      console.error("EMUER v2 knowledge answer reward error:", error.message);
      return res.status(500).json({ error: "KNOWLEDGE_ANSWER_REWARD_FAILED" });
    }
  });

  /* 受け取り済みのものを、一覧から外す。

     報酬は status:"pending" で作られるが、鎖の上で受け取っても
     その status を戻すところがどこにも無かった。だから一度受け取った
     ぶんも一覧に残り続ける。

     10/2、これで二度目の受け取りが転んだ。一覧の先頭が受け取り済みの
     ぶんのままなので、同じ claimId をもう一度コントラクトへ送ることに
     なる。コントラクトは already >= totalAmount で ClaimUnavailable を
     返すので、MetaMask の前に estimateGas が execution reverted で落ちる。
     人からは「受け取ったのに、もう一度押したらエラー」としか見えない。

     鎖に聞けば確かなことが分かるので、聞いて、済んでいるものは
     Firestore にも印を付けて外す（次からは聞かずに済む）。
     鎖に聞けないときは、今までどおり全部返す。黙って隠すより、
     出して転ぶほうがまだ分かる。 */
  async function unpaidOnly(docs) {
    const rows = docs.map(doc => ({ id: doc.id, data: doc.data() || {} }));
    if (!contract) return rows;
    const settled = [];
    const checked = await Promise.all(rows.map(async row => {
      const want = String(row.data.amountWei || "0");
      if (want === "0") return row;
      try {
        const paid = await contract.claimPaid(String(row.data.claimId || row.id));
        if (paid.gte(want)) { settled.push(row.id); return null; }
      } catch (_) { /* 読めないときは外さない */ }
      return row;
    }));
    settled.forEach(id => db.collection("emuer_v2_rewards").doc(id)
      .update({ status: "claimed", claimedAt: new Date(), updatedAt: new Date() })
      .catch(() => { }));
    return checked.filter(Boolean);
  }

  router.get("/rewards", requireFirebaseUser, requireOwnAddress, async (req, res) => {
    if (!isEnabled()) return res.status(409).json({ error: "EMUER_V2_NOT_ACTIVE" });
    if (!db) return res.status(503).json({ error: "FIRESTORE_UNAVAILABLE" });
    try {
      const recipient = String(req.identity.walletAddress).toLowerCase();
      const rewards = await db.collection("emuer_v2_rewards").where("recipient", "==", recipient).where("status", "==", "pending").limit(50).get();
      const rows = await unpaidOnly(rewards.docs);
      return res.json({ rewards: rows.map(row => ({ claimId: row.id, kind: row.data.kind, amount: row.data.amount, postTitle: row.data.postTitle || "", ...(row.data.kind === "bundle" ? { memberCount: row.data.memberCount || 0 } : {}) })) });
    } catch (error) { return res.status(500).json({ error: "REWARDS_LIST_FAILED" }); }
  });

  /* 知識の募集の報酬は、採用された回答で、別の二人であることを、受け取りの署名を出す前に確かめる。
     問題が無ければ null、あれば理由のコードを返す（1件ずつの受け取りとまとめ受け取りで同じ確認）。 */
  async function knowledgeAnswerProblem(reward) {
    const [rs, as] = await Promise.all([
      db.collection('knowledge_requests').doc(String(reward.requestId)).get(),
      db.collection('knowledge_answers').doc(String(reward.answerId)).get()
    ]);
    if (!rs.exists || !as.exists) return 'IDENTITY_REVIEW_REQUIRED';
    if (String(as.data().requestId) !== String(reward.requestId) ||
      String(as.data().answerAuthor || '').toLowerCase() !== String(reward.recipient || '').toLowerCase() ||
      rs.data().status !== 'awarded' || as.data().status !== 'accepted' ||
      String(rs.data().acceptedAnswerId) !== String(reward.answerId))
      return 'KNOWLEDGE_ANSWER_NOT_VERIFIED';
    const people = await identity.knowledgeParticipants(rs.data(), as.data());
    return people.ok ? null : people.code;
  }

  /* 未請求の報酬を、まとめて1回で受け取る。

     コントラクトは「受け取り札（claimId・受取人・合計額・期限）」にサーバーの署名があれば払う。
     札が何件分の報酬かは問わないので、まとめた合計を1枚の札にすれば、MetaMask の承認も
     ガス代も1回で済む（DECISIONS.md の「申請時点で確定済みの未変換報酬を全額まとめる」）。

     二重に払わないために:
       ・まとめた元の報酬は、同じ取引の中で status を "bundled" にする。一覧（pending だけ）にも、
         みてみる（pending だけを支払いに使う）にも、1件ずつの受け取りにも、もう出てこない。
       ・元の報酬の札をすでに出していて、その期限（とみてみると同じ余白）が切れていないものは入れない。
         期限内なら、その札でも受け取れてしまうため。
       ・チェーン上で1円でも受け取り済みのものは入れない（元の札のまま受け取る）。チェーンに聞けない
         ときは、まとめない（推測でまとめると、二重に払うおそれがある）。
       ・知識の募集の報酬は、1件ずつの受け取りと同じ確認を通ったものだけを入れる。
     月の配布上限とトレジャリーの残高は、これまでどおりコントラクトが守る（足りなければ一部だけ払われ、
     残りは同じ札でまた受け取れる）。 */
  const BUNDLE_MAX = 200;
  const BUNDLE_GRACE_MS = 60 * 1000;   // みてみる（mitemiru.js の AUTH_GRACE_MS）と同じ余白
  router.post("/rewards/bundle", requireFirebaseUser, requireOwnAddress, async (req, res) => {
    if (!isEnabled()) return res.status(409).json({ error: "EMUER_V2_NOT_ACTIVE" });
    if (!policy.isActive(Date.now())) return res.status(409).json({ error: "NOT_STARTED", startsAt: policy.START_MS });
    if (!db) return res.status(503).json({ error: "FIRESTORE_UNAVAILABLE" });
    const recipient = String(req.identity.walletAddress || "").toLowerCase();
    if (!validAddress(recipient)) return res.status(400).json({ error: "SELF_CUSTODY_WALLET_REQUIRED" });
    try {
      const ready = await signerReady();
      if (!ready.ok) return res.status(503).json({ error: ready.code });
      const snap = await db.collection("emuer_v2_rewards").where("recipient", "==", recipient).where("status", "==", "pending").limit(500).get();
      const now = Date.now();
      const candidates = [];
      for (const doc of snap.docs) {
        const row = doc.data() || {};
        if (Number(row.authorizedUntilMs || 0) + BUNDLE_GRACE_MS > now) continue;
        if (!/^\d+$/.test(String(row.amountWei || "")) || BigInt(row.amountWei) <= 0n) continue;
        candidates.push({ id: doc.id, row });
      }
      // チェーンに聞いて、少しでも受け取られているものは外す。聞けなければ、まとめない。
      let paid;
      try { paid = await Promise.all(candidates.map(c => contract.claimPaid(String(c.row.claimId || c.id)))); }
      catch (_) { return res.status(503).json({ error: "CHAIN_UNAVAILABLE" }); }
      const unpaid = candidates.filter((c, i) => BigInt(String(paid[i])) === 0n);
      const members = [];
      for (const c of unpaid) {
        if (members.length >= BUNDLE_MAX) break;
        if (c.row.kind === "knowledge-answer" && await knowledgeAnswerProblem(c.row)) continue;
        members.push(c);
      }
      if (!members.length) return res.status(409).json({ error: "NOTHING_TO_BUNDLE" });
      const ids = members.map(m => m.id).sort();
      const key = JSON.stringify(["emuer-v2", "bundle", recipient, ethers.utils.keccak256(ethers.utils.toUtf8Bytes(ids.join(",")))]);
      const id = claimId(key);
      const deadline = Math.floor(Date.now() / 1000) + 15 * 60;
      const bundleRef = db.collection("emuer_v2_rewards").doc(id);
      let bundle;
      await db.runTransaction(async tx => {
        const refs = ids.map(memberId => db.collection("emuer_v2_rewards").doc(memberId));
        const [existing, ...rows] = await Promise.all([tx.get(bundleRef), ...refs.map(ref => tx.get(ref))]);
        if (existing.exists) throw new Error("BUNDLE_ALREADY_EXISTS");
        let total = 0n;
        rows.forEach(memberSnap => {
          const r = memberSnap.exists ? memberSnap.data() || {} : null;
          // 取引の中でもう一度確かめる（同時にみてみるで使われた・札を出した、などを拾う）
          if (!r || r.status !== "pending" || String(r.recipient || "").toLowerCase() !== recipient
              || Number(r.authorizedUntilMs || 0) + BUNDLE_GRACE_MS > Date.now()) throw new Error("BUNDLE_CHANGED");
          total += BigInt(r.amountWei);
        });
        bundle = {
          schema: "emuer-v2-reward-v1", kind: "bundle", key, claimId: id, uid: req.identity.uid,
          recipient, amountWei: total.toString(), amount: (total / policy.UNIT).toString(),
          members: ids, memberCount: ids.length, status: "pending", authorizedUntilMs: deadline * 1000,
          createdAt: new Date(), updatedAt: new Date()
        };
        tx.create(bundleRef, bundle);
        refs.forEach(ref => tx.set(ref, { status: "bundled", bundleClaimId: id, bundledAt: new Date(), updatedAt: new Date() }, { merge: true }));
      });
      return res.json({ ok: true, count: ids.length, amount: bundle.amount, reward: await signReward(bundle, deadline) });
    } catch (error) {
      const code = String(error.message || "");
      if (code === "BUNDLE_CHANGED" || code === "BUNDLE_ALREADY_EXISTS") return res.status(409).json({ error: "BUNDLE_CHANGED" });
      console.error("EMUER v2 bundle error:", error.message); return res.status(500).json({ error: "BUNDLE_FAILED" });
    }
  });

  router.post("/rewards/:claimId/authorization", requireFirebaseUser, requireOwnAddress, async (req, res) => {
    if (!isEnabled()) return res.status(409).json({ error: "EMUER_V2_NOT_ACTIVE" });
    if (!policy.isActive(Date.now())) return res.status(409).json({ error: "NOT_STARTED", startsAt: policy.START_MS });
    if (!db) return res.status(503).json({ error: "FIRESTORE_UNAVAILABLE" });
    try {
      const ref = db.collection("emuer_v2_rewards").doc(String(req.params.claimId));
      const existing = await ref.get();
      if(existing.exists && String(existing.data().recipient||'').toLowerCase() !== String(req.identity.walletAddress).toLowerCase())
        return res.status(403).json({error:'REWARD_NOT_OWNED'});
      if (existing.exists && existing.data().kind === 'knowledge-answer') {
        const problem = await knowledgeAnswerProblem(existing.data());
        if (problem) return res.status(409).json({ error: problem });
      }
      const ready = await signerReady();
      if (!ready.ok) return res.status(503).json({ error: ready.code });
      const { row, deadline } = await reserveAuthorization(ref, req.identity.walletAddress);
      return res.json({ ok: true, reward: await signReward(row, deadline) });
    } catch (error) {
      const code = String(error.message || "");
      if (code === "REWARD_NOT_FOUND") return res.status(404).json({ error: code });
      if (code === "REWARD_NOT_OWNED") return res.status(403).json({ error: code });
      if (code === "REWARD_SPENT" || code === "REWARD_BUNDLED") return res.status(409).json({ error: code });
      console.error("EMUER v2 reward auth error:", error.message); return res.status(500).json({ error: "REWARD_ISSUE_FAILED" });
    }
  });

  router.post("/daily/login", requireFirebaseUser, requireOwnAddress, async (req, res) => {
    if (!isEnabled()) return res.status(409).json({ error: "EMUER_V2_NOT_ACTIVE" });
    if (!db) return res.status(503).json({ error: "FIRESTORE_UNAVAILABLE" });
    const recipient = String(req.identity.walletAddress || "").toLowerCase();
    if (!validAddress(recipient)) return res.status(400).json({ error: "SELF_CUSTODY_WALLET_REQUIRED" });
    if (Date.now() < policy.START_MS) return res.status(409).json({ error: "NOT_STARTED", startsAt: policy.START_MS });
    /* MetaMask の無いところ（LINE・Google のアプリ内ブラウザなど）は、鎖の上で受け取れない。
       そのときは今日のぶんを「待っている報酬」として作るだけにする（claim:false）。
       署名は出さないので、ウォレットに移す前のEMUERとして、すぐ公式ショップで使える。
       あとで MetaMask のあるところから「未請求の報酬」として受け取ることもできる。 */
    const recordOnly = req.body && req.body.claim === false;
    try {
      if (!recordOnly) {
        const ready = await signerReady();
        if (!ready.ok) return res.status(503).json({ error: ready.code });
      }
      const key = rewardKey(req.identity.uid, Date.now());
      const id = claimId(key);
      const ref = db.collection("emuer_v2_rewards").doc(id);
      let row;
      await db.runTransaction(async tx => {
        const previous = await tx.get(ref);
        if (previous.exists) { row = previous.data(); return; }
        row = {
          schema: "emuer-v2-reward-v1", kind: "login", key, claimId: id,
          uid: req.identity.uid, recipient, amountWei: policy.UNIT.toString(), amount: "1",
          status: "pending", createdAt: new Date(), updatedAt: new Date()
        };
        tx.create(ref, row);
      });
      if (String(row.recipient || "").toLowerCase() !== recipient) return res.status(409).json({ error: "REWARD_BOUND_TO_ANOTHER_WALLET" });
      if (recordOnly) return res.json({ ok: true, recorded: true, amount: String(row.amount || "1"), status: row.status || "pending" });
      const reserved = await reserveAuthorization(ref, recipient);
      const authorization = await signReward(reserved.row, reserved.deadline);
      return res.json({ ok: true, alreadyCreated: !!row.createdAt && row.key === key, reward: authorization });
    } catch (error) {
      if (["REWARD_SPENT", "REWARD_BUNDLED"].includes(String(error.message || ""))) return res.status(409).json({ error: String(error.message) });
      console.error("EMUER v2 login reward error:", error.message);
      return res.status(500).json({ error: "REWARD_ISSUE_FAILED" });
    }
  });

  return { router, isEnabled, signerReady, contractAddress: CONTRACT };
}

module.exports = { createEmuerV2Router, CONTRACT, CHAIN_ID, rewardKey, enabled };
