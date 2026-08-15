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
const PROFILE_COL = "member_profiles";

/* 興味・関心テーマ。相手を選ぶときの材料になるので、
   自由入力ではなく決まった一覧から選んでもらう（表記ゆれを防ぐ）。 */
const INTEREST_THEMES = [
  "movie","book","learning","work","tech","art","society",
  "philosophy","money","health","family","game","music","travel","other"
];
const MIN_THEMES = 2;          // 返金条件：興味・関心テーマを2つ以上
const MIN_SLOTS_PER_WEEK = 3;  // 返金条件：毎週3枠以上

// 記録できる結果。canceled_by_emu と no_partner は Emu 側の不履行に数える。
/* 対話の場。相手は創業者本人なので、実際に話す手段だけを扱う。
   emu … Emu内の議論ルーム（room3）でそのまま話す
   zoom … 希望者向け。オーナーがURLを入れて渡す */
const VENUES = ["emu", "zoom"];

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
    let ownerWantsAgain = 0, mutual = 0, bothRated = 0;
    snap.forEach(d => {
      const v = d.data();
      offered += 1;
      if (v.outcome === "held") held += 1;
      if (EMU_FAULT_OUTCOMES.includes(v.outcome)) emuFault += 1;
      if (v.outcome === "member_no_show" || v.outcome === "member_canceled") memberFault += 1;
      if (typeof v.wantsAgain === "boolean") { rated += 1; if (v.wantsAgain) wantsAgain += 1; }
      // 相手（オーナー）側の評価。両方そろって初めて「相互」と数える。
      if (typeof v.ownerWantsAgain === "boolean") { if (v.ownerWantsAgain) ownerWantsAgain += 1; }
      if (typeof v.wantsAgain === "boolean" && typeof v.ownerWantsAgain === "boolean") {
        bothRated += 1;
        if (v.wantsAgain && v.ownerWantsAgain) mutual += 1;
      }
    });
    const slots = await db.collection(SLOTS_COL).doc(uid).get();
    const slotCount = slots.exists ? (slots.data().slots || []).length : 0;
    const profSnap = await db.collection(PROFILE_COL).doc(uid).get();
    const prof = profSnap.exists ? profSnap.data() : null;
    const profileComplete = isProfileComplete(prof);
    const themeCount = prof && Array.isArray(prof.themes) ? prof.themes.length : 0;

    /* 返金条件を1か所で判定する。規約 第5条の3 と同じ並びにしてある。
       画面・管理画面・返金申請のどこから見ても同じ結果になるようにする。 */
    const conditions = {
      profileComplete,                       // プロフィールを完成
      themes: themeCount >= MIN_THEMES,      // 興味・関心テーマを2つ以上
      slots: slotCount >= MIN_SLOTS_PER_WEEK,// 毎週3枠以上
      joined: held >= 3,                     // 提案された対話に3回以上参加
      rated: rated >= held,                  // 対話後の評価に回答
      noWantAgain: wantsAgain === 0          // 「また話したい」が一人もいない
    };

    return {
      offered, held, wantsAgain, emuFault, memberFault, rated, slotCount,
      profileComplete, themeCount,
      // ブリーフ §24 の最重要指標。片方だけの「また話したい」では意味がないので、
      // 双方が「また話したい」と答えた回数を数える。
      ownerWantsAgain, mutual, bothRated,
      mutualRate: bothRated ? Math.round((mutual / bothRated) * 100) : null,
      conditions,
      // 「4回の対話機会を提供できたか」。Emu 側都合の中止は提供に数えない。
      deliveredOpportunities: offered - emuFault,
      meetsRefundConditions: Object.values(conditions).every(Boolean)
    };
  }

  /* ═══════════════════════════════════════
     プロフィールと興味・関心テーマ

     規約の返金条件に「プロフィールを完成」「興味・関心テーマを2つ以上登録」
     と書いてあるのに、登録する場所が無かった。ここで作る。
     対話の相手を選ぶ材料でもある。
  ═══════════════════════════════════════ */
  function profileRef(uid) { return db.collection(PROFILE_COL).doc(uid); }

  /* プロフィールが「完成」しているかの判定。
     ここを1か所にまとめないと、画面と返金判定で基準がずれる。 */
  function isProfileComplete(p) {
    if (!p) return false;
    return !!(String(p.displayName || "").trim()
      && String(p.bio || "").trim().length >= 20
      && Array.isArray(p.themes) && p.themes.length >= MIN_THEMES);
  }

  router.get("/profile", requireFirebaseUser, async (req, res) => {
    try {
      if (!db) return res.status(503).json({ error: "UNAVAILABLE" });
      const snap = await profileRef(req.identity.uid).get();
      const p = snap.exists ? snap.data() : null;
      return res.json({
        ok: true,
        profile: p ? {
          displayName: p.displayName || "",
          bio: p.bio || "",
          themes: p.themes || [],
          talkStyle: p.talkStyle || "",
          zoomPreferred: !!p.zoomPreferred
        } : null,
        complete: isProfileComplete(p),
        themeOptions: INTEREST_THEMES,
        minThemes: MIN_THEMES
      });
    } catch (e) {
      console.error("profile get error:", e.message);
      return res.status(500).json({ error: "LOAD_FAILED" });
    }
  });

  router.post("/profile", requireFirebaseUser, writeLimit, async (req, res) => {
    try {
      if (!db) return res.status(503).json({ error: "UNAVAILABLE" });
      const displayName = String(req.body.displayName || "").trim().slice(0, 40);
      const bio = String(req.body.bio || "").trim().slice(0, 600);
      const talkStyle = ["listen","talk","both"].includes(req.body.talkStyle) ? req.body.talkStyle : "both";
      const themes = Array.isArray(req.body.themes)
        ? req.body.themes.filter(t => INTEREST_THEMES.includes(t)).slice(0, 8)
        : [];

      if (!displayName) return res.status(400).json({ error: "NAME_REQUIRED" });
      if (bio.length < 20) return res.status(400).json({ error: "BIO_TOO_SHORT" });
      if (themes.length < MIN_THEMES) return res.status(400).json({ error: "THEMES_TOO_FEW" });

      const data = {
        uid: req.identity.uid,
        walletAddress: req.identity.walletAddress,
        displayName, bio, themes, talkStyle,
        zoomPreferred: !!req.body.zoomPreferred,
        updatedAt: new Date()
      };
      await profileRef(req.identity.uid).set(data, { merge: true });
      return res.json({ ok: true, complete: isProfileComplete(data) });
    } catch (e) {
      console.error("profile save error:", e.message);
      return res.status(500).json({ error: "SAVE_FAILED" });
    }
  });

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

  /* 会員から「次はZoomで話したい」と伝える。
     実際にURLを用意するのはオーナーなので、ここでは希望を記録するだけ。 */
  router.post("/:id/venue-request", requireFirebaseUser, writeLimit, async (req, res) => {
    try {
      if (!db) return res.status(503).json({ error: "UNAVAILABLE" });
      const venue = VENUES.includes(req.body.venue) ? req.body.venue : null;
      if (!venue) return res.status(400).json({ error: "INVALID_VENUE" });
      const ref = db.collection(DIALOGUE_COL).doc(String(req.params.id));
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: "NOT_FOUND" });
      if (snap.data().uid !== req.identity.uid) return res.status(403).json({ error: "FORBIDDEN" });
      if (snap.data().outcome !== "scheduled") return res.status(400).json({ error: "ALREADY_DONE" });
      await ref.update({ venueRequest: venue, venueRequestedAt: new Date() });
      return res.json({ ok: true, venue });
    } catch (e) {
      console.error("venue-request error:", e.message);
      return res.status(500).json({ error: "REQUEST_FAILED" });
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
          venue: v.venue || "emu",
          meetingUrl: v.meetingUrl || "",
          topic: v.topic || "",
          wantsAgain: typeof v.wantsAgain === "boolean" ? v.wantsAgain : null,
          ownerWantsAgain: typeof v.ownerWantsAgain === "boolean" ? v.ownerWantsAgain : null,
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

      const venue = VENUES.includes(req.body.venue) ? req.body.venue : "emu";
      // Zoom を選んだときだけURLを持たせる。URLの形だけ確かめる。
      let meetingUrl = String(req.body.meetingUrl || "").trim().slice(0, 300);
      if (venue === "zoom") {
        if (!/^https:\/\//.test(meetingUrl)) return res.status(400).json({ error: "INVALID_MEETING_URL" });
      } else {
        meetingUrl = "";
      }

      const doc = await db.collection(DIALOGUE_COL).add({
        uid, scheduledAt, outcome: "scheduled",
        venue, meetingUrl,
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

  /* オーナー側の「また話したい」。これが無いと相互マッチ率が出せない。
     ブリーフ §24 では、成約率よりこの割合のほうが重要とされている。 */
  router.post("/admin/:id/rate", requireOwner, async (req, res) => {
    try {
      if (typeof req.body.wantsAgain !== "boolean") return res.status(400).json({ error: "INVALID_RATING" });
      const ref = db.collection(DIALOGUE_COL).doc(String(req.params.id));
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: "NOT_FOUND" });
      if (snap.data().outcome !== "held") return res.status(400).json({ error: "NOT_HELD" });
      await ref.update({
        ownerWantsAgain: req.body.wantsAgain,
        ownerNote2: String(req.body.note || "").slice(0, 1000),
        ownerRatedAt: new Date()
      });
      await audit(req.identity.uid, "dialogue_owner_rate", snap.data().uid,
        { sessionId: ref.id, wantsAgain: req.body.wantsAgain });
      return res.json({ ok: true });
    } catch (e) {
      console.error("owner rate error:", e.message);
      return res.status(500).json({ error: "RATE_FAILED" });
    }
  });

  /* 全体の相互マッチ率。ブリーフ §24 の最重要指標をここで出す。 */
  router.get("/admin/metrics", requireOwner, async (req, res) => {
    try {
      const snap = await db.collection(DIALOGUE_COL).limit(1000).get();
      let held = 0, bothRated = 0, mutual = 0, memberYes = 0, ownerYes = 0;
      const members = new Set(), membersWithMutual = new Set();
      snap.forEach(d => {
        const v = d.data();
        if (v.uid) members.add(v.uid);
        if (v.outcome !== "held") return;
        held += 1;
        const m = typeof v.wantsAgain === "boolean", o = typeof v.ownerWantsAgain === "boolean";
        if (m && v.wantsAgain) memberYes += 1;
        if (o && v.ownerWantsAgain) ownerYes += 1;
        if (m && o) {
          bothRated += 1;
          if (v.wantsAgain && v.ownerWantsAgain) { mutual += 1; if (v.uid) membersWithMutual.add(v.uid); }
        }
      });
      return res.json({
        ok: true,
        held, bothRated, mutual, memberYes, ownerYes,
        mutualRate: bothRated ? Math.round((mutual / bothRated) * 100) : null,
        members: members.size,
        membersWithMutual: membersWithMutual.size,
        // 「継続相手が一人以上いる割合」（§24 の指標）
        continuingRate: members.size ? Math.round((membersWithMutual.size / members.size) * 100) : null
      });
    } catch (e) {
      console.error("metrics error:", e.message);
      return res.status(500).json({ error: "METRICS_FAILED" });
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
          venue: v.venue || "emu",
          venueRequest: v.venueRequest || null,
          meetingUrl: v.meetingUrl || "",
          wantsAgain: typeof v.wantsAgain === "boolean" ? v.wantsAgain : null,
          ownerWantsAgain: typeof v.ownerWantsAgain === "boolean" ? v.ownerWantsAgain : null
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
