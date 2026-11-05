import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import { SignJWT } from "jose";
import {
  createRouter,
  localSandbox,
  experimentalZkpEnabled,
} from "./router.cjs";
import { present } from "./crypto.mjs";
import { fixture } from "./fixture-support.mjs";
import { Openid4vciClient } from "@openid4vc/openid4vci";
import {
  parseOpenid4vpAuthorizationRequest,
  Openid4vpVerifier,
  parseDcqlVpToken,
} from "@openid4vc/openid4vp";
import { createHash, randomBytes } from "node:crypto";
async function server(t, options = {}) {
  const f = await fixture(),
    app = express();
  const auth = (req, res, next) => {
    if (req.headers.authorization !== "Bearer fixture-alice")
      return res.status(401).json({ error: "AUTH_REQUIRED" });
    req.identity = {
      uid: "alice",
      signInProvider: "google.com",
      authTimeMs: options.authTimeMs ?? Date.now(),
    };
    next();
  };
  const router = createRouter({
    identity: {
      findByUid: async (uid) =>
        uid === "alice" ? "SP-TEST-TEST-TEST-TEST" : null,
    },
    requireFirebaseUser: auth,
    checkSensitiveSession: options.checkSensitiveSession,
    servicePromise: Promise.resolve(f.svc),
  });
  app.use("/api/passport-v2", router);
  app.get("/.well-known/openid-credential-issuer/api/passport-v2", (req, res) =>
    res.json(f.svc.metadata()),
  );
  app.get(
    "/.well-known/oauth-authorization-server/api/passport-v2",
    (req, res) =>
      res.json({
        issuer: f.svc.base,
        token_endpoint: f.svc.base + "/token",
        grant_types_supported: [
          "urn:ietf:params:oauth:grant-type:pre-authorized_code",
        ],
        token_endpoint_auth_methods_supported: ["none"],
      }),
  );
  const http = app.listen(0, "127.0.0.1");
  await once(http, "listening");
  t.after(() => new Promise((r) => http.close(r)));
  const local = "http://127.0.0.1:" + http.address().port;
  const send = async (path, body, auth = "fixture-alice") =>
    fetch(local + "/api/passport-v2" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(auth ? { Authorization: "Bearer " + auth } : {}),
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { ...f, send, local };
}
test("disabled outside local emulators, including production flag override", async (t) => {
  assert.equal(
    localSandbox({
      PASSPORT_V2_ENABLED: "true",
      PASSPORT_V2_SANDBOX: "true",
      NODE_ENV: "production",
      APP_ENV: "local",
      GCLOUD_PROJECT: "demo-test",
      FIRESTORE_EMULATOR_HOST: "127.0.0.1:8787",
      FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9199",
    }),
    false,
  );
  const app = express();
  app.use(
    "/api/passport-v2",
    createRouter({
      env: {},
      requireFirebaseUser: () => assert.fail("auth must not run"),
    }),
  );
  const s = app.listen(0, "127.0.0.1");
  await once(s, "listening");
  t.after(() => new Promise((r) => s.close(r)));
  const base = "http://127.0.0.1:" + s.address().port + "/api/passport-v2";
  assert.equal(
    (await (await fetch(base + "/capabilities")).json()).enabled,
    false,
  );
  assert.equal(
    (await fetch(base + "/credential", { method: "POST", body: "not-json" }))
      .status,
    404,
  );
});
test("private endpoints require auth, malformed bodies sanitized, PII fields rejected", async (t) => {
  const { send, local } = await server(t);
  assert.equal((await send("/credentials", undefined, null)).status, 401);
  const r = await fetch(local + "/api/passport-v2/requests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: '{"secret": "private-test-value" INVALID',
  });
  assert.equal(r.status, 400);
  assert.equal((await r.text()).includes("private-test-value"), false);
  assert.equal(
    (await send("/offers", { individualNumber: "123456789012" })).status,
    400,
  );
  assert.equal((await send("/credentials?uid=someone")).status, 400);
  assert.equal(
    (await send("/credentials")).headers.get("cache-control"),
    "no-store",
  );
});
test("independent OpenWallet Foundation V1 SDK discovers issuer, token, nonce, proof, credential response", async (t) => {
  const { svc, holder, send, local } = await server(t);
  const offer = await (await send("/offers", {})).json();
  const client = new Openid4vciClient({
    callbacks: {
      clientAuthentication: async () => {},
      fetch: (url, options) => {
        const u = new URL(url);
        if (u.origin !== "https://issuer.example")
          throw Error("unexpected network");
        return fetch(local + u.pathname, options);
      },
      generateRandom: (n) => randomBytes(n),
      hash: (data, alg) =>
        new Uint8Array(
          createHash(alg.toLowerCase().replace("-", "")).update(data).digest(),
        ),
      signJwt: async (signer, jwt) => ({
        jwt: await new SignJWT(jwt.payload)
          .setProtectedHeader(jwt.header)
          .sign(holder.privateKey),
        signerJwk: holder.jwk,
      }),
    },
  });
  const metadata = await client.resolveIssuerMetadata(svc.base);
  assert.ok(metadata.knownCredentialConfigurations.schoolpark_account_v1);
  assert.equal(metadata.originalDraftVersion, "V1");
  const token = await client.retrievePreAuthorizedCodeAccessTokenFromOffer({
    credentialOffer: offer.credential_offer,
    issuerMetadata: metadata,
    txCode: offer.tx_code,
  });
  const nonce = await client.requestNonce({ issuerMetadata: metadata });
  const proof = await client.createCredentialRequestJwtProof({
    issuerMetadata: metadata,
    credentialConfigurationId: "schoolpark_account_v1",
    nonce: nonce.c_nonce,
    signer: { method: "jwk", publicJwk: holder.jwk, alg: "ES256" },
  });
  const result = await client.retrieveCredentials({
    issuerMetadata: metadata,
    credentialConfigurationId: "schoolpark_account_v1",
    accessToken: token.accessTokenResponse.access_token,
    proofs: { jwt: [proof.jwt] },
  });
  const c = result.credentialResponse.credentials[0].credential;
  assert.equal(await svc.verify(c), true);
  assert.ok(
    parseDcqlVpToken({ account: [{ type: ["VerifiablePresentation"] }] })
      .account,
  );
  assert.equal(
    (
      await send(
        "/token",
        {
          grant_type: "urn:ietf:params:oauth:grant-type:pre-authorized_code",
          "pre-authorized_code":
            offer.credential_offer.grants[
              "urn:ietf:params:oauth:grant-type:pre-authorized_code"
            ]["pre-authorized_code"],
          tx_code: offer.tx_code,
        },
        null,
      )
    ).status,
    400,
  );
});

test("OpenID4VP final request/DCQL response SDK validation plus real holder signature and public receiver", async (t) => {
  const { svc, mint, holder, send } = await server(t),
    c = await mint("SP-TEST-TEST-TEST-TEST");
  const r = await svc.request("SP-TEST-TEST-TEST-TEST", c.id, "demo");
  const parsed = parseOpenid4vpAuthorizationRequest({
    authorizationRequest: r.authorizationRequest,
  });
  assert.ok(parsed);
  const p = await present(c, holder, r),
    response = { state: r.state, vp_token: { account: [p] } };
  const verifier = new Openid4vpVerifier({ callbacks: {} });
  assert.equal(
    verifier.validateOpenid4vpAuthorizationResponsePayload({
      authorizationRequestPayload: r.authorizationRequest,
      authorizationResponsePayload: response,
    }).type,
    "dcql",
  );
  assert.equal((await send("/response", response, null)).status, 400);
  await svc.decide("SP-TEST-TEST-TEST-TEST", r.id, true);
  assert.equal((await send("/response", response, null)).status, 200);
  assert.equal((await send("/response", response, null)).status, 400);
});

test("OpenID invalid grant errors are fixed OAuth codes without request content", async (t) => {
  const { send } = await server(t);
  const r = await send(
    "/token",
    {
      grant_type: "urn:ietf:params:oauth:grant-type:pre-authorized_code",
      "pre-authorized_code": "not-a-code",
      tx_code: "00000000",
    },
    null,
  );
  assert.equal(r.status, 400);
  assert.deepEqual(await r.json(), { error: "invalid_grant" });
});

test("sensitive actions reject old or revoked sessions while existing read/login behavior stays available", async (t) => {
  const old = await server(t, { authTimeMs: Date.now() - 3600000 });
  assert.equal((await old.send("/credentials")).status, 200);
  const r = await old.send("/offers", {});
  assert.equal(r.status, 409);
  assert.deepEqual(await r.json(), { error: "RECENT_LOGIN_REQUIRED" });
  const revoked = await server(t, {
    checkSensitiveSession: async () => {
      throw Error("revoked");
    },
  });
  assert.equal((await revoked.send("/offers", {})).status, 401);
});
test("SD-JWT VCI endpoint binds configuration, strips JWK metadata, confirms selected disclosure and prevents replay", async (t) => {
  const { svc, holder, send } = await server(t),
    offer = await (
      await send("/offers", { configurationId: "schoolpark_account_sd_v1" })
    ).json(),
    code =
      offer.credential_offer.grants[
        "urn:ietf:params:oauth:grant-type:pre-authorized_code"
      ]["pre-authorized_code"];
  const access = await (
    await send(
      "/token",
      {
        grant_type: "urn:ietf:params:oauth:grant-type:pre-authorized_code",
        "pre-authorized_code": code,
        tx_code: offer.tx_code,
      },
      null,
    )
  ).json();
  const n = (await (await send("/nonce", {}, null)).json()).c_nonce;
  const proof = await new SignJWT({ nonce: n })
    .setProtectedHeader({
      typ: "openid4vci-proof+jwt",
      alg: "ES256",
      jwk: { ...holder.jwk, kid: "untrusted-metadata" },
    })
    .setAudience(svc.base + "/sd")
    .setIssuedAt()
    .sign(holder.privateKey);
  const response = await send(
    "/credential",
    {
      credential_configuration_id: "schoolpark_account_sd_v1",
      proofs: { jwt: [proof] },
    },
    access.access_token,
  );
  assert.equal(response.status, 200);
  const credential = (await response.json()).credentials[0].credential;
  const { decodeJwt } = await import("jose");
  assert.equal(decodeJwt(credential.split("~")[0]).cnf.jwk.kid, undefined);
  const cid = decodeJwt(credential.split("~")[0]).status_id,
    r = await svc.request("SP-TEST-TEST-TEST-TEST", cid, "demo", [
      "accountAccess",
    ]);
  await svc.decide("SP-TEST-TEST-TEST-TEST", r.id, true);
  const { presentSelective } = await import("./selective.mjs");
  const p = await presentSelective(credential, holder, r, ["accountAccess"]);
  assert.equal((await svc.receive(r.state, p)).verified, true);
  await assert.rejects(svc.receive(r.state, p));
});

test("unaudited ZKP requires explicit local-only opt-in and can never activate in production", () => {
  const env = {
    PASSPORT_V2_ENABLED: "true",
    PASSPORT_V2_SANDBOX: "true",
    APP_ENV: "local",
    GCLOUD_PROJECT: "demo-test",
    FIRESTORE_EMULATOR_HOST: "127.0.0.1:8787",
    FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9199",
  };
  assert.equal(experimentalZkpEnabled(env), false);
  env.PASSPORT_ZKP_UNAUDITED_TEST_ONLY = "true";
  assert.equal(experimentalZkpEnabled(env), true);
  assert.equal(
    experimentalZkpEnabled({ ...env, NODE_ENV: "production" }),
    false,
  );
});
