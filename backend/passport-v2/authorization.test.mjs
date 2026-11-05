import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { authorizationServer } from "./authorization.mjs";
import { memoryStore } from "./fixture-support.mjs";
test("registered OAuth authorization-code flow needs explicit approval, S256 PKCE, exact redirect and one-use code", async () => {
  const a = authorizationServer({
      store: memoryStore(),
      clients: [
        {
          id: "wallet",
          name: "Registered test wallet",
          redirectUri: "https://wallet.example/callback",
        },
      ],
      frontendUrl: "https://issuer.example/",
    }),
    verifier = "a".repeat(43),
    p = {
      client_id: "wallet",
      redirect_uri: "https://wallet.example/callback",
      response_type: "code",
      scope: "schoolpark_account_sd_v1",
      state: "s".repeat(32),
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
    };
  await assert.rejects(
    a.begin({ ...p, redirect_uri: "https://attacker.example" }),
  );
  const r = await a.begin(p);
  assert.equal((await a.details(r.id)).recipient, "Registered test wallet");
  const approved = await a.decide("alice", r.id, true),
    code = new URL(approved.redirectUri).searchParams.get("code");
  await assert.rejects(
    a.token({
      code,
      code_verifier: "b".repeat(43),
      client_id: "wallet",
      redirect_uri: p.redirect_uri,
    }),
  );
  assert.ok(
    (
      await a.token({
        code,
        code_verifier: verifier,
        client_id: "wallet",
        redirect_uri: p.redirect_uri,
      })
    ).access_token,
  );
  await assert.rejects(
    a.token({
      code,
      code_verifier: verifier,
      client_id: "wallet",
      redirect_uri: p.redirect_uri,
    }),
  );
  const denied = await a.begin(p);
  assert.equal(
    new URL(
      (await a.decide("alice", denied.id, false)).redirectUri,
    ).searchParams.get("error"),
    "access_denied",
  );
});
