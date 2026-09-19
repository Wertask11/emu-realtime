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

const CONTRACT = "0x9c102cC3016C70767082b60196565878D9314864";
const CHAIN_ID = 137;
const TREASURY = "0x1c156b6a8caa6772430eda2cbb0d20cf41b9cfe4";
const FOUNDER_QUEST_ID = "founder-quest-000";
const ABI = [
  "function hasRole(bytes32 role,address account) view returns (bool)",
  "function claimPaid(bytes32) view returns (uint256)",
  "function claimAuthorizedTotal(bytes32) view returns (uint256)"
];

function enabled(env) {
  return env.EMUER_V2_ENABLED === "true";
}
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
  const env = deps.env || process.env;
  const isEnabled = () => enabled(env);
  const operatorAddresses = new Set(String(env.EMUER_V2_OPERATOR_ADDRESSES || TREASURY)
    .split(",").map(value => String(value || "").trim().toLowerCase()).filter(validAddress));
  const rpcUrl = env.POLYGON_RPC_URL || "https://polygon-bor-rpc.publicnode.com";
  const privateKey = env.EMUER_V2_AUTHORIZER_PRIVATE_KEY || "";
  const provider = privateKey ? new ethers.providers.JsonRpcProvider(rpcUrl) : null;
  const signer = provider ? new ethers.Wallet(privateKey, provider) : null;
  const contract = provider ? new ethers.Contract(CONTRACT, ABI, provider) : null;

  async function signerReady() {
    if (!signer || !contract) return { ok: false, code: "AUTHORIZER_NOT_CONFIGURED" };
    const hasRole = await contract.hasRole(AUTHORIZER_ROLE, signer.address);
    return hasRole ? { ok: true } : { ok: false, code: "AUTHORIZER_ROLE_MISSING" };
  }
  async function signReward(record) {
    const deadline = Math.floor(Date.now() / 1000) + 15 * 60;
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
        const [ledgerSnap, usageSnap] = await Promise.all([tx.get(ledgerRef), access.ref ? tx.get(access.ref) : Promise.resolve(null)]);
        const ledger = ledgerSnap.exists ? ledgerSnap.data() || {} : {};
        const amountEmuer = Number(ledger.unconverted || 0);
        if (!ledgerSnap.exists || ledger.status !== "identity_pending" || !Number.isSafeInteger(amountEmuer) || amountEmuer < 1) throw new Error("NO_VERIFIED_LEGACY_BALANCE");
        if (access.period.limit !== null && Number((usageSnap && usageSnap.data() || {}).used || 0) >= access.period.limit) throw new Error("PERIOD_LIMIT_REACHED");
        const key = JSON.stringify(["emuer-v2", "legacy-good-change", recipient]);
        const id = claimId(key);
        const rewardRef = db.collection("emuer_v2_rewards").doc(id);
        reward = { schema: "emuer-v2-reward-v1", kind: "legacy-good-change", key, claimId: id, recipient,
          amountWei: (BigInt(amountEmuer) * policy.UNIT).toString(), amount: String(amountEmuer), status: "pending",
          source: "verified-backfill", createdAt: new Date(), updatedAt: new Date() };
        tx.create(rewardRef, reward);
        tx.update(ledgerRef, { status: "converted", convertedClaimId: id, convertedAt: new Date(), updatedAt: new Date() });
        if (access.period.limit !== null) tx.set(access.ref, { uid: req.identity.uid, action: "convert", period: access.period.key, plan: access.plan, used: Number((usageSnap && usageSnap.data() || {}).used || 0) + 1, updatedAt: new Date() }, { merge: true });
      });
      return res.json({ ok: true, rewardId: reward.claimId, amount: reward.amount, plan: access.plan });
    } catch (error) {
      const code = String(error.message || "");
      if (["NO_VERIFIED_LEGACY_BALANCE", "PERIOD_LIMIT_REACHED"].includes(code)) return res.status(409).json({ error: code });
      if (code.includes("ALREADY_EXISTS")) return res.status(409).json({ error: "LEGACY_BALANCE_ALREADY_CONVERTED" });
      console.error("EMUER v2 legacy conversion error:", error.message); return res.status(500).json({ error: "LEGACY_CONVERSION_FAILED" });
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
      if (["CONTRIBUTION_NOT_FOUND", "CONTRIBUTION_ALREADY_REVIEWED", "BUDGET_EXCEEDED"].includes(code)) return res.status(409).json({ error: code });
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
      return res.json({ claimedToday: reward.exists, date: key.split(":").pop() });
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

  router.get("/rewards", requireFirebaseUser, requireOwnAddress, async (req, res) => {
    if (!isEnabled()) return res.status(409).json({ error: "EMUER_V2_NOT_ACTIVE" });
    if (!db) return res.status(503).json({ error: "FIRESTORE_UNAVAILABLE" });
    try {
      const recipient = String(req.identity.walletAddress).toLowerCase();
      const rewards = await db.collection("emuer_v2_rewards").where("recipient", "==", recipient).where("status", "==", "pending").limit(50).get();
      return res.json({ rewards: rewards.docs.map(doc => ({ claimId: doc.id, kind: doc.data().kind, amount: doc.data().amount, postTitle: doc.data().postTitle || "" })) });
    } catch (error) { return res.status(500).json({ error: "REWARDS_LIST_FAILED" }); }
  });

  router.post("/rewards/:claimId/authorization", requireFirebaseUser, requireOwnAddress, async (req, res) => {
    if (!isEnabled()) return res.status(409).json({ error: "EMUER_V2_NOT_ACTIVE" });
    if (!policy.isActive(Date.now())) return res.status(409).json({ error: "NOT_STARTED", startsAt: policy.START_MS });
    if (!db) return res.status(503).json({ error: "FIRESTORE_UNAVAILABLE" });
    try {
      const ref = db.collection("emuer_v2_rewards").doc(String(req.params.claimId));
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: "REWARD_NOT_FOUND" });
      const row = snap.data();
      if (String(row.recipient || "").toLowerCase() !== String(req.identity.walletAddress).toLowerCase()) return res.status(403).json({ error: "REWARD_NOT_OWNED" });
      const ready = await signerReady();
      if (!ready.ok) return res.status(503).json({ error: ready.code });
      return res.json({ ok: true, reward: await signReward(row) });
    } catch (error) { console.error("EMUER v2 reward auth error:", error.message); return res.status(500).json({ error: "REWARD_ISSUE_FAILED" }); }
  });

  router.post("/daily/login", requireFirebaseUser, requireOwnAddress, async (req, res) => {
    if (!isEnabled()) return res.status(409).json({ error: "EMUER_V2_NOT_ACTIVE" });
    if (!db) return res.status(503).json({ error: "FIRESTORE_UNAVAILABLE" });
    const recipient = String(req.identity.walletAddress || "").toLowerCase();
    if (!validAddress(recipient)) return res.status(400).json({ error: "SELF_CUSTODY_WALLET_REQUIRED" });
    if (Date.now() < policy.START_MS) return res.status(409).json({ error: "NOT_STARTED", startsAt: policy.START_MS });
    try {
      const ready = await signerReady();
      if (!ready.ok) return res.status(503).json({ error: ready.code });
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
      const authorization = await signReward(row);
      return res.json({ ok: true, alreadyCreated: !!row.createdAt && row.key === key, reward: authorization });
    } catch (error) {
      console.error("EMUER v2 login reward error:", error.message);
      return res.status(500).json({ error: "REWARD_ISSUE_FAILED" });
    }
  });

  return { router, isEnabled, signerReady, contractAddress: CONTRACT };
}

module.exports = { createEmuerV2Router, CONTRACT, CHAIN_ID, rewardKey, enabled };