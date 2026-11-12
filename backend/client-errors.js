"use strict";

/* 画面のエラーを集める（11/3 点検 15）。
   これまで、利用者のブラウザで起きたエラーを知る手段が無かった（気づくのはオーナーが画面写真を送ってくれたときだけ）。

   集めるのは「どの画面の、どのファイルの、何行目で、どんなエラーが、何回起きたか」だけ。
     - 人を特定するものは残さない：ログインの番号・ウォレット・名前・IP・端末の文字列（User-Agent）は受け取らない
     - エラーの文の中のメールアドレス・0x… のアドレス・長い数字・長い英数字（トークンなど）は伏せ字にする
     - 同じエラーは1日1件にまとめて数だけ増やす（emu_client_errors／30日で消す印 expireAt）
   見られるのは運営（requireOwner）だけ。Firestore のルールに当てはまるものが無いので、画面からは読み書きできない。 */

const crypto = require("crypto");

const COLLECTION = "emu_client_errors";
const KEEP_MS = 30 * 24 * 60 * 60 * 1000;
/* 11/11：新しいURL（emu-for-schoolpark）を足した。旧URLだけだったので、
   URLを移してからのエラーは全部「ほかのサイト」として捨てられていた。 */
const ALLOWED_HOSTS = new Set(["emu-for-schoolpark.vercel.app", "schoolpark-emu.vercel.app", "localhost", "127.0.0.1"]);

/* 人につながりそうな部分を伏せる */
function scrub(text, max) {
  return String(text == null ? "" : text)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "<mail>")
    .replace(/0x[0-9a-f]{8,}/gi, "<addr>")
    .replace(/SP-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/g, "<spid>")
    .replace(/[A-Za-z0-9_-]{32,}/g, "<token>")
    .replace(/\d{6,}/g, "<num>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/* ファイルは「このサイトの、どのパスか」だけ。? や # のうしろは捨てる */
function sitePath(value) {
  try {
    const u = new URL(String(value || ""));
    if (!ALLOWED_HOSTS.has(u.hostname)) return null;
    return u.pathname.slice(0, 120);
  } catch (e) { return null; }
}

function dayKey(t) { return new Date(t + 9 * 3600000).toISOString().slice(0, 10); }

function parseReport(body) {
  let data = body;
  if (typeof data === "string") { try { data = JSON.parse(data); } catch (e) { return null; } }
  if (!data || typeof data !== "object") return null;
  const message = scrub(data.message, 200);
  if (!message) return null;
  const source = data.source ? sitePath(data.source) : "";
  if (source === null) return null;                    // ほかのサイト（拡張機能など）のエラーは受け取らない
  const page = sitePath(data.page);
  if (page === null) return null;
  const kind = data.kind === "rejection" ? "rejection" : "error";
  const line = Math.max(0, Math.min(10000000, Math.floor(Number(data.line) || 0)));
  const col = Math.max(0, Math.min(100000, Math.floor(Number(data.col) || 0)));
  return { kind, message, source, line, col, page };
}

function createClientErrorsRouter({ db, requireOwner, rateLimit, now = () => Date.now() }) {
  const express = require("express");
  const router = express.Router();
  const limit = rateLimit ? rateLimit({ windowMs: 60_000, max: 20, key: "client-errors" }) : (q, s, n) => n();

  /* 画面から送る。text/plain で受ける（ブラウザが前もって問い合わせずに送れる形） */
  router.post("/", express.text({ type: "*/*", limit: "4kb" }), limit, async (req, res) => {
    if (!db) return res.status(204).end();
    const report = parseReport(req.body);
    if (!report) return res.status(204).end();
    const t = now();
    const day = dayKey(t);
    const id = day + "_" + crypto.createHash("sha1")
      .update([report.kind, report.message, report.source, report.line, report.col, report.page].join("|"))
      .digest("hex").slice(0, 24);
    try {
      const ref = db.collection(COLLECTION).doc(id);
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (snap.exists) tx.set(ref, { count: (Number(snap.data().count) || 0) + 1, lastAtMs: t }, { merge: true });
        else tx.set(ref, { ...report, day, count: 1, firstAtMs: t, lastAtMs: t, expireAt: new Date(t + KEEP_MS) });
      });
    } catch (error) {
      console.warn("画面のエラーを記録できませんでした:", error.message);
    }
    return res.status(204).end();
  });

  /* 運営だけ：この7日のエラーを、多い順に */
  router.get("/admin", requireOwner, async (req, res) => {
    if (!db) return res.status(503).json({ error: "FIRESTORE_UNAVAILABLE" });
    const since = dayKey(now() - 6 * 24 * 3600000);
    try {
      const snap = await db.collection(COLLECTION).where("day", ">=", since).limit(500).get();
      const merged = new Map();
      snap.docs.forEach((d) => {
        const r = d.data();
        const key = [r.kind, r.message, r.source, r.line, r.col, r.page].join("|");
        const m = merged.get(key) || { kind: r.kind, message: r.message, source: r.source, line: r.line, col: r.col, page: r.page, count: 0, days: [], lastAtMs: 0 };
        m.count += Number(r.count) || 0;
        m.days.push(r.day);
        m.lastAtMs = Math.max(m.lastAtMs, Number(r.lastAtMs) || 0);
        merged.set(key, m);
      });
      const errors = [...merged.values()].sort((a, b) => b.count - a.count || b.lastAtMs - a.lastAtMs).slice(0, 100);
      return res.json({ ok: true, since, errors });
    } catch (error) {
      console.error("画面のエラーの読み出しに失敗:", error.message);
      return res.status(500).json({ error: "CLIENT_ERRORS_READ_FAILED" });
    }
  });

  return { router };
}

module.exports = { createClientErrorsRouter, parseReport, scrub };
