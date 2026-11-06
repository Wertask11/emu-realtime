"use strict";
const express = require("express");
const { createEconomy } = require("./service");
const { createSources } = require("./sources");
const { createAgent } = require("./agent");
const { configuration } = require("./config");
function createEconomyRouter(deps) {
  const env = deps.env || process.env;
  const sources =
    deps.sources || createSources({ db: deps.db, knowledge: deps.knowledge });
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
          reason: e.status ? e.message : "ECONOMY_UNAVAILABLE",
        };
      }
      return {
        ...(await service.status()),
        eligibility,
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
    "/quotes",
    limited,
    handle(async (req, a) => ({
      quote: await service.quote(a, req.body || {}),
    })),
  );
  router.post(
    "/jobs",
    limited,
    handle(async (req, a) => ({
      job: await service.submit(a, req.body || {}),
    })),
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
  let timer = null,
    ticking = false,
    cleanupAfter = 0;
  const tick = async () => {
    if (ticking) return;
    ticking = true;
    try {
      await service.tick();
      if (Date.now() >= cleanupAfter) {
        await service.purge();
        cleanupAfter = Date.now() + 3600000;
      }
    } catch (_) {
      /* state is durable; no inputs or secrets in logs */
    } finally {
      ticking = false;
    }
  };
  if (env.ECONOMY_WORKER_ENABLED === "true" && deps.startWorker !== false) {
    timer = setInterval(tick, 10000);
    timer.unref();
  }
  return {
    router,
    service,
    tick,
    close() {
      if (timer) clearInterval(timer);
    },
  };
}
module.exports = { createEconomyRouter };
