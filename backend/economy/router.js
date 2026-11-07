"use strict";
const express = require("express");
const { createEconomy } = require("./service");
const { createSources } = require("./sources");
const { createAgent } = require("./agent");
const { configuration } = require("./config");
function createEconomyRouter(deps) {
  const env = deps.env || process.env;
  const sources =
    deps.sources ||
    createSources({
      db: deps.db,
      knowledge: deps.knowledge,
      payments: deps.payments,
      env,
    });
  const service = createEconomy({
    ...deps,
    env,
    sources,
    agent:
      deps.agent ||
      createAgent({
        env,
        config: () => configuration(env),
        fetcher: deps.fetcher,
      }),
  });
  const router = express.Router();
  router.use((req, res, next) => {
    res.set("Cache-Control", "private, no-store");
    next();
  });
  const handle = (fn) => async (req, res) => {
    try {
      const a = await service.actor(req.identity);
      res.json({ ok: true, ...(await fn(req, a)) });
    } catch (e) {
      const known = /^[A-Z][A-Z_]{2,60}$/.test(e.message || "");
      const status =
        known && [400, 401, 403, 404, 409, 429, 502, 503].includes(e.status)
          ? e.status
          : known
            ? 409
            : 503;
      res
        .status(status)
        .json({ error: known ? e.message : "ECONOMY_UNAVAILABLE" });
    }
  };
  let snapshot = null,
    lastSuccessAtMs = 0,
    lastError = null;
  // No database read, write, user identity or provider call from this public probe.
  router.get("/status", (req, res) => {
    const c = service.config(),
      workerEnabled = env.ECONOMY_WORKER_ENABLED === "true";
    const healthy =
      workerEnabled &&
      lastError === null &&
      lastSuccessAtMs > 0 &&
      Date.now() - lastSuccessAtMs < 90000;
    const blockers = [...c.blockers, ...(snapshot?.service.blockers || [])];
    if (c.enabled && !snapshot) blockers.push("READINESS_PENDING");
    if (c.enabled && !healthy) blockers.push("WORKER_UNHEALTHY");
    res.json({
      ok: true,
      schema: "economy-release-v2",
      releaseCommit: /^[a-f0-9]{40}$/i.test(env.RENDER_GIT_COMMIT || "")
        ? env.RENDER_GIT_COMMIT
        : null,
      service: {
        id: c.id,
        name: c.name,
        price: c.price,
        currency: c.currency,
        allowedPlans: c.allowedPlans,
        searchProfile: c.searchProfile,
        enabled: c.enabled && snapshot?.service.enabled === true && healthy,
        globalDaily: c.globalDaily,
        personDaily: c.personDaily,
        concurrency: c.concurrency,
        dailyTokens: c.dailyTokens,
        requestTokens: c.reserveTokens,
        trialDays: c.trialDays,
        trialStartMs: c.trialStartMs,
        trialEndMs: c.trialEndMs,
        billingMode: c.billingMode,
        freeTierLimits: require("./free-tier").LIMITS,
        blockers: [...new Set(blockers)],
      },
      worker: {
        state: !workerEnabled ? "disabled" : healthy ? "healthy" : "not_ready",
        lastSuccessAtMs: lastSuccessAtMs || null,
        error: lastError,
        retryAfterMs: Math.max(0, quotaRetryAt - Date.now()),
      },
      walletPaymentEnabled: false,
      externalExchangeExecutable: false,
    });
  });
  router.use(deps.requireFirebaseUser);
  const limited = deps.rateLimit
    ? deps.rateLimit({ windowMs: 60000, max: 12, key: "economy-explorer" })
    : (req, res, next) => next();
  router.get(
    "/me",
    limited,
    handle(async (req, a) => {
      let eligibility = { eligible: true, reason: null };
      try {
        await service.allowed(a);
      } catch (e) {
        eligibility = {
          eligible: false,
          reason: /^[A-Z][A-Z_]{2,60}$/.test(e.message || "")
            ? e.message
            : "ECONOMY_UNAVAILABLE",
        };
      }
      return {
        ...(await service.status()),
        eligibility,
        isOwner: !!(deps.isOwner && deps.isOwner(req.identity)),
        balances: {
          ...(await deps.payments.balances(
            String(a.walletAddress || "").toLowerCase(),
          )),
          processing: await service.processing(a),
        },
      };
    }),
  );
  router.get(
    "/jobs",
    handle(async (req, a) => ({ jobs: await service.history(a) })),
  );
  router.get(
    "/jobs/:id",
    handle(async (req, a) => ({ job: await service.view(a, req.params.id) })),
  );
  router.post(
    "/context",
    limited,
    handle(async (req, a) => {
      const c = await service.allowed(a);
      if (!c.searchProfile || !sources.cross)
        require("./config").fail("CROSS_SEARCH_DISABLED", 503);
      if (
        Object.keys(req.body || {}).some(
          (k) => !["balanceConsent", "achievementsConsent"].includes(k),
        )
      )
        require("./config").fail("INVALID_INPUT", 400);
      if (
        (req.body?.balanceConsent === true &&
          !c.searchProfile.balanceAvailable) ||
        (req.body?.achievementsConsent === true &&
          !c.searchProfile.achievementsAvailable)
      )
        require("./config").fail("PRIVATE_CONTEXT_UNAVAILABLE", 403);
      return {
        context: await sources.cross.privateContext(a, {
          balance: req.body?.balanceConsent === true,
          achievements: req.body?.achievementsConsent === true,
        }),
      };
    }),
  );
  router.post(
    "/quotes",
    limited,
    handle(async (req, a) => ({
      quote: await service.quote(a, req.body || {}),
    })),
  );
  router.post(
    "/jobs",
    limited,
    handle(async (req, a) => {
      const job = await service.submit(a, req.body || {});
      wakeFor(job);
      return { job };
    }),
  );
  router.get(
    "/external",
    handle(async () => ({ capability: require("./external").capability })),
  );
  router.post(
    "/external/simulate",
    limited,
    handle(async (req) => ({
      simulation: require("./external").simulate(req.body),
    })),
  );
  router.get(
    "/admin/operations",
    deps.requireOwner || ((req, res) => res.sendStatus(403)),
    handle(async () => ({
      operations: await service.operations(),
      ...(await service.status()),
    })),
  );
  let timer = null,
    ticking = false,
    wakePending = false,
    closed = false,
    cleanupAfter = 0,
    quotaRetryAt = 0,
    quotaFailures = 0;
  const awakenedJobs = new Set();
  function wakeFor(job) {
    if (
      closed ||
      env.ECONOMY_WORKER_ENABLED !== "true" ||
      deps.startWorker === false ||
      job.state !== "queued" ||
      awakenedJobs.has(job.id)
    )
      return;
    awakenedJobs.add(job.id);
    if (awakenedJobs.size > 64)
      awakenedJobs.delete(awakenedJobs.values().next().value);
    // A new durable paid job wakes the existing worker. Replays do not create
    // more scans, and a busy cycle gets one coalesced follow-up pass.
    if (ticking) wakePending = true;
    else queueMicrotask(tick);
  }
  const tick = async () => {
    if (ticking || closed || Date.now() < quotaRetryAt) return;
    ticking = true;
    try {
      await service.workerHealth(true, false);
      await service.tick();
      await service.workerHealth(true);
      snapshot = await service.status();
      lastSuccessAtMs = Date.now();
      lastError = null;
      if (Date.now() >= cleanupAfter) {
        await service.purge();
        cleanupAfter = Date.now() + 3600000;
      }
      quotaFailures = 0;
      quotaRetryAt = 0;
    } catch (error) {
      // A daily-quota outage is not repaired by scanning every 30 seconds.
      // Back off only quota faults; ordinary recovery and immediate wake stay.
      if (error.code === 8 || /RESOURCE_EXHAUSTED|quota exceeded/i.test(error.message || "")) {
        quotaFailures = Math.min(quotaFailures + 1, 4);
        quotaRetryAt = Date.now() + Math.min(300000, 30000 * 2 ** quotaFailures);
      }
      lastError = "WORKER_CYCLE_FAILED";
      snapshot = null;
      try {
        await service.workerHealth(false);
      } catch (_) {}
      /* state is durable; no inputs or secrets in logs */
    } finally {
      ticking = false;
      if (wakePending && !closed) {
        wakePending = false;
        queueMicrotask(tick);
      }
    }
  };
  if (env.ECONOMY_WORKER_ENABLED === "true" && deps.startWorker !== false) {
    tick();
    // Four minimum reads per idle cycle (one queue probe + three readiness
    // documents), about 11,520/day rather than 23,040. Shared app traffic is
    // additional. The 30s recovery cadence and 90s heartbeat remain unchanged;
    // quota failures wait 60/120/240/300s without additional Firestore reads.
    timer = setInterval(tick, 30000);
    timer.unref();
  }
  return {
    router,
    service,
    tick,
    close() {
      closed = true;
      if (timer) clearInterval(timer);
    },
  };
}
module.exports = { createEconomyRouter };
