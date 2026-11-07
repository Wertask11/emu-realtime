"use strict";
const { fail } = require("./config");
const LIMITS = Object.freeze({
  admissionsPerMinute: 2,
  httpPerMinute: 10,
  generationsPerMinute: 2,
  dailyRequests: 20,
  dailyTokens: 100000,
});
const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
function providerDay(at) {
  return dateFormatter.format(new Date(at));
}
function createFreeTierGuard({ db, now = Date.now }) {
  const ref = (kind, id) => db.collection("emuer_v2_agent_" + kind).doc(id);
  const recent = (rows) =>
    (rows || []).filter(
      (r) => Number.isFinite(r.atMs) && r.atMs > now() - 60000,
    );
  // Return writes separately: all Firestore transaction reads precede any write.
  async function admission(tx, tokens) {
    const bucket = providerDay(now()),
      dailyRef = ref("free_usage", bucket),
      minuteRef = ref("system", "free-admissions"),
      [ds, ms] = await Promise.all([tx.get(dailyRef), tx.get(minuteRef)]),
      d = ds.data() || {},
      rows = recent(ms.data()?.recent);
    if (
      (d.count || 0) >= LIMITS.dailyRequests ||
      (d.reservedTokens || 0) + tokens > LIMITS.dailyTokens
    )
      fail("AI_PROVIDER_DAY_LIMIT", 429);
    if (rows.length >= LIMITS.admissionsPerMinute)
      fail("AI_ADMISSION_RATE_LIMIT", 429);
    return {
      bucket,
      commit() {
        tx.set(
          dailyRef,
          {
            count: (d.count || 0) + 1,
            reservedTokens: (d.reservedTokens || 0) + tokens,
          },
          { merge: true },
        );
        tx.set(minuteRef, { recent: [...rows, { atMs: now() }] });
      },
    };
  }
  async function beforeCall(operation, jobId, leaseToken) {
    if (!["countTokens", "generateContent"].includes(operation))
      fail("AI_INVALID_OPERATION");
    await db.runTransaction(async (tx) => {
      const jr = ref("jobs", jobId),
        mr = ref("system", "free-provider-window"),
        [js, ms] = await Promise.all([tx.get(jr), tx.get(mr)]),
        j = js.data();
      if (
        !j ||
        j.state !== "running" ||
        j.leaseToken !== leaseToken ||
        j.leaseUntilMs < now() + 60000
      )
        fail("LEASE_EXPIRED");
      if (j.providerBucket !== providerDay(now()))
        fail("FREE_QUOTA_WINDOW_EXPIRED");
      const rows = recent(ms.data()?.recent);
      if (
        rows.length >= LIMITS.httpPerMinute ||
        (operation === "generateContent" &&
          rows.filter((r) => r.operation === "generateContent").length >=
            LIMITS.generationsPerMinute)
      )
        fail("AI_PROVIDER_THROTTLED", 429);
      tx.set(mr, { recent: [...rows, { atMs: now(), operation }] });
    });
  }
  async function snapshot() {
    const [daily, minute] = await Promise.all([
      ref("free_usage", providerDay(now())).get(),
      ref("system", "free-provider-window").get(),
    ]);
    return {
      timezone: "America/Los_Angeles",
      bucket: providerDay(now()),
      limits: LIMITS,
      usage: daily.data() || {},
      recentHttpCalls: recent(minute.data()?.recent).length,
      scope: "reizo-request-only; not a live Google project quota measurement",
    };
  }
  return { admission, beforeCall, snapshot };
}
module.exports = { LIMITS, providerDay, createFreeTierGuard };
