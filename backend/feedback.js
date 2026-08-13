"use strict";

/**
 * Emu へのフィードバック。
 *
 * 投稿は本人確認済みのログインユーザーのみ（匿名の荒らしを防ぐため）。
 * 閲覧はオーナーのみ。クライアントから直接 Firestore を触らせない。
 */

const express = require("express");

const FEEDBACK_COL = "emu_feedback";
const MAX_BODY = 2000;
const CATEGORIES = ["bug", "request", "confusing", "good", "other"];

function createFeedbackRouter(deps) {
  const { db, requireFirebaseUser, requireOwner, rateLimit } = deps;
  const router = express.Router();

  // 短時間に何度も送れないようにする（1時間に5件まで）
  const postLimit = rateLimit({ windowMs: 60 * 60_000, max: 5, key: "feedback" });

  router.post("/", requireFirebaseUser, postLimit, async (req, res) => {
    try {
      if (!db) return res.status(503).json({ error: "UNAVAILABLE" });
      const body = String(req.body.body || "").trim().slice(0, MAX_BODY);
      if (!body) return res.status(400).json({ error: "EMPTY_BODY" });
      const category = CATEGORIES.includes(req.body.category) ? req.body.category : "other";

      await db.collection(FEEDBACK_COL).add({
        uid: req.identity.uid,
        walletAddress: req.identity.walletAddress,
        email: req.identity.account.email || null,
        displayName: req.identity.account.displayName || null,
        category,
        body,
        // どの画面から送られたかが分かると、再現と修正が早い
        page: String(req.body.page || "").slice(0, 200),
        userAgent: String(req.headers["user-agent"] || "").slice(0, 300),
        status: "new",
        createdAt: new Date()
      });
      return res.json({ ok: true });
    } catch (e) {
      console.error("feedback post error:", e.message);
      return res.status(500).json({ error: "SAVE_FAILED" });
    }
  });

  router.get("/admin/list", requireOwner, async (req, res) => {
    try {
      const status = String(req.query.status || "all");
      let q = db.collection(FEEDBACK_COL).orderBy("createdAt", "desc").limit(200);
      const snap = await q.get();
      const items = [];
      snap.forEach(d => {
        const v = d.data();
        if (status !== "all" && (v.status || "new") !== status) return;
        items.push({
          id: d.id,
          category: v.category,
          body: v.body,
          page: v.page || null,
          status: v.status || "new",
          displayName: v.displayName || null,
          email: v.email || null,
          uid: v.uid,
          createdAt: v.createdAt ? v.createdAt.toDate().toISOString() : null
        });
      });
      return res.json({ ok: true, items });
    } catch (e) {
      console.error("feedback list error:", e.message);
      return res.status(500).json({ error: "LIST_FAILED" });
    }
  });

  router.post("/admin/:id/status", requireOwner, async (req, res) => {
    try {
      const status = String(req.body.status || "");
      if (!["new", "reading", "done"].includes(status)) {
        return res.status(400).json({ error: "INVALID_STATUS" });
      }
      await db.collection(FEEDBACK_COL).doc(String(req.params.id)).update({
        status, updatedAt: new Date(), updatedBy: req.identity.uid
      });
      return res.json({ ok: true, status });
    } catch (e) {
      console.error("feedback status error:", e.message);
      return res.status(500).json({ error: "UPDATE_FAILED" });
    }
  });

  return { router };
}

module.exports = { createFeedbackRouter, FEEDBACK_COL };
