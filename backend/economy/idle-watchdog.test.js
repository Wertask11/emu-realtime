"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { fixture } = require("./fixture");

test("expired intake skips product reads but an explicit new trial rechecks every gate", async () => {
  const f=fixture();await f.seed();try {
    f.advance(8*86400000);
    const original=f.db.collection.bind(f.db);let reads=0;
    f.db.collection=(name)=>{reads++;throw Error("READ_SENTINEL");};
    const closed=await f.economy.service.status();
    assert.equal(closed.service.enabled,false);assert.ok(closed.service.blockers.includes("TRIAL_NOT_ACTIVE"));assert.equal(reads,0);
    // Isolated fixture only, not the production deadline: no cached enablement.
    f.env.ECONOMY_EXPLORER_TRIAL_START=new Date(f.now()-86400000).toISOString();
    await assert.rejects(f.economy.service.status(),/READ_SENTINEL/);assert.equal(reads,1);
    f.db.collection=original;
  }finally{f.economy.close();}
});

test("24-hour empty watchdog reduces queue/readiness operations and keeps health fresh", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-06T03:00Z") });
  const f = fixture();
  await f.seed();
  try {
    let scans = 0, readiness = 0, writes = 0;
    const tick = f.economy.service.tick, status = f.economy.service.status,
      health = f.economy.service.workerHealth;
    f.economy.service.tick = (...a) => { scans++; return tick(...a); };
    f.economy.service.status = (...a) => { readiness++; return status(...a); };
    f.economy.service.workerHealth = (...a) => { writes++; return health(...a); };
    const route = f.economy.router.stack.find(x => x.route?.path === "/status").route.stack.at(-1).handle;
    for (let i = 0; i < 2880; i++) {
      await f.economy.tickScheduled();
      route({}, { json(s) { assert.equal(s.worker.state, "healthy"); } });
      t.mock.timers.tick(30000);
      f.advance(30000);
    }
    assert.ok(scans <= 292, scans);
    assert.ok(readiness <= 1732, readiness);
    assert.ok(scans + 3 * readiness < 5500); // old 11,520 reads/day, no polling query for completed history
    assert.ok(writes < 2100); // old two writes per 30s cycle = 5,760/day
    t.diagnostic(JSON.stringify({cycles:2880,queueScans:scans,readinessRefreshes:readiness,estimatedIdleDocumentReads:scans+3*readiness,healthWrites:writes,excludes:"cleanup, paid work, other services"}));
    assert.equal(f.db._count("mitemiru_orders"), 0);
  } finally { f.economy.close(); }
});

test("watchdog discovers a durable paid job after a lost wake within five minutes", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-06T03:00Z") });
  const f = fixture(); await f.seed();
  try {
    for (let i = 0; i < 24; i++) { await f.economy.tickScheduled(); t.mock.timers.tick(30000); f.advance(30000); }
    const a = await f.actor(), q = await f.economy.service.quote(a, { goal: "コーヒーを学びたい" });
    const j = await f.economy.service.submit(a, { quoteId:q.id,termsVersion:q.termsVersion,requestId:"lost-wake-recovery-0001",paymentConsent:true,aiConsent:true });
    assert.equal(j.state, "queued");
    for (let i = 0; i <= 10; i++) { await f.economy.tickScheduled(); t.mock.timers.tick(30000); f.advance(30000); }
    assert.equal((await f.economy.service.view(a,j.id)).state,"completed");
    assert.equal(f.calls(),1); assert.equal(f.db._count("mitemiru_orders"),1);
  } finally { f.economy.close(); }
});

test("quota on a lightweight heartbeat closes intake and recovery forces a queue scan", async(t) => {
  t.mock.timers.enable({apis:["Date"],now:Date.parse("2026-11-06T03:00Z")});
  const f=fixture();await f.seed();
  try {
    await f.economy.tickScheduled();t.mock.timers.tick(60000);f.advance(60000);await f.economy.tickScheduled();
    // Next minute is only readiness/heartbeat (empty queue backoff is 120s).
    f.db._breakAll("RESOURCE_EXHAUSTED");t.mock.timers.tick(60000);f.advance(60000);await f.economy.tickScheduled();
    const route=f.economy.router.stack.find(x=>x.route?.path==="/status").route.stack.at(-1).handle;
    route({}, {json(s){assert.equal(s.service.enabled,false);assert.equal(s.worker.state,"not_ready");assert.equal(s.worker.errorStage,"heartbeat");}});
    f.db._repair();t.mock.timers.tick(60000);f.advance(60000);await f.economy.tickScheduled();
    route({}, {json(s){assert.equal(s.service.enabled,true);assert.equal(s.worker.state,"healthy");assert.equal(s.worker.activity.queueScans,3);}});
    assert.equal(f.calls(),0);
  }finally{f.economy.close();}
});
