import { SDJwtVcInstance } from "@sd-jwt/sd-jwt-vc";
import { decodeProtectedHeader, decodeJwt, importJWK, jwtVerify } from "jose";
import { exact, fail } from "./crypto.mjs";
export const SD_VCT =
  "https://emu-for-schoolpark.vercel.app/passport-v2/types/account-sd-v1";
export const SD_FIELDS = ["accountAccess", "assurance", "schemaVersion"];
const enc = new TextEncoder();
const b64 = (bytes) => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
};
export const sdHasher = async (data, alg) => {
  if (alg !== "sha-256") fail("UNSUPPORTED_HASH");
  return new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      typeof data === "string" ? enc.encode(data) : data,
    ),
  );
};
export function sdInstance({ signer, verifier, kbSigner, kbVerifier } = {}) {
  return new SDJwtVcInstance({
    hasher: sdHasher,
    hashAlg: "sha-256",
    allowedDisclosureHashAlgorithms: ["sha-256"],
    saltGenerator: (n) =>
      b64(crypto.getRandomValues(new Uint8Array(Math.max(n, 32)))),
    signAlg: "ES256",
    signer,
    verifier,
    kbSigner,
    kbSignAlg: "ES256",
    kbVerifier,
  });
}
export async function issueSelective({
  issuer,
  signer,
  holderJwk,
  statusId,
  now = Date.now(),
}) {
  exact(holderJwk, ["kty", "crv", "x", "y", "key_ops", "ext"]);
  if (holderJwk.kty !== "EC" || holderJwk.crv !== "P-256") fail("INVALID_KEY");
  return sdInstance({
    signer: async (data) => b64(await signer.sign({ data: enc.encode(data) })),
  }).issue(
    {
      iss: issuer,
      iat: Math.floor(now / 1000),
      nbf: Math.floor(now / 1000),
      exp: Math.floor(now / 1000) + 2592000,
      vct: SD_VCT,
      cnf: { jwk: holderJwk },
      status_id: statusId,
      accountAccess: true,
      assurance: "platform-account",
      schemaVersion: "1",
    },
    { _sd: SD_FIELDS },
    { header: { kid: signer.id } },
  );
}
export async function presentSelective(encoded, key, request, selected) {
  if (
    !Array.isArray(selected) ||
    selected.some((k) => !SD_FIELDS.includes(k)) ||
    request.required.some((k) => !selected.includes(k))
  )
    fail("REQUIRED_DISCLOSURE_MISSING");
  const sd = sdInstance({
    kbSigner: async (data) =>
      b64(
        new Uint8Array(
          await crypto.subtle.sign(
            { name: "ECDSA", hash: "SHA-256" },
            key.privateKey,
            enc.encode(data),
          ),
        ),
      ),
  });
  return sd.present(
    encoded,
    Object.fromEntries(selected.map((k) => [k, true])),
    {
      kb: {
        payload: {
          iat: Math.floor(Date.now() / 1000),
          aud: request.client_id,
          nonce: request.nonce,
        },
      },
    },
  );
}
export async function verifySelective(
  encoded,
  { issuer, issuerJwk, request, isRevoked, now = Date.now() },
) {
  if (typeof encoded !== "string" || encoded.length > 24000)
    fail("INVALID_PRESENTATION");
  const jwt = encoded.split("~")[0],
    header = decodeProtectedHeader(jwt),
    payload = decodeJwt(jwt);
  if (
    header.alg !== "ES256" ||
    header.typ !== "dc+sd-jwt" ||
    payload.iss !== issuer ||
    payload.vct !== SD_VCT
  )
    fail("UNTRUSTED_ISSUER");
  await jwtVerify(jwt, await importJWK(issuerJwk, "ES256"), {
    algorithms: ["ES256"],
    issuer,
    currentDate: new Date(now),
  });
  const key = await importJWK(issuerJwk, "ES256");
  const sd = sdInstance({
    verifier: async (data, sig) =>
      crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        key,
        Uint8Array.from(
          atob(sig.replaceAll("-", "+").replaceAll("_", "/")),
          (c) => c.charCodeAt(0),
        ),
        enc.encode(data),
      ),
    kbVerifier: async (data, sig, p) => {
      const jwk = p.cnf?.jwk;
      if (!jwk || jwk.d) return false;
      const k = await importJWK(jwk, "ES256");
      return crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        k,
        Uint8Array.from(
          atob(sig.replaceAll("-", "+").replaceAll("_", "/")),
          (c) => c.charCodeAt(0),
        ),
        enc.encode(data),
      );
    },
  });
  const result = await sd.verify(encoded, {
    requiredClaimKeys: request.required,
    keyBindingNonce: request.nonce,
    keyBindingAudience: request.client_id,
    keyBindingMaxAgeSeconds: 300,
    currentDate: Math.floor(now / 1000),
    allowedIssuerAlgorithms: ["ES256"],
    allowedKeyBindingAlgorithms: ["ES256"],
  });
  if (
    !result.kb ||
    result.kb.payload.nonce !== request.nonce ||
    result.kb.payload.aud !== request.client_id ||
    Math.abs(now / 1000 - result.kb.payload.iat) > 300
  )
    fail("INVALID_PRESENTATION_BINDING");
  if (!payload.status_id || (await isRevoked(payload.status_id)))
    fail("CREDENTIAL_REVOKED");
  const disclosed = SD_FIELDS.filter((k) => Object.hasOwn(result.payload, k));
  if (
    request.required.some((k) => !disclosed.includes(k)) ||
    request.selected.some((k) => !disclosed.includes(k)) ||
    disclosed.some((k) => !request.selected.includes(k))
  )
    fail("DISCLOSURE_MISMATCH");
  return {
    verified: true,
    disclosed,
    claims: Object.fromEntries(disclosed.map((k) => [k, result.payload[k]])),
  };
}
