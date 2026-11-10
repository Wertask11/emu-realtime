"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  prepare = require("../../frontend/public/economy/practice-plan");
for (const [artifactType, kind] of Object.entries({
  knowledge_draft: "service_guide",
  quest_plan: "quest",
  guild_plan: "guild",
  city_comparison: "city_product",
  wil_plan: "service_guide",
}))
  test(
    "legacy " +
      artifactType +
      ": named source checks, no generation or original mutation",
    () => {
      const a = {
          formatVersion: 1,
          artifactType,
          title: "以前の計画",
          content: "確認してください",
          references: [
            {
              kind,
              title: "実在する公式の案内",
              id: "real",
              target: "/?view=try",
            },
          ],
        },
        original = JSON.stringify(a),
        r = prepare(a);
      assert.equal(r.legacy, true);
      assert.ok(r.items.length >= 2);
      assert.ok(r.items[0].includes("実在する公式の案内"));
      assert.ok(r.items.every((x) => x.length <= 300));
      assert.equal(JSON.stringify(a), original);
      assert.ok(
        !r.items.some((x) =>
          /参加済み|購入済み|成功した|100 EMUER|無料で獲得/.test(x),
        ),
      );
    },
  );
test("structured plans are never relabelled as old templates", () => {
  assert.equal(
    prepare({ formatVersion: 2, document: { checklist: [{ id: "check-1" }] } })
      .legacy,
    false,
  );
  const invalid = prepare({ formatVersion: 2, document: null });
  assert.equal(invalid.legacy, false);
  assert.equal(invalid.invalid, true);
});
test("no source does not invent candidates, price, date or user's experience", () => {
  const r = prepare({
    formatVersion: 1,
    artifactType: "city_comparison",
    references: [],
  });
  assert.ok(
    !r.items.some((x) => /「|\d+ EMUER|2026|在庫あり|体験した/.test(x)),
  );
});
