"use strict";
const { hash, SERVICE, fail } = require("../config");
const { DOMAINS, PURPOSE, VERSION, profile } = require("./profile");
const { assertRow } = require("./contracts");
const { plan, rank } = require("./planner");
const { createAdapters } = require("./adapters");
const { createContext, wei } = require("./context");
const kindDomain = {
  knowledge: "knowledge_lab",
  knowledge_lab: "knowledge_lab",
  knowledge_research: "knowledge_lab",
  knowledge_text: "knowledge_text",
  guild: "guild",
  quest: "quest",
  city_product: "city",
  service_guide: "service",
  emuer_guide: "emuer",
  passport_guide: "passport",
  activity_guide: "activities",
};
async function bounded(fn, ms = 6500) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(fn),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error("SOURCE_TIMEOUT")), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
function createRegistry({
  db,
  knowledge,
  payments,
  env = {},
  now = Date.now,
  adapters,
}) {
  const readers = adapters || createAdapters({ db, knowledge, now }),
    privateContext = createContext({ db, payments, env });
  function enabled(snapshot) {
    const live = profile(env);
    if (!live || snapshot?.version !== VERSION)
      fail("CROSS_SEARCH_DISABLED", 503);
    return snapshot.domains.filter((d) => live.domains.includes(d));
  }
  async function reviewed(s) {
    if (!s) return null;
    const r = (
      await db
        .collection("emuer_v2_agent_source_approvals")
        .doc(hash(s.key))
        .get()
    ).data();
    const legacy = s.kind === "guild" && r?.purpose === SERVICE.termsVersion;
    if (
      r?.piiReviewed !== true ||
      r.aiUseApproved !== true ||
      !(r.validUntilMs > now()) ||
      r.contentHash !== hash([s.title, s.summary]) ||
      (!legacy && (r.purpose !== PURPOSE || r.rightsVerified !== true)) ||
      (s.originHash && s.originHash !== r?.originHash)
    )
      return null;
    if (!s.permission.authorAIConsent && r.authorPermissionConfirmed !== true)
      return null;
    const out = {
      ...s,
      checkedAtMs: now(),
      permission: {
        ...s.permission,
        authorAIConsent: true,
        operatorReviewed: true,
        artifactUseApproved:
          r.artifactUseApproved === true &&
          r.artifactPurpose === require("../tasks").VERSION,
        artifactAllowedTasks: Array.isArray(r.artifactAllowedTasks)
          ? r.artifactAllowedTasks.filter((t) =>
              Object.hasOwn(require("../tasks").TASKS, t),
            )
          : [],
      },
      sourceVersion: hash([s.title, s.summary]),
    };
    return assertRow(out);
  }
  async function collect(a, goal, snapshot, permissions = {}) {
    const started = Date.now(),
      active = enabled(snapshot),
      p = plan(goal);
    const contextPromise = bounded(() => privateContext(a, permissions)).catch(
      () => ({
        balance: { state: "unavailable" },
        achievements: { state: "unavailable" },
      }),
    );
    const requested = p.domains.filter((d) => snapshot.domains.includes(d));
    const reports = await Promise.all(
      Object.keys(DOMAINS).map(async (domain) => {
        if (!snapshot.domains.includes(domain) || !active.includes(domain))
          return {
            domain,
            label: DOMAINS[domain],
            state: "disabled",
            sources: [],
          };
        if (!requested.includes(domain))
          return {
            domain,
            label: DOMAINS[domain],
            state: "not_requested",
            sources: [],
          };
        try {
          const raw = await bounded(() => readers[domain].list(a));
          const approved = (
            await bounded(() =>
              Promise.all(
                raw
                  .filter(
                    (s) =>
                      s && s.domain === domain && kindDomain[s.kind] === domain,
                  )
                  .slice(0, 24)
                  .map(reviewed),
              ),
            )
          ).filter(Boolean);
          return {
            domain,
            label: DOMAINS[domain],
            state: approved.length
              ? "ready"
              : raw.length
                ? "no_approved_data"
                : "empty",
            sources: approved,
          };
        } catch (_) {
          return {
            domain,
            label: DOMAINS[domain],
            state: "unavailable",
            sources: [],
          };
        }
      }),
    );
    const context = await contextPromise;
    let pool = reports.flatMap((r) => r.sources);
    const unique = new Map();
    for (const s of pool) {
      const duplicate = [...unique.values()].find(
        (x) => x.target === s.target && x.sourceVersion === s.sourceVersion,
      );
      if (!duplicate) unique.set(s.key, s);
    }
    pool = [...unique.values()];
    const balance =
      permissions.balance === true && context.balance.state === "ready"
        ? wei(context.balance.spendable)
        : null;
    if (balance !== null)
      pool = pool.filter(
        (s) =>
          s.kind !== "city_product" ||
          BigInt(s.facts.priceEmuer) * 10n ** 18n <= balance,
      );
    const coverage = reports.map(({ sources, ...r }) => ({
      ...r,
      approvedCount: sources.length,
    }));
    if (
      !pool.length &&
      reports
        .filter((r) => requested.includes(r.domain))
        .every((r) => ["unavailable", "disabled"].includes(r.state))
    )
      fail("SEARCH_SOURCES_UNAVAILABLE", 503);
    return {
      sources: rank(pool, p, goal),
      plan: p,
      coverage,
      context: {
        ...context,
        balance:
          context.balance.state === "ready"
            ? { state: "ready", applied: true }
            : context.balance,
      },
      profileVersion: VERSION,
      balanceApplied: balance !== null,
      searchMs: Date.now() - started,
    };
  }
  async function current(a, rows, snapshot, permissions = {}, options = {}) {
    const active =
        options.history === true
          ? snapshot.domains.filter(
              (d) => env["ECONOMY_SOURCE_" + d.toUpperCase()] === "true",
            )
          : enabled(snapshot),
      context =
        options.checkPrivate === false
          ? {
              balance: { state: "not_rechecked" },
              achievements: { state: "not_rechecked" },
            }
          : await bounded(() => privateContext(a, permissions)).catch(() => ({
              balance: { state: "unavailable" },
              achievements: { state: "unavailable" },
            }));
    const balance =
      permissions.balance === true && context.balance.state === "ready"
        ? wei(context.balance.spendable)
        : null;
    const values = await Promise.all(
      rows.map(async (old) => {
        const domain = kindDomain[old.kind];
        if (
          !active.includes(domain) ||
          !snapshot.domains.includes(domain) ||
          !readers[domain]
        )
          return null;
        try {
          const s = await bounded(() => readers[domain].get(old.id, a));
          if (!s || s.kind !== old.kind || s.target !== old.target) return null;
          const approved = await reviewed(s);
          if (!approved) return null;
          if (
            (old.sourceVersion &&
              approved.sourceVersion !== old.sourceVersion) ||
            (old.originHash && approved.originHash !== old.originHash)
          )
            return null;
          if (
            s.kind === "city_product" &&
            balance !== null &&
            BigInt(s.facts.priceEmuer) * 10n ** 18n > balance
          )
            return null;
          return approved;
        } catch (_) {
          return null;
        }
      }),
    );
    return {
      sources: values.filter(Boolean),
      context: {
        ...context,
        balance:
          context.balance.state === "ready"
            ? { state: "ready", applied: true }
            : context.balance,
      },
    };
  }
  async function revalidateResult(a, result, snapshot, permissions) {
    const checked = await current(
        a,
        result.results || [],
        snapshot,
        permissions,
        { history: true },
      ),
      byKey = new Map(checked.sources.map((s) => [s.key, s]));
    const results = (result.results || []).flatMap((r) => {
      const s = byKey.get(r.kind + ":" + r.id);
      return s
        ? [
            {
              ...r,
              title: s.title,
              evidence: s.summary,
              target: s.target,
              publicURL: s.publicURL,
              facts: s.facts,
              checkedAtMs: s.checkedAtMs,
            },
          ]
        : [];
    });
    return {
      ...result,
      results,
      steps: (result.steps || []).filter((s) =>
        s.references.every((k) => byKey.has(k)),
      ),
      comparisons: (result.comparisons || []).filter((s) =>
        s.references.every((k) => byKey.has(k)),
      ),
      privateContext: checked.context,
      limitations: [
        ...(result.limitations || []),
        ...(!profile(env)
          ? [
              "横断探索の新規受付は停止しています。過去の結果は現在の公開範囲と許諾を再確認して表示しています。",
            ]
          : []),
        ...(results.length < (result.results || []).length
          ? [
              "公開範囲・許諾・価格などの更新により、現在確認できない参照先を除外しました。",
            ]
          : []),
      ],
    };
  }
  return {
    collect,
    current,
    revalidateResult,
    privateContext,
    reviewed,
    adapters: readers,
  };
}
module.exports = { createRegistry, bounded, kindDomain };
