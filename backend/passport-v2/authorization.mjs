import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { fail, exact } from "./crypto.mjs";
const hash = (s) => createHash("sha256").update(s).digest("hex"),
  opaque = () => randomBytes(32).toString("base64url");
const equals = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  a.length === b.length &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
export function authorizationServer({
  store,
  clients,
  frontendUrl,
  clock = Date.now,
}) {
  return {
    async begin(p) {
      exact(p, [
        "client_id",
        "redirect_uri",
        "response_type",
        "scope",
        "state",
        "code_challenge",
        "code_challenge_method",
      ]);
      const client = clients.find(
        (c) => c.id === p.client_id && c.redirectUri === p.redirect_uri,
      );
      if (
        !client ||
        p.response_type !== "code" ||
        p.code_challenge_method !== "S256" ||
        !/^[-\w]{43}$/.test(p.code_challenge || "") ||
        !/^[-\w]{16,128}$/.test(p.state || "") ||
        !["schoolpark_account_v1", "schoolpark_account_sd_v1"].includes(p.scope)
      )
        fail("INVALID_AUTHORIZATION_REQUEST");
      const id = opaque();
      await store.ticket(hash(id), () => ({
        next: {
          kind: "authorization_request",
          clientId: client.id,
          clientName: client.name,
          redirectUri: client.redirectUri,
          configurationId: p.scope,
          state: p.state,
          challenge: p.code_challenge,
          expires: clock() + 300000,
          status: "pending",
        },
        result: true,
      }));
      const url = new URL(frontendUrl);
      url.searchParams.set("passport_authorization", id);
      return { id, location: url.href };
    },
    async details(id) {
      if (!/^[-\w]{43}$/.test(id || "")) fail("INVALID_AUTHORIZATION_REQUEST");
      return store.ticket(hash(id), (r) => {
        if (
          !r ||
          r.kind !== "authorization_request" ||
          r.expires <= clock() ||
          r.status !== "pending"
        )
          fail("INVALID_AUTHORIZATION_REQUEST");
        return {
          next: r,
          result: {
            recipient: r.clientName,
            redirectUri: r.redirectUri,
            configurationId: r.configurationId,
            purpose: "アカウント証明書をこのWalletへ発行する",
            expires: r.expires,
          },
        };
      });
    },
    async decide(owner, id, approve) {
      if (typeof approve !== "boolean") fail("INVALID_AUTHORIZATION_REQUEST");
      const code = opaque();
      const r = await store.ticket(hash(id), (r) => {
        if (
          !r ||
          r.kind !== "authorization_request" ||
          r.expires <= clock() ||
          r.status !== "pending"
        )
          fail("INVALID_AUTHORIZATION_REQUEST");
        r.status = approve ? "approved" : "denied";
        return { next: r, result: r };
      });
      const url = new URL(r.redirectUri);
      url.searchParams.set("state", r.state);
      if (!approve) {
        url.searchParams.set("error", "access_denied");
        return { redirectUri: url.href };
      }
      await store.ticket(hash(code), () => ({
        next: {
          kind: "authorization_code",
          owner,
          clientId: r.clientId,
          redirectUri: r.redirectUri,
          configurationId: r.configurationId,
          challenge: r.challenge,
          expires: clock() + 120000,
          used: false,
        },
        result: true,
      }));
      url.searchParams.set("code", code);
      return { redirectUri: url.href };
    },
    async token({ code, code_verifier, client_id, redirect_uri }) {
      if (
        !/^[-\w]{43}$/.test(code || "") ||
        !/^[-\w.~]{43,128}$/.test(code_verifier || "")
      )
        fail("INVALID_GRANT");
      const challenge = createHash("sha256")
        .update(code_verifier)
        .digest("base64url");
      const r = await store.ticket(hash(code), (g) => {
        if (
          !g ||
          g.kind !== "authorization_code" ||
          g.used ||
          g.expires <= clock() ||
          g.clientId !== client_id ||
          g.redirectUri !== redirect_uri ||
          !equals(g.challenge, challenge)
        )
          fail("INVALID_GRANT");
        g.used = true;
        return { next: g, result: g };
      });
      const access = opaque();
      await store.ticket(hash(access), () => ({
        next: {
          kind: "token",
          owner: r.owner,
          configurationId: r.configurationId,
          expires: clock() + 300000,
          used: false,
        },
        result: true,
      }));
      return { access_token: access, token_type: "Bearer", expires_in: 300 };
    },
  };
}
