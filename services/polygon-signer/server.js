"use strict";
const http = require("node:http");
const ethers = require("ethers");
const { createSigningPolicy, authenticate } = require("./policy");
const { createKMSSigner } = require("./kms");
function handler(policy, env) {
  // One in-process request; durable nonce/operation claims coordinate replicas.
  let busy = false;
  return async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json");
    if (
      !(
        (req.method === "POST" && req.url === "/sign") ||
        (req.method === "GET" && req.url === "/ready")
      ) ||
      !authenticate(req.headers.authorization, env.POLYGON_SIGNER_TOKEN)
    ) {
      res.writeHead(403).end('{"error":"DENIED"}');
      return;
    }
    if (busy) {
      res.writeHead(429).end('{"error":"BUSY"}');
      return;
    }
    busy = true;
    try {
      if (req.url === "/ready") {
        res.writeHead(200).end(JSON.stringify(await policy.ready()));
        return;
      }
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 8192) throw Error("BODY_LIMIT");
        chunks.push(chunk);
      }
      const signedTransaction = await policy.sign(
        JSON.parse(Buffer.concat(chunks).toString("utf8")),
      );
      res.writeHead(200).end(JSON.stringify({ signedTransaction }));
    } catch (_) {
      // Never log body, authorization, credentials or raw SDK/provider errors.
      res.writeHead(503).end('{"error":"SIGNING_UNAVAILABLE"}');
      process.stderr.write(
        '{"event":"polygon_signing_denied_or_unavailable"}\n',
      );
    } finally {
      busy = false;
    }
  };
}
if (require.main === module) {
  const env = process.env;
  if (env.POLYGON_SIGNER_ENABLED !== "true") throw Error("SIGNER_DISABLED");
  const credentials = require("./identity").workloadIdentity(env);
  const admin = require("firebase-admin");
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: env.GOOGLE_CLOUD_PROJECT,
  });
  const signer = createKMSSigner({
    keyId: env.POLYGON_KMS_KEY_ARN,
    address: env.ECONOMY_POLYGON_OPERATOR_ADDRESS,
    client: new (require("@aws-sdk/client-kms").KMSClient)({
      region: env.AWS_REGION,
      credentials,
    }),
  });
  const policy = createSigningPolicy({
    db: admin.firestore(),
    provider: new ethers.providers.JsonRpcProvider(env.POLYGON_RPC_URL),
    signer,
    codeHash: env.ECONOMY_POLYGON_CODE_HASH,
    env,
  });
  const server = http.createServer(handler(policy, env));
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.listen(Number(env.PORT || 8080), "127.0.0.1"); // Private TLS ingress required; not exposed by the app.
}
module.exports = { handler };
