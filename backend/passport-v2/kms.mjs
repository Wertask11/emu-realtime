import {
  GetPublicKeyCommand,
  DescribeKeyCommand,
  SignCommand,
} from "@aws-sdk/client-kms";
import { createPublicKey } from "node:crypto";
import formatter from "ecdsa-sig-formatter";
import { publicFromJwk, fail } from "./crypto.mjs";
// SDK uses workload identity/default credential provider; never accept a private key.
export async function awsKmsSigner({
  client,
  keyArn,
  verificationMethod,
  issuer,
  assertOperational,
  audit,
}) {
  if (
    !/^arn:aws:kms:[\w-]+:\d{12}:key\/[\w-]+$/.test(keyArn || "") ||
    typeof assertOperational !== "function" ||
    typeof audit !== "function"
  )
    fail("KMS_CONFIGURATION_REQUIRED");
  const describe = async () => {
    const { KeyMetadata: m } = await client.send(
      new DescribeKeyCommand({ KeyId: keyArn }),
    );
    if (
      !m ||
      m.Arn !== keyArn ||
      m.KeyState !== "Enabled" ||
      m.KeyUsage !== "SIGN_VERIFY" ||
      m.KeySpec !== "ECC_NIST_P256" ||
      !["AWS_KMS", "AWS_CLOUDHSM"].includes(m.Origin)
    )
      fail("KMS_KEY_NOT_USABLE");
  };
  await assertOperational(verificationMethod);
  await describe();
  const result = await client.send(new GetPublicKeyCommand({ KeyId: keyArn }));
  if (
    result.KeyId !== keyArn ||
    result.KeyUsage !== "SIGN_VERIFY" ||
    result.KeySpec !== "ECC_NIST_P256" ||
    !result.SigningAlgorithms?.includes("ECDSA_SHA_256")
  )
    fail("KMS_PUBLIC_KEY_MISMATCH");
  const jwk = createPublicKey({
    key: Buffer.from(result.PublicKey),
    format: "der",
    type: "spki",
  }).export({ format: "jwk" });
  const publicKey = await publicFromJwk(jwk);
  publicKey.id = verificationMethod;
  publicKey.controller = issuer;
  return {
    publicKey,
    jwk,
    signer: {
      id: verificationMethod,
      algorithm: "P-256",
      async sign({ data }) {
        try {
          await assertOperational(verificationMethod);
          await describe();
          const { Signature, KeyId, SigningAlgorithm } = await client.send(
            new SignCommand({
              KeyId: keyArn,
              Message: new Uint8Array(data),
              MessageType: "RAW",
              SigningAlgorithm: "ECDSA_SHA_256",
            }),
          );
          if (
            KeyId !== keyArn ||
            SigningAlgorithm !== "ECDSA_SHA_256" ||
            !Signature
          )
            fail("KMS_SIGNATURE_FAILED");
          const raw = new Uint8Array(
            Buffer.from(
              formatter.derToJose(Buffer.from(Signature), "ES256"),
              "base64url",
            ),
          );
          if (raw.length !== 64) fail("KMS_SIGNATURE_FAILED");
          await assertOperational(verificationMethod);
          await audit({
            event: "issuer_sign",
            keyId: verificationMethod,
            outcome: "success",
          });
          return raw;
        } catch (_) {
          try {
            await audit({
              event: "issuer_sign",
              keyId: verificationMethod,
              outcome: "failed",
            });
          } finally {
            fail("KMS_SIGNATURE_FAILED");
          }
        }
      },
    },
  };
}
