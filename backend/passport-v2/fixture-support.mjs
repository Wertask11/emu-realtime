import { SignJWT } from "jose";
import { deviceKey, deviceSigner } from "./crypto.mjs";
import { createService } from "./service.mjs";
export function memoryStore() {
  const accounts = new Map(),
    tickets = new Map();
  let status = { used: [], revoked: [] },
    queue = Promise.resolve();
  return {
    run(owner, fn) {
      const pending = queue.then(async () => {
        const a = structuredClone(
            accounts.get(owner) || {
              credentials: [],
              history: [],
              grants: {},
              requests: {},
            },
          ),
          s = structuredClone(status);
        const out = await fn(a, s);
        accounts.set(owner, a);
        status = s;
        return structuredClone(out);
      });
      queue = pending.catch(() => {});
      return pending;
    },
    async ticket(id, fn) {
      const pending = queue.then(async () => {
        const { next, result } = await fn(
          structuredClone(tickets.get(id) || null),
        );
        if (next) tickets.set(id, next);
        else tickets.delete(id);
        return result;
      });
      queue = pending.catch(() => {});
      return pending;
    },
    async status() {
      await queue;
      return structuredClone(status);
    },
  };
}
export async function fixture() {
  const issuerKey = await deviceKey();
  issuerKey.publicKey.controller = "https://issuer.example/passport";
  issuerKey.publicKey.id = "https://issuer.example/passport#key-1";
  const store = memoryStore(),
    base = "https://issuer.example/api/passport-v2";
  const svc = createService({
    store,
    issuer: issuerKey.publicKey.controller,
    base,
    signer: deviceSigner(issuerKey),
    keys: [issuerKey.publicKey],
    verifiers: [
      {
        id: "demo",
        clientId: "https://verifier.example",
        name: "検証用",
        purpose: "アカウント証明の動作確認",
        responseUri: "https://verifier.example/response",
      },
    ],
  });
  const holder = await deviceKey();
  async function mint(owner = "alice") {
    const n = await svc.nonce(owner);
    const proof = await new SignJWT({ nonce: n })
      .setProtectedHeader({
        typ: "openid4vci-proof+jwt",
        alg: "ES256",
        jwk: holder.jwk,
      })
      .setAudience(base)
      .setIssuedAt()
      .sign(holder.privateKey);
    return svc.issueCredential(owner, { proof, nonce: n });
  }
  return { svc, store, holder, mint };
}
