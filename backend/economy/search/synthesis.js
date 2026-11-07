"use strict";
const { fail } = require("../config");
const { assertRow } = require("./contracts");
const ACTIONS = {
  read_source: {
    kinds: [
      "knowledge",
      "knowledge_lab",
      "knowledge_text",
      "knowledge_research",
      "service_guide",
    ],
    text: "元の資料を読み、今回に当てはまる条件と違う条件を確認する。",
  },
  review_activity: {
    kinds: ["guild", "quest"],
    text: "活動の内容と参加条件を確認し、自分が試すことを一つ決める。参加は移動先で別途判断する。",
  },
  review_conditions: {
    kinds: ["city_product", "emuer_guide"],
    text: "価格・交換枠・期限・提供条件を確認し、利用するか自分で判断する。",
  },
  draft_outline: {
    kinds: ["service_guide"],
    ids: ["posting"],
    text: "「状況→試したこと→結果→当てはまる条件→注意点」の順で経験を整理する。投稿前に個人情報や秘密を確認する。",
  },
  check_profile: {
    kinds: ["passport_guide"],
    text: "自分のプロフィールからPassport・星空の記録を確認する。ログインや星の記録を公的本人確認の代わりにしない。",
  },
  open_play_guide: {
    kinds: ["activity_guide"],
    text: "Cityの遊び・体験入口で利用条件を確認してから、自分の操作で開始する。",
  },
};
const BASES = {
  learning_to_practice:
    "資料で学ぶ候補と、実際に試す活動の候補を組み合わせました。",
  conditions: "公開されている価格・利用条件を比べる候補です。",
  perspectives: "複数の公開資料を読み比べる候補です。",
};
function schema(keys) {
  const ref = { type: "STRING", enum: keys };
  return {
    type: "OBJECT",
    properties: {
      matches: {
        type: "ARRAY",
        maxItems: 8,
        items: {
          type: "OBJECT",
          properties: {
            key: ref,
            evidence: { type: "STRING", enum: ["summary"] },
          },
          required: ["key", "evidence"],
        },
      },
      steps: {
        type: "ARRAY",
        maxItems: 6,
        items: {
          type: "OBJECT",
          properties: {
            key: ref,
            action: { type: "STRING", enum: Object.keys(ACTIONS) },
          },
          required: ["key", "action"],
        },
      },
      comparisons: {
        type: "ARRAY",
        maxItems: 3,
        items: {
          type: "OBJECT",
          properties: {
            keys: { type: "ARRAY", minItems: 2, maxItems: 4, items: ref },
            basis: { type: "STRING", enum: Object.keys(BASES) },
          },
          required: ["keys", "basis"],
        },
      },
    },
    required: ["matches", "steps", "comparisons"],
  };
}
function exact(v, allowed) {
  return (
    v &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    Object.keys(v).every((k) => allowed.includes(k))
  );
}
function resolve(value, sources) {
  if (
    !exact(value, ["matches", "steps", "comparisons"]) ||
    !Array.isArray(value.matches) ||
    value.matches.length > 8 ||
    !Array.isArray(value.steps) ||
    value.steps.length > 6 ||
    !Array.isArray(value.comparisons) ||
    value.comparisons.length > 3
  )
    fail("AI_INVALID_OUTPUT", 502);
  const byKey = new Map(
    sources.map((s) => [s.key, assertRow({ ...s, key: s.kind + ":" + s.id })]),
  );
  // The map uses ephemeral aliases; assertRow checks the immutable canonical fields separately.
  const selected = new Map();
  for (const m of value.matches) {
    const s = byKey.get(m?.key);
    if (
      !exact(m, ["key", "evidence"]) ||
      m.evidence !== "summary" ||
      !s ||
      selected.has(m.key)
    )
      fail("AI_INVALID_CITATION", 502);
    selected.set(m.key, s);
  }
  const results = [...selected.values()].map((s) => ({
    domain: s.domain,
    kind: s.kind,
    id: s.id,
    title: s.title,
    evidence: s.summary,
    reason:
      "AIが目的との意味的な関連を比較して選んだ公開資料です。適用条件は出典で確認できます。",
    target: s.target,
    publicURL: s.publicURL,
    relevance: s.relevance,
    updatedAtMs: s.updatedAtMs,
    checkedAtMs: s.checkedAtMs,
    sourceVersion: s.sourceVersion,
    permission: s.permission,
    facts: s.facts,
    origin: s.origin,
    originHash: s.originHash,
  }));
  const steps = value.steps.map((s, i) => {
    const source = selected.get(s?.key),
      a = ACTIONS[s?.action];
    if (
      !exact(s, ["key", "action"]) ||
      !source ||
      !a ||
      !a.kinds.includes(source.kind) ||
      (a.ids && !a.ids.includes(source.id))
    )
      fail("AI_INVALID_PLAN", 502);
    return {
      number: i + 1,
      action: s.action,
      text: a.text,
      references: [source.kind + ":" + source.id],
      target: source.target,
      title: source.title,
      origin: "ai-selected-suggestion-not-established-fact",
    };
  });
  const comparisons = value.comparisons.map((c) => {
    if (
      !exact(c, ["keys", "basis"]) ||
      !Array.isArray(c.keys) ||
      c.keys.length < 2 ||
      c.keys.length > 4 ||
      new Set(c.keys).size !== c.keys.length ||
      !Object.hasOwn(BASES, c.basis) ||
      c.keys.some((k) => !selected.has(k))
    )
      fail("AI_INVALID_COMPARISON", 502);
    const rows = c.keys.map((k) => selected.get(k));
    return {
      basis: c.basis,
      text: BASES[c.basis],
      references: rows.map((s) => s.kind + ":" + s.id),
      titles: rows.map((s) => s.title),
      origin: "ai-selected-comparison-not-verified-outcome",
    };
  });
  return {
    results,
    steps,
    comparisons,
    method: "bounded-gemini-semantic-comparison",
    answerType: "verified-sources-and-separate-suggestions",
  };
}
module.exports = { schema, resolve, ACTIONS, BASES };
