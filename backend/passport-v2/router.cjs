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
function experimentalZkpEnabled(env) {
  return localSandbox(env) && env.PASSPORT_ZKP_UNAUDITED_TEST_ONLY === "true";
}
function createRouter({
  db,
  identity,
  requireFirebaseUser,
  env = process.env,
  checkSensitiveSession,
  servicePromise,
  sharedRequestLimit,
  operationalGuard,
  releaseCandidate = false,
}) {
  const router = express.Router();
  const enabled = !!servicePromise || localSandbox(env);
  let init = servicePromise;
  let zkpInit;
  async function zkpService() {
    if (servicePromise || !experimentalZkpEnabled(env))
      throw Error("SANDBOX_REQUIRED");
    return (zkpInit ||= import("./experimental-zkp.mjs").then((m) =>
      m.zkpSandbox({
        store: firestoreStore(db),
        base: env.PASSPORT_V2_SANDBOX_BASE,
      }),
    ));
  }
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
        key.publicKey.id = base + "/issuer#" + key.publicKey.publicKeyMultibase;
        const core = createService({
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
              clientId: "redirect_uri:" + base + "/response",
              responseUri: base + "/response",
            },
          ],
        });
        const auth = await import("./authorization.mjs");
        return {
          ...core,
          authorization: auth.authorizationServer({
            store: firestoreStore(db),
            clients: [
              {
                id: "http://127.0.0.1:7280",
                name: "walt.id Wallet（隔離検証用）",
                redirectUri: "http://127.0.0.1:7280/callback",
              },
            ],
            frontendUrl: new URL("/test/native.html", base).href,
          }),
        };
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
    if (Object.keys(req.query).length && req.path !== "/authorize")
      return res.status(400).json({ error: "QUERY_NOT_ALLOWED" });
    next();
  });
  router.get("/capabilities", (req, res) =>
    res.json({
      enabled,
      sandbox: enabled && !releaseCandidate,
      releaseCandidate: enabled && releaseCandidate,
      government: false,
      zkp: false,
      selectiveDisclosure: enabled,
      zkpSandbox: !servicePromise && experimentalZkpEnabled(env),
      externalWalletCertified: false,
    }),
  );
  router.use((req, res, next) =>
    enabled ? next() : res.status(404).json({ error: "PASSPORT_V2_DISABLED" }),
  );
  // RC always excludes ZKP, even if an experimental environment flag is set.
  router.use((req, res, next) => {
    if (releaseCandidate && /^\/zkp(?:\/|$)/.test(req.path))
      return res.status(404).json({ error: "ZKP_EXCLUDED_FROM_RC" });
    next();
  });
  router.use(async (req, res, next) => {
    try {
      if (
        sharedRequestLimit &&
        !(await sharedRequestLimit(req.ip || "unknown"))
      )
        return res.status(429).json({ error: "RATE_LIMITED" });
      if (operationalGuard) await operationalGuard();
      next();
    } catch (_) {
      res.status(503).json({ error: "PASSPORT_UNAVAILABLE" });
    }
  });
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
        "INVALID_AUTHORIZATION_REQUEST",
        "REQUIRED_DISCLOSURE_MISSING",
        "CREDENTIAL_REVOKED",
        "INVALID_KEY",
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
        return res.status(badProof || safe.has(e.code) ? 400 : 503).json({
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
      if (
        req.method === "POST" &&
        [
          "/offers",
          "/consent",
          "/revoke",
          "/delete",
          "/history/delete",
          "/authorization/decision",
        ].includes(req.path)
      ) {
        if (
          !Number.isFinite(req.identity.authTimeMs) ||
          req.identity.authTimeMs > Date.now() + 30000 ||
          Date.now() - req.identity.authTimeMs > 15 * 60000
        )
          return res.status(409).json({ error: "RECENT_LOGIN_REQUIRED" });
        if (checkSensitiveSession) {
          try {
            await checkSensitiveSession(
              String(req.headers.authorization || "").slice(7),
            );
          } catch (_) {
            return res.status(401).json({ error: "INVALID_AUTH_TOKEN" });
          }
        }
      }
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
        ...(s.authorization
          ? {
              authorization_endpoint: s.base + "/authorize",
              response_types_supported: ["code"],
              code_challenge_methods_supported: ["S256"],
              scopes_supported: [
                "schoolpark_account_v1",
                "schoolpark_account_sd_v1",
              ],
            }
          : {}),
        grant_types_supported: [
          "urn:ietf:params:oauth:grant-type:pre-authorized_code",
          ...(s.authorization ? ["authorization_code"] : []),
        ],
        token_endpoint_auth_methods_supported: ["none"],
        "pre-authorized_grant_anonymous_access_supported": true,
      }),
    ),
  );
  router.get(
    "/sd/metadata",
    run(async (req, res, s) => res.json(s.sdMetadata())),
  );
  router.get(
    "/jwt-vc-issuer",
    run(async (req, res, s) => res.json(await s.issuerMetadata())),
  );
  router.get(
    "/issuer",
    run(async (req, res, s) => {
      const keys = s.publicKeys ? await s.publicKeys() : s.keys;
      return res.json({
        "@context": ["https://www.w3.org/ns/did/v1"],
        id: s.issuer,
        verificationMethod: keys,
        assertionMethod: keys.map((k) => k.id),
      });
    }),
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
  router.get(
    "/authorize",
    run(async (req, res, s) => {
      if (!s.authorization) throw Error("UNAVAILABLE");
      const r = await s.authorization.begin(req.query);
      res.redirect(303, r.location);
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
        "scope",
        "user_pin",
        "code",
        "code_verifier",
        "client_id",
        "redirect_uri",
      ]);
      if (req.body.grant_type === "authorization_code" && s.authorization)
        return res.json(await s.authorization.token(req.body));
      if (
        req.body.user_pin !== undefined &&
        req.body.user_pin !== req.body.tx_code
      )
        throw Object.assign(Error(), { code: "INVALID_GRANT" });
      if (
        req.body.resource &&
        ![s.base, s.base + "/sd"].includes(req.body.resource)
      )
        throw Object.assign(Error(), { code: "INVALID_GRANT" });
      if (
        req.body.grant_type !==
        "urn:ietf:params:oauth:grant-type:pre-authorized_code"
      )
        throw Object.assign(Error(), { code: "INVALID_GRANT" });
      res.json(
        await s.exchange(
          req.body["pre-authorized_code"],
          req.body.tx_code,
          req.body.scope,
        ),
      );
    }),
  );
  router.post(
    "/credential",
    run(async (req, res, s) => {
      fields(req.body, ["credential_configuration_id", "proofs"]);
      fields(req.body.proofs, ["jwt"]);
      if (
        !["schoolpark_account_v1", "schoolpark_account_sd_v1"].includes(
          req.body.credential_configuration_id,
        ) ||
        !Array.isArray(req.body.proofs.jwt) ||
        req.body.proofs.jwt.length !== 1
      )
        throw Object.assign(Error(), { code: "INVALID_PROOF" });
      const proof = req.body.proofs.jwt[0];
      const { decodeJwt } = await import("jose");
      const n = decodeJwt(proof).nonce;
      const o = await s.consumeToken(
        String(req.headers.authorization || "").replace(/^Bearer /, ""),
        req.body.credential_configuration_id,
      );
      res.json({
        credentials: [
          {
            credential: await s.issueCredential(o, {
              proof,
              nonce: n,
              configurationId: req.body.credential_configuration_id,
            }),
          },
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
      fields(req.body, ["configurationId"]);
      res.json(await s.offer(req.passportOwner, req.body.configurationId));
    }),
  );
  router.post(
    "/requests",
    run(async (req, res, s) => {
      fields(req.body, ["credentialId", "verifierId", "selected"]);
      res.json(
        await s.request(
          req.passportOwner,
          req.body.credentialId,
          req.body.verifierId,
          req.body.selected,
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
  router.post(
    "/authorization/details",
    run(async (req, res, s) => {
      fields(req.body, ["requestId"]);
      res.json(await s.authorization.details(req.body.requestId));
    }),
  );
  router.post(
    "/authorization/decision",
    run(async (req, res, s) => {
      fields(req.body, ["requestId", "approved"]);
      res.json(
        await s.authorization.decide(
          req.passportOwner,
          req.body.requestId,
          req.body.approved,
        ),
      );
    }),
  );
  for (const [path, fieldsAllowed, action] of [
    ["/zkp/sample", ["useCase"], (z, o, b) => z.sample(o, b.useCase)],
    [
      "/zkp/request",
      ["credentialId"],
      (z, o, b) => z.request(o, b.credentialId),
    ],
    [
      "/zkp/consent",
      ["requestId", "approved"],
      (z, o, b) => z.consent(o, b.requestId, b.approved),
    ],
    [
      "/zkp/response",
      ["requestId", "presentation"],
      (z, o, b) => z.receive(o, b.requestId, b.presentation),
    ],
    ["/zkp/revoke", ["credentialId"], (z, o, b) => z.revoke(o, b.credentialId)],
  ])
    router.post(path, async (req, res) => {
      try {
        fields(req.body, fieldsAllowed);
        res.json(await action(await zkpService(), req.passportOwner, req.body));
      } catch (_) {
        res.status(400).json({ error: "ZKP_REJECTED" });
      }
    });
  router.use((err, req, res, next) =>
    res
      .status(err.type === "entity.too.large" ? 413 : 400)
      .json({ error: "INVALID_REQUEST" }),
  );
  return router;
}
module.exports = { createRouter, localSandbox, experimentalZkpEnabled, PREFIX };
