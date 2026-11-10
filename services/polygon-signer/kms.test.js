"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  crypto = require("node:crypto"),
  ethers = require("ethers");
const { secp256k1 } = require("@noble/curves/secp256k1"),
  { createKMSSigner } = require("./kms");
const keyId =
  "arn:aws:kms:ap-northeast-1:123456789012:key/11111111-1111-1111-1111-111111111111";
function fixture(patch = {}) {
  const kp = crypto.generateKeyPairSync("ec", { namedCurve: "secp256k1" }),
    jwk = kp.privateKey.export({ format: "jwk" }),
    priv = Buffer.from(jwk.d, "base64url"),
    pub = kp.publicKey.export({ type: "spki", format: "der" }),
    address = new ethers.Wallet(priv).address;
  let signed = 0,
    last;
  const client = {
    send: async (c) => {
      if (c.constructor.name === "DescribeKeyCommand")
        return {
          KeyMetadata: {
            Arn: keyId,
            KeySpec: "ECC_SECG_P256K1",
            KeyUsage: "SIGN_VERIFY",
            KeyState: "Enabled",
            Origin: "AWS_KMS",
            ...patch,
          },
        };
      if (c.constructor.name === "GetPublicKeyCommand")
        return {
          KeyId: keyId,
          KeySpec: "ECC_SECG_P256K1",
          KeyUsage: "SIGN_VERIFY",
          SigningAlgorithms: ["ECDSA_SHA_256"],
          PublicKey: pub,
        };
      assert.equal(c.constructor.name, "SignCommand");
      assert.equal(c.input.MessageType, "DIGEST");
      assert.equal(c.input.SigningAlgorithm, "ECDSA_SHA_256");
      last = ethers.utils.hexlify(c.input.Message);
      signed++;
      const s = secp256k1.sign(c.input.Message, priv);
      const high = new secp256k1.Signature(s.r, secp256k1.CURVE.n - s.s);
      return {
        KeyId: keyId,
        SigningAlgorithm: "ECDSA_SHA_256",
        Signature: Buffer.from(high.toDERHex(), "hex"),
      };
    },
  };
  return {
    signer: createKMSSigner({ keyId, address, client }),
    signed: () => signed,
    last: () => last,
  };
}
test("KMS secp256k1 DIGEST signs Ethereum keccak; high-S normalized and recovered", async () => {
  const f = fixture(),
    tx = {
      chainId: 137,
      to: "0x" + "2".repeat(40),
      value: 0,
      gasPrice: 100,
      gasLimit: 50000,
      nonce: 3,
      data: "0x",
    };
  const raw = await f.signer.signTransaction(tx),
    p = ethers.utils.parseTransaction(raw);
  assert.equal(p.from, f.signer.address);
  assert.equal(p.chainId, 137);
  assert.equal(p.nonce, 3);
  assert.equal(f.signed(), 1);
  assert.equal(
    f.last(),
    ethers.utils.keccak256(ethers.utils.serializeTransaction(tx)),
  );
  assert(BigInt(p.s) <= secp256k1.CURVE.n / 2n);
});
for (const patch of [
  { KeySpec: "ECC_NIST_P256" },
  { KeyState: "Disabled" },
  { Origin: "EXTERNAL" },
  { KeyUsage: "ENCRYPT_DECRYPT" },
])
  test("invalid KMS key fails closed " + JSON.stringify(patch), async () => {
    const f = fixture(patch);
    await assert.rejects(f.signer.validate(), /KMS_KEY_POLICY_INVALID/);
    assert.equal(f.signed(), 0);
  });
test("KMS outage never falls back to private key", async () => {
  const signer = createKMSSigner({
    keyId,
    address: "0x" + "1".repeat(40),
    client: {
      send: async () => {
        throw Error("isolated outage");
      },
    },
  });
  await assert.rejects(signer.signTransaction({}), /isolated outage/);
});
