"use strict";
const m = require("./model");
const EVENTS = new Set([
  "register",
  "publish",
  "view",
  "save",
  "research",
  "practice",
  "answer",
  "search",
  "zero-search",
  "report",
]);
function createAnalytics({ db, ref, now = Date.now }) {
  const day = () => new Date(now() + 9 * 3600000).toISOString().slice(0, 10);
  async function track(a, kind, targetId, fields = [], postId = null) {
    if (!EVENTS.has(kind)) m.fail("INVALID_METRIC");
    const bucket = day(),
      key = m.hash([a?.spid || "public", kind, targetId]),
      event = ref("metric_events", key),
      daily = ref("metric_days", bucket),
      funnel = a ? ref("funnel", a.spid) : null,
      reach =
        kind === "publish" || (kind === "view" && postId)
          ? ref("metric_posts", m.id(postId || targetId))
          : null;
    await db.runTransaction(async (tx) => {
      const [e, d, p, reached] = await Promise.all([
        tx.get(event),
        tx.get(daily),
        funnel ? tx.get(funnel) : Promise.resolve(null),
        reach ? tx.get(reach) : Promise.resolve(null),
      ]);
      if (e.exists) return;
      if (reach) {
        const value = reached?.data() || {};
        if (kind === "publish") value.publishedAtMs ||= now();
        if (
          kind === "view" &&
          (!value.firstViewAtMs || value.firstViewAtMs < value.publishedAtMs)
        )
          value.firstViewAtMs = now();
        tx.set(reach, value);
      }
      const data = d.data() || {},
        person = p?.data() || {};
      tx.create(event, {
        kind,
        targetId,
        day: bucket,
        authorSchoolParkId: a?.spid || null,
        atMs: now(),
      });
      tx.set(
        daily,
        { [kind]: (data[kind] || 0) + 1, fields: data.fields || {} },
        { merge: true },
      );
      if (["search", "zero-search"].includes(kind) && fields.length) {
        const fieldKey = kind === "search" ? "fields" : "zeroFields";
        const groups = { ...(data[fieldKey] || {}) };
        for (const id of fields) groups[id] = (groups[id] || 0) + 1;
        tx.set(daily, { [fieldKey]: groups }, { merge: true });
      }
      if (funnel) {
        const value = { ...person, lastActivityAtMs: now() };
        if (kind === "register" && !value.registeredAtMs)
          value.registeredAtMs = now();
        if (kind === "publish") {
          if (!value.firstPostAtMs) value.firstPostAtMs = now();
          value.publicationCount = (value.publicationCount || 0) + 1;
          value.lastPostAtMs = now();
        }
        if (kind === "view") value.firstViewAtMs ||= now();
        if (kind === "research") value.firstResearchAtMs ||= now();
        if (kind === "practice") value.firstPracticeAtMs ||= now();
        tx.set(funnel, value);
      }
    });
  }
  async function snapshot() {
    const since = now() - 30 * 86400000,
      days = await db
        .collection("knowledge_lab_metric_days")
        .where(
          "__name__",
          ">=",
          new Date(since + 9 * 3600000).toISOString().slice(0, 10),
        )
        .limit(32)
        .get();
    const totals = {},
      fields = {},
      zeroFields = {};
    for (const d of days.docs) {
      for (const [key, n] of Object.entries(d.data())) {
        if (EVENTS.has(key)) totals[key] = (totals[key] || 0) + n;
      }
      for (const [key, n] of Object.entries(d.data().fields || {}))
        fields[key] = (fields[key] || 0) + n;
      for (const [key, n] of Object.entries(d.data().zeroFields || {}))
        zeroFields[key] = (zeroFields[key] || 0) + n;
    }
    const people = [];
    let after = null;
    for (;;) {
      let q = db
        .collection("knowledge_lab_funnel")
        .orderBy("__name__")
        .limit(128);
      if (after) q = q.startAfter(after);
      const s = await q.get();
      people.push(...s.docs.map((d) => d.data()));
      if (people.length > 20000) m.fail("METRICS_CAPACITY_REACHED", 503);
      if (s.size < 128) break;
      after = s.docs.at(-1);
    }
    const count = (predicate) => people.filter(predicate).length,
      registered = count((p) => p.registeredAtMs),
      firstPost = count(
        (p) => p.registeredAtMs && p.firstPostAtMs >= p.registeredAtMs,
      ),
      viewed = count((p) => p.firstViewAtMs),
      researchedAfterView = count(
        (p) => p.firstResearchAtMs >= p.firstViewAtMs && p.firstViewAtMs,
      ),
      researched = count((p) => p.firstResearchAtMs),
      practice = count(
        (p) =>
          p.firstPracticeAtMs >= p.firstResearchAtMs && p.firstResearchAtMs,
      ),
      cohort = count((p) => p.firstPostAtMs && p.firstPostAtMs < since),
      returned = count(
        (p) =>
          p.firstPostAtMs &&
          p.firstPostAtMs < since &&
          p.lastActivityAtMs >= now() - 7 * 86400000,
      );
    const ratio = (n, d) => ({
      numerator: n,
      denominator: d,
      rate: d ? n / d : null,
    });
    let reachedCount = 0,
      publishedCount = 0,
      inspected = 0,
      reachAfter = null;
    for (;;) {
      let q = db
        .collection("knowledge_lab_metric_posts")
        .orderBy("__name__")
        .limit(128);
      if (reachAfter) q = q.startAfter(reachAfter);
      const s = await q.get();
      for (const doc of s.docs) {
        const p = doc.data();
        if (p.publishedAtMs) {
          publishedCount++;
          if (p.firstViewAtMs >= p.publishedAtMs) reachedCount++;
        }
      }
      inspected += s.size;
      if (inspected > 20000) m.fail("METRICS_CAPACITY_REACHED", 503);
      if (s.size < 128) break;
      reachAfter = s.docs.at(-1);
    }
    return {
      window: { days: 30, since, timezone: "Asia/Tokyo" },
      totals,
      fields,
      zeroFields,
      publicationToView: ratio(reachedCount, publishedCount),
      activeWriters30: count(
        (p) => p.registeredAtMs && p.lastActivityAtMs >= since,
      ),
      registrationToFirstPost: ratio(firstPost, registered),
      viewToResearch: ratio(researchedAfterView, viewed),
      researchToPractice: ratio(practice, researched),
      repeatPosting: ratio(
        count((p) => p.publicationCount >= 2),
        count((p) => p.publicationCount >= 1),
      ),
      writerRetention: ratio(returned, cohort),
      zeroSearchRate: ratio(totals["zero-search"] || 0, totals.search || 0),
      definition:
        "計測開始後のサーバー成功処理を集計。登録→初投稿等は認証済みPassport単位、本文・人物名・検索文は保存しません。閲覧はintent=view付き詳細取得を1人・1投稿・日本時間1日につき1回。検索は最初の結果ページのみ、閲覧可能範囲内の0件を数えます。継続率は初投稿30日超の書き手が直近7日活動した割合。未記録の過去行動は推測しません。",
    };
  }
  return { track, snapshot };
}
module.exports = { createAnalytics };
