import { test } from "node:test";
import assert from "node:assert/strict";
import { SignJWT } from "jose";
import { deviceKey, present, loader, CONTEXT_URL, TERMS } from "./crypto.mjs";
import { fixture } from "./fixture-support.mjs";
import { readFileSync } from "node:fs";
async function approved(f) {
  const c = await f.mint(),
    r = await f.svc.request("alice", c.id, "demo");
  await f.svc.decide("alice", r.id, true);
  return { c, r, p: await present(c, f.holder, r) };
}
test("concurrent replay permits exactly one verified presentation", async () => {
  const f = await fixture(),
    { r, p } = await approved(f);
  const results = await Promise.allSettled([
    f.svc.receive(r.state, p),
    f.svc.receive(r.state, p),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
});
test("consent withdrawal invalidates approved but not submitted presentation", async () => {
  const f = await fixture(),
    { r, p } = await approved(f);
  await f.svc.clearHistory("alice");
  await assert.rejects(f.svc.receive(r.state, p));
});
test("recipient, nonce and state tampering fail without consuming legitimate request", async () => {
  const f = await fixture(),
    { c, r, p } = await approved(f);
  await assert.rejects(f.svc.receive(r.state + "x", p));
  for (const k of ["client_id", "nonce"]) {
    const bad = await present(c, f.holder, {
      ...r,
      [k]: "https://attacker.invalid",
    });
    await assert.rejects(f.svc.receive(r.state, bad));
  }
  assert.equal((await f.svc.receive(r.state, p)).verified, true);
});
test("credential cannot be swapped after consent", async () => {
  const f = await fixture(),
    { r } = await approved(f),
    other = await f.mint();
  await assert.rejects(
    f.svc.receive(r.state, await present(other, f.holder, r)),
  );
});
test("lost device: revoke former key, use a new non-extractable device key", async () => {
  const f = await fixture(),
    old = await f.mint();
  await f.svc.revoke("alice", old.id);
  const key = await deviceKey(),
    nonce = await f.svc.nonce();
  assert.equal(key.privateKey.extractable, false);
  await assert.rejects(crypto.subtle.exportKey("jwk", key.privateKey));
  const proof = await new SignJWT({ nonce })
    .setProtectedHeader({
      typ: "openid4vci-proof+jwt",
      alg: "ES256",
      jwk: key.jwk,
    })
    .setAudience(f.svc.base)
    .setIssuedAt()
    .sign(key.privateKey);
  const c = await f.svc.issueCredential("alice", { proof, nonce });
  assert.notEqual(c.credentialSubject.id, old.credentialSubject.id);
  assert.equal(await f.svc.verify(c), true);
  await assert.rejects(f.svc.verify(old));
});
test("pre-authorized code PIN attempts bounded, access token single-use and scope confined", async () => {
  const f = await fixture(),
    o = await f.svc.offer("alice"),
    code =
      o.credential_offer.grants[
        "urn:ietf:params:oauth:grant-type:pre-authorized_code"
      ]["pre-authorized_code"];
  for (let i = 0; i < 5; i++)
    await assert.rejects(f.svc.exchange(code, "00000000"));
  await assert.rejects(f.svc.exchange(code, o.tx_code));
  const n = await f.svc.offer("alice"),
    token = await f.svc.exchange(
      n.credential_offer.grants[
        "urn:ietf:params:oauth:grant-type:pre-authorized_code"
      ]["pre-authorized_code"],
      n.tx_code,
    );
  assert.equal(await f.svc.consumeToken(token.access_token), "alice");
  await assert.rejects(f.svc.consumeToken(token.access_token));
});
test("nonce and presentation expiry enforced server-side", async () => {
  const f = await fixture(),
    { r, p } = await approved(f);
  await f.store.run("alice", (a) => {
    a.requests[r.id].expires = 0;
  });
  await assert.rejects(f.svc.receive(r.state, p));
  const nonce = await f.svc.nonce();
  await f.store.run("alice", (a, s) => {
    for (const k in s.nonces) s.nonces[k] = 0;
  });
  const proof = await new SignJWT({ nonce })
    .setProtectedHeader({
      typ: "openid4vci-proof+jwt",
      alg: "ES256",
      jwk: f.holder.jwk,
    })
    .setAudience(f.svc.base)
    .setIssuedAt()
    .sign(f.holder.privateKey);
  await assert.rejects(f.svc.issueCredential("alice", { proof, nonce }));
});
test("no remote document fetch; pinned context matches downloadable versioned context", async () => {
  const l = loader([]);
  await assert.rejects(l("http://169.254.169.254/latest/meta-data"));
  assert.deepEqual(
    (await l(CONTEXT_URL)).document,
    JSON.parse(
      readFileSync(
        new URL(
          "../../frontend/public/passport-v2/contexts/account-v1.jsonld",
          import.meta.url,
        ),
      ),
    ),
  );
  assert.deepEqual((await l(CONTEXT_URL)).document["@context"], TERMS);
});
test("government adapter cannot turn a mock or self-declaration into a credential", async () => {
  const { governmentReadiness, evaluateMock } = await import(
    "./government.mjs"
  );
  assert.equal(governmentReadiness().connected, false);
  assert.equal(evaluateMock({ scenario: "success" }).governmentVerified, false);
  assert.throws(() =>
    evaluateMock({ scenario: "success", individualNumber: "123456789012" }),
  );
});

test("completed and refused requests do not exhaust the active consent quota", async () => {
  const f = await fixture(),
    c = await f.mint();
  for (let i = 0; i < 12; i++) {
    const r = await f.svc.request("alice", c.id, "demo");
    await f.svc.decide("alice", r.id, false);
  }
  const r = await f.svc.request("alice", c.id, "demo");
  await f.svc.decide("alice", r.id, true);
  await f.svc.decide("alice", r.id, false);
  await assert.rejects(f.svc.receive(r.state, await present(c, f.holder, r)));
});

test("versioned JSON Schema independently validates profile and rejects unknown attributes / future unapproved versions", async () => {
  const { default: Ajv } = await import("ajv/dist/2020.js");
  const schema = JSON.parse(
    readFileSync(
      new URL(
        "../../frontend/public/passport-v2/schemas/account-v1.json",
        import.meta.url,
      ),
    ),
  );
  const validate = new Ajv().compile(schema),
    f = await fixture(),
    c = await f.mint();
  assert.equal(validate(c), true);
  for (const subject of [
    { ...c.credentialSubject, schemaVersion: "2" },
    { ...c.credentialSubject, individualNumber: "123456789012" },
    { ...c.credentialSubject, governmentVerified: true },
  ])
    assert.equal(validate({ ...c, credentialSubject: subject }), false);
});

test("issuer key rotation retains old public-key verification and withdrawn trust rejects old signatures", async () => {
  const f = await fixture(),
    c = await f.mint(),
    next = await deviceKey();
  next.publicKey.controller = f.svc.issuer;
  next.publicKey.id = f.svc.issuer + "#rotated";
  const { createService } = await import("./service.mjs");
  const { deviceSigner } = await import("./crypto.mjs");
  const rotated = createService({
    store: f.store,
    issuer: f.svc.issuer,
    base: f.svc.base,
    signer: deviceSigner(next),
    keys: [...f.svc.keys, next.publicKey],
  });
  assert.equal(await rotated.verify(c), true);
  const untrusted = createService({
    store: f.store,
    issuer: f.svc.issuer,
    base: f.svc.base,
    signer: deviceSigner(next),
    keys: [next.publicKey],
  });
  await assert.rejects(untrusted.verify(c));
});
