"use strict";

/* One completion per person and quest. The reward is reserved from the EMUER v2
   budget in the same Firestore transaction as the operator's approval. */
const express = require("express");
const ethers = require("ethers");
const policy = require("./emuer-v2/policy");

/* ギルドの色。frontend/public/schoolpark/guild-store.js と同じ値。
   証明書の絵と、星空の星の色をそろえるために使う。 */
const GUILD_COLOR = {
  learn: "#0F5C3F", work: "#141310", play: "#C2703D",
  connect: "#B0405A", web3: "#3B382F"
};
const GUILD_LABEL = {
  learn: "LEARN", work: "WORK", play: "PLAY", connect: "CONNECT", web3: "WEB3"
};

/* 段ごとの1人あたりの報酬。年内目標の資料どおり。
   入門3日50 ／ 標準7日100 ／ 実践14日200。段の無いクエストは100。
   運営が予算を公開するときに別の額を入れれば、そちらが優先される。 */
const STAGE_EMUER = { "入門": 50, "標準": 100, "実践": 200 };
function defaultPerPerson(quest) {
  return STAGE_EMUER[String(quest && quest.stage || "")] || 100;
}

/* #000 は原点なので、予算も報酬も持たない。 */
const FOUNDER_QUEST_ID = "founder-quest-000";
function usableQuest(questId, quest) {
  return !!quest && questId !== FOUNDER_QUEST_ID && quest.kind !== "founder"
    && Number.isSafeInteger(Number(quest.questNumber)) && Number(quest.questNumber) >= 1;
}

function createQuestCompletionRouter({ db, requireOwner, requireFirebaseUser, env = process.env }) {
  const router = express.Router();
  const certContract = String(env.SP_QUEST_STAR_CONTRACT || "");
  const certKey = String(env.SP_QUEST_STAR_MINTER_PRIVATE_KEY || "");
  router.get("/certificate/config", (_req, res) => {
    res.json({ ready: ethers.utils.isAddress(certContract) && !!certKey, chainId: 137, contract: ethers.utils.isAddress(certContract) ? certContract : null });
  });
  router.post("/:questId/budget", requireOwner, async (req, res) => {
    if (!policy.isActive(Date.now())) return res.status(409).json({ error: "NOT_STARTED" });
    if (!db) return res.status(503).json({ error: "FIRESTORE_UNAVAILABLE" });
    const questId = String(req.params.questId || "");
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(questId)) return res.status(400).json({ error: "INVALID_QUEST" });
    try {
      const q = await db.collection("sp_quests").doc(questId).get();
      const quest = q.exists ? q.data() || {} : {};
      /* 前は一般 #001 の LEARN しか受け付けなかった。ほかのクエストは
         予算そのものを公開できず、途中報告からの貢献も記録されない。
         クエストなら、どれでも同じ道を通す（#000 だけは除く）。 */
      if (!usableQuest(questId, quest)) return res.status(409).json({ error: "QUEST_NOT_ELIGIBLE" });

      /* 1人あたりの額は、運営が決める。入れなければ段から決める
         （入門50／標準100／実践200、段が無ければ100）。 */
      const perPerson = Number((req.body || {}).perPersonEmuer || defaultPerPerson(quest));
      const total = Number((req.body || {}).totalEmuer || 0);
      if (!Number.isSafeInteger(perPerson) || perPerson <= 0 || perPerson > 1000000)
        return res.status(400).json({ error: "INVALID_PER_PERSON" });
      if (!Number.isSafeInteger(total) || total < perPerson || total > 100000000)
        return res.status(400).json({ error: "INVALID_TOTAL" });

      const label = (quest.series === "special" ? "特殊 " : "一般 ") + "#"
        + String(quest.questNumber).padStart(3, "0")
        + (Number(quest.branch) >= 1 ? "-" + Number(quest.branch) : "")
        + (quest.stage ? " " + quest.stage : "");
      const ref = db.collection("emuer_v2_guild_quest_budgets").doc("quest:" + questId);
      const result = await db.runTransaction(async tx => {
        const snap = await tx.get(ref);
        if (snap.exists) {
          const row = snap.data() || {};
          if (row.status === "published" && Number(row.totalEmuer) === total
              && Number(row.perPersonEmuer || 0) === perPerson) return { alreadyPublished: true };
          throw new Error("BUDGET_EXISTS_DIFFERENT");
        }
        tx.create(ref, {
          schema: "emuer-v2-guild-quest-budget-v1", scopeType: "quest", scopeId: questId,
          title: label + " " + String(quest.title || "").slice(0, 80) + " 完走報酬",
          conditions: "やってみた・つまずいた・気づいたの報告と知恵カードを確認後、運営が完走承認。1人"
            + perPerson + " EMUER、最大" + Math.floor(total / perPerson) + "人。",
          totalEmuer: total, perPersonEmuer: perPerson, allocatedEmuer: 0, status: "published",
          publishedBy: req.identity.walletAddress, publishedAt: new Date(), updatedAt: new Date()
        });
        return { alreadyPublished: false };
      });
      return res.json({ ok: true, totalEmuer: total, perPersonEmuer: perPerson, ...result });
    } catch (error) {
      if (error.message === "BUDGET_EXISTS_DIFFERENT") return res.status(409).json({ error: error.message });
      console.error("Quest budget failed:", error);
      return res.status(500).json({ error: "BUDGET_PUBLISH_FAILED" });
    }
  });
  router.post("/:questId/:address/approve", requireOwner, async (req, res) => {
    if (!policy.isActive(Date.now())) return res.status(409).json({ error: "NOT_STARTED" });
    if (!db) return res.status(503).json({ error: "FIRESTORE_UNAVAILABLE" });
    const questId = String(req.params.questId || "");
    const address = String(req.params.address || "").toLowerCase();
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(questId) || !ethers.utils.isAddress(address))
      return res.status(400).json({ error: "INVALID_COMPLETION" });
    const questRef = db.collection("sp_quests").doc(questId);
    const commitRef = questRef.collection("commits").doc(address);
    const budgetRef = db.collection("emuer_v2_guild_quest_budgets").doc("quest:" + questId);
    try {
      const [quest, commit, logs, wisdom, byChes, byWallet] = await Promise.all([
        questRef.get(), commitRef.get(), questRef.collection("logs").get(),
        db.collection("sp_wisdom").where("questId", "==", questId).get(),
        db.collection("ches_accounts").where("chesAddress", "==", address).limit(2).get(),
        db.collection("ches_accounts").where("walletAddress", "==", address).limit(2).get()
      ]);
      const q = quest.exists ? quest.data() || {} : {};
      if (!usableQuest(questId, q)) return res.status(409).json({ error: "QUEST_NOT_ELIGIBLE" });
      if (!commit.exists) return res.status(409).json({ error: "NOT_JOINED" });
      const kinds = new Set();
      logs.forEach(doc => {
        const row = doc.data() || {};
        if (String(row.author || "").toLowerCase() === address) kinds.add(row.kind);
      });
      let hasWisdom = false;
      wisdom.forEach(doc => { if (String((doc.data() || {}).author || "").toLowerCase() === address) hasWisdom = true; });
      if (!["やってみた", "つまずいた", "気づいた"].every(kind => kinds.has(kind)) || !hasWisdom)
        return res.status(409).json({ error: "COMPLETION_EVIDENCE_MISSING" });
      const accounts = [...byChes.docs, ...byWallet.docs];
      const spids = new Set(accounts.map(doc => String((doc.data() || {}).spid || "")));
      if (spids.size !== 1 || ![...spids][0]) return res.status(409).json({ error: "PASSPORT_LINK_REQUIRED" });
      const spid = [...spids][0];
      const identity = await db.collection("sp_identities").doc(spid).get();
      const links = identity.exists ? (identity.data() || {}).links || [] : [];
      const linkedWallet = links.find(link => link && link.kind === "wallet" && ethers.utils.isAddress(link.subject));
      const recipient = String(linkedWallet && linkedWallet.subject || "").toLowerCase();
      if (!ethers.utils.isAddress(recipient))
        return res.status(409).json({ error: "WALLET_REQUIRED" });
      const completionKey = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(JSON.stringify(["schoolpark", questId, spid])));
      const certRef = db.collection("sp_quest_certificates").doc(completionKey);
      const rewardKey = JSON.stringify(["emuer-v2", "quest-completion", questId, spid]);
      const rewardId = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(rewardKey));
      const rewardRef = db.collection("emuer_v2_rewards").doc(rewardId);

      /* Resolve the wallet from the account that owns the quest address.
         Never accept a destination supplied by the operator's browser. */
      const result = await db.runTransaction(async tx => {
        const [current, budgetSnap, prior, certificate] = await Promise.all([
          tx.get(commitRef), tx.get(budgetRef), tx.get(rewardRef), tx.get(certRef)
        ]);
        if (!current.exists) throw new Error("NOT_JOINED");
        const was = current.data() || {};
        if (prior.exists || certificate.exists) {
          if (prior.exists && certificate.exists && was.approved === true) return { alreadyApproved: true };
          throw new Error("COMPLETION_STATE_CONFLICT");
        }
        /* 承認の印だけが立っていて、報酬も証明書も無いことがある。
           サーバーへ届かないまま管理画面から通した承認がこれ。
           何も払われていないので、ここで引き当て直してよい。
           （この印は運営しか立てられない。firestore.rules の
             sp_quests/{id}/commits/{addr} の update を見ること。）
           前はこれも COMPLETION_STATE_CONFLICT で止めていたので、
           いちど通した承認は、あとから EMUER を渡す道が無かった。 */
        const budget = budgetSnap.exists ? budgetSnap.data() || {} : {};
        if (budget.status !== "published" || budget.scopeType !== "quest" || budget.scopeId !== questId)
          throw new Error("BUDGET_NOT_PUBLISHED");
        const allocated = Number(budget.allocatedEmuer || 0);
        const total = Number(budget.totalEmuer || 0);
        /* 1人あたりの額は、予算を公開したときに決めたもの。
           古い予算（この欄が無いもの）は、段から決める。
           運営のブラウザから送られてきた数は使わない。 */
        const per = Number(budget.perPersonEmuer || defaultPerPerson(q));
        if (!Number.isSafeInteger(per) || per <= 0) throw new Error("BUDGET_NOT_PUBLISHED");
        if (!Number.isSafeInteger(allocated) || !Number.isSafeInteger(total) || allocated + per > total)
          throw new Error("BUDGET_EXCEEDED");
        const now = Date.now();
        const guildId = String(q.guildId || "");
        /* 引き当てた額を、参加の記録そのものに書く。
           管理画面は、この欄があるかどうかで「もう EMUER が動いた承認」と
           「サーバーへ届かないまま通した承認」を見分ける。
           前者は取り消せない（報酬と証明書がもう予約されている）。 */
        /* 認めた日は動かさない。信用スコアと星空の並びが後ろへずれる。 */
        const approvedAt = Number(was.approvedAt) > 0 ? Number(was.approvedAt) : now;
        tx.update(commitRef, { approved: true, approvedAt, approvedBy: req.identity.walletAddress,
          rewardEmuer: per });
        tx.update(budgetRef, { allocatedEmuer: allocated + per, updatedAt: new Date(now) });
        tx.create(rewardRef, {
          schema: "emuer-v2-reward-v1", kind: "quest-completion", key: rewardKey, claimId: rewardId,
          recipient, amountWei: (BigInt(per) * policy.UNIT).toString(), amount: String(per), status: "pending",
          scopeType: "quest", scopeId: questId, createdAt: new Date(now), updatedAt: new Date(now)
        });
        tx.create(certRef, {
          schema: "schoolpark-quest-star-v1", completionKey, questId, spid, address,
          /* 星空の星と同じ色にする。どのギルドにも属さないクエストは未分類の色。 */
          guildId: guildId, guildColor: GUILD_COLOR[guildId] || "#6E695C",
          questTitle: String(q.title || "").slice(0, 120),
          questLabel: (q.series === "special" ? "特殊 " : "一般 ") + "#"
            + String(q.questNumber).padStart(3, "0")
            + (Number(q.branch) >= 1 ? "-" + Number(q.branch) : "")
            + (q.stage ? " " + q.stage : ""),
          amountEmuer: per,
          completedAt: approvedAt, status: "pending", createdAt: new Date(now)
        });
        return { alreadyApproved: false, amountEmuer: per };
      });
      return res.json({ ok: true, rewardId, amountEmuer: result.amountEmuer || 0, ...result });
    } catch (error) {
      const code = String(error.message || "");
      if (["NOT_JOINED", "COMPLETION_STATE_CONFLICT", "BUDGET_NOT_PUBLISHED", "BUDGET_EXCEEDED"].includes(code))
        return res.status(409).json({ error: code });
      console.error("Quest completion failed:", error);
      return res.status(500).json({ error: "COMPLETION_FAILED" });
    }
  });
  router.get("/certificates/:key/metadata", async (req, res) => {
    const key = String(req.params.key || "");
    if (!/^0x[0-9a-f]{64}$/i.test(key) || !db) return res.status(404).json({ error: "NOT_FOUND" });
    const snap = await db.collection("sp_quest_certificates").doc(key).get();
    if (!snap.exists) return res.status(404).json({ error: "NOT_FOUND" });
    const row = snap.data() || {};
    /* 絵も名前も、そのクエストのものにする。
       前はどのクエストで完走しても「#001 LEARN」と書かれた証明書が
       出ていた。#002 を完走した人の手元に #001 の証明書が残る。 */
    const guildId = String(row.guildId || "");
    const guild = GUILD_LABEL[guildId] || "";
    const color = row.guildColor || GUILD_COLOR[guildId] || "#6E695C";
    const label = String(row.questLabel || "").trim();
    const title = String(row.questTitle || "").slice(0, 40);
    const caption = ("SchoolPark " + label + (guild ? " " + guild : "")).trim();
    const esc = t => String(t).replace(/[&<>"']/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640" viewBox="0 0 640 640">'
      + '<rect width="640" height="640" fill="#141310"/><circle cx="320" cy="280" r="170" fill="' + esc(color)
      + '" opacity=".35"/><path d="M320 115l42 124 130 2-105 78 39 125-106-75-106 75 39-125-105-78 130-2z" fill="#D0E2BE"/>'
      + '<text x="320" y="520" text-anchor="middle" fill="#F4F1EA" font-size="30" font-family="sans-serif">'
      + esc(caption) + '</text>'
      + '<text x="320" y="562" text-anchor="middle" fill="#D0E2BE" font-size="18" font-family="sans-serif">'
      + esc(title) + '</text></svg>';
    res.set("Cache-Control", "public, max-age=3600");
    const attributes = [{ trait_type: "Quest", value: label || String(row.questId || "") },
      { trait_type: "Completed", value: new Date(row.completedAt).toISOString().slice(0, 10) }];
    if (guild) attributes.unshift({ trait_type: "Guild", value: guild });
    if (Number(row.amountEmuer) > 0) attributes.push({ trait_type: "EMUER", value: String(row.amountEmuer) });
    return res.json({
      name: caption + " · Star",
      description: "譲渡不可のクエスト完走証明。星空の星と同じ完走記録から発行されます。",
      image: "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64"),
      attributes: attributes
    });
  });
  router.post("/:questId/certificate/claim", requireFirebaseUser, async (req, res) => {
    if (!db) return res.status(503).json({ error: "FIRESTORE_UNAVAILABLE" });
    const questId = String(req.params.questId || "");
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(questId)) return res.status(400).json({ error: "INVALID_QUEST" });
    const spid = String((req.identity.account || {}).spid || "");
    if (!spid) return res.status(409).json({ error: "PASSPORT_LINK_REQUIRED" });
    const key = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(JSON.stringify(["schoolpark", questId, spid])));
    const ref = db.collection("sp_quest_certificates").doc(key);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "NOT_COMPLETED" });
    const row = snap.data() || {};
    if (row.status === "minted") return res.json({ ok: true, tokenId: row.tokenId, txHash: row.txHash, alreadyMinted: true });
    const identity = await db.collection("sp_identities").doc(spid).get();
    const links = identity.exists ? (identity.data() || {}).links || [] : [];
    const linkedWallet = links.find(link => link && link.kind === "wallet" && ethers.utils.isAddress(link.subject));
    const wallet = String(linkedWallet && linkedWallet.subject || "").toLowerCase();
    if (!ethers.utils.isAddress(wallet)) return res.status(409).json({ error: "WALLET_REQUIRED" });
    if (!ethers.utils.isAddress(certContract) || !certKey) return res.status(503).json({ error: "CERTIFICATE_NOT_DEPLOYED" });
    try {
      const provider = new ethers.providers.JsonRpcProvider(env.POLYGON_RPC_URL || "https://polygon-bor-rpc.publicnode.com");
      const signer = new ethers.Wallet(certKey, provider);
      const contract = new ethers.Contract(certContract, [
        "function tokenForCompletion(bytes32) view returns (uint256)",
        "function ownerOf(uint256) view returns (address)",
        "function mint(address,bytes32,string) returns (uint256)"
      ], signer);
      let tokenId = await contract.tokenForCompletion(key);
      let txHash = "";
      if (tokenId.isZero()) {
        const uri = "https://emu-realtime.onrender.com/api/schoolpark/quest-completions/certificates/" + key + "/metadata";
        const tx = await contract.mint(wallet, key, uri);
        txHash = tx.hash;
        await tx.wait();
        tokenId = await contract.tokenForCompletion(key);
      }
      if (tokenId.isZero()) throw new Error("MINT_NOT_CONFIRMED");
      await ref.set({ status: "minted", tokenId: tokenId.toString(), txHash, mintedTo: (await contract.ownerOf(tokenId)).toLowerCase(), mintedAt: new Date() }, { merge: true });
      return res.json({ ok: true, tokenId: tokenId.toString(), txHash });
    } catch (error) {
      console.error("Quest certificate claim failed:", error);
      return res.status(503).json({ error: "CERTIFICATE_MINT_FAILED" });
    }
  });
  return router;
}

module.exports = { createQuestCompletionRouter };
