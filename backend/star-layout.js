"use strict";
/* 星空の星座の並び（11/20 オーナー：黄道12星座・星の配置を自由に・自分だけの星座・完成した日）。

   置き場所は Firestore の sp_star_layouts/{ログインの uid}。読み書きはこのサーバーを通す。
   画面から直に読み書きする形（firestore.rules の sp_star_layouts）は、ルールを本番へ反映するまで
   読めず、「並びを読み込めなかった」と出て入れ替え・自分だけの星座が使えなかったため。

   ここに置くのは「どの種類の星を、どの星座のどの点に置くか」と、しまってある星・自分だけの星座・完成した日だけ。
   星の数そのものは置かない（数は画面が実データから数える）。本人の uid の書類にしか書かない。
     GET /api/schoolpark/star-layout/me   … 自分の並び（無ければ空）
     PUT /api/schoolpark/star-layout/me   … 自分の並びを残す（形と大きさをここで確かめて、整えてから書く） */
const express = require("express");

const MAX_SLOTS = 600, MAX_HELD = 600, MAX_CUSTOMS = 3, MAX_POINTS = 12, MAX_LINES = 30;
const TYPE = /^[A-Za-z0-9_:-]{1,60}$/;
const ZODIAC_ID = /^[a-z]{3,12}$/;

function int(v, lo, hi) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : lo;
}
function str(v, n) { return typeof v === "string" ? v.slice(0, n) : ""; }

/* 画面から来た並びを、決まった形・大きさに整える。知らない欄は捨てる */
function cleanLayout(d, now = Date.now()) {
  const src = d && typeof d === "object" ? d : {};
  const out = { slots: [], held: [], customs: [], completed: {}, updatedAt: now };
  /* slots の空文字は「空いている点」。自分で星を外した点は空いたまま残す */
  if (Array.isArray(src.slots)) out.slots = src.slots.slice(0, MAX_SLOTS).map(t => (typeof t === "string" && TYPE.test(t) ? t : ""));
  while (out.slots.length && out.slots[out.slots.length - 1] === "") out.slots.pop();
  if (Array.isArray(src.held)) out.held = src.held.slice(0, MAX_HELD).filter(t => typeof t === "string" && TYPE.test(t));
  if (Array.isArray(src.customs)) out.customs = src.customs.slice(0, MAX_CUSTOMS).filter(c => c && typeof c === "object").map(c => {
    const points = (Array.isArray(c.points) ? c.points : []).slice(0, MAX_POINTS).map(p => {
      const a = Array.isArray(p) ? p : [p && p.x, p && p.y, p && p.t];
      return { x: int(a[0], 0, 4), y: int(a[1], 0, 4), t: TYPE.test(String(a[2] || "")) ? String(a[2]) : "" };
    }).filter(p => p.t);
    const lines = (Array.isArray(c.lines) ? c.lines : []).slice(0, MAX_LINES).map(l => {
      const a = Array.isArray(l) ? l : [l && l.a, l && l.b];
      return { a: Number(a[0]), b: Number(a[1]) };
    }).filter(l => Number.isInteger(l.a) && Number.isInteger(l.b) && l.a !== l.b
      && l.a >= 0 && l.b >= 0 && l.a < points.length && l.b < points.length);
    return { name: str(c.name, 12).trim() || "わたしの星座", points, lines };
  });
  if (src.completed && typeof src.completed === "object" && !Array.isArray(src.completed)) {
    Object.keys(src.completed).slice(0, 12).forEach(k => {
      const v = Number(src.completed[k]);
      if (ZODIAC_ID.test(k) && v > 0 && v < 4102444800000) out.completed[k] = Math.round(v);
    });
  }
  return out;
}

/* Firestore は「配列の中の配列」を置けないので、点と線は {x,y,t}・{a,b} で残し、画面へは配列に戻して渡す */
function forSky(d) {
  const v = d || {};
  return {
    slots: Array.isArray(v.slots) ? v.slots : [],
    held: Array.isArray(v.held) ? v.held : [],
    completed: v.completed && typeof v.completed === "object" ? v.completed : {},
    customs: (Array.isArray(v.customs) ? v.customs : []).map(c => ({
      name: c.name,
      points: (c.points || []).map(p => [p.x, p.y, p.t]),
      lines: (c.lines || []).map(l => [l.a, l.b])
    }))
  };
}

function createStarLayoutRouter({ db, requireFirebaseUser, rateLimit, now = () => Date.now() }) {
  const router = express.Router();
  const limit = typeof rateLimit === "function" ? rateLimit({ windowMs: 60_000, max: 40, key: "star-layout" }) : (req, res, next) => next();
  const ref = uid => db.collection("sp_star_layouts").doc(String(uid));

  router.get("/me", requireFirebaseUser, limit, async (req, res) => {
    try {
      const snap = await ref(req.identity.uid).get();
      res.json({ ok: true, layout: snap.exists ? forSky(snap.data()) : {} });
    } catch (e) {
      res.status(503).json({ ok: false, error: "STAR_LAYOUT_UNAVAILABLE" });
    }
  });

  router.put("/me", express.json({ limit: "64kb" }), requireFirebaseUser, limit, async (req, res) => {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    if (!body.layout || typeof body.layout !== "object") return res.status(400).json({ ok: false, error: "LAYOUT_REQUIRED" });
    try {
      await ref(req.identity.uid).set(cleanLayout(body.layout, now()));
      res.json({ ok: true });
    } catch (e) {
      res.status(503).json({ ok: false, error: "STAR_LAYOUT_UNAVAILABLE" });
    }
  });

  return { router };
}

module.exports = { createStarLayoutRouter, cleanLayout, forSky };
