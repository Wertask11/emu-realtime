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
      s.permission.artifactAllowedTasks?.includes(type) &&
      (!(
        ["knowledge_draft", "wil_plan"].includes(type) &&
        s.kind === "service_guide"
      ) ||
        ["posting", "research"].includes(s.id)),
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
    .slice(0, 3);
}
function scope(type) {
  return (
    TASKS[type].label +
    "として、許諾済み資料を比較し、AIの提案と本人が記入する箇所を分けた成果物を本人専用に保存します。実体験・実績・店舗・参加資格を作りません。公開・参加・購入・交換・送金・外部サービスへの成果物送信は行いません。資料不足・生成失敗・保存失敗は全額返却対象です。保存した下書きは本人が確認・編集して使ってください。"
  );
}
function schema(type, keys, candidateKeys) {
  return require("./work-artifact").schema(type, keys, candidateKeys);
}
function resolve(type, value, rows, plan) {
  return require("./work-artifact").resolve(type, value, rows, plan);
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
