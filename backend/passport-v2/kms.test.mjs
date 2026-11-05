import { test } from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import formatter from "ecdsa-sig-formatter";
import { awsKmsSigner } from "./kms.mjs";
import { trustRegistry } from "./trust.mjs";
const arn = "arn:aws:kms:ap-northeast-1:123456789012:key/test-key";
test("AWS SDK signing adapter uses non-extractable test key, DER conversion, fail-closed controls and audit", async () => {
  const key = await webcrypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"],
  );
  let enabled = true,
    stop = false;
  const events = [];
  const client = {
    async send(c) {
      if (c.constructor.name === "DescribeKeyCommand")
        return {
          KeyMetadata: {
            Arn: arn,
            KeyState: enabled ? "Enabled" : "Disabled",
            KeyUsage: "SIGN_VERIFY",
            KeySpec: "ECC_NIST_P256",
            Origin: "AWS_KMS",
          },
        };
      if (c.constructor.name === "GetPublicKeyCommand")
        return {
          KeyId: arn,
          KeyUsage: "SIGN_VERIFY",
          KeySpec: "ECC_NIST_P256",
          SigningAlgorithms: ["ECDSA_SHA_256"],
          PublicKey: new Uint8Array(
            await webcrypto.subtle.exportKey("spki", key.publicKey),
          ),
        };
      assert.equal(c.input.MessageType, "RAW");
      const raw = await webcrypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        key.privateKey,
        c.input.Message,
      );
      return {
        KeyId: arn,
        SigningAlgorithm: "ECDSA_SHA_256",
        Signature: formatter.joseToDer(
          Buffer.from(raw).toString("base64url"),
          "ES256",
        ),
      };
    },
  };
  const out = await awsKmsSigner({
    client,
    keyArn: arn,
    issuer: "https://issuer.example",
    verificationMethod: "https://issuer.example#k1",
    assertOperational: async () => {
      if (stop) throw Error("STOP");
    },
    audit: async (e) => events.push(e),
  });
  const data = new TextEncoder().encode("standard-signature-test"),
    sig = await out.signer.sign({ data });
  assert.equal(
    await webcrypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key.publicKey,
      sig,
      data,
    ),
    true,
  );
  assert.equal(events[0].outcome, "success");
  assert.equal(key.privateKey.extractable, false);
  stop = true;
  await assert.rejects(out.signer.sign({ data }));
  stop = false;
  enabled = false;
  await assert.rejects(out.signer.sign({ data }));
});
test("issuer registry retains valid old keys, distrusts compromised keys and emergency stop blocks all", async () => {
  let control = { emergencyStop: false, compromisedKeyIds: [] };
  const registry = trustRegistry({
    issuers: [
      {
        id: "issuer",
        keys: ["old", "new"].map((id) => ({
          publicKey: { id },
          validFrom: "2020-01-01",
          validUntil: "2030-01-01",
        })),
      },
    ],
    verifiers: [],
    readControl: async () => control,
    audit: async () => {},
  });
  assert.equal((await registry.publicKeys()).length, 2);
  control.compromisedKeyIds = ["old"];
  assert.equal((await registry.publicKeys()).length, 1);
  control.emergencyStop = true;
  await assert.rejects(registry.publicKeys());
});

test("trust rejects missing controls, malformed key dates and unregistered verifiers", async () => {
  let control = { emergencyStop: false, compromisedKeyIds: [] };
  const registry = trustRegistry({
    issuers: [
      {
        id: "issuer",
        keys: [
          {
            publicKey: { id: "bad" },
            validFrom: "invalid",
            validUntil: "2030-01-01",
          },
        ],
      },
    ],
    verifiers: [],
    readControl: async () => control,
    audit: async () => {},
  });
  await assert.rejects(registry.assertOperational("bad"));
  await assert.rejects(registry.verifier("not-registered"));
  control = { emergencyStop: false, compromisedKeyIds: [{}] };
  await assert.rejects(registry.publicKeys());
  control = null;
  await assert.rejects(registry.publicKeys());
});
