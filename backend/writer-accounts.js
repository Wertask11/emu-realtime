"use strict";

/* 運営の書き手アカウント（11/18 オーナー）

   オーナーの代わりに、ほかの道具（ChatGPT・Muse など）が「書き手」として本番に投稿する。
   オーナーのアカウントで入ると、オーナーが書いたことになってしまうので、書き手ごとに別のアカウントを運営画面で作る。

   ・作れるのは運営（requireOwner）だけ。作ると「書き手キー」を1回だけ見せる（記録にはキーのハッシュしか残さない）
   ・書き手はログイン画面の「書き手キーで入る」にキーを入れる。サーバーが確かめて、uid「writer:<ID>」でログインの証を出す
     （LINE と同じ、サーバーが発行する証。メールや外部のログインは要らない）
   ・止める・キーを作り直す（前のキーは使えなくなる）・名前を変えるができる
   ・投稿には、運営画面で付けた名前だけが出る（11/18 オーナー：「運営の書き手」の印は付けない）
   ・運営の権限は持たない（requireOwner のアドレスとは別。書き手のアドレスは uid から決まる）
   ・公開できる段（pro）を付ける（11/18：付けていなかったので「見学」扱いになり、公開できなかった）。
     置き場は entitlements/{uid}（運営の付与と同じ。サーバーだけが書ける）。source は "writer"。
     止めたら期限を切り、戻したら付け直す。書き手の uid（writer:…）の分だけを書く。 */

const crypto = require("crypto");
const ethers = require("ethers");

const COLLECTION = "writer_accounts";
const deriveAddress = (uid) => ethers.utils.getAddress("0x" + ethers.utils.keccak256(ethers.utils.toUtf8Bytes("ches-wallet:v1:" + uid)).slice(-40));
const hashKey = (key) => crypto.createHash("sha256").update("emu-writer-key:v1:" + String(key || "")).digest("hex");
const newKey = () => "emw_" + crypto.randomBytes(24).toString("base64url");
const newId = () => crypto.randomBytes(6).toString("hex");
const KEY_FORMAT = /^emw_[A-Za-z0-9_-]{32}$/;
const WRITER_PLAN = "pro";
/* キーの目印（11/24）。キーの最後の4文字だけを残し、運営画面とログイン画面で見比べられるようにする。
   「書き手キーが違う」と断られたとき、渡したキーが今のキーか（作り直す前の古いキーではないか）、
   書き写すうちに1文字ちがっていないかを確かめるため。32文字の乱数のうち4文字なので、当て推量の助けにはならない。 */
const keyHintOf = (key) => String(key || "").slice(-4);

/* 書き手の公開できる段。止めているときは期限を今にして切る。
   expiresAt を null で書くとルールの比較が通らないので、生きているあいだは欄ごと持たない（上書きで入れ直す）。 */
async function setWriterGrant(db, uid, active, now) {
  if (!String(uid || "").startsWith("writer:")) return;
  const at = new Date(now());
  const doc = { plan: WRITER_PLAN, source: "writer", startsAt: at, grantedAt: at };
  if (!active) doc.expiresAt = at;
  await db.collection("entitlements").doc(uid).set(doc);
}

function cleanName(v) {
  const s = String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!s || s.length > 40) return null;
  return s;
}
function cleanNote(v) {
  return String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 120);
}
function publicView(id, d) {
  return {
    id,
    name: d.name || "",
    note: d.note || "",
    active: d.active !== false,
    address: d.address || "",
    createdAt: d.createdAt || 0,
    lastLoginAt: d.lastLoginAt || 0,
    keyIssuedAt: d.keyIssuedAt || 0,
    keyHint: d.keyHint || "",
  };
}

function createWriterAccountsRouter({ db, firebaseAdmin, requireOwner, rateLimit, now = Date.now, forgetEntitlement = () => {} }) {
  const express = require("express");
  const admin = express.Router();
  const auth = express.Router();
  admin.use(express.json({ limit: "8kb" }));
  auth.use(express.json({ limit: "2kb" }));
  const col = () => db.collection(COLLECTION);

  /* ───── 運営 ───── */
  admin.get("/", requireOwner, async (req, res) => {
    try {
      const snap = await col().get();
      const items = snap.docs.map((d) => publicView(d.id, d.data())).sort((a, b) => a.createdAt - b.createdAt);
      res.json({ items });
    } catch (e) {
      console.error("writer-accounts list:", e.message);
      res.status(503).json({ error: "UNAVAILABLE" });
    }
  });
  admin.post("/", requireOwner, rateLimit({ windowMs: 60_000, max: 20, key: "writer-admin" }), async (req, res) => {
    const name = cleanName(req.body && req.body.name);
    if (!name) return res.status(400).json({ error: "NAME_REQUIRED" });
    try {
      const id = newId(), key = newKey(), uid = "writer:" + id;
      const doc = {
        name, note: cleanNote(req.body.note), active: true,
        uid, address: deriveAddress(uid).toLowerCase(), keyHash: hashKey(key), keyHint: keyHintOf(key),
        createdAt: now(), keyIssuedAt: now(), createdBy: req.identity.walletAddress,
      };
      await col().doc(id).create(doc);
      await setWriterGrant(db, uid, true, now);
      res.json({ account: publicView(id, doc), key });
    } catch (e) {
      console.error("writer-accounts create:", e.message);
      res.status(503).json({ error: "UNAVAILABLE" });
    }
  });
  /* キーを作り直す。前のキーはその場で使えなくなる */
  admin.post("/:id/key", requireOwner, rateLimit({ windowMs: 60_000, max: 20, key: "writer-admin" }), async (req, res) => {
    const id = String(req.params.id || "");
    if (!/^[0-9a-f]{12}$/.test(id)) return res.status(400).json({ error: "INVALID_ID" });
    try {
      const ref = col().doc(id);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: "NOT_FOUND" });
      const key = newKey();
      await ref.set({ keyHash: hashKey(key), keyHint: keyHintOf(key), keyIssuedAt: now() }, { merge: true });
      res.json({ account: publicView(id, { ...snap.data(), keyHint: keyHintOf(key), keyIssuedAt: now() }), key });
    } catch (e) {
      console.error("writer-accounts key:", e.message);
      res.status(503).json({ error: "UNAVAILABLE" });
    }
  });
  /* 名前・メモ・止める／戻す */
  admin.patch("/:id", requireOwner, rateLimit({ windowMs: 60_000, max: 30, key: "writer-admin" }), async (req, res) => {
    const id = String(req.params.id || "");
    if (!/^[0-9a-f]{12}$/.test(id)) return res.status(400).json({ error: "INVALID_ID" });
    const body = req.body || {};
    const patch = {};
    if (body.name !== undefined) {
      const name = cleanName(body.name);
      if (!name) return res.status(400).json({ error: "NAME_REQUIRED" });
      patch.name = name;
    }
    if (body.note !== undefined) patch.note = cleanNote(body.note);
    if (body.active !== undefined) patch.active = body.active === true;
    if (!Object.keys(patch).length) return res.status(400).json({ error: "NOTHING_TO_CHANGE" });
    try {
      const ref = col().doc(id);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: "NOT_FOUND" });
      await ref.set(patch, { merge: true });
      // 名前を変えたら、アカウントの表示名も合わせる（次に開いたときから、その名前で投稿される）
      if (patch.name) await db.collection("ches_accounts").doc(snap.data().uid).set({ displayName: patch.name }, { merge: true });
      // 止めたら公開できる段も切る。戻したら付け直す
      if (patch.active !== undefined) { await setWriterGrant(db, snap.data().uid, patch.active, now); forgetEntitlement(snap.data().uid); }
      // 止めたら、いま持っているログインの証も使えなくする
      if (patch.active === false && firebaseAdmin) await firebaseAdmin.auth().revokeRefreshTokens(snap.data().uid).catch(() => {});
      res.json({ account: publicView(id, { ...snap.data(), ...patch }) });
    } catch (e) {
      console.error("writer-accounts patch:", e.message);
      res.status(503).json({ error: "UNAVAILABLE" });
    }
  });

  /* ───── 書き手のログイン（キー → ログインの証） ─────

     11/23 オーナー「使えるになってるのに、入れるときと入れないときがある」。
     前は「同じ回線から10分に10回まで」だった。Muse・ChatGPT は何人分の書き手でも同じ回線から入ってくるので、
     5人×2つの道具が入り直すとすぐ上限に当たり、正しいキーでも断られていた（429）。
     回数はキーごとに数える（1つのキーで10分に20回まで）。回線ごとの上限は、総当たりを止めるためだけに広めに残す。
     キーは 192 ビットの乱数なので、回線の上限を広げても当て推量では入れない。 */
  const KEY_WINDOW_MS = 10 * 60_000, KEY_MAX = 20;
  const keyBuckets = new Map();
  function keyLimited(keyHash) {
    const t = now();
    if (keyBuckets.size > 2000) for (const [k, b] of keyBuckets) if (b.resetAt <= t) keyBuckets.delete(k);
    let b = keyBuckets.get(keyHash);
    if (!b || b.resetAt <= t) b = { count: 0, resetAt: t + KEY_WINDOW_MS };
    b.count += 1;
    keyBuckets.set(keyHash, b);
    return b.count > KEY_MAX ? b.resetAt - t : 0;
  }
  auth.post("/writer", rateLimit({ windowMs: 10 * 60_000, max: 120, key: "writer-login" }), async (req, res) => {
    const key = String((req.body && req.body.key) || "").trim();
    if (!KEY_FORMAT.test(key)) return res.status(401).json({ error: "INVALID_WRITER_KEY" });
    if (!firebaseAdmin) return res.status(503).json({ error: "AUTH_UNAVAILABLE" });
    const wait = keyLimited(hashKey(key));
    if (wait) return res.status(429).json({ error: "RATE_LIMITED", retryAfterMs: wait });
    try {
      const snap = await col().where("keyHash", "==", hashKey(key)).limit(1).get();
      const d = snap.docs[0];
      /* 11/24：前は「無いキー」と「止めた書き手」を同じ返事にしていたので、画面は「違うか、止められています」としか言えなかった。
         止めた書き手のキーを持っている人には、止められていると伝えても何も漏れない。分けて返す。 */
      if (!d) {
        console.warn("writer login: 一致する書き手キーがありません（末尾 …" + keyHintOf(key) + "）");
        return res.status(401).json({ error: "INVALID_WRITER_KEY" });
      }
      if (d.data().active === false) return res.status(403).json({ error: "WRITER_DISABLED" });
      const v = d.data();
      /* 目印が無い書き手（11/24 より前に作ったキー）は、正しいキーで入ったときに目印を残す */
      await col().doc(d.id).set(v.keyHint ? { lastLoginAt: now() } : { lastLoginAt: now(), keyHint: keyHintOf(key) }, { merge: true }).catch(() => {});
      /* 段を付ける前に作った書き手（11/18 より前）にも、ログインのときに付ける */
      await setWriterGrant(db, v.uid, true, now);
      forgetEntitlement(v.uid);
      const firebaseToken = await firebaseAdmin.auth().createCustomToken(v.uid, { provider: "writer", name: v.name });
      res.json({ firebaseToken, profile: { name: v.name, picture: "", email: "" } });
    } catch (e) {
      console.error("writer login:", e.message);
      res.status(503).json({ error: "UNAVAILABLE" });
    }
  });

  return { admin, auth };
}

/* ログインのたびに、書き手かどうかの印を確かめる（verified-platform.js から呼ぶ）。止めた書き手は入れない */
async function writerStatus(db, uid) {
  if (!String(uid || "").startsWith("writer:")) return null;
  const snap = await db.collection(COLLECTION).doc(String(uid).slice(7)).get();
  if (!snap.exists) return { active: false };
  return { active: snap.data().active !== false, name: snap.data().name || "" };
}

module.exports = { createWriterAccountsRouter, writerStatus, setWriterGrant, hashKey, deriveAddress, KEY_FORMAT, WRITER_PLAN };
