"use strict";

/**
 * 本人確認。
 *
 * ── なぜ書類を預からないのか ──
 * Emu の対話相手はオーナー本人で、全会員と1対1で話す。
 * 画面越しに顔を見て話す方が、送られてきた書類の画像より確実に本人を確かめられる。
 * （他人の免許証の画像を送るのは簡単だが、その人になりすまして45分話すのは無理）
 *
 * また Emu は金融機関ではないので、犯罪収益移転防止法の取引時確認の対象ではない。
 * 書類の提出は法律上の義務ではなく、安全のための自主的な措置にすぎない。
 *
 * 一方で書類の画像は、漏れたときの被害が最も大きい種類の個人情報にあたる。
 * 預かる以上は保管・削除・閲覧制御の責任がずっと付いて回る。
 * 得られる確実性が対話に劣るのに、リスクだけ大きい。だから預からない。
 *
 * ── いま行っていること ──
 *  - 決済が通ること（実在するカードが必要なので、使い捨てアカウントを量産できない）
 *  - 入会時に18歳以上であることの確認
 *  - 最初の対話で、オーナーが本人を確認する
 *  - 記録するのは「確認した事実・日付・方法」だけ。画像も氏名も生年月日も保存しない
 *
 * 規約 第5条の4 は「必要と判断した場合に提示を求めることがある」という書き方にしてある。
 * 例外的に確認が必要になったときは、対話の場で提示してもらい、その場で確認して終える。
 */

const express = require("express");

const KYC_COL = "kyc_submissions";   // 確認結果だけを持つ（画像は保存しない）
const AUDIT_COL = "admin_audit_logs";

// 確認の方法
const METHODS = ["dialogue", "document_shown", "other"];
const METHOD_LABELS = {
  dialogue: "対話で確認",
  document_shown: "対話中に書類を提示してもらい確認",
  other: "その他"
};

function createKycRouter(deps) {
  const { db, requireFirebaseUser, requireOwner, rateLimit } = deps;
  const router = express.Router();

  const declareLimit = rateLimit({ windowMs: 60 * 60_000, max: 10, key: "kyc" });

  function kycRef(uid) { return db.collection(KYC_COL).doc(uid); }

  async function audit(actorUid, action, target, detail) {
    try {
      await db.collection(AUDIT_COL).add({
        actorUid, action, target, detail: detail || null, createdAt: new Date()
      });
    } catch (e) {
      console.warn("監査ログ書き込み失敗:", e.message);
    }
  }

  // ───────── 会員側 ─────────

  /* 18歳以上であることの申告。入会の前に一度だけ。
     年齢は保存せず、「18歳以上だと申告した事実」だけを残す。 */
  router.post("/declare-age", requireFirebaseUser, declareLimit, async (req, res) => {
    try {
      if (!db) return res.status(503).json({ error: "KYC_UNAVAILABLE" });
      if (req.body.adult !== true) return res.status(400).json({ error: "AGE_NOT_CONFIRMED" });
      await kycRef(req.identity.uid).set({
        uid: req.identity.uid,
        walletAddress: req.identity.walletAddress,
        adultDeclared: true,
        adultDeclaredAt: new Date()
      }, { merge: true });
      return res.json({ ok: true });
    } catch (e) {
      console.error("declare-age error:", e.message);
      return res.status(500).json({ error: "SAVE_FAILED" });
    }
  });

  router.get("/status", requireFirebaseUser, async (req, res) => {
    try {
      if (!db) return res.status(503).json({ error: "KYC_UNAVAILABLE" });
      const snap = await kycRef(req.identity.uid).get();
      const d = snap.exists ? snap.data() : {};
      return res.json({
        ok: true,
        status: d.status || "none",              // none | verified
        adultDeclared: !!d.adultDeclared,
        method: d.method || null,
        methodLabel: d.method ? (METHOD_LABELS[d.method] || d.method) : null,
        verifiedAt: d.verifiedAt ? d.verifiedAt.toDate().toISOString() : null
      });
    } catch (e) {
      console.error("kyc status error:", e.message);
      return res.status(500).json({ error: "STATUS_FAILED" });
    }
  });

  // ───────── 管理（オーナーのみ） ─────────

  router.get("/admin/list", requireOwner, async (req, res) => {
    try {
      const status = String(req.query.status || "all");
      const snap = await db.collection(KYC_COL).limit(200).get();
      const items = [];
      snap.forEach(d => {
        const v = d.data();
        const st = v.status || "none";
        if (status !== "all" && st !== status) return;
        items.push({
          uid: d.id,
          status: st,
          adultDeclared: !!v.adultDeclared,
          adultDeclaredAt: v.adultDeclaredAt ? v.adultDeclaredAt.toDate().toISOString() : null,
          method: v.method || null,
          methodLabel: v.method ? (METHOD_LABELS[v.method] || v.method) : null,
          note: v.note || null,
          verifiedAt: v.verifiedAt ? v.verifiedAt.toDate().toISOString() : null
        });
      });
      items.sort((a, b) => String(b.adultDeclaredAt || "").localeCompare(String(a.adultDeclaredAt || "")));
      return res.json({ ok: true, items, methods: METHODS, methodLabels: METHOD_LABELS });
    } catch (e) {
      console.error("kyc admin list error:", e.message);
      return res.status(500).json({ error: "LIST_FAILED" });
    }
  });

  /* 対話で確認できたら、ここで確認済みにする。
     残すのは「いつ・どの方法で確認したか」だけ。氏名も生年月日も書類も残さない。 */
  router.post("/admin/:uid/verify", requireOwner, async (req, res) => {
    try {
      const targetUid = String(req.params.uid);
      const method = METHODS.includes(req.body.method) ? req.body.method : "dialogue";
      const note = String(req.body.note || "").slice(0, 500);
      const verified = req.body.verified !== false;

      await kycRef(targetUid).set({
        uid: targetUid,
        status: verified ? "verified" : "none",
        method: verified ? method : null,
        note,
        verifiedAt: verified ? new Date() : null,
        verifiedBy: req.identity.uid
      }, { merge: true });

      await audit(req.identity.uid, verified ? "kyc_verify" : "kyc_unverify", targetUid, { method, note: note || null });
      return res.json({ ok: true, status: verified ? "verified" : "none" });
    } catch (e) {
      console.error("kyc verify error:", e.message);
      return res.status(500).json({ error: "VERIFY_FAILED" });
    }
  });

  /* 以前は書類画像の保持期限バッチだったもの。
     画像を持たなくなったので、消すものが無い。
     server.js の日次スケジュールから呼ばれ続けるため、関数だけ残す。 */
  async function purgeExpiredDocuments() {
    return { deleted: 0, note: "書類画像は保存しない設計のため、削除対象はありません" };
  }

  return { router, purgeExpiredDocuments, METHODS, METHOD_LABELS };
}

module.exports = { createKycRouter, KYC_COL, METHODS };
