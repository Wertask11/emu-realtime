import { test } from "node:test";
import assert from "node:assert/strict";
import { deviceKey, deviceSigner } from "./crypto.mjs";
import {
  issueSelective,
  presentSelective,
  verifySelective,
} from "./selective.mjs";
test("real SD-JWT issuance, selected disclosures and holder binding, absent required field rejection", async () => {
  const issuer = await deviceKey(),
    holder = await deviceKey();
  const encoded = await issueSelective({
    issuer: "https://issuer.example",
    signer: deviceSigner(issuer),
    holderJwk: holder.jwk,
    statusId: "opaque-status",
  });
  const request = {
    client_id: "https://verifier.example",
    nonce: crypto.randomUUID(),
    required: ["accountAccess"],
    selected: ["accountAccess"],
  };
  let revoked = false;
  const options = {
    issuer: "https://issuer.example",
    issuerJwk: issuer.jwk,
    request,
    isRevoked: async () => revoked,
  };
  const presentation = await presentSelective(encoded, holder, request, [
    "accountAccess",
  ]);
  const r = await verifySelective(presentation, options);
  assert.deepEqual(r.claims, { accountAccess: true });
  assert.equal(presentation.includes("platform-account"), false);
  await assert.rejects(presentSelective(encoded, holder, request, []));
  await assert.rejects(
    verifySelective(presentation, {
      ...options,
      request: { ...request, nonce: "wrong" },
    }),
  );
  const attacker = await deviceKey();
  await assert.rejects(
    verifySelective(
      await presentSelective(encoded, attacker, request, ["accountAccess"]),
      options,
    ),
  );
  await assert.rejects(
    verifySelective(presentation, {
      ...options,
      issuer: "https://unknown-issuer.example",
    }),
  );
  await assert.rejects(
    verifySelective(presentation, { ...options, issuerJwk: attacker.jwk }),
  );
  await assert.rejects(
    verifySelective(presentation, {
      ...options,
      request: { ...request, client_id: "https://wrong-audience.example" },
    }),
  );
  revoked = true;
  await assert.rejects(verifySelective(presentation, options));
});
