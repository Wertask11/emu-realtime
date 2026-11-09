"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  work = require("./work-artifact"),
  tasks = require("./tasks"),
  reply = require("../../tools/economy-tests/work-reply.cjs");
function sample(type = "quest_plan", n = 2) {
  const kind = {
    quest_plan: "quest",
    guild_plan: "guild",
    city_comparison: "city_product",
    knowledge_draft: "service_guide",
    wil_plan: "service_guide",
  }[type];
  const domain = {
    quest: "quest",
    guild: "guild",
    city_product: "city",
    service_guide: "service",
  }[kind];
  const rows = Array.from({ length: n }, (_, i) => ({
    key: "s" + i,
    kind,
    id: kind === "service_guide" ? ["posting", "research"][i] : "real-" + i,
    domain,
    title: ["公式Web3の活動を知人に紹介する", "公式カフェ会で学びを話す"][i],
    summary: [
      "活動の説明を読んで紹介文を準備する公開課題",
      "参加前に話すテーマを用意する公開課題",
    ][i],
    target: require("../../frontend/public/economy/targets").target(
      kind,
      kind === "service_guide" ? ["posting", "research"][i] : "real-" + i,
    ),
    permission: {
      public: true,
      readAllowed: true,
      authorAIConsent: true,
      operatorReviewed: true,
      artifactUseApproved: true,
      artifactAllowedTasks: [type],
    },
    origin: { label: "運営公開資料", checkedAtMs: Date.now() },
    facts: { status: "OPEN" },
    sourceVersion: "verified",
    originHash: "verified",
  }));
  const payload = {
    contents: [
      { parts: [{ text: JSON.stringify({ workType: type, sources: rows }) }] },
    ],
  };
  return { rows, value: reply(payload) };
}
for (const type of Object.keys(tasks.TASKS))
  test(
    type +
      " structured work contains named choices, ordered actions, completion conditions and executable checklist",
    () => {
      const f = sample(type);
      const r = work.resolve(type, f.value, f.rows);
      assert.equal(r.artifact.formatVersion, 2);
      const d = r.artifact.document;
      assert.equal(d.candidates.length, 2);
      assert.equal(d.candidates[0].title, f.rows[0].title);
      assert.equal(d.steps[0].order, 1);
      assert.ok(d.steps.every((x) => x.done.length >= 8));
      assert.ok(d.checklist.length >= 5);
      assert.ok(d.checklist.every((x) => /^check-/.test(x.id)));
      assert.ok(d.unknowns.length);
      assert.ok(d.reflection.length >= 2);
      assert.ok(d.evidence.every((e) => f.rows.some((s) => s.id === e.id)));
      assert.equal(
        Boolean(d.draft),
        ["knowledge_draft", "wil_plan"].includes(type),
      );
    },
  );
test("one real source is a single candidate; the validator never invents a comparison partner", () => {
  const f = sample("quest_plan", 1),
    r = work.resolve("quest_plan", f.value, f.rows);
  assert.equal(r.artifact.document.candidates.length, 1);
  assert.match(r.artifact.document.summary, /単一/);
  f.value.artifact.candidates.push({
    key: "invented",
    reason: "架空の候補を比較する理由です。",
    recommended: false,
  });
  assert.throws(
    () => work.resolve("quest_plan", f.value, f.rows),
    /INVALID_CITATION/,
  );
});
for (const text of [
  "クエストを比較してください",
  "参加条件を確認してください",
  "チェックリストで確認してください",
  "学習計画を作りましょう",
])
  test("rejects production regression: " + text, () => {
    const f = sample();
    f.value.artifact.steps[0].action = text;
    assert.throws(
      () => work.resolve("quest_plan", f.value, f.rows),
      /NOT_ACTIONABLE/,
    );
  });
for (const mode of [
  "candidate",
  "empty-steps",
  "empty-checklist",
  "repeat",
  "made-up-reference",
  "made-up-price",
  "made-up-date",
  "made-up-qualification",
  "story",
  "automatic-action",
])
  test("rejects incomplete/unsafe work: " + mode, () => {
    const f = sample(),
      a = f.value.artifact;
    switch (mode) {
      case "candidate":
        a.candidates[0].key = "invented";
        break;
      case "empty-steps":
        a.steps = [];
        break;
      case "empty-checklist":
        a.checklist = [];
        break;
      case "repeat":
        a.checklist[1] = a.checklist[0];
        break;
      case "made-up-reference":
        a.steps[0].references = ["invented"];
        break;
      case "made-up-price":
        a.candidates[0].reason = "参加料金は999 EMUERです。";
        break;
      case "made-up-date":
        a.candidates[0].reason = "2026年12月1日に受付終了です。";
        break;
      case "made-up-qualification":
        a.summary = "本人は参加資格を満たしています。";
        break;
      case "story":
        a.summary = "私はクエストで成功しました。";
        break;
      case "automatic-action":
        a.steps[0].action = "本人の代わりに購入します。";
        break;
    }
    assert.throws(
      () => work.resolve("quest_plan", f.value, f.rows),
      /ARTIFACT_/,
    );
  });
test("old prompt-only payload cannot pass the new generator; stored legacy documents are handled separately", () => {
  assert.throws(
    () =>
      work.resolve(
        "quest_plan",
        {
          artifact: {
            title: "古い形式",
            sections: [{ prompt: "チェックリストで確認してください" }],
          },
        },
        sample().rows,
      ),
    /INVALID_OUTPUT/,
  );
});
test("without an experience draft Knowledge and WIL are incomplete", () => {
  for (const type of ["knowledge_draft", "wil_plan"]) {
    const f = sample(type);
    f.value.artifact.draft = "私は成功しました。";
    assert.throws(() => work.resolve(type, f.value, f.rows), /ARTIFACT_/);
  }
});

test("draft with placeholders must still reject fabricated achievements outside those slots", () => {
  const f = sample("knowledge_draft");
  f.value.artifact.draft +=
    "その結果、味の安定性と提供時間の短縮につながり、満足度向上を確認できました。";
  assert.throws(
    () => work.resolve("knowledge_draft", f.value, f.rows),
    /UNSUPPORTED_CLAIM/,
  );
});
test("WIL cannot consist solely of screen and form instructions", () => {
  const f = sample("wil_plan");
  for (const s of f.value.artifact.steps)
    s.action = "投稿画面の入力欄と保存範囲のガイドを開いて記録用の欄を用意する";
  assert.throws(
    () => work.resolve("wil_plan", f.value, f.rows),
    /WIL_PRACTICE_MISSING|REPEATED_CONTENT/,
  );
});
test("a single recommendation is selected by a validated key, not independent model booleans", () => {
  const f = sample();
  f.value.artifact.recommendedKey = "invented";
  assert.throws(
    () => work.resolve("quest_plan", f.value, f.rows),
    /QUALITY_INCOMPLETE/,
  );
  const p = work.schema("quest_plan", ["s0", "s1", "s2"], ["s0", "s1"])
    .properties.artifact.properties;
  assert.deepEqual(p.recommendedKey.enum, ["s0", "s1"]);
  assert.deepEqual(p.candidates.items.properties.key.enum, ["s0", "s1"]);
});
