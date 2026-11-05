"use strict";
// Local-only fixture: actual app, Firebase/Auth emulators and existing auth middleware.
process.env.LAB_EMULATOR_PROJECT = "demo-emu-knowledge-lab-passport2";
process.env.LAB_AUTH_EMULATOR_HOST = "127.0.0.1:9199";
const { main } = require("../knowledge-lab-tests/native-fixture.cjs");
async function start() {
  const f = await main({
    port: Number(process.env.PASSPORT_TEST_PORT || 4240),
    reset: false,
  });
  const router = require("../../backend/passport-v2/router.cjs").createRouter({
    db: f.db,
    identity: f.identity,
    requireFirebaseUser: f.middleware.requireFirebaseUser,
    checkSensitiveSession: (token) =>
      f.middleware.firebaseAdmin.auth().verifyIdToken(token, true),
    env: {
      PASSPORT_V2_ENABLED: "true",
      PASSPORT_V2_SANDBOX: "true",
      PASSPORT_ZKP_UNAUDITED_TEST_ONLY:
        process.env.PASSPORT_ZKP_UNAUDITED_TEST_ONLY,
      APP_ENV: "local",
      GCLOUD_PROJECT: "demo-emu-knowledge-lab-passport2",
      FIRESTORE_EMULATOR_HOST: "127.0.0.1:8787",
      FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9199",
      PASSPORT_V2_SANDBOX_BASE: f.base + "/api/passport-v2",
    },
  });
  f.app.use("/api/passport-v2", router);
  const layer = f.app.router.stack.pop();
  f.app.router.stack.unshift(layer);
  for (const [path, target] of [
    ["/.well-known/openid-credential-issuer/api/passport-v2", "/metadata"],
    [
      "/.well-known/openid-credential-issuer/api/passport-v2/sd",
      "/sd/metadata",
    ],
    [
      "/.well-known/oauth-authorization-server/api/passport-v2",
      "/oauth-metadata",
    ],
    ["/.well-known/jwt-vc-issuer/api/passport-v2/issuer", "/jwt-vc-issuer"],
  ]) {
    f.app.get(path, (req, res, next) => {
      req.url = target;
      router(req, res, next);
    });
    const discovery = f.app.router.stack.pop();
    f.app.router.stack.unshift(discovery);
  }
  if (process.env.PASSPORT_INTEROP_DIAGNOSTICS === "true") {
    const express = require("../../backend/node_modules/express");
    let shape, credentialShape;
    f.app.use(
      "/api/passport-v2/token",
      express.urlencoded({ extended: false, limit: "8kb" }),
      (req, res, next) => {
        const b = req.body || {};
        shape = {
          fields: Object.keys(b),
          grantType: b.grant_type,
          codeLength: b["pre-authorized_code"]?.length,
          pinLength: b.tx_code?.length,
          legacyPinLength: b.user_pin?.length,
          clientIdPresent: !!b.client_id,
        };
        next();
      },
    );
    const tap = f.app.router.stack.pop();
    const parser = f.app.router.stack.pop();
    f.app.router.stack.unshift(parser, tap);
    f.app.use(
      "/api/passport-v2/credential",
      express.json({ limit: "32kb" }),
      async (req, res, next) => {
        const b = req.body || {};
        let h = {},
          p = {};
        try {
          const j = await import(
            "../../backend/node_modules/jose/dist/webapi/index.js"
          );
          const proof = b.proofs?.jwt?.[0];
          h = j.decodeProtectedHeader(proof);
          p = j.decodeJwt(proof);
        } catch (_) {}
        credentialShape = {
          fields: Object.keys(b),
          proofFields: Object.keys(b.proofs || {}),
          headerFields: Object.keys(h),
          jwkFields: Object.keys(h.jwk || {}),
          payloadFields: Object.keys(p),
          audienceMatchesSD: p.aud === f.base + "/api/passport-v2/sd",
          nonceLength: p.nonce?.length,
        };
        const json = res.json.bind(res);
        res.json = (d) => {
          if (d.error) credentialShape.error = d.error;
          return json(d);
        };
        next();
      },
    );
    const ct = f.app.router.stack.pop(),
      cp = f.app.router.stack.pop();
    f.app.router.stack.unshift(cp, ct);
    f.app.get("/test/interop-credential-shape", (req, res) =>
      res.json(credentialShape || {}),
    );
    f.app.get("/test/interop-token-shape", (req, res) => res.json(shape || {}));
  }
  console.log("PASSPORT_SANDBOX_READY " + f.base + "/test/native.html");
  return f;
}
if (require.main === module)
  start().catch(() => {
    console.error("LOCAL_FIXTURE_FAILED");
    process.exitCode = 1;
  });
module.exports = { start };
