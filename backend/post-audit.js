"use strict";

/* 投稿の記録（運営だけが見る）。11/2 オーナーから。

   覚えの無い投稿（11/1 18:04「日本だよね？」）を調べたとき、だれがいつ書いたかは分かっても、
   どの端末から書いたかは記録が無く分からなかった。次に同じことがあったときに追えるよう、
   投稿したとき・書き直したときに、次のものを残す。
     - 時刻（サーバーが受け取った時刻と、投稿の時刻）
     - 端末の種類（スマホ・タブレット・パソコン）、OS、ブラウザ（LINE などのアプリ内ブラウザか）
     - ログインの方法（LINE・Google・メール・ウォレット）と、そのログインをした時刻
       （いつものスマホのまま書いたのか、その直前に新しくログインしたのかが分かる）
     - ブラウザが名乗った文字列（User-Agent）。300字まで
   IP アドレス・位置・投稿の本文は残さない。

   置き場所は emu_post_audit。Firestore のルールに当てはまるものが無いので、画面からは読み書きできない
   （サーバーだけ）。見られるのは運営（requireOwner）だけ。1年たったら消してよい印（expireAt）を付ける。 */

const KEEP_MS = 365 * 24 * 60 * 60 * 1000;
const COLLECTION = "emu_post_audit";

/* User-Agent から、端末の種類・OS・ブラウザを読み取る（よく使われるものだけ。分からなければ「不明」） */
function describeDevice(ua) {
  const s = String(ua || "");
  const os = /iPhone/.test(s) ? "iPhone (iOS)"
    : /iPad/.test(s) || (/Macintosh/.test(s) && /Mobile/.test(s)) ? "iPad (iPadOS)"
    : /Android/.test(s) ? "Android"
    : /Windows/.test(s) ? "Windows"
    : /Mac OS X|Macintosh/.test(s) ? "Mac"
    : /CrOS/.test(s) ? "ChromeOS"
    : /Linux/.test(s) ? "Linux" : "不明";
  const type = /iPad|Tablet/.test(s) || (/Android/.test(s) && !/Mobile/.test(s)) ? "タブレット"
    : /iPhone|Android|Mobile/.test(s) ? "スマホ"
    : s ? "パソコン" : "不明";
  const browser = /\bLine\//i.test(s) ? "LINE のアプリ内ブラウザ"
    : /MetaMaskMobile/i.test(s) ? "MetaMask アプリ内ブラウザ"
    : /FBAN|FBAV|Instagram/.test(s) ? "Facebook / Instagram のアプリ内ブラウザ"
    : /EdgA?\//.test(s) ? "Edge"
    : /SamsungBrowser\//.test(s) ? "Samsung Internet"
    : /OPR\/|Opera/.test(s) ? "Opera"
    : /Firefox\/|FxiOS\//.test(s) ? "Firefox"
    : /CriOS\/|Chrome\//.test(s) ? "Chrome"
    : /Safari\//.test(s) ? "Safari" : "不明";
  return { type, os, browser };
}

const tsMs = v => v && typeof v.toMillis === "function" ? v.toMillis()
  : v instanceof Date ? v.getTime() : typeof v === "number" ? v : Date.parse(v) || 0;
const PROVIDER = { line: "LINE", wallet: "ウォレット", "google.com": "Google", password: "メール" };

function createPostAuditRouter({ db, requireFirebaseUser, requireOwner, rateLimit, now = () => Date.now() }) {
  const express = require("express");
  const router = express.Router();
  const limit = rateLimit ? rateLimit({ windowMs: 60_000, max: 30, key: "post-audit" }) : (q, s, n) => n();

  /* 画面が、投稿・書き直しのすぐあとに送る。投稿が本人の名義のものだけ受ける */
  router.post("/", limit, requireFirebaseUser, async (req, res) => {
    if (!db) return res.status(503).json({ error: "FIRESTORE_UNAVAILABLE" });
    const postId = String(req.body && req.body.postId || "").trim();
    const kind = req.body && req.body.kind === "edit" ? "edit" : "create";
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(postId)) return res.status(400).json({ error: "INVALID_POST" });
    try {
      const post = await db.collection("posts").doc(postId).get();
      if (!post.exists) return res.status(404).json({ error: "POST_NOT_FOUND" });
      const data = post.data() || {};
      const mine = [req.identity.walletAddress, req.identity.account && req.identity.account.walletAddress,
        req.identity.account && req.identity.account.chesAddress].map(a => String(a || "").toLowerCase()).filter(Boolean);
      const address = String(data.address || "").toLowerCase();
      if (!mine.includes(address)) return res.status(403).json({ error: "NOT_YOUR_POST" });
      const ua = String(req.headers["user-agent"] || "").slice(0, 300);
      const t = now();
      const row = {
        postId, kind, address, uid: req.identity.uid,
        title: String(data.title || "").slice(0, 80),
        postCreatedAtMs: tsMs(data.createdAt) || null,
        recordedAtMs: t,
        signInProvider: String(req.identity.loginMethod || req.identity.signInProvider || ""),
        authTimeMs: Number(req.identity.authTimeMs) || null,
        device: describeDevice(ua),
        userAgent: ua,
        expireAt: new Date(t + KEEP_MS)
      };
      // 投稿は1件につき1つ（最初に届いたもの）。書き直しは、そのたびに1つ
      const ref = db.collection(COLLECTION).doc(kind === "create" ? postId : `${postId}__edit__${t}`);
      try { await ref.create(row); }
      catch (e) {
        // Firestore は「もうある」を code 6（ALREADY_EXISTS）で返す。投稿の記録は最初のものを残す
        if (kind === "create" && (e && (e.code === 6 || /ALREADY_EXISTS/i.test(String(e.message))))) return res.json({ ok: true, already: true });
        throw e;
      }
      return res.json({ ok: true });
    } catch (error) {
      console.error("投稿の記録に失敗:", error.message);
      return res.status(500).json({ error: "POST_AUDIT_FAILED" });
    }
  });

  /* 運営だけ：投稿ID か 名義（アドレス）で引く。新しい順に50件まで */
  router.get("/admin", requireOwner, async (req, res) => {
    if (!db) return res.status(503).json({ error: "FIRESTORE_UNAVAILABLE" });
    const postId = String(req.query.postId || "").trim();
    const address = String(req.query.address || "").trim().toLowerCase();
    try {
      let rows = [];
      if (postId) {
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(postId)) return res.status(400).json({ error: "INVALID_POST" });
        const snap = await db.collection(COLLECTION).where("postId", "==", postId).limit(50).get();
        rows = snap.docs.map(d => d.data());
      } else if (address) {
        if (!/^0x[0-9a-f]{40}$/.test(address)) return res.status(400).json({ error: "INVALID_ADDRESS" });
        const snap = await db.collection(COLLECTION).where("address", "==", address).limit(200).get();
        rows = snap.docs.map(d => d.data());
      } else {
        const snap = await db.collection(COLLECTION).where("recordedAtMs", ">=", now() - 14 * 24 * 60 * 60 * 1000).limit(200).get();
        rows = snap.docs.map(d => d.data());
      }
      rows.sort((a, b) => (b.recordedAtMs || 0) - (a.recordedAtMs || 0));
      return res.json({ ok: true, records: rows.slice(0, 50).map(r => ({
        postId: r.postId, kind: r.kind, by: r.by || "", reason: r.reason || "", address: r.address, uid: r.uid, title: r.title,
        postCreatedAtMs: r.postCreatedAtMs, recordedAtMs: r.recordedAtMs,
        signIn: PROVIDER[r.signInProvider] || r.signInProvider || "不明", authTimeMs: r.authTimeMs,
        device: r.device, userAgent: r.userAgent
      })) });
    } catch (error) {
      console.error("投稿の記録の読み出しに失敗:", error.message);
      return res.status(500).json({ error: "POST_AUDIT_READ_FAILED" });
    }
  });

  return { router };
}

/* 投稿を消す（11/2 オーナーから）。
     - 本人：自分の名義（ウォレット・CHES のどちらでも）の投稿を消せる（知識ラボの投稿は除く。ルールと同じ）
     - 運営：どの投稿でも消せる（不適切な投稿の取り下げ）。理由を残せる
   消す前に、だれが・いつ・どの端末から消したかを emu_post_audit に残す（題・名義・反応の数。本文は残さない）。
   Firestore のルールでも本人は消せるが、画面からはこちらを使う（記録が残るように）。 */
function createPostDeleteRouter({ db, requireFirebaseUser, isOwner, rateLimit, now = () => Date.now() }) {
  const express = require("express");
  const router = express.Router();
  const limit = rateLimit ? rateLimit({ windowMs: 60_000, max: 20, key: "post-delete" }) : (q, s, n) => n();
  router.post("/:id/delete", limit, requireFirebaseUser, async (req, res) => {
    if (!db) return res.status(503).json({ error: "FIRESTORE_UNAVAILABLE" });
    const postId = String(req.params.id || "");
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(postId)) return res.status(400).json({ error: "INVALID_POST" });
    try {
      const ref = db.collection("posts").doc(postId);
      const snap = await ref.get();
      if (!snap.exists) return res.json({ ok: true, already: true });
      const data = snap.data() || {};
      const mine = [req.identity.walletAddress, req.identity.account && req.identity.account.walletAddress,
        req.identity.account && req.identity.account.chesAddress].map(a => String(a || "").toLowerCase()).filter(Boolean);
      const address = String(data.address || "").toLowerCase();
      const byAuthor = mine.includes(address) && !data.knowledgeLab;
      const byOwner = !byAuthor && !!(isOwner && isOwner(req.identity));
      if (!byAuthor && !byOwner) return res.status(403).json({ error: "NOT_YOUR_POST" });
      const ua = String(req.headers["user-agent"] || "").slice(0, 300);
      const t = now();
      await db.collection(COLLECTION).doc(`${postId}__delete__${t}`).create({
        postId, kind: "delete", by: byAuthor ? "author" : "owner", address, uid: req.identity.uid,
        title: String(data.title || "").slice(0, 80),
        postCreatedAtMs: tsMs(data.createdAt) || null,
        goodCount: Number(data.goodCount) || 0, changeCount: Number(data.changeCount) || 0,
        reason: byOwner ? String(req.body && req.body.reason || "").slice(0, 200) : "",
        recordedAtMs: t,
        signInProvider: String(req.identity.loginMethod || req.identity.signInProvider || ""),
        authTimeMs: Number(req.identity.authTimeMs) || null,
        device: describeDevice(ua), userAgent: ua,
        expireAt: new Date(t + KEEP_MS)
      });
      await ref.delete();
      return res.json({ ok: true, by: byAuthor ? "author" : "owner" });
    } catch (error) {
      console.error("投稿を消せませんでした:", error.message);
      return res.status(500).json({ error: "POST_DELETE_FAILED" });
    }
  });
  return { router };
}

module.exports = { createPostAuditRouter, createPostDeleteRouter, describeDevice };
