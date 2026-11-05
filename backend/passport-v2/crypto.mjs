// Maintained W3C Data Integrity implementations. No network document resolution.
import * as vc from "@digitalbazaar/vc";
import * as multikey from "@digitalbazaar/ecdsa-multikey";
import { DataIntegrityProof } from "@digitalbazaar/data-integrity";
import { cryptosuite } from "@digitalbazaar/ecdsa-rdfc-2019-cryptosuite";
import { contexts } from "@digitalbazaar/credentials-context";
import { contexts as securityContexts } from "@digitalbazaar/security-context";
import {
  BitstringStatusList,
  createCredential,
  checkStatus,
} from "@digitalbazaar/vc-bitstring-status-list";
export const V2 = "https://www.w3.org/ns/credentials/v2";
export const TYPE = "SchoolParkAccountCredential";
export const TERMS = Object.freeze({
  SchoolParkAccountCredential:
    "https://emu-for-schoolpark.vercel.app/passport-v2/vocab#SchoolParkAccountCredential",
  accountAccess:
    "https://emu-for-schoolpark.vercel.app/passport-v2/vocab#accountAccess",
  assurance:
    "https://emu-for-schoolpark.vercel.app/passport-v2/vocab#assurance",
  schemaVersion:
    "https://emu-for-schoolpark.vercel.app/passport-v2/vocab#schemaVersion",
});
export const CONTEXT_URL =
  "https://emu-for-schoolpark.vercel.app/passport-v2/contexts/account-v1.jsonld";
export const CONTEXT = [V2, CONTEXT_URL];
export function fail(code = "INVALID_CREDENTIAL") {
  throw Object.assign(new Error(code), { code });
}
export function exact(o, fields) {
  if (
    !o ||
    typeof o !== "object" ||
    Array.isArray(o) ||
    Object.keys(o).some((k) => !fields.includes(k))
  )
    fail("INVALID_FIELDS");
}
export async function publicFromJwk(jwk) {
  exact(jwk, ["kty", "crv", "x", "y", "key_ops", "ext", "alg", "use"]);
  if (
    jwk.kty !== "EC" ||
    jwk.crv !== "P-256" ||
    !/^[\w-]{43}$/.test(jwk.x) ||
    !/^[\w-]{43}$/.test(jwk.y)
  )
    fail("INVALID_KEY");
  const k = await multikey.fromJwk({ jwk });
  const pub = await k.export({ publicKey: true, includeContext: true });
  pub.controller = `did:key:${pub.publicKeyMultibase}`;
  pub.id = `${pub.controller}#${pub.publicKeyMultibase}`;
  return pub;
}
export async function deviceKey() {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return {
    privateKey: pair.privateKey,
    jwk,
    publicKey: await publicFromJwk(jwk),
  };
}
export function deviceSigner(key) {
  return {
    id: key.publicKey.id,
    algorithm: "P-256",
    async sign({ data }) {
      return new Uint8Array(
        await crypto.subtle.sign(
          { name: "ECDSA", hash: "SHA-256" },
          key.privateKey,
          data,
        ),
      );
    },
  };
}
export function loader(keys, documents = new Map()) {
  const docs = new Map([
    ...contexts,
    ...securityContexts,
    [CONTEXT_URL, { "@context": TERMS }],
    ...documents,
  ]);
  for (const k of keys) {
    docs.set(k.id, k);
    docs.set(k.controller, {
      "@context": ["https://w3id.org/security/v2"],
      id: k.controller,
      assertionMethod: keys
        .filter((other) => other.controller === k.controller)
        .map((other) => other.id),
      authentication: keys
        .filter((other) => other.controller === k.controller)
        .map((other) => other.id),
    });
  }
  return async (url) => {
    if (!docs.has(url)) fail("UNTRUSTED_DOCUMENT");
    return {
      contextUrl: null,
      documentUrl: url,
      document: structuredClone(docs.get(url)),
    };
  };
}
export function suite(signer) {
  return new DataIntegrityProof({ cryptosuite, ...(signer ? { signer } : {}) });
}
export async function issue(credential, signer, keys) {
  return vc.issue({
    credential,
    suite: suite(signer),
    documentLoader: loader(keys),
  });
}
export function validateAccount(c, issuer, now = Date.now()) {
  exact(c, [
    "@context",
    "id",
    "type",
    "issuer",
    "validFrom",
    "validUntil",
    "credentialSubject",
    "credentialStatus",
    "proof",
  ]);
  if (
    JSON.stringify(c["@context"]) !== JSON.stringify(CONTEXT) ||
    JSON.stringify(c.type) !== JSON.stringify(["VerifiableCredential", TYPE]) ||
    c.issuer !== issuer ||
    !/^urn:uuid:[\da-f-]{36}$/.test(c.id)
  )
    fail();
  exact(c.credentialSubject, [
    "id",
    "accountAccess",
    "assurance",
    "schemaVersion",
  ]);
  const s = c.credentialSubject;
  if (
    !/^did:key:z[1-9A-HJ-NP-Za-km-z]{20,150}$/.test(s.id) ||
    s.accountAccess !== true ||
    s.assurance !== "platform-account" ||
    s.schemaVersion !== "1"
  )
    fail();
  const start = Date.parse(c.validFrom),
    end = Date.parse(c.validUntil);
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start > now + 30000 ||
    end <= now ||
    end <= start ||
    end - start > 31 * 86400000
  )
    fail("CREDENTIAL_EXPIRED");
  exact(c.proof, [
    "type",
    "cryptosuite",
    "created",
    "verificationMethod",
    "proofPurpose",
    "proofValue",
  ]);
  if (
    c.proof.type !== "DataIntegrityProof" ||
    c.proof.cryptosuite !== "ecdsa-rdfc-2019" ||
    c.proof.proofPurpose !== "assertionMethod"
  )
    fail();
}
export async function makeStatus({
  url,
  issuer,
  signer,
  keys,
  revoked,
  now = Date.now(),
}) {
  const list = new BitstringStatusList({ length: 131072 });
  for (const i of revoked) list.setStatus(i, true);
  const c = await createCredential({
    id: url,
    list,
    statusPurpose: "revocation",
  });
  Object.assign(c, {
    issuer,
    validFrom: new Date(now).toISOString(),
    validUntil: new Date(now + 300000).toISOString(),
  });
  return issue(c, signer, keys);
}
export async function verifyAccount(
  c,
  { issuer, keys, status, statusUrl, now = Date.now() },
) {
  validateAccount(c, issuer, now);
  const cs = c.credentialStatus;
  exact(cs, [
    "id",
    "type",
    "statusPurpose",
    "statusListCredential",
    "statusListIndex",
  ]);
  if (
    cs.type !== "BitstringStatusListEntry" ||
    cs.statusPurpose !== "revocation" ||
    cs.statusListCredential !== statusUrl ||
    !/^\d{1,6}$/.test(cs.statusListIndex) ||
    +cs.statusListIndex >= 131072 ||
    cs.id !== `${statusUrl}#${cs.statusListIndex}`
  )
    fail();
  const key = keys.find(
    (k) => k.id === c.proof.verificationMethod && k.controller === issuer,
  );
  if (!key) fail("UNTRUSTED_ISSUER_KEY");
  if (
    status.issuer !== issuer ||
    status.id !== statusUrl ||
    Date.parse(status.validUntil) <= now ||
    Date.parse(status.validFrom) > now + 30000
  )
    fail("STATUS_UNAVAILABLE");
  const documentLoader = loader(keys, new Map([[statusUrl, status]]));
  const result = await vc.verifyCredential({
    credential: c,
    suite: suite(),
    documentLoader,
    now: new Date(now),
    maxClockSkew: 0,
    checkStatus: (options) =>
      unrevoked({ ...options, documentLoader, suite: suite() }),
  });
  if (!result.verified) fail("INVALID_OR_REVOKED_CREDENTIAL");
  return true;
}
export async function present(c, key, request) {
  const presentation = vc.createPresentation({
    verifiableCredential: [c],
    holder: key.publicKey.controller,
  });
  return vc.signPresentation({
    presentation,
    suite: suite(deviceSigner(key)),
    documentLoader: loader([key.publicKey]),
    challenge: request.nonce,
    domain: request.client_id,
  });
}
export async function verifyPresentation(
  p,
  { request, holderKey, issuer, keys, status, statusUrl, now },
) {
  exact(p, ["@context", "type", "holder", "verifiableCredential", "proof"]);
  if (
    JSON.stringify(p["@context"]) !== JSON.stringify([V2]) ||
    JSON.stringify(p.type) !== JSON.stringify(["VerifiablePresentation"]) ||
    p.holder !== holderKey.controller ||
    p.verifiableCredential?.length !== 1 ||
    p.verifiableCredential[0].credentialSubject?.id !== p.holder
  )
    fail("HOLDER_MISMATCH");
  exact(p.proof, [
    "type",
    "cryptosuite",
    "created",
    "verificationMethod",
    "proofPurpose",
    "proofValue",
    "challenge",
    "domain",
  ]);
  if (
    p.proof.verificationMethod !== holderKey.id ||
    p.proof.challenge !== request.nonce ||
    p.proof.domain !== request.client_id ||
    !Number.isFinite(Date.parse(p.proof.created)) ||
    Math.abs(Date.now() - Date.parse(p.proof.created)) > 300000
  )
    fail("INVALID_PRESENTATION_BINDING");
  await verifyAccount(p.verifiableCredential[0], {
    issuer,
    keys,
    status,
    statusUrl,
    now,
  });
  const result = await vc.verify({
    presentation: p,
    suite: suite(),
    documentLoader: loader(
      [...keys, holderKey],
      new Map([[statusUrl, status]]),
    ),
    challenge: request.nonce,
    domain: request.client_id,
    maxClockSkew: 0,
    checkStatus: (options) =>
      unrevoked({
        ...options,
        documentLoader: loader(keys, new Map([[statusUrl, status]])),
        suite: suite(),
      }),
  });
  if (!result.verified) fail("INVALID_PRESENTATION");
  return true;
}

async function unrevoked(options) {
  const result = await checkStatus(options);
  return {
    ...result,
    verified:
      result.verified === true &&
      result.results?.length === 1 &&
      result.results.every((r) => r.status === false),
  };
}
