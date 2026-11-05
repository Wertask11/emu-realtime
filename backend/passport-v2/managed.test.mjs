import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import { SignJWT } from "jose";
import { deviceKey } from "./crypto.mjs";
import { createManagedRouter, prepareManagedPassport } from "./managed.mjs";

import { testDatabase, testKms } from "./kms-fixture-support.mjs";
async function setup() {
  const db = testDatabase(),
    realm = "c".repeat(64),
    key = await deviceKey(),
    arn = "arn:aws:kms:ap-northeast-1:123456789012:key/synthetic";
  key.publicKey.controller = "https://issuer.example/api/passport-v2/issuer";
  key.publicKey.id = key.publicKey.controller + "#one";
  const control = { emergencyStop: false, compromisedKeyIds: [] };
  db.rows.set("passport_v2_controls/" + realm + "-issuer", control);
  const config = {
    issuer: key.publicKey.controller,
    base: "https://issuer.example/api/passport-v2",
    frontendUrl: "https://issuer.example/",
    storageRealm: realm,
    keyArn: arn,
    signingKeyId: key.publicKey.id,
    issuers: [
      {
        id: key.publicKey.controller,
        keys: [
          {
            publicKey: key.publicKey,
            validFrom: "2020-01-01",
            validUntil: "2030-01-01",
          },
        ],
      },
    ],
    verifiers: [],
    authorizationClients: [],
  };
  return {
    db,
    realm,
    key,
    config,
    control,
    kmsClient: await testKms(key, arn),
  };
}
test("managed adapter connects actual HTTP router; RC rejects every ZKP shape before parsing or auth", async (t) => {
  const f = await setup();
  let authCalls = 0;
  const prepared = await createManagedRouter({
    ...f,
    rateHmacKey: new Uint8Array(32),
    identity: { findByUid: async () => "synthetic-account" },
    requireFirebaseUser: (req, res, next) => {
      authCalls++;
      res.status(401).json({ error: "AUTH_REQUIRED" });
    },
    checkSensitiveSession: async () => {},
  });
  const app = express();
  app.use("/api/passport-v2", prepared.router);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((r) => server.close(r)));
  const base = "http://127.0.0.1:" + server.address().port + "/api/passport-v2";
  const cap = await (await fetch(base + "/capabilities")).json();
  assert.equal(cap.releaseCandidate, true);
  assert.equal(cap.zkp, false);
  assert.equal(cap.zkpSandbox, false);
  for (const body of [
    "{}",
    '{"proof":"extra trailing bytes"}',
    "{INVALID",
    '{"proof":[]}',
    "null",
  ]) {
    const r = await fetch(base + "/zkp/response", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    assert.equal(r.status, 404);
    assert.equal((await r.json()).error, "ZKP_EXCLUDED_FROM_RC");
  }
  assert.equal(authCalls, 0);
  assert.equal((await fetch(base + "/metadata")).status, 200);
  f.control.emergencyStop = true;
  assert.equal((await fetch(base + "/metadata")).status, 503);
  assert.equal((await fetch(base + "/credentials")).status, 503);
});
test("managed signing outage fails closed; rotated public ring verifies previously issued VC and compromise rejects it", async () => {
  const f = await setup(),
    old = await prepareManagedPassport(f),
    holder = await deviceKey(),
    n = await old.service.nonce();
  const proof = await new SignJWT({ nonce: n })
    .setProtectedHeader({
      typ: "openid4vci-proof+jwt",
      alg: "ES256",
      jwk: holder.jwk,
    })
    .setAudience(f.config.base)
    .setIssuedAt()
    .sign(holder.privateKey);
  const c = await old.service.issueCredential("synthetic", { proof, nonce: n });
  assert.ok(c.proof);
  const next = await deviceKey();
  next.publicKey.controller = f.config.issuer;
  next.publicKey.id = f.config.issuer + "#two";
  const config = structuredClone(f.config);
  config.signingKeyId = next.publicKey.id;
  config.issuers[0].keys.push({
    publicKey: next.publicKey,
    validFrom: "2020-01-01",
    validUntil: "2030-01-01",
  });
  const kmsClient = await testKms(next, config.keyArn),
    rotated = await prepareManagedPassport({ ...f, config, kmsClient });
  assert.equal(await rotated.service.verify(c), true);
  const n2 = await rotated.service.nonce();
  const p2 = await new SignJWT({ nonce: n2 })
    .setProtectedHeader({
      typ: "openid4vci-proof+jwt",
      alg: "ES256",
      jwk: holder.jwk,
    })
    .setAudience(f.config.base)
    .setIssuedAt()
    .sign(holder.privateKey);
  kmsClient.setOutage(true);
  await assert.rejects(
    rotated.service.issueCredential("synthetic", { proof: p2, nonce: n2 }),
  );
  assert.equal((await rotated.service.list("synthetic")).credentials.length, 1);
  kmsClient.setOutage(false);
  f.control.compromisedKeyIds = [f.config.signingKeyId];
  await assert.rejects(rotated.service.verify(c));
  assert.equal((await rotated.registry.publicKeys()).length, 1);
  assert.equal(
    (await rotated.service.list("synthetic")).credentials[0].issuerTrusted,
    false,
  );
});
test("managed bootstrap refuses absent controls, wrong public pin and cross-origin consent page", async () => {
  const f = await setup();
  await assert.rejects(
    prepareManagedPassport({
      ...f,
      config: { ...f.config, frontendUrl: "https://attacker.example/" },
    }),
  );
  const wrong = await deviceKey(),
    config = structuredClone(f.config);
  config.issuers[0].keys[0].publicKey.publicKeyMultibase =
    wrong.publicKey.publicKeyMultibase;
  await assert.rejects(prepareManagedPassport({ ...f, config }));
  f.db.rows.clear();
  await assert.rejects(prepareManagedPassport(f));
});

test("workload-only client rejects absent federation settings without reading credentials", async () => {
  const { workloadKmsClient } = await import("./workload-kms.mjs");
  assert.throws(() => workloadKmsClient({ region: "ap-northeast-1" }));
  const client = workloadKmsClient({
    region: "ap-northeast-1",
    roleArn: "arn:aws:iam::123456789012:role/synthetic",
    tokenFile: "/tmp/nonexistent-workload-token",
  });
  assert.equal(typeof client.config.credentials, "function");
  assert.equal(
    (await client.config.endpoint()).hostname,
    "kms.ap-northeast-1.amazonaws.com",
  );
  client.destroy();
});
