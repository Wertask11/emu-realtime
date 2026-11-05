import { test } from "node:test";
import assert from "node:assert/strict";
import { SignJWT } from "jose";
import { deviceKey, deviceSigner, present, publicFromJwk } from "./crypto.mjs";
import { createService } from "./service.mjs";
import { fixture } from "./fixture-support.mjs";
test("VC2 signed account credential, consent denial, full disclosure, presentation and replay", async () => {
  const { svc, holder, mint } = await fixture();
  const c = await mint();
  assert.equal(await svc.verify(c), true);
  assert.equal(JSON.stringify(c).includes("alice"), false);
  assert.equal(c.credentialSubject.schemaVersion, "1");
  const denied = await svc.request("alice", c.id, "demo");
  await svc.decide("alice", denied.id, false);
  await assert.rejects(
    svc.submit(
      "alice",
      denied.id,
      await present(c, holder, denied),
      denied.state,
    ),
    /CONSENT_REQUIRED/,
  );
  const r = await svc.request("alice", c.id, "demo");
  await svc.decide("alice", r.id, true);
  const p = await present(c, holder, r);
  assert.deepEqual(await svc.submit("alice", r.id, p, r.state), {
    verified: true,
  });
  await assert.rejects(
    svc.submit("alice", r.id, p, r.state),
    /CONSENT_REQUIRED/,
  );
});
test("revocation, issuer trust, forgery, expiry, wrong holder, authorization and recovery", async () => {
  const { svc, holder, mint } = await fixture();
  const c = await mint();
  for (const mutate of [
    (c) => (c.credentialSubject.accountAccess = false),
    (c) => (c.credentialSubject.email = "private@example.org"),
    (c) => (c.issuer = "https://evil.example"),
    (c) => (c.validUntil = "2000-01-01T00:00:00Z"),
    (c) => (c.proof.proofValue += "A"),
  ]) {
    const bad = structuredClone(c);
    mutate(bad);
    await assert.rejects(svc.verify(bad));
  }
  await assert.rejects(svc.request("bob", c.id, "demo"));
  await assert.rejects(svc.request("alice", c.id, "evil"));
  const r = await svc.request("alice", c.id, "demo");
  await svc.decide("alice", r.id, true);
  const attacker = await deviceKey();
  await assert.rejects(
    svc.submit("alice", r.id, await present(c, attacker, r), r.state),
  );
  await svc.revoke("alice", c.id);
  await assert.rejects(svc.verify(c));
  await assert.rejects(
    svc.submit("alice", r.id, await present(c, holder, r), r.state),
  );
  const replacement = await mint();
  assert.equal(await svc.verify(replacement), true);
  await svc.revoke("alice", replacement.id, true);
  assert.equal((await svc.list("alice")).credentials.length, 1);
  await svc.clearHistory("alice");
  assert.equal((await svc.list("alice")).history.length, 0);
});
test("nonce replay and private JWK rejection", async () => {
  const { svc, holder } = await fixture();
  const n = await svc.nonce("alice");
  const proof = await new SignJWT({ nonce: n })
    .setProtectedHeader({
      typ: "openid4vci-proof+jwt",
      alg: "ES256",
      jwk: holder.jwk,
    })
    .setAudience(svc.base)
    .setIssuedAt()
    .sign(holder.privateKey);
  await svc.issueCredential("alice", { proof, nonce: n });
  await assert.rejects(svc.issueCredential("alice", { proof, nonce: n }));
  await assert.rejects(
    publicFromJwk({ ...holder.jwk, d: "never-accept-private-key" }),
  );
  await assert.rejects(
    svc.issueCredential("alice", { proof, nonce: "forged" }),
  );
});
