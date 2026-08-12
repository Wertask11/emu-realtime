"use strict";

/**
 * 対話機会の記録。
 *
 * 相手は創業者本人なので、マッチングのアルゴリズムも予約システムも作らない。
 * ここで扱うのは「保証条件を後から検証できる記録」だけ:
 *   - Emu が何回の対話機会を提示したか（4回の提供義務）
 *   - 会員が何回参加したか（3回以上の参加条件）
 *   - 「また話したい」と評価した相手が一人でもいたか（返金の可否）
 *   - 不成立が誰の責任だったか（Emu 側都合の不履行かどうか）
 *
 * これが無いと、返金申請を承認するか却下するかを事実に基づいて判断できない。
 */

const express = require("express");

const DIALOGUE_COL = "dialogue_sessions";
const SLOTS_COL = "dialogue_slots";
const AUDIT_COL = "admin_audit_logs";

// 記録できる結果。canceled_by_emu と no_partner は Emu 側の不履行に数える。
const OUTCOMES = ["scheduled", "held", "member_no_show", "member_canceled", "canceled_by_emu", "no_partner"];
const EMU_FAULT_OUTCOMES = ["canceled_by_emu", "no_partner"];

function createDialogueRouter(deps) {
  const { db, requireFirebaseUser, requireOwner, rateLimit } = deps;
  const router = express.Router();

  const writeLimit = rateLimit({ windowMs: 60_000, max: 20, key: "dialogue" });

  async function audit(actorUid, action, target, detail) {
    try {
      await db.collection(AUDIT_COL).add({ actorUid, action, target, detail: detail || null, createdAt: new Date() });
    } catch (e) { console.warn("監査ログ書き込み失敗:", e.message); }
  }

  /* 保証条件の判定に使う集計。返金画面と管理画面で同じ数字を見せるため、
     計算はここ一箇所に置く。 */
  async function summarize(uid) {
    const snap = await db.collection(DIALOGUE_COL).where("uid", "==", uid).limit(200).get();
    let offered = 0, held = 0, wantsAgain = 0, emuFault = 0, memberFault = 0, rated = 0;
    snap.forEach(d => {
      const v = d.data();
      offered += 1;
      if (v.outcome === "held") held += 1;
      if (EMU_FAULT_OUTCOMES.includes(v.outcome)) emuFault += 1;
      if (v.outcome === "member_no_show" || v.outcome === "member_canceled") memberFault += 1;
      if (typeof v.wantsAgain === "boolean") { rated += 1; if (v.wantsAgain) wantsAgain += 1; }
    });
    const slots = await db.collection(SLOTS_COL).doc(uid).get();
    const slotCount = slots.exists ? (slots.data().slots || []).length : 0;
    return {
      offered, held, wantsAgain, emuFault, memberFault, rated, slotCount,
      // 「4回の対話機会を提供できたか」。Emu 側都合の中止は提供に数えない。
      deliveredOpportunities: offered - emuFault,
      meetsRefundConditions: held >= 3 && rated >= held && wantsAgain === 0
    };
  }

  // ───────── 会員側 ─────────

  // 対話可能日時の登録（毎週3枠以上が返金条件のひとつ）
  router.post("/slots", requireFirebaseUser, writeLimit, async (req, res) => {
    try {
      if (!db) return res.status(503).json({ error: "UNAVAILABLE" });
      const raw = Array.isArray(req.body.slots) ? req.body.slots : [];
      const slots = raw.slice(0, 50)
        .map(s => String(s || "").slice(0, 40))
        .filter(Boolean);
      await db.collection(SLOTS_COL).doc(req.identity.uid).set({
        uid: req.identity.uid, slots, updatedAt: new Date()
      }, { merge: true });
      return res.json({ ok: true, count: slots.length });
    } catch (e) {
      console.error("slots error:", e.message);
      return res.status(500).json({ error: "SAVE_FAILED" });
    }
  });

  router.get("/my", requireFirebaseUser, async (req, res) => {
    try {
      if (!db) return res.status(503).json({ error: "UNAVAILABLE" });
      const uid = req.identity.uid;
      const snap = await db.collection(DIALOGUE_COL).where("uid", "==", uid).limit(200).get();
      const sessions = [];
      snap.forEach(d => {
        const v = d.data();
        sessions.push({
          id: d.id,
          scheduledAt: v.scheduledAt ? v.scheduledAt.toDate().toISOString() : null,
          outcome: v.outcome,
          wantsAgain: typeof v.wantsAgain === "boolean" ? v.wantsAgain : null,
          note: v.memberNote || null
        });
      });
      sessions.sort((a, b) => String(a.scheduledAt || "").localeCompare(String(b.scheduledAt || "")));
      const slots = await db.collection(SLOTS_COL).doc(uid).get();
      return res.json({
        ok: true, sessions,
        slots: slots.exists ? (slots.data().slots || []) : [],
        summary: await summarize(uid)
      });
    } catch (e) {
      console.error("dialogue my error:", e.message);
      return res.status(500).json({ error: "LIST_FAILED" });
    }
  });

  // 対話後の評価（「また話したい」か）
  router.post("/:id/rate", requireFirebaseUser, writeLimit, async (req, res) => {
    try {
      if (!db) return res.status(503).json({ error: "UNAVAILABLE" });
      const ref = db.collection(DIALOGUE_COL).doc(String(req.params.id));
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: "NOT_FOUND" });
      if (snap.data().uid !== req.identity.uid) return res.status(403).json({ error: "FORBIDDEN" });
      if (snap.data().outcome !== "held") return res.status(400).json({ error: "NOT_HELD" });
      if (typeof req.body.wantsAgain !== "boolean") return res.status(400).json({ error: "INVALID_RATING" });

      await ref.update({
        wantsAgain: req.body.wantsAgain,
        memberNote: String(req.body.note || "").slice(0, 1000),
        ratedAt: new Date()
      });
      return res.json({ ok: true });
    } catch (e) {
      console.error("rate error:", e.message);
      return res.status(500).json({ error: "RATE_FAILED" });
    }
  });

  // ───────── 管理（オーナーのみ） ─────────

  // 対話機会を提示する
  router.post("/admin/offer", requireOwner, async (req, res) => {
    try {
      const uid = String(req.body.uid || "");
      const scheduledAt = new Date(String(req.body.scheduledAt || ""));
      if (!uid) return res.status(400).json({ error: "MISSING_UID" });
      if (isNaN(scheduledAt.getTime())) return res.status(400).json({ error: "INVALID_DATE" });

      const doc = await db.collection(DIALOGUE_COL).add({
        uid, scheduledAt, outcome: "scheduled",
        offeredBy: req.identity.uid, createdAt: new Date()
      });
      await audit(req.identity.uid, "dialogue_offer", uid, { sessionId: doc.id });
      return res.json({ ok: true, id: doc.id });
    } catch (e) {
      console.error("offer error:", e.message);
      return res.status(500).json({ error: "OFFER_FAILED" });
    }
  });

  // 実施結果を記録する
  router.post("/admin/:id/record", requireOwner, async (req, res) => {
    try {
      const outcome = String(req.body.outcome || "");
      if (!OUTCOMES.includes(outcome)) return res.status(400).json({ error: "INVALID_OUTCOME" });
      const ref = db.collection(DIALOGUE_COL).doc(String(req.params.id));
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: "NOT_FOUND" });

      await ref.update({
        outcome,
        ownerNote: String(req.body.note || "").slice(0, 1000),
        recordedAt: new Date(), recordedBy: req.identity.uid
      });
      await audit(req.identity.uid, "dialogue_record", snap.data().uid, { sessionId: ref.id, outcome });
      return res.json({ ok: true, outcome });
    } catch (e) {
      console.error("record error:", e.message);
      return res.status(500).json({ error: "RECORD_FAILED" });
    }
  });

  router.get("/admin/summary/:uid", requireOwner, async (req, res) => {
    try {
      return res.json({ ok: true, uid: req.params.uid, summary: await summarize(String(req.params.uid)) });
    } catch (e) {
      console.error("summary error:", e.message);
      return res.status(500).json({ error: "SUMMARY_FAILED" });
    }
  });

  router.get("/admin/list", requireOwner, async (req, res) => {
    try {
      const snap = await db.collection(DIALOGUE_COL).orderBy("createdAt", "desc").limit(200).get();
      const items = [];
      snap.forEach(d => {
        const v = d.data();
        items.push({
          id: d.id, uid: v.uid,
          scheduledAt: v.scheduledAt ? v.scheduledAt.toDate().toISOString() : null,
          outcome: v.outcome,
          wantsAgain: typeof v.wantsAgain === "boolean" ? v.wantsAgain : null
        });
      });
      return res.json({ ok: true, items });
    } catch (e) {
      console.error("dialogue list error:", e.message);
      return res.status(500).json({ error: "LIST_FAILED" });
    }
  });

  return { router, summarize };
}

module.exports = { createDialogueRouter, DIALOGUE_COL, SLOTS_COL, EMU_FAULT_OUTCOMES };
