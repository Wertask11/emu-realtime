"use strict";

/* 運営の書き手アカウント（11/18 オーナー）

   オーナーの代わりに、ほかの道具（ChatGPT・Muse など）が「書き手」として本番に投稿する。
   オーナーのアカウントで入ると、オーナーが書いたことになってしまうので、書き手ごとに別のアカウントを運営画面で作る。

   ・作れるのは運営（requireOwner）だけ。作ると「書き手キー」を1回だけ見せる（記録にはキーのハッシュしか残さない）
   ・書き手はログイン画面の「書き手キーで入る」にキーを入れる。サーバーが確かめて、uid「writer:<ID>」でログインの証を出す
     （LINE と同じ、サーバーが発行する証。メールや外部のログインは要らない）
   ・止める・キーを作り直す（前のキーは使えなくなる）・名前を変えるができる
   ・投稿には、運営画面で付けた名前だけが出る（11/18 オーナー：「運営の書き手」の印は付けない）
   ・運営の権限は持たない（requireOwner のアドレスとは別。書き手のアドレスは uid から決まる） */

const crypto = require("crypto");
const ethers = require("ethers");

const COLLECTION = "writer_accounts";
const deriveAddress = (uid) => ethers.utils.getAddress("0x" + ethers.utils.keccak256(ethers.utils.toUtf8Bytes("ches-wallet:v1:" + uid)).slice(-40));
const hashKey = (key) => crypto.createHash("sha256").update("emu-writer-key:v1:" + String(key || "")).digest("hex");
const newKey = () => "emw_" + crypto.randomBytes(24).toString("base64url");
const newId = () => crypto.randomBytes(6).toString("hex");
const KEY_FORMAT = /^emw_[A-Za-z0-9_-]{32}$/;

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
  };
}

function createWriterAccountsRouter({ db, firebaseAdmin, requireOwner, rateLimit, now = Date.now }) {
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
        uid, address: deriveAddress(uid).toLowerCase(), keyHash: hashKey(key),
        createdAt: now(), keyIssuedAt: now(), createdBy: req.identity.walletAddress,
      };
      await col().doc(id).create(doc);
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
      await ref.set({ keyHash: hashKey(key), keyIssuedAt: now() }, { merge: true });
      res.json({ account: publicView(id, { ...snap.data(), keyIssuedAt: now() }), key });
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
      // 止めたら、いま持っているログインの証も使えなくする
      if (patch.active === false && firebaseAdmin) await firebaseAdmin.auth().revokeRefreshTokens(snap.data().uid).catch(() => {});
      res.json({ account: publicView(id, { ...snap.data(), ...patch }) });
    } catch (e) {
      console.error("writer-accounts patch:", e.message);
      res.status(503).json({ error: "UNAVAILABLE" });
    }
  });

  /* ───── 書き手のログイン（キー → ログインの証） ───── */
  auth.post("/writer", rateLimit({ windowMs: 10 * 60_000, max: 10, key: "writer-login" }), async (req, res) => {
    const key = String((req.body && req.body.key) || "").trim();
    if (!KEY_FORMAT.test(key)) return res.status(401).json({ error: "INVALID_WRITER_KEY" });
    if (!firebaseAdmin) return res.status(503).json({ error: "AUTH_UNAVAILABLE" });
    try {
      const snap = await col().where("keyHash", "==", hashKey(key)).limit(1).get();
      const d = snap.docs[0];
      if (!d || d.data().active === false) return res.status(401).json({ error: "INVALID_WRITER_KEY" });
      const v = d.data();
      await col().doc(d.id).set({ lastLoginAt: now() }, { merge: true }).catch(() => {});
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

module.exports = { createWriterAccountsRouter, writerStatus, hashKey, deriveAddress, KEY_FORMAT };
