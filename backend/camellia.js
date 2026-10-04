"use strict";

const express = require("express");
const crypto = require("crypto");

const USERS = "camellia_official_users";
const AUDIT = "admin_audit_logs";
const CONSENT_VERSION = "camellia-server-storage-v1";
const ARRAY_COLLECTIONS = [
  "checkins", "actions", "actionFeedback", "savedActions",
  "contextualMemory", "insights", "insightFeedback", "fortunes",
  "analyticsEvents"
];

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function safeId(value) {
  const id = String(value || "");
  return /^[A-Za-z0-9_-]{1,160}$/.test(id) ? id : "";
}

function clean(value, depth) {
  if (depth > 12 || value === undefined) return null;
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(v => clean(v, depth + 1));
  if (typeof value === "object") {
    const out = {};
    Object.keys(value).forEach(k => { out[k] = clean(value[k], depth + 1); });
    return out;
  }
  return String(value);
}

function jsonValue(value) {
  if (value && typeof value.toDate === "function") return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(jsonValue);
  if (value && typeof value === "object") {
    const out = {};
    Object.keys(value).forEach(k => { out[k] = jsonValue(value[k]); });
    return out;
  }
  return value;
}

function validateConsent(consent) {
  if (!consent || consent.version !== CONSENT_VERSION) return false;
  const at = Date.parse(String(consent.acceptedAt || ""));
  return Number.isFinite(at) && at <= Date.now() + 5 * 60_000;
}

function validateState(input) {
  if (!input || input.version !== 3 || !input.profile || !safeId(input.profile.id)) return null;
  const state = clean(input, 0);
  if (!state || JSON.stringify(state).length > 8 * 1024 * 1024) return null;
  return state;
}

function flattenState(state) {
  const collections = {};
  ARRAY_COLLECTIONS.forEach(name => { collections[name] = Array.isArray(state[name]) ? state[name] : []; });
  collections.aiConversations = [];
  collections.aiMessages = [];
  (state.aiConversations || []).forEach(conversation => {
    if (!safeId(conversation.id)) return;
    collections.aiConversations.push({
      id: conversation.id, createdAt: conversation.createdAt || "", updatedAt: conversation.updatedAt || ""
    });
    (conversation.messages || []).forEach(message => {
      if (!safeId(message.id)) return;
      collections.aiMessages.push(Object.assign({}, message, { conversationId: conversation.id }));
    });
  });
  collections.treeLeaves = [];
  collections.treeReflections = [];
  (state.treeLeaves || []).forEach(leaf => {
    if (!safeId(leaf.id)) return;
    const copy = Object.assign({}, leaf);
    delete copy.reflections;
    collections.treeLeaves.push(copy);
    (leaf.reflections || []).forEach(reflection => {
      if (!safeId(reflection.id)) return;
      collections.treeReflections.push(Object.assign({}, reflection, { leafId: leaf.id }));
    });
  });
  return collections;
}

async function replaceCollection(db, root, name, rows) {
  const ref = root.collection(name);
  const current = await ref.get();
  const wanted = new Map();
  rows.forEach((row, index) => {
    const id = safeId(row && (row.id || row.date)) || `row_${index}`;
    wanted.set(id, row);
  });
  const operations = [];
  current.forEach(doc => { if (!wanted.has(doc.id)) operations.push({ type: "delete", ref: doc.ref }); });
  wanted.forEach((row, id) => operations.push({ type: "set", ref: ref.doc(id), data: row }));
  for (let i = 0; i < operations.length; i += 400) {
    const batch = db.batch();
    operations.slice(i, i + 400).forEach(op => op.type === "delete" ? batch.delete(op.ref) : batch.set(op.ref, op.data));
    await batch.commit();
  }
}

async function deleteUserTree(db, root) {
  const names = [...ARRAY_COLLECTIONS, "aiConversations", "aiMessages", "treeLeaves", "treeReflections"];
  for (const name of names) await replaceCollection(db, root, name, []);
  await root.delete();
}

function createCamelliaRouter(deps) {
  const { db, requireOwner, rateLimit } = deps;
  const router = express.Router();
  const registerLimit = rateLimit({ windowMs: 60 * 60_000, max: 10, key: "camellia-official-register" });
  const syncLimit = rateLimit({ windowMs: 60_000, max: 30, key: "camellia-official-sync" });

  function available(req, res, next) {
    if (!db) return res.status(503).json({ error: "CAMELLIA_STORAGE_UNAVAILABLE" });
    next();
  }

  function requireCamelliaOrigin(req, res, next) {
    const origin = String(req.headers.origin || "");
    if (!origin || origin === "https://camellia-beta.vercel.app" || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))
      return next();
    return res.status(403).json({ error: "CAMELLIA_ORIGIN_NOT_ALLOWED" });
  }

  async function authenticateInstall(req, res, next) {
    try {
      const id = safeId(req.headers["x-camellia-user"] || req.params.userId);
      const header = String(req.headers.authorization || "");
      const token = header.startsWith("Bearer ") ? header.slice(7) : "";
      if (!id || token.length < 32) return res.status(401).json({ error: "CAMELLIA_AUTH_REQUIRED" });
      const ref = db.collection(USERS).doc(id);
      const snap = await ref.get();
      if (!snap.exists) return res.status(401).json({ error: "CAMELLIA_USER_NOT_FOUND" });
      const actual = Buffer.from(hashToken(token));
      const expected = Buffer.from(String(snap.data().tokenHash || ""));
      if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected))
        return res.status(401).json({ error: "CAMELLIA_AUTH_INVALID" });
      req.camelliaUser = { id, ref, data: snap.data() };
      next();
    } catch (e) {
      return res.status(500).json({ error: "CAMELLIA_AUTH_FAILED" });
    }
  }

  router.post("/register", available, requireCamelliaOrigin, registerLimit, async (req, res) => {
    try {
      if (!validateConsent(req.body && req.body.consent))
        return res.status(412).json({ error: "CAMELLIA_STORAGE_CONSENT_REQUIRED", consentVersion: CONSENT_VERSION });
      const profileId = safeId(req.body && req.body.profileId);
      if (!profileId) return res.status(400).json({ error: "INVALID_PROFILE_ID" });
      const id = `cam_${crypto.randomUUID().replace(/-/g, "")}`;
      const token = crypto.randomBytes(32).toString("base64url");
      await db.collection(USERS).doc(id).set({
        id, sourceProfileId: profileId, tokenHash: hashToken(token), schemaVersion: 1,
        consent: clean(req.body.consent, 0), createdAt: new Date(), updatedAt: new Date(), lastSyncAt: null,
        status: "active"
      });
      return res.status(201).json({ userId: id, token, schemaVersion: 1 });
    } catch (e) {
      console.error("camellia official register error:", e.message);
      return res.status(500).json({ error: "CAMELLIA_REGISTER_FAILED" });
    }
  });

  router.put("/state", available, requireCamelliaOrigin, syncLimit, authenticateInstall, async (req, res) => {
    try {
      if (!validateConsent(req.body && req.body.consent))
        return res.status(412).json({ error: "CAMELLIA_STORAGE_CONSENT_REQUIRED", consentVersion: CONSENT_VERSION });
      const state = validateState(req.body && req.body.state);
      if (!state) return res.status(400).json({ error: "INVALID_CAMELLIA_STATE" });
      if (state.profile.id !== req.camelliaUser.data.sourceProfileId)
        return res.status(409).json({ error: "PROFILE_ID_MISMATCH" });
      const collections = flattenState(state);
      for (const [name, rows] of Object.entries(collections))
        await replaceCollection(db, req.camelliaUser.ref, name, rows);
      const counts = {};
      Object.keys(collections).forEach(name => { counts[name] = collections[name].length; });
      await req.camelliaUser.ref.set({
        profile: state.profile, onboardingComplete: !!state.onboardingComplete,
        stateCreatedAt: state.createdAt || "", stateUpdatedAt: state.updatedAt || "",
        consent: clean(req.body.consent, 0), counts, lastSyncAt: new Date(), updatedAt: new Date(), schemaVersion: 1
      }, { merge: true });
      return res.json({ ok: true, counts });
    } catch (e) {
      console.error("camellia official sync error:", e.message);
      return res.status(500).json({ error: "CAMELLIA_SYNC_FAILED" });
    }
  });

  router.delete("/state", available, requireCamelliaOrigin, syncLimit, authenticateInstall, async (req, res) => {
    try {
      await deleteUserTree(db, req.camelliaUser.ref);
      await db.collection(AUDIT).add({ action: "camellia.official.user_delete", target: req.camelliaUser.id, createdAt: new Date() });
      return res.json({ ok: true });
    } catch (e) {
      console.error("camellia official delete error:", e.message);
      return res.status(500).json({ error: "CAMELLIA_DELETE_FAILED" });
    }
  });

  router.get("/admin/users", available, requireOwner, async (req, res) => {
    try {
      const snap = await db.collection(USERS).orderBy("updatedAt", "desc").limit(500).get();
      const users = [];
      snap.forEach(doc => {
        const d = doc.data() || {};
        delete d.tokenHash;
        users.push(jsonValue(Object.assign({ id: doc.id }, d)));
      });
      await db.collection(AUDIT).add({ action: "camellia.official.admin_list", by: req.identity.uid, count: users.length, createdAt: new Date() });
      return res.json({ users });
    } catch (e) {
      console.error("camellia official admin list error:", e.message);
      return res.status(500).json({ error: "CAMELLIA_ADMIN_LIST_FAILED" });
    }
  });

  router.get("/admin/users/:userId", available, requireOwner, async (req, res) => {
    try {
      const id = safeId(req.params.userId);
      if (!id) return res.status(400).json({ error: "INVALID_USER_ID" });
      const root = db.collection(USERS).doc(id);
      const snap = await root.get();
      if (!snap.exists) return res.status(404).json({ error: "CAMELLIA_USER_NOT_FOUND" });
      const data = snap.data() || {};
      delete data.tokenHash;
      const names = [...ARRAY_COLLECTIONS, "aiConversations", "aiMessages", "treeLeaves", "treeReflections"];
      const collections = {};
      await Promise.all(names.map(async name => {
        const rows = await root.collection(name).get();
        collections[name] = rows.docs.map(doc => jsonValue(Object.assign({ id: doc.id }, doc.data() || {})));
      }));
      await db.collection(AUDIT).add({ action: "camellia.official.admin_view", by: req.identity.uid, target: id, createdAt: new Date() });
      return res.json({ user: jsonValue(Object.assign({ id }, data)), collections });
    } catch (e) {
      console.error("camellia official admin detail error:", e.message);
      return res.status(500).json({ error: "CAMELLIA_ADMIN_DETAIL_FAILED" });
    }
  });

  return { router };
}

module.exports = {
  createCamelliaRouter, validateConsent, validateState, flattenState,
  CONSENT_VERSION, USERS
};
