"use strict";

/* ───────── 運営：お問い合わせを読む ─────────

   お問い合わせ（/api/contact）は、Firestore の contact_submissions と Notion に入る。
   Notion は NOTION_TOKEN があるときだけで、運営画面からは見えなかった。
   ここは contact_submissions を新しい順に並べて返し、対応済みの印を付けられるようにする。
   読むのも書くのもオーナーだけ（requireOwner）。利用者の画面からは触れない
   （firestore.rules の contact_submissions は read, write: false）。 */

const express = require("express");

const COL = "contact_submissions";
const STATUSES = ["open", "done"];
const LIST_LIMIT = 300;
// 送られてくる項目だけを返す（想定外の欄はそのまま出さない）。
const FIELDS = ["type", "name", "nameGiven", "email", "company", "message", "scale", "source", "passport",
  "login_method", "place", "device", "topic", "child_age", "participants", "submittedAt",
  "status", "handledAt"];

function ms(v) {
  if (!v) return 0;
  if (typeof v === "number") return v;
  if (typeof v.toMillis === "function") return v.toMillis();
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : 0;
}

function createContactAdminRouter({ db, requireOwner, now = Date.now }) {
  const router = express.Router();
  router.use((req, res, next) => { res.set("Cache-Control", "no-store"); next(); });

  /* 一覧。status=open（未対応）・done（対応済み）・all。印の無い古いものは未対応として数える。 */
  router.get("/", requireOwner, async (req, res) => {
    if (!db) return res.status(503).json({ error: "DB_UNAVAILABLE" });
    const want = ["open", "done", "all"].includes(req.query.status) ? req.query.status : "open";
    try {
      const snap = await db.collection(COL).limit(LIST_LIMIT * 3).get();
      const all = [];
      snap.forEach(d => {
        const v = d.data() || {};
        const row = { id: d.id };
        for (const k of FIELDS) if (v[k] !== undefined) row[k] = v[k];
        row.status = STATUSES.includes(v.status) ? v.status : "open";
        row.submittedAtMs = ms(v.submittedAt);
        all.push(row);
      });
      all.sort((a, b) => b.submittedAtMs - a.submittedAtMs);
      const counts = { open: all.filter(r => r.status === "open").length, done: all.filter(r => r.status === "done").length };
      const rows = (want === "all" ? all : all.filter(r => r.status === want)).slice(0, LIST_LIMIT);
      res.json({ rows, counts });
    } catch (e) {
      console.error("お問い合わせの一覧:", e.message);
      res.status(500).json({ error: "CONTACT_LIST_FAILED" });
    }
  });

  /* 対応済み・未対応に戻す。中身（本文・連絡先）は書き換えない。 */
  router.post("/:id/status", requireOwner, async (req, res) => {
    if (!db) return res.status(503).json({ error: "DB_UNAVAILABLE" });
    const status = req.body && req.body.status;
    if (!STATUSES.includes(status)) return res.status(400).json({ error: "BAD_STATUS" });
    const id = String(req.params.id || "");
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return res.status(400).json({ error: "BAD_ID" });
    try {
      const ref = db.collection(COL).doc(id);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: "NOT_FOUND" });
      await ref.set({ status, handledAt: status === "done" ? new Date(now()).toISOString() : null,
        handledBy: status === "done" ? String(req.identity && req.identity.uid || "owner").slice(0, 120) : null }, { merge: true });
      res.json({ ok: true, id, status });
    } catch (e) {
      console.error("お問い合わせの対応:", e.message);
      res.status(500).json({ error: "CONTACT_UPDATE_FAILED" });
    }
  });

  return router;
}

module.exports = { createContactAdminRouter };
