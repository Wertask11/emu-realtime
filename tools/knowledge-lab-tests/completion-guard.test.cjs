"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict");
const { createFixture } = require("./fixture.cjs");
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
    api.close();
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
    api.close();
    await f.close();
  }
});
