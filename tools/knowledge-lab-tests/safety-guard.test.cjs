"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict");
const { createFixture } = require("./fixture.cjs");
function routerFor(f, db, extra = {}) {
  return require("../../backend/knowledge-lab/router").createKnowledgeLabRouter(
    {
      db,
      identity: f.identity,
      entitlement: f.entitlement,
      requireFirebaseUser: f.middleware.requireFirebaseUser,
      requireOwner: f.middleware.requireOwner,
      rateLimit: f.middleware.rateLimit,
      isOwner: () => false,
      env: {
        KNOWLEDGE_LAB_ENABLED: "true",
        FIRESTORE_EMULATOR_HOST: "127.0.0.1:8787",
      },
      ...extra,
    },
  );
}
async function configServer(api) {
  const app = require("../../backend/node_modules/express")();
  app.use("/api/knowledge-lab", api.router);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  return {
    url:
      "http://127.0.0.1:" + server.address().port + "/api/knowledge-lab/config",
    close: async () => {
      api.close?.();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
test("a failed anonymous permission probe keeps Lab closed and a bounded cooldown prevents repeated write storms", async () => {
  const f = await createFixture(),
    original = global.fetch;
  let calls = 0,
    time = Date.now(),
    blocked = true;
  const reserved = f.db.collection("knowledge_lab_notes").doc("security-probe");
  await reserved.set({ preserved: "existing-operational-record" });
  const api =
    require("../../backend/knowledge-lab/router").createKnowledgeLabRouter({
      rulesNow: () => time,
      db: f.db,
      identity: f.identity,
      entitlement: f.entitlement,
      requireFirebaseUser: f.middleware.requireFirebaseUser,
      requireOwner: f.middleware.requireOwner,
      rateLimit: f.middleware.rateLimit,
      isOwner: () => false,
      env: {
        KNOWLEDGE_LAB_ENABLED: "true",
        FIRESTORE_EMULATOR_HOST: "127.0.0.1:8787",
      },
    });
  try {
    global.fetch = async (url, opts) => {
      if (String(url).includes("/security-probe-")) {
        calls++;
        return new Response(
          JSON.stringify(
            blocked
              ? { fields: { probe: { stringValue: "unsafe-open-probe" } } }
              : { error: { status: "PERMISSION_DENIED" } },
          ),
          { status: blocked ? 200 : 403 },
        );
      }
      return original(url, opts);
    };
    assert.equal(await api.checkRules(), false);
    const before = calls;
    assert.ok(before > 0);
    assert.equal(await api.checkRules(), false);
    assert.equal(calls, before);
    time += 300001;
    blocked = false;
    assert.equal(await api.checkRules(), true);
    time += 300001;
    blocked = true;
    assert.equal(await api.checkRules(), false);
    assert.deepEqual((await reserved.get()).data(), {
      preserved: "existing-operational-record",
    });
    assert.equal((await f.db.collection("knowledge_lab_notes").get()).size, 1);
  } finally {
    global.fetch = original;
    api.close?.();
    await f.close();
  }
});

test("public readiness reports a safe Admin error code and bounded retry without exposing raw errors", async () => {
  const f = await createFixture(),
    warn = console.warn,
    logs = [];
  let creates = 0;
  const db = {
    projectId: f.db.projectId,
    collection: (name) =>
      name === "knowledge_lab_notes"
        ? {
            doc: () => ({
              create: async () => {
                creates++;
                const e = Error("PRIVATE_KEY_SHOULD_NOT_APPEAR");
                e.code = 7;
                throw e;
              },
              delete: async () => {
                throw Error("MUST_NOT_DELETE");
              },
            }),
          }
        : f.db.collection(name),
  };
  const api = routerFor(f, db),
    server = await configServer(api);
  try {
    console.warn = (...v) => logs.push(v);
    const response = await fetch(server.url),
      result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.enabled, false);
    assert.equal(result.reason, "RULES_NOT_VERIFIED");
    assert.equal(result.safetyCheck.failure.stage, "admin-probe-write");
    assert.equal(result.safetyCheck.failure.code, 7);
    assert.ok(
      result.safetyCheck.retryAfterSeconds > 0 &&
        result.safetyCheck.retryAfterSeconds <= 300,
    );
    assert.equal(
      JSON.stringify([result, logs]).includes("PRIVATE_KEY_SHOULD_NOT_APPEAR"),
      false,
    );
    await fetch(server.url);
    assert.equal(creates, 1);
  } finally {
    console.warn = warn;
    await server.close();
    await f.close();
  }
});

test("failed cleanup keeps Lab closed, retries only its own document, and opens after cleanup recovers", async () => {
  const f = await createFixture();
  let time = Date.now(),
    unavailable = true,
    creates = 0;
  const db = {
    projectId: f.db.projectId,
    collection: (name) =>
      name === "knowledge_lab_notes"
        ? {
            doc: (key) => {
              const real = f.db.collection(name).doc(key);
              return {
                create: async (data) => {
                  creates++;
                  await real.create(data);
                },
                delete: async () => {
                  if (unavailable) {
                    const e = Error("SENSITIVE_CLEANUP_MESSAGE");
                    e.code = 14;
                    throw e;
                  }
                  await real.delete();
                },
              };
            },
          }
        : f.db.collection(name),
  };
  const api = routerFor(f, db, { rulesNow: () => time }),
    server = await configServer(api);
  try {
    let r = await (await fetch(server.url)).json();
    assert.equal(r.enabled, false);
    assert.equal(r.safetyCheck.failure.stage, "cleanup");
    assert.equal(r.safetyCheck.failure.code, 14);
    assert.equal(
      JSON.stringify(r).includes("SENSITIVE_CLEANUP_MESSAGE"),
      false,
    );
    time += 300001;
    r = await (await fetch(server.url)).json();
    assert.equal(r.enabled, false);
    assert.equal(creates, 1);
    unavailable = false;
    time += 300001;
    r = await (await fetch(server.url)).json();
    assert.equal(r.enabled, true);
    assert.equal(r.safetyCheck.failure, null);
    assert.equal((await f.db.collection("knowledge_lab_notes").get()).size, 0);
  } finally {
    await server.close();
    await f.close();
  }
});

test("network failure causes are diagnosed by allowlisted codes, not raw URLs or messages", async () => {
  const f = await createFixture(),
    original = global.fetch;
  const api = routerFor(f, f.db),
    server = await configServer(api);
  try {
    global.fetch = async (url, opts) => {
      if (String(url).includes("/security-probe-")) {
        const e = Error("CREDENTIAL_OR_PRIVATE_URL_MUST_NOT_APPEAR");
        e.cause = { code: "ECONNRESET" };
        throw e;
      }
      return original(url, opts);
    };
    const r = await (await fetch(server.url)).json();
    assert.equal(r.enabled, false);
    assert.equal(r.safetyCheck.failure.stage, "anonymous-access-check");
    assert.equal(r.safetyCheck.failure.code, "ECONNRESET");
    assert.equal(
      JSON.stringify(r).includes("CREDENTIAL_OR_PRIVATE_URL_MUST_NOT_APPEAR"),
      false,
    );
  } finally {
    global.fetch = original;
    await server.close();
    await f.close();
  }
});

test("a probe ID collision fails closed and never deletes the existing document", async () => {
  const f = await createFixture(),
    original = global.fetch;
  const probeId = "security-probe-collision-test";
  const existing = f.db.collection("knowledge_lab_notes").doc(probeId);
  await existing.set({ preserved: "do-not-overwrite-or-delete" });
  const api =
    require("../../backend/knowledge-lab/router").createKnowledgeLabRouter({
      rulesProbeId: () => probeId,
      db: f.db,
      identity: f.identity,
      entitlement: f.entitlement,
      requireFirebaseUser: f.middleware.requireFirebaseUser,
      requireOwner: f.middleware.requireOwner,
      rateLimit: f.middleware.rateLimit,
      isOwner: () => false,
      env: {
        KNOWLEDGE_LAB_ENABLED: "true",
        FIRESTORE_EMULATOR_HOST: "127.0.0.1:8787",
      },
    });
  try {
    global.fetch = async (url, opts) =>
      String(url).includes("/" + probeId)
        ? new Response(
            JSON.stringify({ error: { status: "PERMISSION_DENIED" } }),
            { status: 403 },
          )
        : original(url, opts);
    assert.equal(await api.checkRules(), false);
    assert.deepEqual((await existing.get()).data(), {
      preserved: "do-not-overwrite-or-delete",
    });
    assert.equal(
      (await f.db.collection("knowledge_lab_private_posts").get()).size,
      0,
    );
  } finally {
    global.fetch = original;
    api.close?.();
    await f.close();
  }
});
