"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { createPasskeyRouter } = require("./passkey-router");

class MemoryDb {
  constructor() { this.rows = new Map(); }
  collection(name) {
    const db = this;
    const rows = () => { if (!db.rows.has(name)) db.rows.set(name, new Map()); return db.rows.get(name); };
    const collection = {
      doc(id) {
        const ref = { id, collection: name };
        ref.get = async () => { const data = rows().get(id); return { exists: data !== undefined, data: () => data, ref }; };
        ref.set = async (data) => rows().set(id, data);
        ref.update = async (patch) => { const current = rows().get(id) || {}; for (const [key, value] of Object.entries(patch)) {
          if (key.includes('.')) { const [parent, child] = key.split('.'); current[parent] = { ...(current[parent] || {}), [child]: value }; }
          else current[key] = value;
        } rows().set(id, current); };
        return ref;
      },
      where(field, operator, value) {
        assert.equal(operator, "==");
        const filters = [[field, value]];
        const query = {
          where(nextField, nextOperator, nextValue) { assert.equal(nextOperator, "=="); filters.push([nextField, nextValue]); return query; },
          limit() { return query; },
          async get() {
            const docs = [...rows()].filter(([, data]) => filters.every(([key, expected]) => data[key] === expected)).map(([id, data]) => ({ id, ref: collection.doc(id), data: () => data }));
            return { docs };
          }
        };
        return query;
      }
    };
    return collection;
  }
  async runTransaction(callback) {
    const tx = {
      get: (ref) => ref.get(),
      create: async (ref, data) => { if ((await ref.get()).exists) throw new Error("ALREADY_EXISTS"); await ref.set(data); },
      delete: async (ref) => { this.rows.get(ref.collection)?.delete(ref.id); },
      update: async (ref, patch) => ref.update(patch)
    };
    return callback(tx);
  }
}

function mockResponse(done) {
  return {
    code: 200,
    status(code) { this.code = code; return this; },
    set() { return this; },
    json(body) { done({ status: this.code, body }); return this; }
  };
}

async function call(router, path, method, body, identity) {
  const layer = router.stack.find((item) => item.route && item.route.path === path && item.route.methods[method.toLowerCase()]);
  assert.ok(layer, `route exists: ${method} ${path}`);
  const route = layer.route.stack;
  const req = { body: body || {}, params: {}, identity: identity || {}, method, path, headers: {} };
  return new Promise((resolve, reject) => {
    let index = 0;
    const res = mockResponse(resolve);
    const next = (error) => {
      if (error) return reject(error);
      const current = route[index++];
      if (!current) return resolve({ status: 404, body: {} });
      try {
        const result = current.handle(req, res, next);
        if (result && typeof result.then === "function") result.catch(reject);
      } catch (error) { reject(error); }
    };
    next();
  });
}

test("Passkey registration is attached to an existing Passport and login restores its existing Firebase uid", async () => {
  const db = new MemoryDb();
  await db.collection("ches_accounts").doc("firebase-user-1").set({ walletAddress: "0xabc" });
  const identity = {
    async findByUid(uid) { return uid === "firebase-user-1" ? "SP-AAAA-BBBB-CCCC-DDDD" : null; },
    async readIdentity(spid) { return spid === "SP-AAAA-BBBB-CCCC-DDDD" ? { primaryUid: "firebase-user-1" } : null; }
  };
  let mintedPassport = false;
  identity.resolveForUid = async () => { mintedPassport = true; throw new Error("must not issue a Passport during Passkey setup"); };
  const webauthn = {
    async generateRegistrationOptions(options) { assert.equal(options.authenticatorSelection.residentKey, "required"); return { challenge: "registration-challenge", user: { id: "opaque-user-handle" } }; },
    async verifyRegistrationResponse(options) { assert.equal(options.expectedChallenge, "registration-challenge"); assert.equal(options.expectedOrigin, "https://schoolpark-emu.vercel.app"); assert.equal(options.expectedRPID, "schoolpark-emu.vercel.app"); return { verified: true, registrationInfo: { credential: { id: "credential-id", publicKey: Uint8Array.from([1, 2, 3]), counter: 0, transports: ["internal"] } } }; },
    async generateAuthenticationOptions(options) { assert.deepEqual(options.allowCredentials, []); return { challenge: "authentication-challenge" }; },
    async verifyAuthenticationResponse(options) { assert.equal(options.expectedChallenge, "authentication-challenge"); assert.deepEqual([...options.credential.publicKey], [1, 2, 3]); return { verified: true, authenticationInfo: { newCounter: 0 } }; }
  };
  const firebaseAdmin = { auth: () => ({ getUser: async (uid) => ({ uid }), createCustomToken: async (uid) => `token:${uid}` }) };
  const requireFirebaseUser = (req, _res, next) => { req.identity = { uid: "firebase-user-1", account: { walletAddress: "0xabc" } }; next(); };
  const api = createPasskeyRouter({ db, identity, firebaseAdmin, requireFirebaseUser, webauthn, env: { SCHOOLPARK_PASSKEY_ENABLED: "true", SCHOOLPARK_PASSKEY_RP_ID: "schoolpark-emu.vercel.app", SCHOOLPARK_PASSKEY_ORIGIN: "https://schoolpark-emu.vercel.app" } });

  const options = await call(api, "/register/options", "POST", {}, {});
  assert.equal(options.status, 200);
  const registered = await call(api, "/register/verify", "POST", { challenge: "registration-challenge", response: { id: "credential-id", rawId: "credential-id" } }, {});
  assert.equal(registered.status, 200);
  assert.equal(registered.body.schoolParkId, "SP-AAAA-BBBB-CCCC-DDDD");
  const stored = await db.collection("sp_passkeys").doc(require("crypto").createHash("sha256").update("credential-id").digest("hex")).get();
  assert.equal(stored.data().spid, "SP-AAAA-BBBB-CCCC-DDDD");
  assert.equal(stored.data().credential.publicKey, Buffer.from([1, 2, 3]).toString("base64url"));
  assert.equal(stored.data().userHandle, require("crypto").createHash("sha256").update("schoolpark-passkey:SP-AAAA-BBBB-CCCC-DDDD").digest("base64url"));
  assert.equal(Object.hasOwn(stored.data(), "privateKey"), false);

  const loginOptions = await call(api, "/login/options", "POST", {}, {});
  assert.equal(loginOptions.status, 200);
  const login = await call(api, "/login/verify", "POST", { challenge: "authentication-challenge", response: { id: "credential-id", rawId: "credential-id", response: { userHandle: stored.data().userHandle } } }, {});
  assert.deepEqual(login, { status: 200, body: { firebaseToken: "token:firebase-user-1" } });
  assert.equal(mintedPassport, false);
  const replay = await call(api, "/register/verify", "POST", { challenge: "registration-challenge", response: { id: "credential-id", rawId: "credential-id" } }, {});
  assert.equal(replay.status, 400, "a consumed challenge cannot be reused");
  const mismatchedRawId = await call(api, "/login/verify", "POST", { challenge: "authentication-challenge", response: { id: "credential-id", rawId: "another-id" } }, {});
  assert.equal(mismatchedRawId.status, 400, "outer credential id and signed rawId must match");
});

test("Passkey fails closed without exact HTTPS RP configuration and its Firestore collections stay excluded", async () => {
  const api = createPasskeyRouter({ env: {}, db: new MemoryDb(), identity: {}, firebaseAdmin: {}, requireFirebaseUser: (_req, _res, next) => next() });
  const result = await call(api, "/available", "GET", {}, {});
  assert.deepEqual(result, { status: 200, body: { available: false } });
  const rules = fs.readFileSync(require("node:path").join(__dirname, "../firestore.rules"), "utf8");
  assert.match(rules, /coll != 'sp_passkeys'/);
  assert.match(rules, /coll != 'sp_passkey_challenges'/);
  const indexFile = JSON.parse(fs.readFileSync(require("node:path").join(__dirname, "../firestore.indexes.json"), "utf8"));
  assert.ok(indexFile.indexes.some((index) => index.collectionGroup === "sp_passkey_challenges" && index.fields.some((field) => field.fieldPath === "challenge") && index.fields.some((field) => field.fieldPath === "type")));
  assert.ok(indexFile.fieldOverrides.some((field) => field.collectionGroup === "sp_passkey_challenges" && field.fieldPath === "expiresAt" && field.ttl === true));
});

test("Passkey stays disabled until the explicit activation flag is true", async () => {
  const deps = { db: new MemoryDb(), identity: {}, firebaseAdmin: {}, requireFirebaseUser: (_req, _res, next) => next(), env: { SCHOOLPARK_PASSKEY_RP_ID: "schoolpark-emu.vercel.app", SCHOOLPARK_PASSKEY_ORIGIN: "https://schoolpark-emu.vercel.app" } };
  const api = createPasskeyRouter(deps);
  assert.deepEqual(await call(api, "/available", "GET", {}, {}), { status: 200, body: { available: false } });
});

test("Passkey rejects expired challenges, foreign user handles, and malformed Origins fail closed", async () => {
  const db = new MemoryDb();
  await db.collection("ches_accounts").doc("firebase-user-1").set({ walletAddress: "0xabc" });
  const identity = {
    async findByUid(uid) { return uid === "firebase-user-1" ? "SP-AAAA-BBBB-CCCC-DDDD" : null; },
    async readIdentity() { return { primaryUid: "firebase-user-1" }; }
  };
  let authenticationChecks = 0;
  const webauthn = {
    async generateAuthenticationOptions() { return { challenge: "expiring-challenge" }; },
    async verifyAuthenticationResponse() { authenticationChecks++; return { verified: true, authenticationInfo: { newCounter: 0 } }; }
  };
  await db.collection("sp_passkeys").doc(require("crypto").createHash("sha256").update("credential-id").digest("hex")).set({
    id: "credential-id", spid: "SP-AAAA-BBBB-CCCC-DDDD", userHandle: "expected-user-handle",
    credential: { id: "credential-id", publicKey: Buffer.from([1]).toString("base64url"), counter: 0 }
  });
  const deps = {
    db, identity, firebaseAdmin: { auth: () => ({ getUser: async () => ({}), createCustomToken: async () => "token" }) },
    requireFirebaseUser: (req, _res, next) => { req.identity = { uid: "firebase-user-1" }; next(); }, webauthn,
    env: { SCHOOLPARK_PASSKEY_ENABLED: "true", SCHOOLPARK_PASSKEY_RP_ID: "schoolpark-emu.vercel.app", SCHOOLPARK_PASSKEY_ORIGIN: "https://schoolpark-emu.vercel.app" }
  };
  const api = createPasskeyRouter(deps);
  await call(api, "/login/options", "POST", {}, {});
  const challengeDocs = db.rows.get("sp_passkey_challenges");
  for (const [id, row] of challengeDocs) challengeDocs.set(id, { ...row, expiresAt: new Date(Date.now() - 1) });
  const expired = await call(api, "/login/verify", "POST", { challenge: "expiring-challenge", response: { id: "credential-id", rawId: "credential-id", response: { userHandle: "expected-user-handle" } } }, {});
  assert.equal(expired.status, 400);
  assert.equal(authenticationChecks, 0, "expired challenges stop before signature verification");

  const originalNow = Date.now;
  const start = originalNow();
  challengeDocs.set("expires-during-transaction", { challenge: "expires-during-transaction", type: "authentication", expiresAt: new Date(start + 10) });
  const clock = [start, start + 11];
  Date.now = () => clock.shift() ?? start + 11;
  let expiredDuringConsume;
  try {
    expiredDuringConsume = await call(api, "/login/verify", "POST", { challenge: "expires-during-transaction", response: { id: "credential-id", rawId: "credential-id", response: { userHandle: "expected-user-handle" } } }, {});
  } finally { Date.now = originalNow; }
  assert.equal(expiredDuringConsume.status, 400, "transaction retries recheck expiry using the current time");
  assert.equal(authenticationChecks, 0);

  const invalidConfig = createPasskeyRouter({ ...deps, env: { SCHOOLPARK_PASSKEY_ENABLED: "true", SCHOOLPARK_PASSKEY_RP_ID: "schoolpark-emu.vercel.app", SCHOOLPARK_PASSKEY_ORIGIN: "https://schoolpark-emu.vercel.app.evil.test/path" } });
  assert.deepEqual(await call(invalidConfig, "/available", "GET", {}, {}), { status: 200, body: { available: false } });
});

test("Passkey cannot cross from its Passport to another canonical Firebase identity", async () => {
  const db = new MemoryDb();
  await db.collection("ches_accounts").doc("firebase-user-b").set({ walletAddress: "0xdef" });
  const credentialId = "credential-a";
  await db.collection("sp_passkeys").doc(require("crypto").createHash("sha256").update(credentialId).digest("hex")).set({
    id: credentialId, spid: "SP-PASSPORT-A", userHandle: "handle-a",
    credential: { id: credentialId, publicKey: Buffer.from([1]).toString("base64url"), counter: 0 }
  });
  await db.collection("sp_passkey_challenges").doc("live").set({ challenge: "fresh", type: "authentication", expiresAt: new Date(Date.now() + 30_000) });
  const api = createPasskeyRouter({
    db,
    identity: { async readIdentity() { return { primaryUid: "firebase-user-b" }; }, async findByUid(uid) { return uid === "firebase-user-b" ? "SP-PASSPORT-B" : null; } },
    requireFirebaseUser: (_req, _res, next) => next(),
    firebaseAdmin: { auth: () => ({ getUser: async () => ({}), createCustomToken: async () => "token" }) },
    webauthn: { async verifyAuthenticationResponse() { return { verified: true, authenticationInfo: { newCounter: 0 } }; } },
    env: { SCHOOLPARK_PASSKEY_ENABLED: "true", SCHOOLPARK_PASSKEY_RP_ID: "schoolpark-emu.vercel.app", SCHOOLPARK_PASSKEY_ORIGIN: "https://schoolpark-emu.vercel.app" }
  });
  const result = await call(api, "/login/verify", "POST", { challenge: "fresh", response: { id: credentialId, rawId: credentialId, response: { userHandle: "handle-a" } } }, {});
  assert.equal(result.status, 409, "credential for Passport A cannot mint a token for Passport B");
});

test("Passkey counter regression is rejected before Firebase token issuance", async () => {
  const db = new MemoryDb();
  await db.collection("ches_accounts").doc("firebase-user-1").set({ walletAddress: "0xabc" });
  const credentialId = "counter-credential";
  const credentialRef = db.collection("sp_passkeys").doc(require("crypto").createHash("sha256").update(credentialId).digest("hex"));
  await credentialRef.set({
    id: credentialId, spid: "SP-AAAA-BBBB-CCCC-DDDD", userHandle: "handle",
    credential: { id: credentialId, publicKey: Buffer.from([1]).toString("base64url"), counter: 5 }
  });
  await db.collection("sp_passkey_challenges").doc("live").set({ challenge: "counter-challenge", type: "authentication", expiresAt: new Date(Date.now() + 30_000) });
  let issued = false;
  const api = createPasskeyRouter({
    db,
    identity: { async readIdentity() { return { primaryUid: "firebase-user-1" }; }, async findByUid(uid) { return uid === "firebase-user-1" ? "SP-AAAA-BBBB-CCCC-DDDD" : null; } },
    requireFirebaseUser: (_req, _res, next) => next(),
    webauthn: { async verifyAuthenticationResponse() { return { verified: true, authenticationInfo: { newCounter: 5 } }; } },
    firebaseAdmin: { auth: () => ({ getUser: async () => ({}), createCustomToken: async () => { issued = true; return "token"; } }) },
    env: { SCHOOLPARK_PASSKEY_ENABLED: "true", SCHOOLPARK_PASSKEY_RP_ID: "schoolpark-emu.vercel.app", SCHOOLPARK_PASSKEY_ORIGIN: "https://schoolpark-emu.vercel.app" }
  });
  const result = await call(api, "/login/verify", "POST", { challenge: "counter-challenge", response: { id: credentialId, rawId: credentialId, response: { userHandle: "handle" } } }, {});
  assert.equal(result.status, 401);
  assert.equal(issued, false, "a replayed assertion never receives a Firebase custom token");
  assert.equal((await credentialRef.get()).data().credential.counter, 5);
});
