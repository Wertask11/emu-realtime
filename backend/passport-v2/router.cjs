const express = require("express");
const { firestoreStore } = require("./storage.cjs");
const PREFIX = "/api/passport-v2";
function localSandbox(env) {
  return (
    env.PASSPORT_V2_ENABLED === "true" &&
    env.PASSPORT_V2_SANDBOX === "true" &&
    env.NODE_ENV !== "production" &&
    env.APP_ENV === "local" &&
    /^demo-/.test(env.GCLOUD_PROJECT || "") &&
    /^127\.0\.0\.1:\d+$/.test(env.FIRESTORE_EMULATOR_HOST || "") &&
    /^127\.0\.0\.1:\d+$/.test(env.FIREBASE_AUTH_EMULATOR_HOST || "")
  );
}
function createRouter({
  db,
  identity,
  requireFirebaseUser,
  env = process.env,
  servicePromise,
}) {
  const router = express.Router();
  const enabled = !!servicePromise || localSandbox(env);
  let init = servicePromise;
  async function service() {
    if (!init)
      init = Promise.all([
        import("./service.mjs"),
        import("./crypto.mjs"),
      ]).then(async ([{ createService }, { deviceKey, deviceSigner }]) => {
        if (!db) throw Error("UNAVAILABLE");
        const base = env.PASSPORT_V2_SANDBOX_BASE;
        if (!/^http:\/\/127\.0\.0\.1:\d+\/api\/passport-v2$/.test(base || ""))
          throw Error("UNAVAILABLE");
        const key = await deviceKey();
        key.publicKey.controller = base + "/issuer";
        key.publicKey.id = base + "/issuer#sandbox-key";
        return createService({
          store: firestoreStore(db),
          issuer: key.publicKey.controller,
          base,
          signer: deviceSigner(key),
          keys: [key.publicKey],
          verifiers: [
            {
              id: "sandbox",
              name: "この開発環境の検証画面",
              purpose: "アカウント証明の署名と同意の動作確認",
              clientId: base,
              responseUri: base + "/response",
            },
          ],
        });
      });
    return init;
  }
  router.use((req, res, next) => {
    res.set({
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    });
    if (Object.keys(req.query).length)
      return res.status(400).json({ error: "QUERY_NOT_ALLOWED" });
    next();
  });
  router.get("/capabilities", (req, res) =>
    res.json({
      enabled,
      sandbox: enabled,
      government: false,
      zkp: false,
      selectiveDisclosure: false,
      externalWalletCertified: false,
    }),
  );
  router.use((req, res, next) =>
    enabled ? next() : res.status(404).json({ error: "PASSPORT_V2_DISABLED" }),
  );
  // Scoped parsers; never expose parser input/stack in Express default handlers.
  router.use(express.json({ limit: "32kb", strict: true }));
  router.use(
    express.urlencoded({ extended: false, limit: "8kb", parameterLimit: 10 }),
  );
  const run = (fn) => async (req, res) => {
    try {
      await fn(req, res, await service());
    } catch (e) {
      const safe = new Set([
        "INVALID_FIELDS",
        "INVALID_GRANT",
        "INVALID_TOKEN",
        "INVALID_PROOF",
        "INVALID_NONCE",
        "NONCE_USED_OR_EXPIRED",
        "LIMIT_REACHED",
        "CONSENT_REQUIRED",
        "REQUEST_NOT_PENDING",
        "CREDENTIAL_NOT_AVAILABLE",
        "UNTRUSTED_VERIFIER",
        "CREDENTIAL_MISMATCH",
        "DISCLOSURE_MISMATCH",
        "REQUEST_USED_OR_REVOKED",
        "NOT_FOUND",
        "INVALID_CREDENTIAL",
        "CREDENTIAL_EXPIRED",
        "INVALID_OR_REVOKED_CREDENTIAL",
        "HOLDER_MISMATCH",
        "INVALID_PRESENTATION_BINDING",
        "INVALID_PRESENTATION",
      ]);
      const proofError =
        req.path === "/credential" &&
        (/^ERR_JW|^ERR_JOSE/.test(String(e.code || "")) ||
          e.name === "DataError");
      if (req.path === "/token")
        return res
          .status(safe.has(e.code) ? 400 : 503)
          .json({ error: safe.has(e.code) ? "invalid_grant" : "server_error" });
      if (req.path === "/credential") {
        if (e.code === "INVALID_TOKEN")
          return res
            .status(401)
            .set("WWW-Authenticate", 'Bearer error="invalid_token"')
            .json({ error: "invalid_token" });
        const badProof =
          proofError ||
          [
            "INVALID_PROOF",
            "INVALID_NONCE",
            "NONCE_USED_OR_EXPIRED",
            "INVALID_KEY",
          ].includes(e.code);
        return res
          .status(badProof || safe.has(e.code) ? 400 : 503)
          .json({
            error: badProof
              ? "invalid_proof"
              : safe.has(e.code)
                ? "invalid_credential_request"
                : "server_error",
          });
      }
      res
        .status(safe.has(e.code) ? 400 : 503)
        .json({ error: safe.has(e.code) ? e.code : "PASSPORT_UNAVAILABLE" });
    }
  };
  let budget = new Map();
  router.use((req, res, next) => {
    const now = Date.now(),
      ip = req.ip || "unknown";
    if (budget.size >= 1000)
      budget = new Map([...budget].filter(([, b]) => b.until > now));
    if (!budget.has(ip) && budget.size >= 1000)
      return res.status(429).json({ error: "RATE_LIMITED" });
    const b = budget.get(ip) || { count: 0, until: now + 60000 };
    if (b.until <= now) {
      b.count = 0;
      b.until = now + 60000;
    }
    budget.set(ip, b);
    if (++b.count > 60) return res.status(429).json({ error: "RATE_LIMITED" });
    next();
  });
  const fields = (body, keys) => {
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).some((k) => !keys.includes(k))
    )
      throw Object.assign(Error("INVALID_FIELDS"), { code: "INVALID_FIELDS" });
  };
  const owner = async (req, res, next) => {
    // The original Firebase middleware remains authoritative; no body-supplied identity.
    if (!req.identity?.uid || req.identity.signInProvider === "anonymous")
      return res.status(403).json({ error: "ACCOUNT_REQUIRED" });
    try {
      const spid = await identity.findByUid(req.identity.uid);
      if (!spid)
        return res.status(409).json({ error: "EXISTING_PASSPORT_REQUIRED" });
      req.passportOwner = spid;
      next();
    } catch (_) {
      res.status(503).json({ error: "PASSPORT_UNAVAILABLE" });
    }
  };
  router.get(
    "/metadata",
    run(async (req, res, s) => res.json(s.metadata())),
  );
  router.get(
    "/oauth-metadata",
    run(async (req, res, s) =>
      res.json({
        issuer: s.base,
        token_endpoint: s.base + "/token",
        grant_types_supported: [
          "urn:ietf:params:oauth:grant-type:pre-authorized_code",
        ],
        token_endpoint_auth_methods_supported: ["none"],
        "pre-authorized_grant_anonymous_access_supported": true,
      }),
    ),
  );
  router.get(
    "/issuer",
    run(async (req, res, s) =>
      res.json({
        "@context": ["https://www.w3.org/ns/did/v1"],
        id: s.issuer,
        verificationMethod: s.keys,
        assertionMethod: s.keys.map((k) => k.id),
      }),
    ),
  );
  router.get(
    "/status/account-v1",
    run(async (req, res, s) => res.json(await s.status())),
  );
  router.post(
    "/nonce",
    run(async (req, res, s) => {
      fields(req.body || {}, []);
      res.json({ c_nonce: await s.nonce() });
    }),
  );
  router.post(
    "/token",
    run(async (req, res, s) => {
      fields(req.body, [
        "grant_type",
        "pre-authorized_code",
        "tx_code",
        "resource",
        "user_pin",
      ]);
      if (
        req.body.user_pin !== undefined &&
        req.body.user_pin !== req.body.tx_code
      )
        throw Object.assign(Error(), { code: "INVALID_GRANT" });
      if (req.body.resource && req.body.resource !== s.base)
        throw Object.assign(Error(), { code: "INVALID_GRANT" });
      if (
        req.body.grant_type !==
        "urn:ietf:params:oauth:grant-type:pre-authorized_code"
      )
        throw Object.assign(Error(), { code: "INVALID_GRANT" });
      res.json(
        await s.exchange(req.body["pre-authorized_code"], req.body.tx_code),
      );
    }),
  );
  router.post(
    "/credential",
    run(async (req, res, s) => {
      fields(req.body, ["credential_configuration_id", "proofs"]);
      fields(req.body.proofs, ["jwt"]);
      if (
        req.body.credential_configuration_id !== "schoolpark_account_v1" ||
        !Array.isArray(req.body.proofs.jwt) ||
        req.body.proofs.jwt.length !== 1
      )
        throw Object.assign(Error(), { code: "INVALID_PROOF" });
      const proof = req.body.proofs.jwt[0];
      const { decodeJwt } = await import("jose");
      const n = decodeJwt(proof).nonce;
      const o = await s.consumeToken(
        String(req.headers.authorization || "").replace(/^Bearer /, ""),
      );
      res.json({
        credentials: [
          { credential: await s.issueCredential(o, { proof, nonce: n }) },
        ],
      });
    }),
  );
  router.post(
    "/response",
    run(async (req, res, s) => {
      fields(req.body, ["vp_token", "state"]);
      let token = req.body.vp_token;
      if (typeof token === "string") {
        try {
          token = JSON.parse(token);
        } catch (_) {
          throw Object.assign(Error(), { code: "INVALID_FIELDS" });
        }
      }
      fields(token, ["account"]);
      if (!Array.isArray(token.account) || token.account.length !== 1)
        throw Object.assign(Error(), { code: "INVALID_FIELDS" });
      res.json(await s.receive(req.body.state, token.account[0]));
    }),
  );
  router.use(requireFirebaseUser, owner);
  router.get(
    "/credentials",
    run(async (req, res, s) => res.json(await s.list(req.passportOwner))),
  );
  router.post(
    "/offers",
    run(async (req, res, s) => {
      fields(req.body, []);
      res.json(await s.offer(req.passportOwner));
    }),
  );
  router.post(
    "/requests",
    run(async (req, res, s) => {
      fields(req.body, ["credentialId", "verifierId"]);
      res.json(
        await s.request(
          req.passportOwner,
          req.body.credentialId,
          req.body.verifierId,
        ),
      );
    }),
  );
  router.post(
    "/consent",
    run(async (req, res, s) => {
      fields(req.body, ["requestId", "approved"]);
      res.json(
        await s.decide(
          req.passportOwner,
          req.body.requestId,
          req.body.approved,
        ),
      );
    }),
  );
  router.post(
    "/revoke",
    run(async (req, res, s) => {
      fields(req.body, ["credentialId"]);
      res.json(await s.revoke(req.passportOwner, req.body.credentialId));
    }),
  );
  router.post(
    "/delete",
    run(async (req, res, s) => {
      fields(req.body, ["credentialId"]);
      res.json(await s.revoke(req.passportOwner, req.body.credentialId, true));
    }),
  );
  router.post(
    "/history/delete",
    run(async (req, res, s) => {
      fields(req.body, []);
      res.json(await s.clearHistory(req.passportOwner));
    }),
  );
  router.use((err, req, res, next) =>
    res
      .status(err.type === "entity.too.large" ? 413 : 400)
      .json({ error: "INVALID_REQUEST" }),
  );
  return router;
}
module.exports = { createRouter, localSandbox, PREFIX };
