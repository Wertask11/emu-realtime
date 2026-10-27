"use strict";

/* ───────── Emu for SchoolPark：運営からのギフト ─────────

   見学（無料）のままでは投稿・募集・回答・一日シェアができない。書いてみる前に
   500円の壁があると、書き手が増えない。そこで 11/1（新プランの施行日）から、
   画面の「🎁 ギフト」で次の2段を渡す。

     1. 1週間の体験   見学の人が自分で受け取る。1人1回。light を7日。
     2. 1か月の延長   体験を受け取った人が SchoolPark パスポートID を運営に送り、
                      オーナーが確かめて承認したら、light をさらに30日。1人1回。

   渡すものは、運営が手で渡すときと同じ entitlements/{uid}（entitlement.js の付与）。
   サーバーも Firestore のルールもそれを読むので、受け取った瞬間に書けるようになり、
   期限が来たら自動で見学に戻る（書いた投稿は残る）。Stripe の契約には触らない。

   置き場所（どれも利用者の画面からは読めない・書けない。firestore.rules の emu_gift.*）
     emu_gifts/{SchoolPark ID または uid_<uid>}   その人のギフトの記録
       trialClaimedAt / trialExpiresAt          体験を受け取った時刻・終わる時刻（ミリ秒）
       extensionStatus                          none / pending / approved / rejected
       extensionRequestedAt / extensionDecidedAt / extensionExpiresAt / extensionDecidedBy
     emu_gift_audit                              運営が何をしたか

   「1人1回」は SchoolPark ID で数える。まだ番号の無い人は uid で数え、あとで番号が
   できても、その番号に連携した uid の記録があれば受け取れない。
   ただし LINE と Google で別々に入り、どちらもパスポートを作らなければ別の人に見える
   （identity.js の頭に書いたとおり、機械では見分けられない）。延長はパスポートIDを
   オーナーが確かめるので、そこで止められる。 */

const express = require("express");
const membershipPolicy = require("./membership-policy");

const GIFT_COL = "emu_gifts";
const AUDIT_COL = "emu_gift_audit";
const GRANTS_COL = "entitlements";
const DAY = 24 * 60 * 60 * 1000;
/* 始まるのは新プランと同じ瞬間（日本時間 2026-11-01 0:00）。画面の EMU_GIFT_FROM と必ず同じにすること。 */
const GIFT_STARTS_AT = membershipPolicy.EFFECTIVE_AT;
const TRIAL_DAYS = 7;
const EXTENSION_DAYS = 30;
const PLAN_RANK = { guest: 0, light: 1, plus: 2, pro: 3 };

function ms(v) {
  if (!v) return 0;
  if (typeof v === "number") return v;
  if (typeof v.toMillis === "function") return v.toMillis();
  if (typeof v.toDate === "function") return v.toDate().getTime();
  if (v instanceof Date) return v.getTime();
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : 0;
}
/* 付与がいま生きていて、light 以上か。 */
function liveGrant(data, at) {
  if (!data || PLAN_RANK[data.plan] === undefined || PLAN_RANK[data.plan] < 1) return false;
  const starts = ms(data.startsAt), expires = ms(data.expiresAt);
  return !(starts && at < starts) && !(expires && at >= expires);
}

function createEmuGiftRouter({ db, requireFirebaseUser, requireOwner, entitlement, identity, rateLimit, now = Date.now }) {
  const router = express.Router();
  const signed = [requireFirebaseUser, rateLimit({ windowMs: 60_000, max: 20, key: "emu-gift" })];

  async function whoIs(uid) {
    const spid = identity && identity.findByUid ? await identity.findByUid(uid) : null;
    const uids = identity && identity.linkedUidsForUid ? await identity.linkedUidsForUid(uid) : [uid];
    const keys = [...new Set([...(spid ? [spid] : []), ...uids.map(u => "uid_" + u)])];
    return { spid, keys, key: spid || "uid_" + uid };
  }
  async function findGift(keys) {
    for (const key of keys) {
      const snap = await db.collection(GIFT_COL).doc(key).get();
      if (snap.exists) return { key, data: snap.data() || {} };
    }
    return null;
  }
  /* 受け取る・承認するときは読み直す（60秒の控えが古いと、渡したのに見学のまま見える）。
     様子を見るだけのときは控えでよい（forget は控えを全部捨てるので、毎回は呼ばない）。 */
  async function planOf(uid, account, fresh) {
    if (fresh) entitlement.forget(uid);
    return (await entitlement.getEntitlement(uid, account)).plan;
  }
  function statusOf(gift, plan, spid, at) {
    const g = gift ? gift.data : null;
    return {
      startsAt: GIFT_STARTS_AT,
      open: at >= GIFT_STARTS_AT,
      trialDays: TRIAL_DAYS,
      extensionDays: EXTENSION_DAYS,
      plan,
      schoolParkId: spid || null,
      // 見学の人だけが受け取れる。もう light 以上の人には要らない。
      canClaim: at >= GIFT_STARTS_AT && !g && plan === "guest",
      trialClaimedAt: g ? ms(g.trialClaimedAt) || null : null,
      trialExpiresAt: g ? ms(g.trialExpiresAt) || null : null,
      extensionStatus: g ? g.extensionStatus || "none" : "none",
      extensionExpiresAt: g ? ms(g.extensionExpiresAt) || null : null,
    };
  }
  async function audit(action, data) {
    try { await db.collection(AUDIT_COL).add({ action, ...data, at: new Date(now()) }); }
    catch (e) { console.warn("ギフト: 記録を残せませんでした:", e.message); }
  }

  router.get("/status", ...signed, async (req, res) => {
    try {
      const uid = req.identity.uid, at = now();
      const who = await whoIs(uid);
      const [gift, plan] = await Promise.all([findGift(who.keys), planOf(uid, req.identity.account)]);
      res.json(statusOf(gift, plan, who.spid, at));
    } catch (e) {
      console.error("ギフト status:", e.message);
      res.status(500).json({ error: "GIFT_UNAVAILABLE" });
    }
  });

  /* 1週間の体験を受け取る。 */
  router.post("/claim", ...signed, async (req, res) => {
    const uid = req.identity.uid, at = now();
    if (at < GIFT_STARTS_AT) return res.status(409).json({ error: "NOT_STARTED", startsAt: GIFT_STARTS_AT });
    if (req.identity.signInProvider === "anonymous") return res.status(403).json({ error: "SIGN_IN_REQUIRED" });
    try {
      const who = await whoIs(uid);
      if (await findGift(who.keys)) return res.status(409).json({ error: "ALREADY_CLAIMED" });
      if (await planOf(uid, req.identity.account, true) !== "guest") return res.status(409).json({ error: "ALREADY_MEMBER" });
      const expiresAt = at + TRIAL_DAYS * DAY;
      await db.runTransaction(async tx => {
        const giftRefs = who.keys.map(key => db.collection(GIFT_COL).doc(key));
        const grantRef = db.collection(GRANTS_COL).doc(uid);
        const [grant, ...gifts] = await Promise.all([tx.get(grantRef), ...giftRefs.map(ref => tx.get(ref))]);
        if (gifts.some(s => s.exists)) throw Object.assign(new Error("ALREADY_CLAIMED"), { status: 409 });
        // 運営が手で渡したものや Founding など、生きている付与は上書きしない。
        if (grant.exists && liveGrant(grant.data(), at)) throw Object.assign(new Error("ALREADY_MEMBER"), { status: 409 });
        tx.set(grantRef, {
          uid, plan: "light", source: "gift-trial",
          walletAddress: String(req.identity.walletAddress || "").toLowerCase(),
          ...(who.spid ? { spid: who.spid } : {}),
          startsAt: new Date(at), expiresAt: new Date(expiresAt),
          grantedBy: "gift", note: "運営からのギフト（" + TRIAL_DAYS + "日間の体験）", createdAt: new Date(at),
        });
        tx.set(db.collection(GIFT_COL).doc(who.key), {
          uid, spid: who.spid || null, trialClaimedAt: at, trialExpiresAt: expiresAt, extensionStatus: "none",
        });
      });
      // ルールは SchoolPark ID の参照先（membershipSources.grantUid）から付与を読む。
      // 読み直してその参照先をこの付与に向けてから返す（すぐ投稿できるように）。
      const plan = await planOf(uid, req.identity.account, true);
      await audit("trial_claimed", { uid, spid: who.spid || null, expiresAt });
      res.json({ ok: true, plan, trialExpiresAt: expiresAt });
    } catch (e) {
      if (e.status) return res.status(e.status).json({ error: e.message });
      console.error("ギフト claim:", e.message);
      res.status(500).json({ error: "GIFT_UNAVAILABLE" });
    }
  });

  /* パスポートIDを運営に送る（1か月の延長の申し込み）。番号はサーバーが持っているものを使う。
     画面で打った番号は信じない（他人の番号を送れてしまうため）。 */
  router.post("/extension", ...signed, async (req, res) => {
    const uid = req.identity.uid, at = now();
    try {
      const who = await whoIs(uid);
      if (!who.spid) return res.status(409).json({ error: "PASSPORT_REQUIRED" });
      const gift = await findGift(who.keys);
      if (!gift) return res.status(409).json({ error: "TRIAL_REQUIRED" });
      const status = gift.data.extensionStatus || "none";
      if (status !== "none") return res.status(409).json({ error: "ALREADY_REQUESTED", extensionStatus: status });
      await db.collection(GIFT_COL).doc(gift.key).set({
        extensionStatus: "pending", extensionRequestedAt: at, extensionSpid: who.spid, extensionUid: uid,
        displayName: String((req.identity.account || {}).displayName || "").slice(0, 60),
      }, { merge: true });
      await audit("extension_requested", { uid, spid: who.spid });
      res.json({ ok: true, extensionStatus: "pending", schoolParkId: who.spid });
    } catch (e) {
      console.error("ギフト extension:", e.message);
      res.status(500).json({ error: "GIFT_UNAVAILABLE" });
    }
  });

  /* ───────── 運営 ───────── */

  router.get("/admin/requests", requireOwner, async (req, res) => {
    try {
      const status = ["pending", "approved", "rejected"].includes(req.query.status) ? req.query.status : "pending";
      const snap = await db.collection(GIFT_COL).where("extensionStatus", "==", status).limit(200).get();
      const rows = [];
      snap.forEach(d => {
        const v = d.data() || {};
        rows.push({
          key: d.id, uid: v.extensionUid || v.uid || "", schoolParkId: v.extensionSpid || v.spid || "",
          displayName: v.displayName || "", trialClaimedAt: ms(v.trialClaimedAt) || null,
          trialExpiresAt: ms(v.trialExpiresAt) || null, requestedAt: ms(v.extensionRequestedAt) || null,
          decidedAt: ms(v.extensionDecidedAt) || null, extensionExpiresAt: ms(v.extensionExpiresAt) || null,
          extensionStatus: v.extensionStatus,
        });
      });
      rows.sort((a, b) => (b.requestedAt || 0) - (a.requestedAt || 0));
      const all = await db.collection(GIFT_COL).count().get();
      res.json({ rows, trialsClaimed: all.data().count });
    } catch (e) {
      console.error("ギフト admin list:", e.message);
      res.status(500).json({ error: "GIFT_UNAVAILABLE" });
    }
  });

  /* 承認すると、light を30日足す。いまの付与がまだ生きていれば、その終わりから30日。 */
  router.post("/admin/requests/:key/:decision", requireOwner, async (req, res) => {
    const { key, decision } = req.params, at = now();
    if (!["approve", "reject"].includes(decision)) return res.status(400).json({ error: "BAD_DECISION" });
    try {
      const out = await db.runTransaction(async tx => {
        const giftRef = db.collection(GIFT_COL).doc(String(key));
        const gift = await tx.get(giftRef);
        if (!gift.exists) throw Object.assign(new Error("NOT_FOUND"), { status: 404 });
        const v = gift.data() || {};
        if (v.extensionStatus !== "pending") throw Object.assign(new Error("NOT_PENDING"), { status: 409 });
        const decidedBy = String(req.identity.uid || "owner").slice(0, 120);
        if (decision === "reject") {
          tx.set(giftRef, { extensionStatus: "rejected", extensionDecidedAt: at, extensionDecidedBy: decidedBy }, { merge: true });
          return { uid: v.extensionUid || v.uid, extensionStatus: "rejected" };
        }
        const uid = v.extensionUid || v.uid;
        const grantRef = db.collection(GRANTS_COL).doc(uid);
        const grant = await tx.get(grantRef);
        const g = grant.exists ? grant.data() || {} : null;
        // plus・pro など、もっと上の付与が生きていれば触らない（下げてしまわない）。
        const stronger = g && liveGrant(g, at) && PLAN_RANK[g.plan] > PLAN_RANK.light;
        const from = g && liveGrant(g, at) && ms(g.expiresAt) ? Math.max(at, ms(g.expiresAt)) : at;
        const expiresAt = from + EXTENSION_DAYS * DAY;
        if (!stronger) {
          tx.set(grantRef, {
            uid, plan: "light", source: "gift-extension",
            walletAddress: g && g.walletAddress || "",
            ...(v.extensionSpid ? { spid: v.extensionSpid } : {}),
            startsAt: new Date(at), expiresAt: new Date(expiresAt),
            grantedBy: decidedBy, note: "運営からのギフト（パスポートID確認後の" + EXTENSION_DAYS + "日延長）", createdAt: new Date(at),
          });
        }
        tx.set(giftRef, {
          extensionStatus: "approved", extensionDecidedAt: at, extensionDecidedBy: decidedBy,
          extensionExpiresAt: stronger ? null : expiresAt,
        }, { merge: true });
        return { uid, extensionStatus: "approved", extensionExpiresAt: stronger ? null : expiresAt, keptStronger: !!stronger };
      });
      entitlement.forget(out.uid);
      // ルールが読む参照先をこの付与に向ける（承認した直後から書けるように）。
      try { await entitlement.getEntitlement(out.uid); } catch (e) { /* 次にその人が開いたときに向く */ }
      await audit("extension_" + out.extensionStatus, { key: String(key), uid: out.uid || null, by: req.identity.uid || null });
      res.json({ ok: true, ...out });
    } catch (e) {
      if (e.status) return res.status(e.status).json({ error: e.message });
      console.error("ギフト admin decide:", e.message);
      res.status(500).json({ error: "GIFT_UNAVAILABLE" });
    }
  });

  return router;
}

module.exports = { createEmuGiftRouter, GIFT_STARTS_AT, TRIAL_DAYS, EXTENSION_DAYS, GIFT_COL };
