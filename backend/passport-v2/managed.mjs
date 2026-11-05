import { awsKmsSigner } from "./kms.mjs";
import { trustRegistry, firestoreOperations } from "./trust.mjs";
import { createService } from "./service.mjs";
import { publicJwk, fail } from "./crypto.mjs";
// Preparation interface only. Production router activation remains blocked pending release review.
export async function prepareManagedPassport({ config, db, kmsClient }) {
  if (
    !db ||
    !kmsClient ||
    !config?.issuer?.startsWith("https://") ||
    !config.base?.startsWith("https://") ||
    !config.keyArn ||
    !/^[a-f0-9]{64}$/.test(config.storageRealm || "") ||
    !Array.isArray(config.issuers) ||
    !Array.isArray(config.verifiers)
  )
    fail("MANAGED_CONFIGURATION_REQUIRED");
  const ops = firestoreOperations(db, { realm: config.storageRealm }),
    registry = trustRegistry({
      issuers: config.issuers,
      verifiers: config.verifiers,
      readControl: ops.readControl,
      audit: ops.audit,
    });
  const kms = await awsKmsSigner({
    client: kmsClient,
    keyArn: config.keyArn,
    verificationMethod: config.signingKeyId,
    issuer: config.issuer,
    assertOperational: registry.assertOperational,
    audit: ops.audit,
  });
  const trusted = await registry.publicKeys(),
    pin = trusted.find((k) => k.id === kms.publicKey.id);
  if (
    !pin ||
    pin.controller !== config.issuer ||
    pin.publicKeyMultibase !== kms.publicKey.publicKeyMultibase
  )
    fail("KMS_PUBLIC_KEY_MISMATCH");
  for (const v of config.verifiers) await registry.verifier(v.id);
  const service = createService({
    store: (await import("./storage.cjs")).firestoreStore(db, {
      realm: config.storageRealm,
    }),
    issuer: config.issuer,
    base: config.base,
    signer: kms.signer,
    keys: trusted,
    verifiers: config.verifiers,
    operational: registry.assertOperational,
  });
  return {
    service: {
      ...service,
      publicKeys: registry.publicKeys,
      async verify(c) {
        await registry.assertOperational(c.proof?.verificationMethod);
        return service.verify(c);
      },
      async issuerMetadata() {
        const keys = await registry.publicKeys();
        return {
          issuer: config.issuer,
          jwks: {
            keys: await Promise.all(
              keys.map(async (k) => ({
                ...(await publicJwk(k)),
                kid: k.id,
                alg: "ES256",
                use: "sig",
              })),
            ),
          },
        };
      },
    },
    registry,
    operations: ops,
  };
}
