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
  const env = deps.env || process.env;
  const isEnabled = () => enabled(env);
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
  async function createReward({ key, kind, recipient, meta }) {
    const id = claimId(key);
    const ref = db.collection("emuer_v2_rewards").doc(id);
    let row;
    await db.runTransaction(async tx => {
      const previous = await tx.get(ref);
      if (previous.exists) { row = previous.data(); return; }
      row = {
        schema: "emuer-v2-reward-v1", kind, key, claimId: id,
        recipient: String(recipient).toLowerCase(), amountWei: policy.UNIT.toString(), amount: "1",
        status: "pending", ...meta, createdAt: new Date(), updatedAt: new Date()
      };
      tx.create(ref, row);
    });
    return row;
  }

  router.get("/config", (req, res) => res.json({
    enabled: isEnabled(), chainId: CHAIN_ID, contract: CONTRACT,
    startsAt: new Date(policy.START_MS).toISOString(), monthlyCap: "416000"
  }));

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
