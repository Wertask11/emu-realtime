"use strict";

const express = require("express");
const { createHash, randomBytes, randomUUID } = require("crypto");

const TICKET_TTL_MS = 5 * 60 * 1000;
const hash = (value) => createHash("sha256").update(String(value)).digest("hex");

function createCamelliaAuthRouter({ db, firebaseAdmin, identity, requireFirebaseUser }) {
  const router = express.Router();

  async function optionalUser(req) {
    const value = String(req.headers.authorization || "");
    if (!value.startsWith("Bearer ") || !firebaseAdmin) return null;
    try { return await firebaseAdmin.auth().verifyIdToken(value.slice(7)); } catch (_) { return null; }
  }

  async function canonicalFor(provider, subject, requestedUid) {
    const key = `${provider}:${subject}`;
    const ref = db.collection("camellia_auth_identities").doc(hash(key));
    const snap = await ref.get();
    if (snap.exists) {
      const current = snap.data().camelliaUid;
      if (requestedUid && requestedUid !== current) {
        const error = new Error("IDENTITY_LINKED_TO_OTHER"); error.status = 409; throw error;
      }
      return current;
    }
    const camelliaUid = requestedUid || `camellia:${randomUUID()}`;
    await ref.create({ provider, subjectHash: hash(subject), camelliaUid, createdAt: Date.now() });
    const userRef = db.collection("camellia_auth_users").doc(camelliaUid);
    const userSnap = await userRef.get();
    const providers = { ...((userSnap.exists && userSnap.data().identities) || {}), [provider]: true };
    await userRef.set({ uid: camelliaUid, updatedAt: Date.now(), identities: providers }, { merge: true });
    return camelliaUid;
  }

  async function tokenFor(uid, provider, extra) {
    return firebaseAdmin.auth().createCustomToken(uid, { provider, camellia: true, ...(extra || {}) });
  }


  router.post("/line", async (req, res) => {
    const { code, redirectUri, nonce } = req.body || {};
    const channelId = process.env.LINE_CHANNEL_ID;
    const secret = process.env.LINE_CHANNEL_SECRET;
    if (!code || !redirectUri || !nonce) return res.status(400).json({ error: "MISSING_PARAMS" });
    if (!channelId || !secret || !db || !firebaseAdmin) return res.status(503).json({ error: "AUTH_UNAVAILABLE" });
    try {
      const tokenRes = await fetch("https://api.line.me/oauth2/v2.1/token", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri,
          client_id: channelId, client_secret: secret }).toString()
      });
      const token = await tokenRes.json();
      if (!tokenRes.ok || !token.id_token) return res.status(401).json({ error: "LINE_TOKEN_FAILED" });
      const verifyRes = await fetch("https://api.line.me/oauth2/v2.1/verify", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ id_token: token.id_token, client_id: channelId, nonce }).toString()
      });
      const profile = await verifyRes.json();
      if (!verifyRes.ok || !profile.sub || profile.nonce !== nonce) return res.status(401).json({ error: "LINE_VERIFY_FAILED" });
      const current = await optionalUser(req);
      const uid = await canonicalFor("line", profile.sub, current && (current.camellia || current.firebase?.sign_in_provider === "anonymous") ? current.uid : null);
      return res.json({ firebaseToken: await tokenFor(uid, "line"), linked: !!current });
    } catch (error) {
      if (error.status === 409) return res.status(409).json({ error: error.message });
      console.error("Camellia LINE auth failed:", error);
      return res.status(500).json({ error: "AUTH_FAILED" });
    }
  });

  router.post("/passport/ticket", requireFirebaseUser, async (req, res) => {
    if (!db || !identity) return res.status(503).json({ error: "AUTH_UNAVAILABLE" });
    try {
      const found = await identity.resolveForUid(req.identity.uid, { linkedBy: "camellia-handoff" });
      const raw = randomBytes(32).toString("base64url");
      await db.collection("camellia_auth_tickets").doc(hash(raw)).create({
        schoolParkId: found.spid, expiresAt: Date.now() + TICKET_TTL_MS, used: false, createdAt: Date.now()
      });
      return res.json({ ticket: raw, expiresInMs: TICKET_TTL_MS });
    } catch (error) {
      console.error("Camellia passport ticket failed:", error);
      return res.status(500).json({ error: "TICKET_FAILED" });
    }
  });

  router.post("/passport/exchange", async (req, res) => {
    const raw = String((req.body || {}).ticket || "");
    if (!raw || !db || !firebaseAdmin) return res.status(400).json({ error: "MISSING_TICKET" });
    const ref = db.collection("camellia_auth_tickets").doc(hash(raw));
    try {
      const ticket = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new Error("TICKET_NOT_FOUND");
        const data = snap.data();
        if (data.used) throw new Error("TICKET_USED");
        if (Number(data.expiresAt) < Date.now()) throw new Error("TICKET_EXPIRED");
        tx.set(ref, { used: true, usedAt: Date.now() }, { merge: true });
        return data;
      });
      const current = await optionalUser(req);
      const uid = await canonicalFor("schoolpark", ticket.schoolParkId, current && (current.camellia || current.firebase?.sign_in_provider === "anonymous") ? current.uid : null);
      return res.json({
        firebaseToken: await tokenFor(uid, "schoolpark", { schoolParkId: ticket.schoolParkId }),
        linked: !!current
      });
    } catch (error) {
      const code = String(error.message || "");
      if (code === "IDENTITY_LINKED_TO_OTHER") return res.status(409).json({ error: code });
      if (code.startsWith("TICKET_")) return res.status(400).json({ error: code });
      console.error("Camellia passport exchange failed:", error);
      return res.status(500).json({ error: "AUTH_FAILED" });
    }
  });

  return { router };
}

module.exports = { createCamelliaAuthRouter };
