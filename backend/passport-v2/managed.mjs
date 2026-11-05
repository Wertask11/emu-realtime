import { awsKmsSigner } from "./kms.mjs";
import { trustRegistry, firestoreOperations } from "./trust.mjs";
import { createService } from "./service.mjs";
import { publicJwk, fail } from "./crypto.mjs";
import { authorizationServer } from "./authorization.mjs";
import { sharedRateLimit } from "./rate-limit.mjs";
import { decodeProtectedHeader } from "jose";
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
  const frontend = new URL(config.frontendUrl || config.base);
  if (
    frontend.origin !== new URL(config.base).origin ||
    frontend.username ||
    frontend.password ||
    frontend.search ||
    frontend.hash
  )
    fail("MANAGED_CONFIGURATION_REQUIRED");
  const clients = config.authorizationClients || [];
  if (
    !Array.isArray(clients) ||
    clients.some((c) => {
      try {
        const u = new URL(c.redirectUri);
        return (
          !c.id ||
          !c.name ||
          u.protocol !== "https:" ||
          !!u.username ||
          !!u.password ||
          !!u.hash
        );
      } catch (_) {
        return true;
      }
    })
  )
    fail("MANAGED_CONFIGURATION_REQUIRED");
  const store = (await import("./storage.cjs")).firestoreStore(db, {
    realm: config.storageRealm,
  });
  const service = createService({
    store,
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
      async list(owner) {
        const data = await service.list(owner),
          live = new Set((await registry.publicKeys()).map((k) => k.id));
        for (const item of data.credentials) {
          const keyId =
            item.format === "dc+sd-jwt"
              ? decodeProtectedHeader(item.credential.split("~")[0]).kid
              : item.credential.proof.verificationMethod;
          item.issuerTrusted = live.has(keyId);
        }
        return data;
      },
      authorization: authorizationServer({
        store,
        clients,
        frontendUrl: frontend.href,
      }),
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

// Explicit factory for a reviewed deployment bootstrap. Existing server.js never
// invokes it automatically; flags cannot replace Founder approval or real KMS.
export async function createManagedRouter({
  config,
  db,
  kmsClient,
  rateHmacKey,
  identity,
  requireFirebaseUser,
  checkSensitiveSession,
}) {
  if (
    typeof requireFirebaseUser !== "function" ||
    typeof checkSensitiveSession !== "function" ||
    !identity?.findByUid
  )
    fail("MANAGED_CONFIGURATION_REQUIRED");
  const limit = sharedRateLimit({
    db,
    realm: config.storageRealm,
    hmacKey: rateHmacKey,
  });
  const prepared = await prepareManagedPassport({ config, db, kmsClient });
  const { createRouter } = await import("./router.cjs");
  return {
    ...prepared,
    router: createRouter({
      db,
      identity,
      requireFirebaseUser,
      checkSensitiveSession,
      servicePromise: Promise.resolve(prepared.service),
      releaseCandidate: true,
      sharedRequestLimit: limit,
      operationalGuard: () =>
        prepared.registry.assertOperational(config.signingKeyId),
      env: {},
    }),
  };
}
