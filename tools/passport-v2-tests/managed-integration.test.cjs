const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  { once } = require("node:events"),
  { randomBytes } = require("node:crypto");
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8787";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9199";
const admin = require("../../backend/node_modules/firebase-admin"),
  express = require("../../backend/node_modules/express");
test("RC combines real Auth/Firestore emulators, SDK KMS test signer, HTTP issuance/consent/presentation and emergency stop", async (t) => {
  const a = admin.initializeApp(
    { projectId: "demo-emu-knowledge-lab-passport2" },
    "managed-rc-integration",
  );
  t.after(() => a.delete());
  const db = a.firestore();
  const { deviceKey } = await import("../../backend/passport-v2/crypto.mjs"),
    { testKms } = await import(
      "../../backend/passport-v2/kms-fixture-support.mjs"
    ),
    { createManagedRouter } = await import(
      "../../backend/passport-v2/managed.mjs"
    ),
    { presentSelective } = await import(
      "../../backend/passport-v2/selective.mjs"
    ),
    { SignJWT } = await import(
      "../../backend/node_modules/jose/dist/webapi/index.js"
    );
  const realm = randomBytes(32).toString("hex"),
    base = "https://issuer.example/api/passport-v2",
    issuer = base + "/issuer",
    key = await deviceKey(),
    holder = await deviceKey(),
    keyArn = "arn:aws:kms:ap-northeast-1:123456789012:key/synthetic";
  key.publicKey.controller = issuer;
  key.publicKey.id = issuer + "#rc";
  const control = db.collection("passport_v2_controls").doc(realm + "-issuer");
  await control.set({ emergencyStop: false, compromisedKeyIds: [] });
  const kmsClient = await testKms(key, keyArn),
    config = {
      base,
      issuer,
      keyArn,
      storageRealm: realm,
      signingKeyId: key.publicKey.id,
      frontendUrl: "https://issuer.example/",
      authorizationClients: [],
      issuers: [
        {
          id: issuer,
          keys: [
            {
              publicKey: key.publicKey,
              validFrom: "2020-01-01",
              validUntil: "2030-01-01",
            },
          ],
        },
      ],
      verifiers: [
        {
          id: "test",
          name: "Synthetic verifier",
          legalName: "Synthetic verifier",
          purpose: "Isolated account proof test",
          trusted: true,
          clientId: "redirect_uri:https://issuer.example/response",
          responseUri: "https://issuer.example/response",
          retentionNotice: "Synthetic test only",
        },
      ],
    };
  const auth = async (req, res, next) => {
    try {
      const token = await a
        .auth()
        .verifyIdToken(String(req.headers.authorization || "").slice(7), true);
      req.identity = {
        uid: token.uid,
        signInProvider: token.firebase.sign_in_provider,
        authTimeMs: token.auth_time * 1000,
      };
      next();
    } catch {
      res.status(401).json({ error: "AUTH_REQUIRED" });
    }
  };
  const p = await createManagedRouter({
    config,
    db,
    kmsClient,
    rateHmacKey: randomBytes(32),
    identity: {
      findByUid: async (uid) => (uid === "lab-bob" ? "SP-SYNTHETIC-RC" : null),
    },
    requireFirebaseUser: auth,
    checkSensitiveSession: (token) => a.auth().verifyIdToken(token, true),
  });
  const web = express();
  web.use("/api/passport-v2", p.router);
  const server = web.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((r) => server.close(r)));
  const local =
    "http://127.0.0.1:" + server.address().port + "/api/passport-v2";
  const login = await (
    await fetch(
      "http://127.0.0.1:9199/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator-only",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "bob@knowledge-lab.example.invalid",
          password: "Emulator-only-password-123",
          returnSecureToken: true,
        }),
      },
    )
  ).json();
  assert.ok(login.idToken);
  const call = async (path, body, token = login.idToken) => {
    const r = await fetch(local + path, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    assert.equal(r.status, 200, "endpoint " + path);
    return r.json();
  };
  // UID is discovered from the actual emulator token; no user-controlled body identity.
  const decoded = await a.auth().verifyIdToken(login.idToken);
  assert.ok(decoded.uid);
  // Fixture UID is intentionally stable in this demo project.
  assert.equal(decoded.uid, "lab-bob");
  const offer = await call("/offers", {
      configurationId: "schoolpark_account_sd_v1",
    }),
    grant =
      offer.credential_offer.grants[
        "urn:ietf:params:oauth:grant-type:pre-authorized_code"
      ];
  const token = await call(
      "/token",
      {
        grant_type: "urn:ietf:params:oauth:grant-type:pre-authorized_code",
        "pre-authorized_code": grant["pre-authorized_code"],
        tx_code: offer.tx_code,
      },
      null,
    ),
    n = await call("/nonce", {}, null);
  const proof = await new SignJWT({ nonce: n.c_nonce })
    .setProtectedHeader({
      typ: "openid4vci-proof+jwt",
      alg: "ES256",
      jwk: holder.jwk,
    })
    .setAudience(base + "/sd")
    .setIssuedAt()
    .sign(holder.privateKey);
  await call(
    "/credential",
    {
      credential_configuration_id: "schoolpark_account_sd_v1",
      proofs: { jwt: [proof] },
    },
    token.access_token,
  );
  const listed = await call("/credentials"),
    id = listed.credentials[0].id,
    r = await call("/requests", {
      credentialId: id,
      verifierId: "test",
      selected: ["accountAccess"],
    });
  const presentation = await presentSelective(
    listed.credentials[0].credential,
    holder,
    r,
    ["accountAccess"],
  );
  assert.equal(
    (
      await fetch(local + "/response", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          state: r.state,
          vp_token: { account: [presentation] },
        }),
      })
    ).status,
    400,
  );
  await call("/consent", { requestId: r.id, approved: true });
  assert.equal(
    (
      await call(
        "/response",
        { state: r.state, vp_token: { account: [presentation] } },
        null,
      )
    ).verified,
    true,
  );
  await control.set({ emergencyStop: true, compromisedKeyIds: [] });
  assert.equal((await fetch(local + "/metadata")).status, 503);
});
