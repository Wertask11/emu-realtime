"use strict";

/* ───────── Camellia：招待と利用停止 ─────────

   Camellia は女性限定。入口で「私は女性です」と自己申告してもらい、
   さらに招待コードを持っている人だけが入れるようにできる（招待制）。

   置き場所（どれも利用者の画面からは読めない・書けない）
     camellia_admin/release_phase1/config/access        招待制の入り切り
       inviteRequired  true なら、招待コードが無い新しい人は入れない
       requiredSince   招待制を入れた時刻（ミリ秒）。これより前に入った人はそのまま使える
     camellia_admin/release_phase1/invites/{コード}      招待コード
       kind  operator（運営が配る。営業の配り先ごとに作る）／member（利用者が友だちに配る）
       label 配り先の名前（英小文字・数字・-_ だけ。PostHog の集計にも使う）
     camellia_admin/release_phase1/invites/{コード}/uses/{uid}  誰が使ったか
     camellia_admin/release_phase1/member_invites/{uid}  その人が配っているコード
     camellia_admin/release_phase1/suspended/{uid}       止めている人の一覧（運営画面用）
     camellia_admin/release_phase1/access_audit          運営が何をしたか

   その人に効かせるもの
     camellia_users/{uid}/admin/access
       admitted     招待コードで入った
       suspended    利用を止めた（対象外と分かったとき・規約違反のとき）
     本人は読めるが書けない（firestore.rules の admin/{docId}）。

   「すでに入っていた人」は、Camellia の記録（camellia_users/{uid}）が
   招待制を入れる前に作られているかで決める。作られた時刻は Firestore が
   自分で持っている値（createTime）なので、画面から書き換えられない。
   Camellia 側のサーバー（チャット・Circle）も同じ決め方をする。変えるときは両方変えること。 */

const express = require("express");
const { randomBytes } = require("crypto");

const CODE_CHARS = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // 読み違えやすい 0 O 1 I は使わない
const CODE_LENGTH = 8;
const MEMBER_INVITE_USES = 3;
const MAX_OPERATOR_USES = 1000;
const MAX_EXPIRY_DAYS = 365;
const SUSPEND_REASONS = ["not_eligible", "terms", "other"];
const CAMELLIA_ORIGIN = "https://camellia-beta.vercel.app";

function makeCode() {
  const buf = randomBytes(CODE_LENGTH);
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) out += CODE_CHARS[buf[i] % CODE_CHARS.length];
  return out;
}
/* 「k7qm-2xpa」「K7QM 2XPA」のように打たれても同じコードにする。 */
function normalizeCode(value) {
  const code = String(value || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (code.length !== CODE_LENGTH) return "";
  for (const ch of code) if (CODE_CHARS.indexOf(ch) < 0) return "";
  return code;
}
/* Camellia の PostHog は、utm_campaign を「英字で始まり、数字が7つ続かない」ものだけ受け取る
   （電話番号などを送らないため。camellia-beta の lib/analytics/attribution.ts）。同じ形に合わせる。 */
function normalizeLabel(value) {
  const label = String(value || "").trim().toLowerCase();
  return /^[a-z][a-z0-9_-]{0,31}$/.test(label) && !/\d{7}/.test(label) ? label : "";
}
function inviteUrl(code, kind, label) {
  const url = new URL(CAMELLIA_ORIGIN + "/");
  url.searchParams.set("invite", code);
  url.searchParams.set("utm_source", kind === "member" ? "member_invite" : "invite");
  if (kind !== "member" && label) url.searchParams.set("utm_campaign", label);
  return url.toString();
}
function millisOf(value) {
  if (!value) return null;
  if (typeof value.toMillis === "function") return value.toMillis();
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function accessError(code, status) {
  const error = new Error(code);
  error.status = status;
  return error;
}

function createCamelliaAccess({ db }) {
  const base = () => db.collection("camellia_admin").doc("release_phase1");
  const configRef = () => base().collection("config").doc("access");
  const inviteRef = (code) => base().collection("invites").doc(code);
  const memberInviteRef = (uid) => base().collection("member_invites").doc(uid);
  const suspendedRef = (uid) => base().collection("suspended").doc(uid);
  const userAccessRef = (uid) => db.collection("camellia_users").doc(uid).collection("admin").doc("access");
  const audit = (entry) => base().collection("access_audit").add({ ...entry, at: Date.now() }).catch(() => {});

  async function readConfig() {
    const snap = await configRef().get();
    const data = (snap.exists && snap.data()) || {};
    return {
      inviteRequired: data.inviteRequired === true,
      requiredSince: Number(data.requiredSince) || 0,
      updatedAt: data.updatedAt || null
    };
  }

  /* その人がいま Camellia を使えるか。画面・チャット・Circle の判定はすべてここと同じ。 */
  async function statusFor(uid) {
    const [config, rootSnap, accessSnap] = await Promise.all([
      readConfig(),
      db.collection("camellia_users").doc(uid).get(),
      userAccessRef(uid).get()
    ]);
    const root = (rootSnap.exists && rootSnap.data()) || {};
    const access = (accessSnap.exists && accessSnap.data()) || {};
    const createdAt = rootSnap.exists ? millisOf(rootSnap.createTime) : null;
    const existing = config.requiredSince > 0 && createdAt !== null && createdAt < config.requiredSince;
    const admitted = access.admitted === true || existing;
    return {
      inviteRequired: config.inviteRequired,
      admitted,
      via: access.admitted === true ? (access.via || "invite") : existing ? "existing" : null,
      needsInvite: config.inviteRequired && !admitted,
      suspended: access.suspended === true,
      profileComplete: typeof root.agreedAt === "string" && root.agreedAt !== "",
      womanSelfDeclared: root.womanSelfDeclared === true
    };
  }

  async function redeem(uid, rawCode) {
    const code = normalizeCode(rawCode);
    if (!code) throw accessError("INVITE_INVALID", 400);
    const current = await statusFor(uid);
    if (current.suspended) throw accessError("SUSPENDED", 403);
    /* すでに入れる人は、コードを使い切らせない。 */
    if (current.admitted) return { ok: true, already: true, kind: null, label: "" };
    const now = Date.now();
    return db.runTransaction(async (tx) => {
      const [inviteSnap, accessSnap] = await Promise.all([tx.get(inviteRef(code)), tx.get(userAccessRef(uid))]);
      if (!inviteSnap.exists) throw accessError("INVITE_NOT_FOUND", 404);
      const invite = inviteSnap.data() || {};
      const access = (accessSnap.exists && accessSnap.data()) || {};
      if (access.suspended === true) throw accessError("SUSPENDED", 403);
      if (access.admitted === true) return { ok: true, already: true, kind: null, label: "" };
      if (invite.revoked === true) throw accessError("INVITE_REVOKED", 410);
      if (invite.expiresAt && Number(invite.expiresAt) < now) throw accessError("INVITE_EXPIRED", 410);
      if (invite.kind === "member" && invite.ownerUid === uid) throw accessError("INVITE_OWN", 400);
      const uses = Number(invite.uses) || 0;
      if (uses >= (Number(invite.maxUses) || 0)) throw accessError("INVITE_USED_UP", 410);
      const kind = invite.kind === "member" ? "member" : "operator";
      tx.set(inviteRef(code), { uses: uses + 1, lastUsedAt: now }, { merge: true });
      tx.set(inviteRef(code).collection("uses").doc(uid), { uid, at: now });
      tx.set(userAccessRef(uid), {
        admitted: true,
        via: "invite",
        inviteCode: code,
        inviteKind: kind,
        inviteLabel: kind === "operator" ? (invite.label || "") : "",
        invitedBy: kind === "member" ? (invite.ownerUid || "") : (invite.createdBy || "operator"),
        admittedAt: now
      }, { merge: true });
      return { ok: true, already: false, kind, label: kind === "operator" ? (invite.label || "") : "" };
    });
  }

  function publicInvite(code, data) {
    const d = data || {};
    return {
      code,
      kind: d.kind === "member" ? "member" : "operator",
      label: d.label || "",
      uses: Number(d.uses) || 0,
      maxUses: Number(d.maxUses) || 0,
      expiresAt: d.expiresAt || null,
      revoked: d.revoked === true,
      createdAt: d.createdAt || null,
      url: inviteUrl(code, d.kind, d.label)
    };
  }

  async function createInvite(data) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = makeCode();
      try {
        await inviteRef(code).create({ ...data, code, uses: 0, revoked: false, createdAt: Date.now() });
        return code;
      } catch (error) {
        if (error && (error.code === 6 || /ALREADY_EXISTS/.test(String(error.message)))) continue;
        throw error;
      }
    }
    throw accessError("INVITE_CREATE_FAILED", 500);
  }

  /* 利用者が友だちへ配るコード。1人1つ、3人まで。
     女性の自己申告とプロフィールを済ませ、止められていない人だけが作れる。 */
  async function memberInvite(uid, { create } = {}) {
    const status = await statusFor(uid);
    if (status.suspended) throw accessError("SUSPENDED", 403);
    if (status.needsInvite) throw accessError("INVITE_REQUIRED", 403);
    if (!status.profileComplete || !status.womanSelfDeclared) throw accessError("PROFILE_REQUIRED", 403);
    const mine = await memberInviteRef(uid).get();
    let code = mine.exists ? (mine.data() || {}).code : "";
    if (!code) {
      if (!create) return null;
      code = await createInvite({ kind: "member", label: "", maxUses: MEMBER_INVITE_USES, ownerUid: uid, expiresAt: null, createdBy: uid });
      await memberInviteRef(uid).set({ code, createdAt: Date.now() });
    }
    const snap = await inviteRef(code).get();
    return publicInvite(code, snap.data());
  }

  /* ── 運営の操作 ── */
  async function setInviteRequired(on, by) {
    const config = await readConfig();
    const patch = { inviteRequired: !!on, updatedAt: Date.now(), updatedBy: by };
    /* 入れ直すたびに区切りを今にする。切っていたあいだに入った人も、そのまま使える。 */
    if (on && !config.inviteRequired) patch.requiredSince = Date.now();
    await configRef().set(patch, { merge: true });
    await audit({ action: on ? "invite_required.on" : "invite_required.off", by });
    return readConfig();
  }

  async function createOperatorInvite({ label, maxUses, expiresInDays }, by) {
    const cleanLabel = normalizeLabel(label);
    if (!cleanLabel) throw accessError("LABEL_INVALID", 400);
    const uses = Math.floor(Number(maxUses));
    if (!(uses >= 1 && uses <= MAX_OPERATOR_USES)) throw accessError("MAX_USES_INVALID", 400);
    const days = Math.floor(Number(expiresInDays) || 0);
    if (days < 0 || days > MAX_EXPIRY_DAYS) throw accessError("EXPIRY_INVALID", 400);
    const expiresAt = days ? Date.now() + days * 86_400_000 : null;
    const code = await createInvite({ kind: "operator", label: cleanLabel, maxUses: uses, expiresAt, createdBy: by });
    await audit({ action: "invite.create", by, code, label: cleanLabel, maxUses: uses, expiresAt });
    return publicInvite(code, (await inviteRef(code).get()).data());
  }

  async function revokeInvite(rawCode, by) {
    const code = normalizeCode(rawCode);
    if (!code) throw accessError("INVITE_INVALID", 400);
    const snap = await inviteRef(code).get();
    if (!snap.exists) throw accessError("INVITE_NOT_FOUND", 404);
    await inviteRef(code).set({ revoked: true, revokedAt: Date.now(), revokedBy: by }, { merge: true });
    await audit({ action: "invite.revoke", by, code });
    return publicInvite(code, (await inviteRef(code).get()).data());
  }

  async function listInvites() {
    const snap = await base().collection("invites").limit(500).get();
    return snap.docs.map((doc) => publicInvite(doc.id, doc.data()))
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  /* uid でも Camellia ID（CAM-XXXX-XXXX-XXXX）でも探せるようにする。 */
  async function resolveUid(value) {
    const raw = String(value || "").trim();
    if (/^CAM-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/i.test(raw)) {
      const found = await db.collection("camellia_users").where("camelliaId", "==", raw.toUpperCase()).limit(2).get();
      if (found.size !== 1) throw accessError("USER_NOT_FOUND", 404);
      return found.docs[0].id;
    }
    if (!/^[A-Za-z0-9:_-]{1,128}$/.test(raw)) throw accessError("UID_INVALID", 400);
    const root = await db.collection("camellia_users").doc(raw).get();
    if (!root.exists) throw accessError("USER_NOT_FOUND", 404);
    return raw;
  }

  async function suspend(target, reason, by) {
    if (SUSPEND_REASONS.indexOf(reason) < 0) throw accessError("REASON_INVALID", 400);
    const uid = await resolveUid(target);
    const at = Date.now();
    await userAccessRef(uid).set({ suspended: true, suspendedReason: reason, suspendedAt: at, suspendedBy: by }, { merge: true });
    const root = (await db.collection("camellia_users").doc(uid).get()).data() || {};
    await suspendedRef(uid).set({ uid, camelliaId: root.camelliaId || "", reason, suspendedAt: at, suspendedBy: by });
    await audit({ action: "user.suspend", by, uid, reason });
    return { uid, ...(await statusFor(uid)) };
  }

  async function restore(target, by) {
    const uid = await resolveUid(target);
    await userAccessRef(uid).set({ suspended: false, restoredAt: Date.now(), restoredBy: by }, { merge: true });
    await suspendedRef(uid).delete();
    await audit({ action: "user.restore", by, uid });
    return { uid, ...(await statusFor(uid)) };
  }

  async function listSuspended() {
    const snap = await base().collection("suspended").limit(500).get();
    return snap.docs.map((doc) => {
      const d = doc.data() || {};
      return { uid: doc.id, camelliaId: d.camelliaId || "", reason: d.reason || "", suspendedAt: d.suspendedAt || null };
    }).sort((a, b) => (b.suspendedAt || 0) - (a.suspendedAt || 0));
  }

  return {
    statusFor, redeem, memberInvite,
    readConfig, setInviteRequired, createOperatorInvite, revokeInvite, listInvites,
    suspend, restore, listSuspended
  };
}

function sendError(res, error, fallback) {
  if (error && error.status) return res.status(error.status).json({ error: error.message });
  console.error(fallback, error && error.message);
  return res.status(500).json({ error: fallback });
}

/* 運営だけが使う。membership-admin.html の Camellia の欄から呼ぶ。 */
function createCamelliaAccessAdminRouter({ db, requireOwner, rateLimit }) {
  const router = express.Router();
  const access = createCamelliaAccess({ db });
  const limit = rateLimit ? rateLimit({ windowMs: 60_000, max: 30, key: "camellia-access-admin" }) : (req, res, next) => next();
  const who = (req) => (req.identity && req.identity.uid) || "admin";

  router.get("/", requireOwner, async (_req, res) => {
    try {
      const [config, invites, suspended] = await Promise.all([access.readConfig(), access.listInvites(), access.listSuspended()]);
      return res.json({ ok: true, config, invites, suspended });
    } catch (error) { return sendError(res, error, "CAMELLIA_ACCESS_FAILED"); }
  });
  router.post("/config", requireOwner, limit, async (req, res) => {
    try { return res.json({ ok: true, config: await access.setInviteRequired((req.body || {}).inviteRequired === true, who(req)) }); }
    catch (error) { return sendError(res, error, "CAMELLIA_ACCESS_CONFIG_FAILED"); }
  });
  router.post("/invites", requireOwner, limit, async (req, res) => {
    try { return res.json({ ok: true, invite: await access.createOperatorInvite(req.body || {}, who(req)) }); }
    catch (error) { return sendError(res, error, "CAMELLIA_INVITE_CREATE_FAILED"); }
  });
  router.post("/invites/revoke", requireOwner, limit, async (req, res) => {
    try { return res.json({ ok: true, invite: await access.revokeInvite((req.body || {}).code, who(req)) }); }
    catch (error) { return sendError(res, error, "CAMELLIA_INVITE_REVOKE_FAILED"); }
  });
  router.post("/suspend", requireOwner, limit, async (req, res) => {
    const b = req.body || {};
    try { return res.json({ ok: true, user: await access.suspend(b.user, b.reason, who(req)) }); }
    catch (error) { return sendError(res, error, "CAMELLIA_SUSPEND_FAILED"); }
  });
  router.post("/restore", requireOwner, limit, async (req, res) => {
    try { return res.json({ ok: true, user: await access.restore((req.body || {}).user, who(req)) }); }
    catch (error) { return sendError(res, error, "CAMELLIA_RESTORE_FAILED"); }
  });
  return router;
}

module.exports = {
  createCamelliaAccess, createCamelliaAccessAdminRouter, sendError,
  normalizeCode, normalizeLabel, inviteUrl, MEMBER_INVITE_USES, SUSPEND_REASONS
};
