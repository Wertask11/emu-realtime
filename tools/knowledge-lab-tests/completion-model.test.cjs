"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const m = require("../../backend/knowledge-lab/model");
const taxonomy = require("../../backend/knowledge-lab/taxonomy");
const terms = [
  { id: "field-work", axis: "field", label: "仕事・キャリア", active: true },
  { id: "field-business", axis: "field", label: "経営", active: true },
  { id: "field-beauty", axis: "field", label: "美容", active: true },
  {
    id: "occupation-hair",
    axis: "occupation",
    label: "美容師",
    aliases: ["ヘアスタイリスト"],
    active: true,
  },
  { id: "occupation-teacher", axis: "occupation", label: "教員", active: true },
  { id: "industry-beauty", axis: "industry", label: "美容業", active: true },
];
const row = (id, title, body, facets, extra = {}) =>
  m.indexPost(
    id,
    {
      title,
      body,
      visibility: "public",
      createdAt: 1000,
      knowledgeLab: { facets },
      ...extra,
    },
    1000,
  );
const rows = [
  row(
    "independent",
    "会社を辞めて独立した経験",
    "小さく試した。準備も必要だった。",
    { field: ["field-work"] },
  ),
  row(
    "salon",
    "独立後のお客さんへの声かけ",
    "成功したことと失敗したこと。",
    {
      field: ["field-business", "field-beauty"],
      industry: ["industry-beauty"],
      occupation: ["occupation-hair"],
    },
    { goodCount: 9 },
  ),
  row("employee", "会社員としての暮らし", "毎朝の習慣を見直した。", {
    field: ["field-work"],
  }),
  row("teacher", "教員の経験", "仕事を比較する。", {
    occupation: ["occupation-teacher"],
  }),
  row(
    "private",
    "公開しない経験",
    "独立と成功。",
    { field: ["field-business"] },
    { visibility: "private", goodCount: 999 },
  ),
];
const ids = (q) =>
  m
    .select(rows, m.searchParams(q), terms)
    .map((p) => p.postId)
    .sort();
test("ten independent public axes keep legacy job data without guessing its industry or occupation", () => {
  assert.deepEqual(taxonomy.PUBLIC_AXES, [
    "field",
    "industry",
    "occupation",
    "genre",
    "experience",
    "purpose",
    "kind",
    "difficulty",
    "audience",
    "period",
  ]);
  const facets = m.facets({ knowledgeLab: { facets: { job: ["job-food"] } } });
  assert.deepEqual(facets.job, ["job-food"]);
  assert.deepEqual(facets.industry, []);
  assert.deepEqual(facets.occupation, []);
});
test("Japanese partial vs complete words distinguish company from company employee", () => {
  assert.deepEqual(ids({ q: "会社" }), ["employee", "independent"]);
  assert.deepEqual(ids({ q: "会社", match: "exact" }), ["independent"]);
});
test("multiple keywords have explicit AND and OR semantics", () => {
  assert.deepEqual(ids({ q: "独立 成功" }), ["salon"]);
  assert.deepEqual(ids({ q: "独立 習慣", keywordOp: "or" }), [
    "employee",
    "independent",
    "salon",
  ]);
});
test("quoted Japanese phrases retain their contiguous sequence", () => {
  assert.deepEqual(ids({ q: '"会社を辞めて"', match: "exact" }), [
    "independent",
  ]);
});
test("exclude terms and independent industry/occupation conditions combine safely", () => {
  assert.deepEqual(ids({ q: "独立", exclude: "お客さん" }), ["independent"]);
  assert.deepEqual(
    ids({ industry: "industry-beauty", occupation: "occupation-hair" }),
    ["salon"],
  );
  assert.deepEqual(
    ids({ industry: "industry-beauty", occupation: "occupation-teacher" }),
    [],
  );
});
test("cross-axis OR and same-axis AND are separate choices", () => {
  assert.deepEqual(
    ids({
      industry: "industry-beauty",
      occupation: "occupation-teacher",
      facetOp: "or",
    }),
    ["salon", "teacher"],
  );
  assert.deepEqual(
    ids({ field: "field-business,field-beauty", withinAxis: "and" }),
    ["salon"],
  );
});
test("excluded classifications remove matched public sources", () => {
  assert.deepEqual(ids({ q: "独立", exclude_field: "field-beauty" }), [
    "independent",
  ]);
});
test("Owner-edited synonyms and labels affect classification searches without rewriting posts", () => {
  assert.deepEqual(ids({ q: "ヘアスタイリスト" }), ["salon"]);
  const changed = terms.map((t) =>
    t.id === "occupation-hair" ? { ...t, label: "髪を整える仕事" } : t,
  );
  assert.deepEqual(
    m
      .select(rows, m.searchParams({ q: "髪を整える仕事" }), changed)
      .map((p) => p.postId),
    ["salon"],
  );
});
test("popular order uses source reactions and never revives private content", () => {
  const result = m.select(rows, m.searchParams({ sort: "popular" }), terms);
  assert.equal(result[0].postId, "salon");
  assert.ok(!result.some((p) => p.postId === "private"));
});
test("taxonomy aliases have bounded validation and preserve existing aliases when omitted", () => {
  assert.deepEqual(taxonomy.aliases(undefined, ["既存の同義語"]), [
    "既存の同義語",
  ]);
  assert.throws(
    () => taxonomy.aliases(Array(13).fill("同義語")),
    /INVALID_ALIASES/,
  );
  assert.throws(() => taxonomy.aliases([{}]), /INVALID_ALIASES/);
});
