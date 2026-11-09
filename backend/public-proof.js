"use strict";
/* 完走証明ページ（11/9）。

   完走の記録（運営が承認したときに作られる sp_quest_certificates）は、本人のパスポートの中でしか
   見られなかった（City の画面にも「公開プロフィールURLはまだありません」とある）。
   塾・学校・企業など外の人が確かめられる形が無いので、「動いた証明」が外へ出ていかない。

   ここでは、本人が選んだ完走1件（1周ぶん）だけを、推測できないURLで公開できるようにする。
   - 公開するもの … クエストの名前と番号・ギルド・何周目か・運営が認めた日・
                     （選んだら）その周の知恵カード・（選んだら）本人が名乗っている名前・証明書NFTの番号
   - 公開しないもの … ウォレットのアドレス・SchoolPark ID・報告の本文と画像・ほかの完走
   - 公開をやめれば、そのURLはすぐ見られなくなる（記録そのものは消えない）。

   置き場所は証明書の記録の中（publicToken / publicProof）。新しいコレクションを作らないので、
   Firestore のルールは変えない（sp_quest_certificates はもともとサーバー専用）。 */
const express = require("express");
const crypto = require("node:crypto");

const TOKEN = /^[A-Za-z0-9_-]{16,64}$/;
const KEY = /^0x[0-9a-f]{64}$/;

function cleanName(value) {
  return String(value || "").replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, 40);
}
function cleanText(value, max) {
  return String(value || "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max);
}

function createPublicProofRouter({ db, requireFirebaseUser, contract = "" }) {
  const router = express.Router();
  router.use(express.json({ limit: "8kb" }));
  const certs = () => db.collection("sp_quest_certificates");
  const spidOf = (req) => String(((req.identity || {}).account || {}).spid || "");

  /* その周の知恵カード。置ける枚数は承認された周の数までなので、古い順の n 枚目が n 周目のもの。 */
  async function wisdomOf(questId, spid, round) {
    const snap = await db.collection("sp_wisdom").where("questId", "==", questId).get();
    const mine = [];
    snap.forEach((d) => { const w = d.data() || {}; if (String(w.spid || "") === spid) mine.push(w); });
    mine.sort((a, b) => (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0));
    const w = mine[Math.max(0, (Number(round) || 1) - 1)];
    if (!w) return null;
    return {
      knowledge: cleanText(w.knowledge, 200), experiment: cleanText(w.experiment, 200),
      insight: cleanText(w.insight, 200), fromPostTitle: cleanText(w.fromPostTitle, 120)
    };
  }

  /* 自分の完走（証明書の記録）と、公開しているかどうか。 */
  router.get("/mine", requireFirebaseUser, async (req, res) => {
    if (!db) return res.status(503).json({ error: "FIRESTORE_UNAVAILABLE" });
    const spid = spidOf(req);
    if (!spid) return res.json({ ok: true, proofs: [] });
    try {
      const snap = await certs().where("spid", "==", spid).limit(500).get();
      const proofs = [];
      snap.forEach((d) => {
        const v = d.data() || {};
        proofs.push({
          key: d.id, questId: String(v.questId || ""), questLabel: String(v.questLabel || ""),
          questTitle: String(v.questTitle || ""), round: Math.max(1, Number(v.round) || 1),
          completedAt: Number(v.completedAt) || null,
          token: TOKEN.test(String(v.publicToken || "")) ? String(v.publicToken) : ""
        });
      });
      proofs.sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
      return res.json({ ok: true, proofs });
    } catch (e) {
      console.warn("完走証明の一覧:", e && (e.code || e.message));
      return res.status(503).json({ error: "PROOF_LIST_FAILED" });
    }
  });

  async function ownCertificate(req, res) {
    const spid = spidOf(req);
    const key = String(req.params.key || "");
    if (!spid) { res.status(409).json({ error: "PASSPORT_LINK_REQUIRED" }); return null; }
    if (!KEY.test(key)) { res.status(400).json({ error: "INVALID_KEY" }); return null; }
    const ref = certs().doc(key);
    const snap = await ref.get();
    if (!snap.exists || String((snap.data() || {}).spid || "") !== spid) {
      res.status(404).json({ error: "NOT_FOUND" }); return null;
    }
    return { ref, data: snap.data() || {}, spid };
  }

  /* 公開する（すでに公開していれば、同じURLのまま中身だけ選び直す）。 */
  router.post("/:key/publish", requireFirebaseUser, async (req, res) => {
    if (!db) return res.status(503).json({ error: "FIRESTORE_UNAVAILABLE" });
    try {
      const own = await ownCertificate(req, res);
      if (!own) return;
      const b = req.body || {};
      const name = b.showName === true ? cleanName(b.name) : "";
      const wisdom = b.withWisdom === false ? null
        : await wisdomOf(String(own.data.questId || ""), own.spid, own.data.round);
      const token = TOKEN.test(String(own.data.publicToken || ""))
        ? String(own.data.publicToken) : crypto.randomBytes(18).toString("base64url");
      await own.ref.set({ publicToken: token,
        publicProof: { name, wisdom, publishedAt: Date.now() } }, { merge: true });
      return res.json({ ok: true, token });
    } catch (e) {
      console.warn("完走証明の公開:", e && (e.code || e.message));
      return res.status(503).json({ error: "PROOF_PUBLISH_FAILED" });
    }
  });

  /* 公開をやめる。URLはすぐ見られなくなる。完走の記録そのものは残る。 */
  router.post("/:key/unpublish", requireFirebaseUser, async (req, res) => {
    if (!db) return res.status(503).json({ error: "FIRESTORE_UNAVAILABLE" });
    try {
      const own = await ownCertificate(req, res);
      if (!own) return;
      await own.ref.set({ publicToken: null, publicProof: null }, { merge: true });
      return res.json({ ok: true });
    } catch (e) {
      console.warn("完走証明の公開停止:", e && (e.code || e.message));
      return res.status(503).json({ error: "PROOF_UNPUBLISH_FAILED" });
    }
  });

  /* 誰でも見られる。返すのは本人が選んだものだけ。 */
  router.get("/view/:token", async (req, res) => {
    if (!db) return res.status(503).json({ error: "FIRESTORE_UNAVAILABLE" });
    const token = String(req.params.token || "");
    if (!TOKEN.test(token)) return res.status(404).json({ error: "NOT_FOUND" });
    try {
      const snap = await certs().where("publicToken", "==", token).limit(1).get();
      const doc = snap.docs[0];
      const v = doc ? doc.data() || {} : null;
      if (!v || !v.publicProof) return res.status(404).json({ error: "NOT_FOUND" });
      const p = v.publicProof || {};
      const minted = v.status === "minted" && /^\d+$/.test(String(v.tokenId || ""));
      res.set("Cache-Control", "no-store");
      return res.json({ ok: true, proof: {
        questLabel: String(v.questLabel || ""), questTitle: String(v.questTitle || ""),
        guildId: String(v.guildId || ""), guildColor: /^#[0-9A-Fa-f]{6}$/.test(String(v.guildColor || "")) ? v.guildColor : "#6E695C",
        round: Math.max(1, Number(v.round) || 1), completedAt: Number(v.completedAt) || null,
        name: cleanName(p.name), wisdom: p.wisdom || null, publishedAt: Number(p.publishedAt) || null,
        nft: minted ? { tokenId: String(v.tokenId), contract: /^0x[0-9a-fA-F]{40}$/.test(contract) ? contract : "" } : null
      } });
    } catch (e) {
      console.warn("完走証明の表示:", e && (e.code || e.message));
      return res.status(503).json({ error: "PROOF_UNAVAILABLE" });
    }
  });

  return router;
}

module.exports = { createPublicProofRouter };
