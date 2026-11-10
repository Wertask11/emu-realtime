"use strict";
const { createPublicKey } = require("node:crypto");
const {
  DescribeKeyCommand,
  GetPublicKeyCommand,
  SignCommand,
} = require("@aws-sdk/client-kms");
const { secp256k1 } = require("@noble/curves/secp256k1");
const ethers = require("ethers");
// No raw/private key or credentials parameters. AWS SDK uses workload credentials.
function createKMSSigner({ keyId, address, client }) {
  if (!/^arn:aws:kms:[a-z0-9-]+:\d{12}:key\/[a-f0-9-]{36}$/.test(keyId || ""))
    throw Error("KMS_KEY_ARN_REQUIRED");
  if (!client || typeof client.send !== "function")
    throw Error("WORKLOAD_KMS_CLIENT_REQUIRED");
  const pinned = ethers.utils.getAddress(address);
  async function validate() {
    const { KeyMetadata: m } = await client.send(
      new DescribeKeyCommand({ KeyId: keyId }),
    );
    if (
      m?.Arn !== keyId ||
      m.KeySpec !== "ECC_SECG_P256K1" ||
      m.KeyUsage !== "SIGN_VERIFY" ||
      m.KeyState !== "Enabled" ||
      m.Origin !== "AWS_KMS"
    )
      throw Error("KMS_KEY_POLICY_INVALID");
    const k = await client.send(new GetPublicKeyCommand({ KeyId: keyId }));
    if (
      k.KeyId !== keyId ||
      k.KeySpec !== "ECC_SECG_P256K1" ||
      k.KeyUsage !== "SIGN_VERIFY" ||
      !k.SigningAlgorithms?.includes("ECDSA_SHA_256")
    )
      throw Error("KMS_KEY_POLICY_INVALID");
    const jwk = createPublicKey({
      key: Buffer.from(k.PublicKey),
      type: "spki",
      format: "der",
    }).export({ format: "jwk" });
    if (jwk.kty !== "EC" || jwk.crv !== "secp256k1")
      throw Error("KMS_PUBLIC_KEY_INVALID");
    const pub = Buffer.concat([
      Buffer.from([4]),
      Buffer.from(jwk.x, "base64url"),
      Buffer.from(jwk.y, "base64url"),
    ]);
    if (ethers.utils.computeAddress(pub) !== pinned)
      throw Error("KMS_ADDRESS_MISMATCH");
  }
  async function signTransaction(tx) {
    await validate(); // Disabled/replaced keys fail closed on every request.
    const unsigned = ethers.utils.serializeTransaction(tx),
      digest = ethers.utils.keccak256(unsigned);
    const result = await client.send(
      new SignCommand({
        KeyId: keyId,
        Message: ethers.utils.arrayify(digest),
        MessageType: "DIGEST",
        SigningAlgorithm: "ECDSA_SHA_256",
      }),
    );
    if (result.KeyId !== keyId || result.SigningAlgorithm !== "ECDSA_SHA_256")
      throw Error("KMS_SIGNATURE_INVALID");
    const sig = secp256k1.Signature.fromDER(
      Buffer.from(result.Signature),
    ).normalizeS();
    let signature;
    for (const recoveryParam of [0, 1]) {
      const candidate = {
        r: "0x" + sig.r.toString(16).padStart(64, "0"),
        s: "0x" + sig.s.toString(16).padStart(64, "0"),
        recoveryParam,
      };
      if (ethers.utils.recoverAddress(digest, candidate) === pinned)
        signature = candidate;
    }
    if (!signature) throw Error("KMS_SIGNATURE_INVALID");
    return ethers.utils.serializeTransaction(tx, signature);
  }
  return { address: pinned, validate, signTransaction };
}
module.exports = { createKMSSigner };
