"use strict";
const { fail } = require("./config");
const VERSION = "reizo-work-20261109-v1";
const TASKS = Object.freeze({
  knowledge_draft: {
    label: "知識投稿の準備",
    domains: ["service"],
    required: ["service_guide", "knowledge_lab", "knowledge", "knowledge_text"],
    sections: {
      context: "状況・伝えたいこと",
      method: "試したこと・方法",
      observation: "結果・未確認の点",
      conditions: "当てはまる条件・注意点",
      publish: "投稿前の確認",
    },
  },
  quest_plan: {
    label: "クエスト挑戦の準備",
    domains: ["quest"],
    required: ["quest"],
    sections: {
      choice: "挑戦候補の比較",
      requirements: "参加条件・期限の確認",
      preparation: "学ぶこと・準備",
      checklist: "実行チェックリスト",
      reflection: "記録・振り返り",
    },
  },
  guild_plan: {
    label: "ギルド活動の準備",
    domains: ["guild"],
    required: ["guild"],
    sections: {
      choice: "活動分野の比較",
      objective: "活動の目標",
      preparation: "必要な準備",
      checklist: "行動計画",
      reflection: "振り返り",
    },
  },
  city_comparison: {
    label: "Cityの利用支援",
    domains: ["city"],
    required: ["city_product"],
    sections: {
      choice: "選択した候補",
      comparison: "価格・条件の比較",
      deadline: "期限・在庫の確認",
      checklist: "交換前の確認事項",
      decision: "自分で判断すること",
    },
  },
  wil_plan: {
    label: "探究・WILの支援",
    domains: ["service"],
    required: ["service_guide", "knowledge_lab", "knowledge"],
    sections: {
      objective: "学習目標",
      preparation: "資料・実践の準備",
      checklist: "実践計画",
      observation: "記録用テンプレート",
      reflection: "振り返り・知識に残す下書き",
    },
  },
});
const STAGES = ["planning", "collecting", "working", "validating", "saving"];
function workflow(env, profile) {
  const enabled = env.ECONOMY_PHASE3_ENABLED === "true" && !!profile;
  return {
    version: VERSION,
    enabled,
    tasks: Object.entries(TASKS).map(([id, t]) => ({
      id,
      label: t.label,
      available: enabled && t.domains.every((d) => profile.domains.includes(d)),
      reason: !enabled
        ? "WORKFLOW_DISABLED"
        : t.domains.every((d) => profile.domains.includes(d))
          ? null
          : "WORK_SOURCE_DISABLED",
    })),
  };
}
function task(type, config) {
  if (!Object.hasOwn(TASKS, type)) fail("INVALID_WORK_TYPE", 400);
  if (!config.workflow?.enabled) fail("WORKFLOW_DISABLED", 503);
  if (!config.workflow.tasks.find((t) => t.id === type)?.available)
    fail("WORK_SOURCE_DISABLED", 409);
  return TASKS[type];
}
function material(type, rows) {
  const t = TASKS[type];
  const approved = rows.filter(
    (s) =>
      s.permission?.artifactUseApproved === true &&
      s.permission.artifactAllowedTasks?.includes(type),
  );
  if (!t || !approved.some((s) => t.required.includes(s.kind)))
    fail("WORK_MATERIAL_UNAVAILABLE", 409);
  // Keep the necessary activity/product when the token budget later trims data.
  return approved
    .sort(
      (a, b) =>
        Number(t.required.includes(b.kind)) -
        Number(t.required.includes(a.kind)),
    )
    .slice(0, 8);
}
function scope(type) {
  return (
    TASKS[type].label +
    "として、許諾済み資料を比較し、AIの提案と本人が記入する箇所を分けた成果物を本人専用に保存します。実体験・実績・店舗・参加資格を作りません。公開・参加・購入・交換・送金・外部サービスへの成果物送信は行いません。資料不足・生成失敗・保存失敗は全額返却対象です。保存した下書きは本人が確認・編集して使ってください。"
  );
}
function schema(type, keys) {
  return {
    type: "OBJECT",
    properties: {
      artifact: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING" },
          sections: {
            type: "ARRAY",
            minItems: 5,
            maxItems: 5,
            items: {
              type: "OBJECT",
              properties: {
                section: {
                  type: "STRING",
                  enum: Object.keys(TASKS[type].sections),
                },
                prompt: { type: "STRING" },
                references: {
                  type: "ARRAY",
                  minItems: 1,
                  maxItems: 3,
                  items: { type: "STRING", enum: keys },
                },
              },
              required: ["section", "prompt", "references"],
            },
          },
        },
        required: ["title", "sections"],
      },
    },
    required: ["artifact"],
  };
}
function exact(v, keys) {
  return (
    v &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    Object.keys(v).length === keys.length &&
    keys.every((k) => Object.hasOwn(v, k))
  );
}
function text(v, max) {
  const t = require("./agent").safeText(v, max);
  if (/[<>\u0000-\u0008]|https?:|www\.|\]\(|javascript:|data:/i.test(t))
    fail("ARTIFACT_UNSAFE_OUTPUT", 502);
  return t;
}
function resolve(type, value, rows) {
  const t = TASKS[type];
  if (
    !t ||
    !exact(value, ["artifact"]) ||
    !exact(value.artifact, ["title", "sections"]) ||
    !Array.isArray(value.artifact.sections) ||
    value.artifact.sections.length !== 5
  )
    fail("ARTIFACT_INVALID_OUTPUT", 502);
  const keys = [
    ...new Set(
      value.artifact.sections.flatMap((s) =>
        Array.isArray(s?.references) ? s.references : [],
      ),
    ),
  ];
  const resolved = require("./search/synthesis").resolve(
    {
      matches: keys.map((key) => ({ key, evidence: "summary" })),
      steps: [],
      comparisons: [],
    },
    rows,
  );
  const chosen = new Map(
    keys.map((key) => [key, rows.find((s) => s.key === key)]),
  );
  material(type, [...chosen.values()]);
  const seen = new Set();
  const sections = value.artifact.sections.map((s) => {
    if (
      !exact(s, ["section", "prompt", "references"]) ||
      !Object.hasOwn(t.sections, s.section) ||
      seen.has(s.section) ||
      !Array.isArray(s.references) ||
      !s.references.length ||
      s.references.length > 3 ||
      s.references.some((k) => !chosen.has(k))
    )
      fail("ARTIFACT_INVALID_CITATION", 502);
    seen.add(s.section);
    const prompt = text(s.prompt, 220);
    // Output is an actionable prompt/template, never an asserted personal story.
    if (
      !/(ください。|ましょう。|か[？?])$/.test(prompt) ||
      /しました(?:[。！!]|$)|(?:確認済み|認証済み|参加済み|購入済み)(?:です|だ)|保証します/.test(
        prompt,
      )
    )
      fail("ARTIFACT_UNSUPPORTED_CLAIM", 502);
    return {
      heading: t.sections[s.section],
      prompt,
      references: s.references.map(
        (k) => chosen.get(k).kind + ":" + chosen.get(k).id,
      ),
    };
  });
  const content =
    "AIが作成した準備用の提案・記入用下書きです。本人の経験・結果・参加資格は未確認です。公開や参加は実行していません。\n\n" +
    sections
      .map(
        (s) => "## " + s.heading + "\n" + s.prompt + "\n［本人が確認・記入］",
      )
      .join("\n\n");
  return {
    ...resolved,
    artifact: {
      artifactType: type,
      title: text(value.artifact.title, 100),
      content,
      sections,
      references: resolved.results,
    },
    outcome: "success",
  };
}
function execution(type, at) {
  return {
    version: VERSION,
    taskType: type,
    steps: STAGES.map((id) => ({
      id,
      state: "pending",
      startedAt: null,
      completedAt: null,
      error: null,
    })),
    createdAt: at,
  };
}
function advance(execution, stage, at, error = null) {
  if (!execution) return null;
  const n = STAGES.indexOf(stage);
  return {
    ...execution,
    steps: execution.steps.map((s, i) =>
      i < n
        ? {
            ...s,
            state: "completed",
            startedAt: s.startedAt || at,
            completedAt: s.completedAt || at,
          }
        : i === n
          ? {
              ...s,
              state: error ? "failed" : "running",
              startedAt: s.startedAt || at,
              completedAt: error ? at : s.completedAt,
              error,
            }
          : s,
    ),
  };
}
module.exports = {
  VERSION,
  TASKS,
  STAGES,
  workflow,
  task,
  material,
  scope,
  schema,
  resolve,
  execution,
  advance,
};
