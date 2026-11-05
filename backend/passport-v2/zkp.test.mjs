import { test } from "node:test";
import dock from "@docknetwork/crypto-wasm-ts";
import assert from "node:assert/strict";
import { sandboxZkpIssuer } from "./zkp-issuer.mjs";
import { generateZkp, verifyZkp } from "./zkp-proof.mjs";
const request = (useCase) => {
  const now = Date.now();
  return {
    useCase,
    client_id: "https://verifier.example",
    nonce: crypto.randomUUID().replaceAll("-", "") + "1234",
    asOf: now,
    expires: now + 300000,
  };
};
for (const useCase of ["age18", "identity", "city"])
  test(
    "real ZKP " +
      useCase +
      ": hidden predicate, signature proof, forgery, audience, randomization, revocation",
    async () => {
      const issuer = await sandboxZkpIssuer(),
        id = await issuer.issueTest(),
        bundle = await issuer.bundle(id),
        r = request(useCase),
        proof = await generateZkp(bundle, r),
        data = issuer.publicData();
      assert.equal(
        (await verifyZkp(proof, { request: r, publicData: data })).verified,
        true,
      );
      const raw = JSON.stringify(proof);
      assert.ok(
        !raw.includes("SYNTHETIC TEST PERSON") &&
          !raw.includes("SYNTHETIC TEST ADDRESS") &&
          !raw.includes(bundle.credential.credentialSubject.holderSecret),
      );
      const other = await generateZkp(bundle, r);
      assert.notEqual(JSON.stringify(other.proof), JSON.stringify(proof.proof));
      await assert.rejects(
        verifyZkp(proof, {
          request: { ...r, client_id: "https://attacker.example" },
          publicData: data,
        }),
      );
      const bad = dock.Presentation.fromJSON(proof);
      const changed = Uint8Array.from(bad.proof.bytes);
      changed[Math.floor(changed.length / 2)] ^= 1;
      bad.proof.value = changed;
      await assert.rejects(verifyZkp(bad.toJSON(), { request: r, publicData: data }));
      await issuer.revoke(id);
      await assert.rejects(
        verifyZkp(proof, { request: r, publicData: issuer.publicData() }),
      );
    },
  );
test("ZKP refuses underage / unverified / unauthorized / expired synthetic credentials", async () => {
  for (const [useCase, values] of [
    ["age18", { birthDay: 44000 }],
    ["identity", { verified: 0 }],
    ["city", { shop: 0 }],
    ["age18", { validUntil: 10000 }],
  ]) {
    const issuer = await sandboxZkpIssuer(),
      id = await issuer.issueTest(values);
    await assert.rejects(
      generateZkp(await issuer.bundle(id), request(useCase)),
    );
  }
});

test("separate verifier process accepts public proof without issuer/holder secrets and rejects injected tracking pseudonym", async () => {
  const { spawnSync } = await import("node:child_process");
  const issuer = await sandboxZkpIssuer(),
    id = await issuer.issueTest(),
    r = request("age18"),
    proof = await generateZkp(await issuer.bundle(id), r),
    data = issuer.publicData();
  const run = spawnSync(
    process.execPath,
    [
      new URL(
        "../../tools/passport-v2-tests/independent-zkp-verifier.cjs",
        import.meta.url,
      ).pathname,
    ],
    {
      input: JSON.stringify({
        presentation: proof,
        publicData: data,
        context: proof.context,
      }),
      encoding: "utf8",
      timeout: 30000,
    },
  );
  assert.equal(run.status, 0);
  assert.equal(run.stdout, "VERIFIED");
  const bad = structuredClone(proof);
  bad.spec.unboundedPseudonyms = { tracking: "undeclared" };
  await assert.rejects(verifyZkp(bad, { request: r, publicData: data }));
});

// Keep the unmet release criterion visible. Do not substitute a core-byte mutation
// and silently claim that the library rejects all non-canonical encodings.
test(
  "RELEASE BLOCKER: Dock rejects appended proof bytes",
  {
    todo: "Dock 0.33.0 accepts trailing bytes; strict canonical deserialization needs upstream review",
  },
  async () => {
    const issuer = await sandboxZkpIssuer(),
      id = await issuer.issueTest(),
      r = request("city");
    const proof = await generateZkp(await issuer.bundle(id), r);
    const p = dock.Presentation.fromJSON(proof);
    p.proof.value = Uint8Array.from([...p.proof.bytes, 0]);
    await assert.rejects(
      verifyZkp(p.toJSON(), { request: r, publicData: issuer.publicData() }),
    );
  },
);
