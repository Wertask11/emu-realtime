"use strict";
/* LAB-08（11/7）：閲覧の GET が、権限の確認（確認用の文書の書き込み・削除）を始めない。
   本番（scheduleRulesCheck: true）では、確認は起動時と定期の時刻にだけ行い、
   結果が無い・古いときは 503 で止める（fail-closed）。隔離エミュレーターだけを使う。 */
const { test } = require("node:test"),
  assert = require("node:assert/strict");
const { createFixture } = require("./fixture.cjs");

test("scheduled Rules check: GETs never start a probe, stale results fail closed", async () => {
  const f = await createFixture(),
    original = global.fetch;
  let probes = 0,
    time = Date.now();
  global.fetch = async (url, opts) => {
    if (String(url).includes("/security-probe-")) probes++;
    return original(url, opts);
  };
  const api = require("../../backend/knowledge-lab/router").createKnowledgeLabRouter({
    rulesNow: () => time,
    scheduleRulesCheck: true,
    db: f.db,
    identity: f.identity,
    entitlement: f.entitlement,
    requireFirebaseUser: f.middleware.requireFirebaseUser,
    requireOwner: f.middleware.requireOwner,
    rateLimit: f.middleware.rateLimit,
    isOwner: () => false,
    env: { KNOWLEDGE_LAB_ENABLED: "true", FIRESTORE_EMULATOR_HOST: "127.0.0.1:8787" },
  });
  const app = require("../../backend/node_modules/express")();
  app.use("/api/knowledge-lab", api.router);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = "http://127.0.0.1:" + server.address().port + "/api/knowledge-lab";
  const get = async (path) => {
    const r = await original(base + path);
    return { status: r.status, body: await r.json() };
  };
  try {
    // 起動時の確認（途中なら待つ）
    const first = await get("/config");
    assert.equal(first.body.enabled, true);
    const afterStartup = probes;
    assert.ok(afterStartup > 0, "起動時に確認していない");
    // 5分を過ぎても、GET は確認を始めない
    time += 6 * 60000;
    for (const path of ["/config", "/taxonomy", "/config"]) {
      const r = await get(path);
      assert.notEqual(r.status, 503, path);
    }
    assert.equal(probes, afterStartup, "GET が確認（書き込み）を始めた");
    // 3時間たっても、定期の確認の結果が使える（間隔は3時間・期限は3時間40分）
    time += 174 * 60000;
    assert.notEqual((await get("/taxonomy")).status, 503);
    assert.equal(probes, afterStartup);
    // 定期の確認が止まって3時間40分を過ぎたら、GET は 503（fail-closed）。それでも確認は始めない
    time += 41 * 60000;
    const stale = await get("/taxonomy");
    assert.equal(stale.status, 503);
    assert.equal(stale.body.error, "RULES_NOT_VERIFIED");
    assert.equal((await get("/config")).body.enabled, false);
    assert.equal(probes, afterStartup);
    // 定期の確認（timer と同じ checkRules）が走れば、また開く
    assert.equal(await api.checkRules(), true);
    assert.ok(probes > afterStartup);
    assert.equal((await get("/taxonomy")).status, 200);
  } finally {
    global.fetch = original;
    api.close();
    await new Promise((r) => server.close(r));
    await f.close();
  }
});
