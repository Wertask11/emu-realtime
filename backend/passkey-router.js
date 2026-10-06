"use strict";

const express = require("express");
const { createHash, randomUUID } = require("crypto");
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse
} = require("@simplewebauthn/server");

const CREDENTIALS = "sp_passkeys";
const CHALLENGES = "sp_passkey_challenges";
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const hash = (value) => createHash("sha256").update(String(value)).digest("hex");
const millis = (value) => value && typeof value.toMillis === "function" ? value.toMillis() : value instanceof Date ? value.getTime() : Number(value);

function createPasskeyRouter(deps) {
  const { db, identity, firebaseAdmin, requireFirebaseUser, rateLimit, env = process.env } = deps || {};
  const webauthn = deps && deps.webauthn || {
    generateRegistrationOptions,
    verifyRegistrationResponse,
    generateAuthenticationOptions,
    verifyAuthenticationResponse
  };
  const router = express.Router();
  const rpID = String(env.SCHOOLPARK_PASSKEY_RP_ID || "").trim().toLowerCase();
  const origin = String(env.SCHOOLPARK_PASSKEY_ORIGIN || "").trim().replace(/\/$/, "");
  let configured = false;
  try {
    const parsedOrigin = new URL(origin);
    configured = !!rpID && parsedOrigin.protocol === "https:" && parsedOrigin.origin === origin &&
      parsedOrigin.hostname === rpID && !parsedOrigin.username && !parsedOrigin.password &&
      parsedOrigin.pathname === "/" && !parsedOrigin.search && !parsedOrigin.hash;
  } catch (_) {}
  // Infrastructure must be deployed and verified before an operator opts in.
  configured = configured && env.SCHOOLPARK_PASSKEY_ENABLED === "true";
  const limit = rateLimit ? rateLimit({ windowMs: 60_000, max: 10, key: "passkey" }) : (_req, _res, next) => next();
  const unavailable = (res) => res.status(503).json({ error: "PASSKEY_UNAVAILABLE" });
  const credentialRef = (id) => db.collection(CREDENTIALS).doc(hash(id));

  async function saveChallenge(challenge, data) {
    await db.collection(CHALLENGES).doc(randomUUID()).set({ challenge, ...data, expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) });
  }
  async function consumeChallenge(challenge, type, uid) {
    const snap = await db.collection(CHALLENGES).where("challenge", "==", challenge).where("type", "==", type).limit(5).get();
    const now = Date.now();
    for (const doc of snap.docs) {
      const data = doc.data() || {};
      const expiresAt = millis(data.expiresAt);
      if (!expiresAt || expiresAt <= now || (uid && data.uid !== uid)) continue;
      const claimed = await db.runTransaction(async (tx) => {
        const current = await tx.get(doc.ref);
        const currentData = current.exists ? current.data() : {};
        const currentExpiry = millis(currentData.expiresAt);
        if (!current.exists || !currentExpiry || currentExpiry <= Date.now() || currentData.challenge !== challenge || (uid && currentData.uid !== uid)) return null;
        tx.delete(doc.ref);
        return current.data();
      });
      if (claimed) return claimed;
    }
    return null;
  }

  router.get("/available", (_req, res) => res.json({ available: configured && !!db && !!firebaseAdmin }));

  router.post("/register/options", requireFirebaseUser, limit, async (req, res) => {
    if (!configured || !db || !identity) return unavailable(res);
    try {
      const spid = await identity.findByUid(req.identity.uid);
      if (!spid) return res.status(409).json({ error: "PASSPORT_REQUIRED" });
      const record = await identity.readIdentity(spid);
      if (!record || !record.primaryUid) {
        return res.status(409).json({ error: "CANONICAL_ACCOUNT_UNAVAILABLE" });
      }
      if (await identity.findByUid(record.primaryUid) !== spid) return res.status(409).json({ error: "CANONICAL_ACCOUNT_UNAVAILABLE" });
      const canonicalAccount = await db.collection("ches_accounts").doc(record.primaryUid).get();
      if (!canonicalAccount.exists || !canonicalAccount.data().walletAddress) return res.status(409).json({ error: "CANONICAL_ACCOUNT_UNAVAILABLE" });
      const existing = await db.collection(CREDENTIALS).where("spid", "==", spid).get();
      const options = await webauthn.generateRegistrationOptions({
        rpName: "SchoolPark",
        rpID,
        userID: Buffer.from(hash(`schoolpark-passkey:${spid}`), "hex"),
        userName: "SchoolPark Account",
        userDisplayName: "SchoolPark Account",
        attestationType: "none",
        excludeCredentials: existing.docs.map((doc) => {
          const item = doc.data();
          return { id: item.id, transports: item.transports || [] };
        }),
        authenticatorSelection: { residentKey: "required", userVerification: "required" },
        timeout: CHALLENGE_TTL_MS
      });
      await saveChallenge(options.challenge, { type: "registration", uid: req.identity.uid, spid });
      res.set("Cache-Control", "no-store").json(options);
    } catch (error) {
      console.error("Passkey registration options failed");
      res.status(500).json({ error: "PASSKEY_OPTIONS_FAILED" });
    }
  });

  router.post("/register/verify", requireFirebaseUser, limit, async (req, res) => {
    if (!configured || !db || !identity) return unavailable(res);
    try {
      const response = req.body && req.body.response;
      if (!response || typeof response.id !== "string" || response.rawId !== response.id) return res.status(400).json({ error: "BAD_RESPONSE" });
      const consumed = await consumeChallenge(req.body.challenge, "registration", req.identity.uid);
      if (!consumed || consumed.spid !== await identity.findByUid(req.identity.uid)) return res.status(400).json({ error: "CHALLENGE_EXPIRED" });
      const verification = await webauthn.verifyRegistrationResponse({ response, expectedChallenge: consumed.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true });
      if (!verification.verified || !verification.registrationInfo) return res.status(400).json({ error: "VERIFICATION_FAILED" });
      const credential = verification.registrationInfo.credential;
      if (!credential || credential.id !== response.id) return res.status(400).json({ error: "VERIFICATION_FAILED" });
      const ref = credentialRef(credential.id);
      await db.runTransaction(async (tx) => {
        const existing = await tx.get(ref);
        if (existing.exists) throw new Error("CREDENTIAL_ALREADY_REGISTERED");
        tx.create(ref, {
          id: credential.id,
          spid: consumed.spid,
          userHandle: Buffer.from(hash(`schoolpark-passkey:${consumed.spid}`), "hex").toString("base64url"),
          credential: {
            id: credential.id,
            publicKey: Buffer.from(credential.publicKey).toString("base64url"),
            counter: credential.counter,
            transports: credential.transports || []
          },
          deviceName: String(req.body.deviceName || "この端末").slice(0, 40),
          createdAt: Date.now(),
          lastUsedAt: null
        });
      });
      res.set("Cache-Control", "no-store").json({ ok: true, schoolParkId: consumed.spid });
    } catch (error) {
      const code = error.message === "CREDENTIAL_ALREADY_REGISTERED" ? error.message : "VERIFICATION_FAILED";
      res.status(code === "CREDENTIAL_ALREADY_REGISTERED" ? 409 : 400).json({ error: code });
    }
  });

  router.post("/login/options", limit, async (_req, res) => {
    if (!configured || !db) return unavailable(res);
    try {
      const options = await webauthn.generateAuthenticationOptions({ rpID, allowCredentials: [], userVerification: "required", timeout: CHALLENGE_TTL_MS });
      await saveChallenge(options.challenge, { type: "authentication" });
      res.set("Cache-Control", "no-store").json(options);
    } catch (error) {
      console.error("Passkey login options failed");
      res.status(500).json({ error: "PASSKEY_OPTIONS_FAILED" });
    }
  });

  router.post("/login/verify", limit, async (req, res) => {
    if (!configured || !db || !identity || !firebaseAdmin) return unavailable(res);
    try {
      const response = req.body && req.body.response;
      if (!response || typeof response.id !== "string" || response.rawId !== response.id) return res.status(400).json({ error: "BAD_RESPONSE" });
      const challenge = await consumeChallenge(req.body.challenge, "authentication");
      if (!challenge) return res.status(400).json({ error: "CHALLENGE_EXPIRED" });
      const stored = await credentialRef(response.id).get();
      if (!stored.exists) return res.status(401).json({ error: "CREDENTIAL_NOT_FOUND" });
      const credentialDoc = stored.data();
      if (!response.response || response.response.userHandle !== credentialDoc.userHandle) return res.status(401).json({ error: "CREDENTIAL_NOT_FOUND" });
      const credential = credentialDoc.credential;
      const verification = await webauthn.verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        credential: { ...credential, publicKey: Buffer.from(credential.publicKey, "base64url") },
        requireUserVerification: true
      });
      if (!verification.verified || !verification.authenticationInfo) return res.status(401).json({ error: "VERIFICATION_FAILED" });
      const spid = String(credentialDoc.spid || "");
      const record = await identity.readIdentity(spid);
      const uid = String(record && record.primaryUid || "");
      if (!uid || await identity.findByUid(uid) !== spid) return res.status(409).json({ error: "CANONICAL_ACCOUNT_UNAVAILABLE" });
      const account = await db.collection("ches_accounts").doc(uid).get();
      if (!account.exists || !account.data().walletAddress) return res.status(409).json({ error: "CANONICAL_ACCOUNT_UNAVAILABLE" });
      const nextCounter = verification.authenticationInfo.newCounter;
      await db.runTransaction(async (tx) => {
        const current = await tx.get(stored.ref);
        if (!current.exists || current.data().spid !== spid) throw new Error("CREDENTIAL_NOT_FOUND");
        const currentCounter = Number(current.data().credential && current.data().credential.counter) || 0;
        if (currentCounter > 0 && nextCounter <= currentCounter) throw new Error("COUNTER_REPLAY");
        tx.update(stored.ref, { "credential.counter": nextCounter, lastUsedAt: Date.now() });
      });
      await firebaseAdmin.auth().getUser(uid);
      const firebaseToken = await firebaseAdmin.auth().createCustomToken(uid, { provider: "passkey" });
      res.set("Cache-Control", "no-store").json({ firebaseToken });
    } catch (error) {
      console.error("Passkey login failed");
      res.status(401).json({ error: "PASSKEY_LOGIN_FAILED" });
    }
  });

  router.get("/list", requireFirebaseUser, limit, async (req, res) => {
    if (!configured || !db || !identity) return unavailable(res);
    try {
      const spid = await identity.findByUid(req.identity.uid);
      if (!spid) return res.json({ passkeys: [] });
      const snap = await db.collection(CREDENTIALS).where("spid", "==", spid).get();
      res.set("Cache-Control", "no-store").json({ passkeys: snap.docs.map((doc) => ({ id: doc.id, deviceName: doc.data().deviceName, createdAt: doc.data().createdAt, lastUsedAt: doc.data().lastUsedAt })) });
    } catch (_) { res.status(500).json({ error: "PASSKEY_LIST_FAILED" }); }
  });

  router.delete("/:credentialHash", requireFirebaseUser, limit, async (req, res) => {
    if (!configured || !db || !identity) return unavailable(res);
    try {
      const spid = await identity.findByUid(req.identity.uid);
      if (!spid) return res.status(404).json({ error: "PASSKEY_NOT_FOUND" });
      const ref = db.collection(CREDENTIALS).doc(String(req.params.credentialHash || ""));
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists || snap.data().spid !== spid) throw new Error("NOT_FOUND");
        tx.delete(ref);
      });
      res.json({ ok: true });
    } catch (_) { res.status(404).json({ error: "PASSKEY_NOT_FOUND" }); }
  });
  return router;
}

module.exports = { createPasskeyRouter, CREDENTIALS, CHALLENGES };
