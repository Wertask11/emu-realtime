"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  { artifactApproval } = require("./artifact-review.cjs"),
  { hash } = require("../../backend/economy/config");
const s = {
    key: "service_guide:posting",
    kind: "service_guide",
    id: "posting",
    title: "投稿の準備",
    summary: "本人の経験を整理する",
    originHash: "origin",
  },
  now = 1000,
  existing = {
    purpose: require("../../backend/economy/search/profile").PURPOSE,
    rightsVerified: true,
    aiUseApproved: true,
    piiReviewed: true,
    validUntilMs: 2000,
    contentHash: hash([s.title, s.summary]),
    originHash: s.originHash,
  },
  r = {
    sourceKey: s.key,
    contentHash: existing.contentHash,
    originHash: s.originHash,
    category: "A",
    authorizationRef: "founder-phase3-instruction-20261109",
    evidenceRef: "PR297-original-system-facts-20261107",
  };
test("generation review only adds a separate purpose without changing base permission or expiry", () => {
  const a = artifactApproval(s, existing, r, now);
  assert.equal(a.artifactUseApproved, true);
  assert.equal(a.validUntilMs, undefined);
  assert.equal(a.purpose, undefined);
  assert.deepEqual(a.artifactAllowedTasks, [
    "knowledge_draft",
    "guild_plan",
    "wil_plan",
  ]);
});
test("public user content, City, unknown ownership, expired/changed source and absent explicit review cannot grant generation permission", () => {
  for (const type of ["knowledge_lab", "city_product", "quest"])
    assert.throws(() =>
      artifactApproval({ ...s, kind: type }, existing, r, now),
    );
  for (const bad of [
    null,
    { ...r, category: "B" },
    { ...r, authorizationRef: "" },
    { ...r, contentHash: "changed" },
  ])
    assert.throws(() => artifactApproval(s, existing, bad, now));
  for (const old of [
    { ...existing, validUntilMs: 999 },
    { ...existing, aiUseApproved: false },
    { ...existing, originHash: "changed" },
  ])
    assert.throws(() => artifactApproval(s, old, r, now));
});
