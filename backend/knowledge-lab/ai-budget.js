"use strict";
const m = require("./model");
const CAPS = {
  analysis: 10,
  embedding: 60,
  perPassportAnalysis: 3,
  perPassportEmbedding: 15,
  totalTokens: 200000,
  concurrency: 2,
};
function createBudget({ db, ref, now = Date.now }) {
  const day = () => new Date(now() + 9 * 3600000).toISOString().slice(0, 10);
  async function reserve(a, kind) {
    if (!["analysis", "embedding"].includes(kind))
      m.fail("AI_INVALID_OPERATION");
    const bucket = day(),
      token = m.hash([a.spid, now(), Math.random()]);
    const global = ref("ai_usage", "day-" + bucket),
      person = ref("ai_user_usage", m.hash([bucket, a.spid])),
      slots = ref("system", "ai-slots"),
      control = ref("system", "ai-control");
    await db.runTransaction(async (tx) => {
      const [g, p, s, c] = await Promise.all([
        tx.get(global),
        tx.get(person),
        tx.get(slots),
        tx.get(control),
      ]);
      const settings = c.data() || {};
      if (settings.stopped !== false || !settings.freeTierAttested)
        m.fail("AI_STOPPED", 503);
      const gd = g.data() || {},
        pd = p.data() || {},
        active = (s.data()?.active || []).filter((v) => v.until > now());
      const limit = Math.min(
        CAPS[kind],
        settings[kind + "DailyLimit"] ?? CAPS[kind],
      );
      if (
        (gd[kind] || 0) >= limit ||
        (gd.totalTokens || 0) >= CAPS.totalTokens ||
        (pd[kind] || 0) >=
          CAPS[
            kind === "analysis" ? "perPassportAnalysis" : "perPassportEmbedding"
          ]
      )
        m.fail("AI_DAILY_LIMIT", 429);
      if (active.length >= CAPS.concurrency) m.fail("AI_BUSY", 429);
      tx.set(
        global,
        {
          [kind]: (gd[kind] || 0) + 1,
          attempts: (gd.attempts || 0) + 1,
          updatedAtMs: now(),
        },
        { merge: true },
      );
      tx.set(
        person,
        { [kind]: (pd[kind] || 0) + 1, updatedAtMs: now() },
        { merge: true },
      );
      tx.set(slots, { active: [...active, { token, until: now() + 60000 }] });
    });
    return { token, bucket, kind };
  }
  async function finish(lease, outcome, usage = {}) {
    await db.runTransaction(async (tx) => {
      const global = ref("ai_usage", "day-" + lease.bucket),
        slots = ref("system", "ai-slots");
      const receipt = ref("ai_calls", lease.token);
      const [g, s, event] = await Promise.all([
          tx.get(global),
          tx.get(slots),
          tx.get(receipt),
        ]),
        data = g.data() || {};
      if (event.exists) return;
      tx.create(receipt, {
        kind: lease.kind,
        bucket: lease.bucket,
        outcome,
        finishedAtMs: now(),
      });
      const input = Math.max(0, Number(usage.inputTokens) || 0),
        output = Math.max(0, Number(usage.outputTokens) || 0),
        total = Math.max(input + output, Number(usage.totalTokens) || 0);
      tx.set(
        global,
        {
          inputTokens: (data.inputTokens || 0) + input,
          outputTokens: (data.outputTokens || 0) + output,
          totalTokens: (data.totalTokens || 0) + total,
          inputCharacters:
            (data.inputCharacters || 0) + (Number(usage.inputCharacters) || 0),
          unreportedTokens:
            (data.unreportedTokens || 0) +
            (outcome === "success" && usage.providerTokensReported === false
              ? 1
              : 0),
          [outcome === "success" ? "successes" : "errors"]:
            (data[outcome === "success" ? "successes" : "errors"] || 0) + 1,
          updatedAtMs: now(),
        },
        { merge: true },
      );
      tx.set(slots, {
        active: (s.data()?.active || []).filter(
          (v) => v.token !== lease.token && v.until > now(),
        ),
      });
    });
  }
  async function call(a, kind, fn) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const lease = await reserve(a, kind);
      try {
        const result = await fn();
        await finish(lease, "success", result.usage);
        return result;
      } catch (e) {
        await finish(lease, "error");
        if (
          attempt === 0 &&
          ["AI_PROVIDER_UNAVAILABLE", "AI_FREE_QUOTA_EXHAUSTED"].includes(
            e.message,
          )
        ) {
          await new Promise((r) => setTimeout(r, 400));
          continue;
        }
        throw e;
      }
    }
  }
  async function cacheHit() {
    await db.runTransaction(async (tx) => {
      const r = ref("ai_usage", "day-" + day()),
        s = await tx.get(r);
      tx.set(r, { cacheHits: (s.data()?.cacheHits || 0) + 1 }, { merge: true });
    });
  }
  return { call, cacheHit, caps: CAPS };
}
module.exports = { createBudget, CAPS };
