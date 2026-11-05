import {
  randomBytes,
  randomInt,
  randomUUID,
  createHash,
  timingSafeEqual,
} from "node:crypto";
import * as jose from "jose";
import { isDeepStrictEqual } from "node:util";
import {
  CONTEXT,
  TYPE,
  exact,
  fail,
  publicFromJwk,
  issue,
  makeStatus,
  verifyAccount,
  verifyPresentation,
} from "./crypto.mjs";
const opaque = () => randomBytes(32).toString("base64url");
const hash = (s) => createHash("sha256").update(s).digest("hex");
const equal = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  a.length === b.length &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
export const CONFIG_ID = "schoolpark_account_v1";
export const PRE_AUTH = "urn:ietf:params:oauth:grant-type:pre-authorized_code";
export function createService({
  store,
  issuer,
  base,
  signer,
  keys,
  verifiers = [],
  clock = Date.now,
}) {
  if (
    !issuer ||
    !base ||
    !signer ||
    !keys.some((k) => k.id === signer.id && k.controller === issuer)
  )
    fail("SIGNER_NOT_CONFIGURED");
  const statusUrl = base + "/status/account-v1";
  function history(a, type, extra = {}) {
    a.history.unshift({
      id: randomUUID(),
      type,
      at: new Date(clock()).toISOString(),
      ...extra,
    });
    a.history = a.history.slice(0, 50);
  }
  function prune(a) {
    for (const name of ["grants", "requests"])
      for (const [id, v] of Object.entries(a[name]))
        if (
          v.expires < clock() ||
          (name === "requests" && !["pending", "approved"].includes(v.status))
        )
          delete a[name][id];
  }
  function active(a, id) {
    const c = a.credentials.find((c) => c.id === id);
    if (!c || c.revoked || c.deleted) fail("CREDENTIAL_NOT_AVAILABLE");
    return c;
  }
  async function status() {
    return makeStatus({
      url: statusUrl,
      issuer,
      signer,
      keys,
      revoked: (await store.status()).revoked,
      now: clock(),
    });
  }
  async function offer(owner) {
    const code = opaque(),
      pin = String(randomInt(10000000, 100000000));
    await store.ticket(hash(code), (old) => {
      if (old) fail("INVALID_GRANT");
      return {
        next: {
          kind: "code",
          owner,
          pinHash: hash(pin),
          expires: clock() + 300000,
          used: false,
          attempts: 0,
        },
        result: true,
      };
    });
    return {
      credential_offer: {
        credential_issuer: base,
        credential_configuration_ids: [CONFIG_ID],
        grants: {
          [PRE_AUTH]: {
            "pre-authorized_code": code,
            tx_code: { input_mode: "numeric", length: 8 },
          },
        },
      },
      tx_code: pin,
    };
  }
  async function exchange(code, pin) {
    if (
      typeof code !== "string" ||
      !/^[\w-]{43}$/.test(code) ||
      typeof pin !== "string" ||
      !/^\d{8}$/.test(pin)
    )
      fail("INVALID_GRANT");
    const owner = await store.ticket(hash(code), (g) => {
      if (
        !g ||
        g.kind !== "code" ||
        g.used ||
        g.expires <= clock() ||
        g.attempts >= 5
      )
        return { next: g, result: null };
      g.attempts++;
      if (!equal(g.pinHash, hash(pin))) return { next: g, result: null };
      g.used = true;
      return { next: g, result: g.owner };
    });
    if (!owner) fail("INVALID_GRANT");
    const token = opaque();
    await store.ticket(hash(token), () => ({
      next: { kind: "token", owner, expires: clock() + 300000, used: false },
      result: true,
    }));
    return { access_token: token, token_type: "Bearer", expires_in: 300 };
  }
  async function consumeToken(token) {
    if (typeof token !== "string" || !/^[\w-]{43}$/.test(token))
      fail("INVALID_TOKEN");
    const owner = await store.ticket(hash(token), (g) => {
      if (!g || g.kind !== "token" || g.used || g.expires <= clock())
        return { next: g, result: null };
      g.used = true;
      return { next: g, result: g.owner };
    });
    if (!owner) fail("INVALID_TOKEN");
    return owner;
  }
  async function nonce() {
    const n = opaque();
    await store.run("__nonce__", (a, s) => {
      s.nonces = s.nonces || {};
      for (const [k, v] of Object.entries(s.nonces))
        if (v < clock()) delete s.nonces[k];
      if (Object.keys(s.nonces).length >= 100) fail("LIMIT_REACHED");
      s.nonces[hash(n)] = clock() + 300000;
    });
    return n;
  }
  async function issueCredential(owner, { proof, nonce: expected }) {
    if (typeof proof !== "string" || proof.length > 4096) fail("INVALID_PROOF");
    const header = jose.decodeProtectedHeader(proof);
    exact(header, ["typ", "alg", "jwk"]);
    if (header.typ !== "openid4vci-proof+jwt" || header.alg !== "ES256")
      fail("INVALID_PROOF");
    const holderKey = await publicFromJwk(header.jwk);
    const key = await jose.importJWK(header.jwk, "ES256");
    const { payload } = await jose.jwtVerify(proof, key, {
      algorithms: ["ES256"],
      audience: base,
      typ: "openid4vci-proof+jwt",
      maxTokenAge: 300,
      clockTolerance: 0,
      currentDate: new Date(clock()),
    });
    exact(payload, ["aud", "iat", "nonce", "iss"]);
    if (
      !equal(payload.nonce, expected) ||
      !Number.isFinite(payload.iat) ||
      payload.iat > clock() / 1000 + 5
    )
      fail("INVALID_NONCE");
    const id = "urn:uuid:" + randomUUID(),
      now = clock();
    // Signing happens inside transaction; no credential is returned before commit.
    return store.run(owner, async (a, s) => {
      prune(a);
      if (!s.nonces?.[hash(expected)] || s.nonces[hash(expected)] <= clock())
        fail("NONCE_USED_OR_EXPIRED");
      if (
        a.credentials.filter((c) => !c.deleted).length >= 20 ||
        s.used.length >= 1000
      )
        fail("LIMIT_REACHED");
      let index;
      do {
        index = randomInt(131072);
      } while (s.used.includes(index));
      const c = await issue(
        {
          "@context": CONTEXT,
          id,
          type: ["VerifiableCredential", TYPE],
          issuer,
          validFrom: new Date(now).toISOString(),
          validUntil: new Date(now + 30 * 86400000).toISOString(),
          credentialSubject: {
            id: holderKey.controller,
            accountAccess: true,
            assurance: "platform-account",
            schemaVersion: "1",
          },
          credentialStatus: {
            id: `${statusUrl}#${index}`,
            type: "BitstringStatusListEntry",
            statusPurpose: "revocation",
            statusListCredential: statusUrl,
            statusListIndex: String(index),
          },
        },
        signer,
        keys,
      );
      delete s.nonces[hash(expected)];
      s.used.push(index);
      a.credentials.push({
        id,
        index,
        holderKey,
        credential: c,
        revoked: false,
        deleted: false,
      });
      history(a, "issued", { credentialId: id });
      return c;
    });
  }
  async function request(owner, credentialId, verifierId) {
    const v = verifiers.find((v) => v.id === verifierId);
    if (!v) fail("UNTRUSTED_VERIFIER");
    const id = opaque(),
      nonce = opaque(),
      state = opaque();
    return store.run(owner, (a) => {
      prune(a);
      const c = active(a, credentialId);
      if (Object.keys(a.requests).length >= 10) fail("LIMIT_REACHED");
      const r = {
        id,
        credentialId,
        nonce,
        state,
        client_id: v.clientId,
        recipient: v.name,
        purpose: v.purpose,
        response_uri: v.responseUri,
        expires: clock() + 300000,
        status: "pending",
        disclosure: structuredClone(c.credential),
      };
      const authorizationRequest = {
        response_type: "vp_token",
        response_mode: "direct_post",
        client_id: r.client_id,
        response_uri: r.response_uri,
        nonce: r.nonce,
        state: r.state,
        dcql_query: {
          credentials: [
            {
              id: "account",
              format: "ldp_vc",
              meta: { type_values: [["VerifiableCredential", TYPE]] },
            },
          ],
        },
        client_metadata: {
          vp_formats_supported: {
            ldp_vc: {
              proof_type_values: ["DataIntegrityProof"],
              cryptosuite_values: ["ecdsa-rdfc-2019"],
            },
          },
        },
      };
      a.requests[id] = r;
      return { ...r, authorizationRequest };
    });
  }
  async function decide(owner, id, approved) {
    if (typeof approved !== "boolean") fail("INVALID_FIELDS");
    const result = await store.run(owner, (a) => {
      prune(a);
      const r = a.requests[id];
      if (!r || !["pending", "approved"].includes(r.status))
        fail("REQUEST_NOT_PENDING");
      active(a, r.credentialId);
      if (r.status === "approved" && approved)
        return { status: r.status, state: r.state, expires: r.expires };
      const event = approved
        ? "approved"
        : r.status === "approved"
          ? "withdrawn"
          : "denied";
      r.status = event;
      history(a, event, {
        recipient: r.recipient,
        purpose: r.purpose,
        requestId: id,
        disclosedFields: [
          "accountAccess",
          "assurance",
          "schemaVersion",
          "pseudonymousHolderId",
          "credentialId",
          "issuer",
          "validFrom",
          "validUntil",
          "credentialStatus",
          "proof",
        ],
      });
      return { status: r.status, state: r.state, expires: r.expires };
    });
    if (approved)
      await store.ticket(hash(result.state), () => ({
        next: {
          kind: "presentation",
          owner,
          requestId: id,
          expires: result.expires,
        },
        result: true,
      }));
    return { status: result.status };
  }
  async function submit(owner, id, presentation, state) {
    const r = await store.run(owner, (a) => {
      prune(a);
      const r = a.requests[id];
      if (!r || r.status !== "approved" || !equal(state, r.state))
        fail("CONSENT_REQUIRED");
      return structuredClone(r);
    });
    const c = await store.run(owner, (a) =>
      structuredClone(active(a, r.credentialId)),
    );
    if (presentation?.verifiableCredential?.[0]?.id !== c.id)
      fail("CREDENTIAL_MISMATCH");
    // The approved disclosure is immutable. No credential substitution after consent.
    if (!isDeepStrictEqual(presentation.verifiableCredential[0], r.disclosure))
      fail("DISCLOSURE_MISMATCH");
    await verifyPresentation(presentation, {
      request: r,
      holderKey: c.holderKey,
      issuer,
      keys,
      status: await status(),
      statusUrl,
      now: clock(),
    });
    return store.run(owner, (a, s) => {
      prune(a);
      const live = a.requests[id];
      const current = active(a, r.credentialId);
      if (
        !live ||
        live.status !== "approved" ||
        s.revoked.includes(current.index)
      )
        fail("REQUEST_USED_OR_REVOKED");
      live.status = "consumed";
      delete live.disclosure;
      history(a, "presented", {
        recipient: r.recipient,
        purpose: r.purpose,
        requestId: id,
      });
      return { verified: true };
    });
  }
  async function revoke(owner, id, remove = false) {
    return store.run(owner, (a, s) => {
      const c = a.credentials.find((c) => c.id === id);
      if (!c) fail("NOT_FOUND");
      if (!s.revoked.includes(c.index)) s.revoked.push(c.index);
      c.revoked = true;
      if (remove) {
        c.deleted = true;
        delete c.credential;
        delete c.holderKey;
      }
      for (const r of Object.values(a.requests))
        if (r.credentialId === id) {
          r.status = "withdrawn";
          delete r.disclosure;
        }
      history(a, remove ? "deleted" : "revoked", { credentialId: id });
      return { revoked: true, deleted: remove };
    });
  }
  return {
    base,
    issuer,
    keys,
    statusUrl,
    status,
    offer,
    exchange,
    consumeToken,
    nonce,
    issueCredential,
    request,
    decide,
    submit,
    revoke,
    async receive(state, presentation) {
      if (typeof state !== "string" || !/^[\w-]{43}$/.test(state))
        fail("CONSENT_REQUIRED");
      const r = await store.ticket(hash(state), (g) => ({
        next: g,
        result: g?.kind === "presentation" && g.expires > clock() ? g : null,
      }));
      if (!r) fail("CONSENT_REQUIRED");
      return submit(r.owner, r.requestId, presentation, state);
    },
    async list(owner) {
      return store.run(owner, (a) => ({
        credentials: a.credentials
          .filter((c) => !c.deleted)
          .map((c) => ({
            id: c.id,
            revoked: c.revoked,
            credential: c.credential,
          })),
        history: a.history,
        verifiers: verifiers.map(({ id, name, purpose }) => ({
          id,
          name,
          purpose,
        })),
      }));
    },
    async clearHistory(owner) {
      return store.run(owner, (a) => {
        a.history = [];
        a.requests = {};
        return { deleted: true };
      });
    },
    async verify(c) {
      return verifyAccount(c, {
        issuer,
        keys,
        status: await status(),
        statusUrl,
        now: clock(),
      });
    },
    metadata() {
      return {
        credential_issuer: base,
        authorization_servers: [base],
        credential_endpoint: base + "/credential",
        nonce_endpoint: base + "/nonce",
        credential_configurations_supported: {
          [CONFIG_ID]: {
            format: "ldp_vc",
            credential_metadata: {
              display: [{ name: "SchoolPark account access", locale: "en-US" }],
            },
            credential_definition: {
              "@context": CONTEXT,
              type: ["VerifiableCredential", TYPE],
            },
            cryptographic_binding_methods_supported: ["did:key"],
            credential_signing_alg_values_supported: ["ecdsa-rdfc-2019"],
            proof_types_supported: {
              jwt: { proof_signing_alg_values_supported: ["ES256"] },
            },
          },
        },
      };
    },
  };
}
