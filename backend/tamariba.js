"use strict";
/* たまり場（11/19 オーナー：CONNECT で、オンラインでもっと簡単に交流できるように。「たまり場を固定」）。

   テーマごとの小さな部屋が、決まった数だけある（固定）。部屋を増やす・消すのは、ここの ROOMS を書き換えるときだけ。
   人が少なくても成り立つように、ふだんは「書き込み → 返信」でゆっくり話す（チャットではない）。
   見るだけでも入れる。書く人だけが書く。

   安全のための決めごと
   - 1対1のやりとり（DM）は作らない。友だち申請も無い。部屋の中で、みんなに見える形でだけ話す。
   - 出すのは名前（本人が付けた名前）だけ。パスポート番号・アドレスは出さない。
     ブロックに使う書き手の印（authorKey）は、パスポート番号から作った、元に戻せない短い値。
   - 通報できる。ちがう3人から通報されたら、運営が見るまで自動で隠す。運営は隠す・戻すができる。
   - ブロックした人の書き込みと返信は、自分には出さない（相手には知らせない）。
   - 書けるのは 1日に 書き込み10件・返信30件まで（日本時間）。1件は400字まで。
   - 自分の書き込み・返信は自分で消せる（消したことは「書いた人が消しました」と残る）。

   置き場所（どれもサーバーだけが読み書きする。Firestore のルールでは、名前の無いコレクションは誰も読めない）
     sp_tamariba_rooms/{room}                       … 部屋ごとの数（count）と最後に書かれた時刻（lastAtMs）
     sp_tamariba_rooms/{room}/posts/{id}           … 書き込み
     sp_tamariba_rooms/{room}/posts/{id}/replies/{id} … 返信
     sp_tamariba_reports/{対象:通報した人}           … 通報（同じ人は同じものを1回だけ）
     sp_tamariba_blocks/{パスポート番号}             … その人がブロックした書き手の印
     sp_tamariba_daily/{パスポート番号:日}           … その日に書いた数

   入れるのは SchoolPark に入れる人だけ（City と同じ確かめ方。パスポートが連携されていること）。
   書いた文は計測（PostHog）には送らない。 */
const crypto = require("node:crypto");
const express = require("express");
const { decideSchoolParkAccess } = require("./schoolpark-access");

const ROOMS = [
  { id: "today", name: "今日なにしてた？", hint: "今日あったこと、やってみたこと。ひとことでも。" },
  { id: "hobby", name: "好きなことを語る", hint: "映画・本・音楽・ゲーム・推し。好きなものの話。" },
  { id: "together", name: "なにか一緒にやりたい", hint: "やってみたいこと、仲間がほしいこと。" },
  { id: "learnwork", name: "学び・仕事の相談", hint: "勉強や仕事で迷っていること、聞いてみたいこと。" },
  { id: "tech", name: "開発・Web3 雑談", hint: "つくっているもの、技術の話、Web3 の話。" }
];
const ROOM_IDS = ROOMS.map(r => r.id);
const MAX_BODY = 400;
const PAGE = 20;
const DAILY_POSTS = 10;
const DAILY_REPLIES = 30;
const HIDE_AT_REPORTS = 3;
const REASONS = ["spam", "harass", "personal", "other"];

const C_ROOMS = "sp_tamariba_rooms";
const C_REPORTS = "sp_tamariba_reports";
const C_BLOCKS = "sp_tamariba_blocks";
const C_DAILY = "sp_tamariba_daily";
/* 11/28 オーナー：「たまり場も画像（プロフィールのやつ）反映させて。投稿の時みたいに」。
   書き手の印（authorKey）→ その人のアドレス を、サーバーだけが読める所に控える（画面には出さない）。
   画面には「印ごとのプロフィール画像」だけを返す。アドレス・パスポート番号は出さない。 */
const C_PEOPLE = "sp_tamariba_people";
const AVATAR_TTL_MS = 10 * 60 * 1000;
const MAX_AVATAR_KEYS = 40;
function okAvatar(v) { return typeof v === "string" && v.length <= 300000 && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+\/]+=*$/.test(v); }

function isSchoolParkId(v) { return /^SP-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(String(v || "")); }
function authorKeyOf(spid) { return "a" + crypto.createHash("sha256").update("tamariba:" + spid).digest("hex").slice(0, 15); }
function jstDay(ms) { return new Date(ms + 9 * 3600000).toISOString().slice(0, 10); }
/* 文を整える：前後の空白を落とし、改行は残し、見えない制御文字は消す。長さは数えるだけ（切らない） */
function cleanBody(v) {
  if (typeof v !== "string") return "";
  return v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000B-\u001F\u007F​-‏‪-‮⁦-⁩]/g, "").replace(/\n{4,}/g, "\n\n\n").trim();
}
function newId(now) { return now().toString(36) + crypto.randomBytes(6).toString("hex"); }

function createTamaribaRouter({ db, identity, entitlement, requireFirebaseUser, rateLimit,
  ownerAddresses = [], now = Date.now }) {
  const router = express.Router();
  const registered = new Set();          // このサーバーで控え済みの印
  const avatarCache = new Map();         // 印 → { at, avatar }
  const limited = (key, max) => (rateLimit ? rateLimit({ key, max, windowMs: 60000 }) : (_q, _s, n) => n());
  router.use((_req, res, next) => { res.set("Cache-Control", "private, no-store"); next(); });
  router.use(requireFirebaseUser);
  router.use(limited("schoolpark-tamariba", 90));

  /* 入れる人かを確かめ、名前と印を決める（City と同じ確かめ方。読めなかったら入れない） */
  router.use(async (req, res, next) => {
    if (!db || !identity || !entitlement) return res.status(503).json({ error: "TAMARIBA_UNAVAILABLE" });
    try {
      const accountSnap = await db.collection("ches_accounts").doc(req.identity.uid).get();
      if (!accountSnap.exists) return res.status(403).json({ error: "ACCOUNT_NOT_FOUND" });
      const account = accountSnap.data() || {};
      const addrs = [account.walletAddress, account.chesAddress].map(a => String(a || "").toLowerCase()).filter(Boolean);
      const isOwner = addrs.some(a => ownerAddresses.includes(a));
      const hasOfficialPass = await entitlement.holdsOfficialPass(req.identity.uid, account);
      if (!decideSchoolParkAccess(now(), { isOwner, hasOfficialPass }).allowed) return res.status(403).json({ error: "SCHOOLPARK_ACCESS_DENIED" });
      const spid = await identity.findByUid(req.identity.uid);
      if (!isSchoolParkId(spid)) return res.status(409).json({ error: "PASSPORT_LINK_REQUIRED" });
      const person = await identity.readIdentity(spid);
      if (!person || person.status !== "active") return res.status(403).json({ error: "PASSPORT_INACTIVE" });
      /* 名前は本人が付けたもの（user_profiles/{アドレス}）を先に。無ければアカウントの名前。どちらも無ければ番号の末尾だけ */
      let name = "";
      for (const a of addrs) {
        if (name) break;
        try { const p = await db.collection("user_profiles").doc(a).get(); if (p.exists) name = String((p.data() || {}).displayName || "").trim(); } catch (_) {}
      }
      if (!name) name = String(account.displayName || "").trim();
      if (!name) name = "メンバー" + spid.slice(-4);
      req.tama = { spid, isOwner, name: name.slice(0, 40), key: authorKeyOf(spid) };
      /* 画像を引けるよう、印とアドレスを控える（このサーバーで1人1回。失敗しても入場は止めない） */
      if (!registered.has(req.tama.key) && addrs.length) {
        registered.add(req.tama.key);
        avatarCache.delete(req.tama.key);
        db.collection(C_PEOPLE).doc(req.tama.key).set({ addrs, updatedAtMs: now() }, { merge: true }).catch(() => registered.delete(req.tama.key));
      }
      next();
    } catch (_) {
      return res.status(503).json({ error: "TAMARIBA_UNAVAILABLE" });
    }
  });

  const roomRef = id => db.collection(C_ROOMS).doc(id);
  const postsCol = room => db.collection(C_ROOMS + "/" + room + "/posts");
  const repliesCol = (room, pid) => db.collection(C_ROOMS + "/" + room + "/posts/" + pid + "/replies");
  const okRoom = room => ROOM_IDS.includes(String(room || ""));
  const okId = id => /^[a-z0-9]{8,40}$/.test(String(id || ""));

  async function blockedOf(spid) {
    const snap = await db.collection(C_BLOCKS).doc(spid).get();
    return snap.exists ? ((snap.data() || {}).keys || []).filter(k => typeof k === "string") : [];
  }
  function view(id, d, me, blocked) {
    const hidden = !!d.hidden;
    const deleted = !!d.deleted;
    const mine = d.authorKey === me.key;
    if (blocked.includes(d.authorKey) && !me.isOwner) return null;
    if (hidden && !me.isOwner && !mine) return null;
    return {
      id, body: deleted ? "" : String(d.body || ""), name: String(d.authorName || ""), authorKey: d.authorKey,
      createdAtMs: d.createdAtMs || 0, replyCount: d.replyCount || 0, lastReplyAtMs: d.lastReplyAtMs || 0,
      mine, deleted, hidden, hiddenByReports: !!d.hiddenByReports,
      reportCount: me.isOwner ? (d.reportCount || 0) : undefined
    };
  }
  /* 1日に書ける数を数える（取引の中で） */
  async function countToday(tx, spid, kind, max) {
    const ref = db.collection(C_DAILY).doc(spid + ":" + jstDay(now()));
    const snap = await tx.get(ref);
    const d = snap.exists ? (snap.data() || {}) : {};
    const used = Number(d[kind] || 0);
    if (used >= max) { const e = new Error("DAILY_LIMIT"); e.code = "DAILY_LIMIT"; throw e; }
    return () => tx.set(ref, Object.assign({}, d, { [kind]: used + 1, updatedAtMs: now() }));
  }
  const fail = (res, e, fallback) => {
    if (e && e.code === "DAILY_LIMIT") return res.status(429).json({ error: "DAILY_LIMIT" });
    if (e && e.code === "NOT_FOUND") return res.status(404).json({ error: "NOT_FOUND" });
    if (e && e.code === "FORBIDDEN") return res.status(403).json({ error: "FORBIDDEN" });
    return res.status(503).json({ error: fallback });
  };

  /* 部屋の一覧（数と最後に書かれた時刻） */
  router.get("/rooms", async (req, res) => {
    try {
      const rows = await Promise.all(ROOMS.map(async r => {
        const s = await roomRef(r.id).get();
        const d = s.exists ? (s.data() || {}) : {};
        return { id: r.id, name: r.name, hint: r.hint, count: d.count || 0, lastAtMs: d.lastAtMs || 0 };
      }));
      return res.json({ ok: true, rooms: rows, me: { name: req.tama.name, key: req.tama.key, isOwner: req.tama.isOwner },
        limits: { maxBody: MAX_BODY, dailyPosts: DAILY_POSTS, dailyReplies: DAILY_REPLIES } });
    } catch (e) { return fail(res, e, "TAMARIBA_UNAVAILABLE"); }
  });

  /* 書き手のプロフィール画像（知識を読むと同じ user_profiles/{アドレス}.avatar）。印ごとに返す */
  async function avatarOf(key) {
    const hit = avatarCache.get(key);
    if (hit && now() - hit.at < AVATAR_TTL_MS) return hit.avatar;
    let avatar = "";
    try {
      const ps = await db.collection(C_PEOPLE).doc(key).get();
      const addrs = ps.exists ? ((ps.data() || {}).addrs || []).filter(a => typeof a === "string" && a) : [];
      for (const a of addrs) {
        const p = await db.collection("user_profiles").doc(a).get();
        const v = p.exists ? (p.data() || {}).avatar : "";
        if (okAvatar(v)) { avatar = v; break; }
      }
    } catch (_) { return ""; }
    if (avatarCache.size > 2000) avatarCache.clear();
    avatarCache.set(key, { at: now(), avatar });
    return avatar;
  }
  router.get("/avatars", async (req, res) => {
    const keys = [...new Set(String(req.query.keys || "").split(",").filter(k => /^a[0-9a-f]{15}$/.test(k)))].slice(0, MAX_AVATAR_KEYS);
    try {
      const out = {};
      await Promise.all(keys.map(async k => { const v = await avatarOf(k); if (v) out[k] = v; }));
      return res.json({ ok: true, avatars: out });
    } catch (e) { return fail(res, e, "TAMARIBA_UNAVAILABLE"); }
  });

  /* 部屋の書き込み（新しい順に20件。before で続き） */
  router.get("/rooms/:room/posts", async (req, res) => {
    const room = req.params.room;
    if (!okRoom(room)) return res.status(404).json({ error: "ROOM_NOT_FOUND" });
    const before = Number(req.query.before || 0);
    try {
      const blocked = await blockedOf(req.tama.spid);
      let q = postsCol(room);
      q = before > 0 ? q.where("createdAtMs", "<", before).orderBy("createdAtMs", "desc") : q.orderBy("createdAtMs", "desc");
      const snap = await q.limit(PAGE + 1).get();
      const docs = snap.docs.slice(0, PAGE);
      const posts = docs.map(d => view(d.id, d.data() || {}, req.tama, blocked)).filter(Boolean);
      const last = docs.length ? (docs[docs.length - 1].data() || {}).createdAtMs : 0;
      return res.json({ ok: true, room, posts, next: snap.docs.length > PAGE ? last : null });
    } catch (e) { return fail(res, e, "TAMARIBA_UNAVAILABLE"); }
  });

  /* 書き込む */
  router.post("/rooms/:room/posts", limited("schoolpark-tamariba-write", 10), async (req, res) => {
    const room = req.params.room;
    if (!okRoom(room)) return res.status(404).json({ error: "ROOM_NOT_FOUND" });
    const body = cleanBody(req.body && req.body.body);
    if (!body) return res.status(400).json({ error: "BODY_REQUIRED" });
    if ([...body].length > MAX_BODY) return res.status(400).json({ error: "BODY_TOO_LONG" });
    const id = newId(now);
    try {
      await db.runTransaction(async tx => {
        const rs = await tx.get(roomRef(room));
        const commitDaily = await countToday(tx, req.tama.spid, "posts", DAILY_POSTS);
        const r = rs.exists ? (rs.data() || {}) : {};
        tx.create(postsCol(room).doc(id), { room, body, authorKey: req.tama.key, authorSpid: req.tama.spid, authorName: req.tama.name,
          createdAtMs: now(), replyCount: 0, reportCount: 0, hidden: false, deleted: false });
        tx.set(roomRef(room), Object.assign({}, r, { count: Number(r.count || 0) + 1, lastAtMs: now() }));
        commitDaily();
      });
      return res.json({ ok: true, id });
    } catch (e) { return fail(res, e, "TAMARIBA_WRITE_FAILED"); }
  });

  /* 返信の一覧（古い順に、最大100件） */
  router.get("/rooms/:room/posts/:id/replies", async (req, res) => {
    const { room, id } = req.params;
    if (!okRoom(room) || !okId(id)) return res.status(404).json({ error: "NOT_FOUND" });
    try {
      const blocked = await blockedOf(req.tama.spid);
      const ps = await postsCol(room).doc(id).get();
      if (!ps.exists || !view(id, ps.data() || {}, req.tama, blocked)) return res.status(404).json({ error: "NOT_FOUND" });
      const snap = await repliesCol(room, id).orderBy("createdAtMs", "asc").limit(100).get();
      const replies = snap.docs.map(d => view(d.id, d.data() || {}, req.tama, blocked)).filter(Boolean);
      return res.json({ ok: true, replies });
    } catch (e) { return fail(res, e, "TAMARIBA_UNAVAILABLE"); }
  });

  /* 返信する */
  router.post("/rooms/:room/posts/:id/replies", limited("schoolpark-tamariba-write", 10), async (req, res) => {
    const { room, id } = req.params;
    if (!okRoom(room) || !okId(id)) return res.status(404).json({ error: "NOT_FOUND" });
    const body = cleanBody(req.body && req.body.body);
    if (!body) return res.status(400).json({ error: "BODY_REQUIRED" });
    if ([...body].length > MAX_BODY) return res.status(400).json({ error: "BODY_TOO_LONG" });
    const rid = newId(now);
    try {
      await db.runTransaction(async tx => {
        const pref = postsCol(room).doc(id);
        const ps = await tx.get(pref);
        const commitDaily = await countToday(tx, req.tama.spid, "replies", DAILY_REPLIES);
        const p = ps.exists ? (ps.data() || {}) : null;
        if (!p || p.deleted || (p.hidden && !req.tama.isOwner)) { const e = new Error("NOT_FOUND"); e.code = "NOT_FOUND"; throw e; }
        tx.create(repliesCol(room, id).doc(rid), { body, authorKey: req.tama.key, authorSpid: req.tama.spid, authorName: req.tama.name,
          createdAtMs: now(), reportCount: 0, hidden: false, deleted: false });
        tx.set(pref, Object.assign({}, p, { replyCount: Number(p.replyCount || 0) + 1, lastReplyAtMs: now() }));
        commitDaily();
      });
      return res.json({ ok: true, id: rid });
    } catch (e) { return fail(res, e, "TAMARIBA_WRITE_FAILED"); }
  });

  /* 自分の書き込み・返信を消す（運営は誰のものでも消せる）。中身は消し、「消しました」と残す */
  router.post("/rooms/:room/posts/:id/delete", async (req, res) => {
    const { room, id } = req.params;
    const replyId = req.body && req.body.replyId ? String(req.body.replyId) : "";
    if (!okRoom(room) || !okId(id) || (replyId && !okId(replyId))) return res.status(404).json({ error: "NOT_FOUND" });
    try {
      await db.runTransaction(async tx => {
        const ref = replyId ? repliesCol(room, id).doc(replyId) : postsCol(room).doc(id);
        const s = await tx.get(ref);
        if (!s.exists) { const e = new Error("NOT_FOUND"); e.code = "NOT_FOUND"; throw e; }
        const d = s.data() || {};
        if (d.authorKey !== req.tama.key && !req.tama.isOwner) { const e = new Error("FORBIDDEN"); e.code = "FORBIDDEN"; throw e; }
        tx.set(ref, Object.assign({}, d, { body: "", deleted: true, deletedAtMs: now(), deletedBy: d.authorKey === req.tama.key ? "author" : "owner" }));
      });
      return res.json({ ok: true });
    } catch (e) { return fail(res, e, "TAMARIBA_WRITE_FAILED"); }
  });

  /* 通報する。同じ人は同じものを1回だけ。ちがう3人から通報されたら、運営が見るまで隠す */
  router.post("/rooms/:room/posts/:id/report", limited("schoolpark-tamariba-report", 10), async (req, res) => {
    const { room, id } = req.params;
    const replyId = req.body && req.body.replyId ? String(req.body.replyId) : "";
    const reason = REASONS.includes(req.body && req.body.reason) ? req.body.reason : "other";
    if (!okRoom(room) || !okId(id) || (replyId && !okId(replyId))) return res.status(404).json({ error: "NOT_FOUND" });
    const target = room + "/" + id + (replyId ? "/" + replyId : "");
    try {
      let already = false;
      await db.runTransaction(async tx => {
        const ref = replyId ? repliesCol(room, id).doc(replyId) : postsCol(room).doc(id);
        const repRef = db.collection(C_REPORTS).doc(target.replace(/\//g, "~") + ":" + req.tama.spid);
        const [s, r] = [await tx.get(ref), await tx.get(repRef)];
        if (!s.exists) { const e = new Error("NOT_FOUND"); e.code = "NOT_FOUND"; throw e; }
        if (r.exists) { already = true; return; }
        const d = s.data() || {};
        if (d.authorKey === req.tama.key) { const e = new Error("FORBIDDEN"); e.code = "FORBIDDEN"; throw e; }
        const count = Number(d.reportCount || 0) + 1;
        tx.create(repRef, { target, room, postId: id, replyId: replyId || "", reason, reporterSpid: req.tama.spid, createdAtMs: now(), open: true });
        tx.set(ref, Object.assign({}, d, { reportCount: count },
          count >= HIDE_AT_REPORTS && !d.reviewedAtMs ? { hidden: true, hiddenByReports: true } : {}));
      });
      return res.json({ ok: true, already });
    } catch (e) { return fail(res, e, "TAMARIBA_WRITE_FAILED"); }
  });

  /* ブロック。相手の書き込みと返信が、自分には出なくなる。相手には知らせない */
  router.get("/blocks", async (req, res) => {
    try { return res.json({ ok: true, keys: await blockedOf(req.tama.spid) }); }
    catch (e) { return fail(res, e, "TAMARIBA_UNAVAILABLE"); }
  });
  router.post("/blocks", async (req, res) => {
    const key = String((req.body && req.body.authorKey) || "");
    if (!/^a[0-9a-f]{15}$/.test(key) || key === req.tama.key) return res.status(400).json({ error: "BAD_AUTHOR" });
    try {
      await db.runTransaction(async tx => {
        const ref = db.collection(C_BLOCKS).doc(req.tama.spid);
        const s = await tx.get(ref);
        const keys = s.exists ? ((s.data() || {}).keys || []) : [];
        if (keys.includes(key)) return;
        if (keys.length >= 500) { const e = new Error("FORBIDDEN"); e.code = "FORBIDDEN"; throw e; }
        tx.set(ref, { keys: keys.concat([key]), updatedAtMs: now() });
      });
      return res.json({ ok: true });
    } catch (e) { return fail(res, e, "TAMARIBA_WRITE_FAILED"); }
  });
  router.post("/blocks/remove", async (req, res) => {
    const key = String((req.body && req.body.authorKey) || "");
    try {
      await db.runTransaction(async tx => {
        const ref = db.collection(C_BLOCKS).doc(req.tama.spid);
        const s = await tx.get(ref);
        const keys = s.exists ? ((s.data() || {}).keys || []) : [];
        tx.set(ref, { keys: keys.filter(k => k !== key), updatedAtMs: now() });
      });
      return res.json({ ok: true });
    } catch (e) { return fail(res, e, "TAMARIBA_WRITE_FAILED"); }
  });

  /* 運営：通報の一覧と、隠す・戻す */
  const ownerOnly = (req, res, next) => (req.tama.isOwner ? next() : res.status(403).json({ error: "OWNER_ONLY" }));
  router.get("/admin/reports", ownerOnly, async (req, res) => {
    try {
      const snap = await db.collection(C_REPORTS).orderBy("createdAtMs", "desc").limit(50).get();
      const reports = snap.docs.map(d => {
        const r = d.data() || {};
        return { target: r.target, room: r.room, postId: r.postId, replyId: r.replyId, reason: r.reason, createdAtMs: r.createdAtMs };
      });
      /* 11/28：管理画面で判断できるように、通報されたもの1件ずつに本文と今の状態をつける（通報した人はここでも出さない） */
      const byTarget = new Map();
      reports.forEach(r => {
        if (!okRoom(r.room) || !okId(r.postId) || (r.replyId && !okId(r.replyId))) return;
        const t = byTarget.get(r.target) || { target: r.target, room: r.room, postId: r.postId, replyId: r.replyId || "", reasons: {}, lastAtMs: 0 };
        t.reasons[r.reason] = (t.reasons[r.reason] || 0) + 1;
        t.lastAtMs = Math.max(t.lastAtMs, Number(r.createdAtMs) || 0);
        byTarget.set(r.target, t);
      });
      const targets = await Promise.all([...byTarget.values()].map(async t => {
        try {
          const s = await (t.replyId ? repliesCol(t.room, t.postId).doc(t.replyId) : postsCol(t.room).doc(t.postId)).get();
          const d = s.exists ? (s.data() || {}) : {};
          return Object.assign(t, { exists: s.exists, body: String(d.body || "").slice(0, MAX_BODY), authorName: String(d.authorName || ""),
            hidden: !!d.hidden, deleted: !!d.deleted, reportCount: Number(d.reportCount || 0), reviewedAtMs: Number(d.reviewedAtMs || 0) || null });
        } catch (_) { return Object.assign(t, { exists: false }); }
      }));
      return res.json({ ok: true, reports, targets });
    } catch (e) { return fail(res, e, "TAMARIBA_UNAVAILABLE"); }
  });
  router.post("/admin/hide", ownerOnly, async (req, res) => {
    const b = req.body || {};
    const room = String(b.room || ""), id = String(b.postId || ""), replyId = b.replyId ? String(b.replyId) : "";
    if (!okRoom(room) || !okId(id) || (replyId && !okId(replyId))) return res.status(404).json({ error: "NOT_FOUND" });
    try {
      await db.runTransaction(async tx => {
        const ref = replyId ? repliesCol(room, id).doc(replyId) : postsCol(room).doc(id);
        const s = await tx.get(ref);
        if (!s.exists) { const e = new Error("NOT_FOUND"); e.code = "NOT_FOUND"; throw e; }
        tx.set(ref, Object.assign({}, s.data() || {}, { hidden: !!b.hidden, hiddenByReports: false, reviewedAtMs: now() }));
      });
      return res.json({ ok: true });
    } catch (e) { return fail(res, e, "TAMARIBA_WRITE_FAILED"); }
  });

  return router;
}

module.exports = { createTamaribaRouter, ROOMS, authorKeyOf, cleanBody, MAX_BODY, DAILY_POSTS, DAILY_REPLIES, HIDE_AT_REPORTS };
