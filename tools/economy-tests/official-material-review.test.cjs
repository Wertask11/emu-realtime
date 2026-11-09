"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  { fixture } = require("../../backend/economy/fixture"),
  { createAdapters } = require("../../backend/economy/search/adapters"),
  { hash } = require("../../backend/economy/config"),
  {
    seeds,
    catalog,
    provenance,
    approval,
  } = require("./official-material-review.cjs");
const now = Date.parse("2026-11-09T04:00:00Z"),
  until = Date.parse("2026-11-14T06:48:46Z");
function setup(kind) {
  const f = fixture(),
    adapters = createAdapters({ db: f.db, now: () => now });
  let raw, id, domain;
  if (kind === "quest") {
    raw = {
      ...seeds[0].row,
      status: "OPEN",
      visibility: "public",
      owner: "test-operator",
      closesAt: until + 86400000,
    };
    id = "official-test-quest";
    domain = "quest";
  } else {
    const p = catalog[0];
    raw = {
      name: p.name,
      description: p.description,
      fulfillment: p.fulfillment,
      cancelPolicy: p.cancelPolicy,
      status: "live",
      shopId: "schoolpark-official",
      prices: { EMUER: p.price },
      stock: 10,
      sold: 1,
      reserved: 1,
      createdBy: "test-operator",
    };
    id = p.id;
    domain = "city";
  }
  const source = adapters[domain].project(id, raw),
    p = provenance(source, raw, true),
    review = {
      sourceKey: source.key,
      contentHash: hash([source.title, source.summary]),
      originHash: source.originHash,
      originalFile: p.file,
      originalHash: p.sourceHash,
      category: "A",
      authorizationRef: "founder-official-quest-city-phase3-20261109",
      piiReviewed: true,
    };
  return { f, adapters, source, raw, review, id, domain };
}
for (const kind of ["quest", "city"])
  test(
    kind +
      ": only exact repository-owned public material with verified operator provenance receives the new purpose",
    () => {
      const c = setup(kind),
        r = approval(c.source, c.raw, c.review, {
          now,
          validUntilMs: until,
          operatorVerified: true,
        });
      assert.equal(r.artifactUseApproved, true);
      assert.equal(r.rightsVerified, true);
      assert.ok(r.validUntilMs <= until);
      assert.equal(r.contentHash, c.review.contentHash);
      assert.equal(c.raw.aiUseConsent, undefined);
    },
  );
test("third-party shop, unknown Quest, altered text, private rows and explicit refusal never inherit Founder ownership", () => {
  for (const kind of ["quest", "city"]) {
    const c = setup(kind);
    for (const raw of [
      { ...c.raw, visibility: "private" },
      { ...c.raw, aiUseConsent: { allowed: false } },
      kind === "quest"
        ? { ...c.raw, brief: "第三者が書いた内容" }
        : { ...c.raw, description: "第三者の説明" },
    ])
      assert.throws(() => provenance(c.source, raw, true));
    assert.throws(() => provenance(c.source, c.raw, false));
    assert.throws(() =>
      approval(
        c.source,
        c.raw,
        { ...c.review, contentHash: "changed" },
        { now, validUntilMs: until, operatorVerified: true },
      ),
    );
  }
  const c = setup("city");
  assert.throws(() =>
    provenance(c.source, { ...c.raw, shopId: "third-party" }, true),
  );
  const q = setup("quest");
  assert.throws(() =>
    provenance({ ...q.source, id: "founder-quest-000" }, q.raw, true),
  );
});
test("price/stock/deadline/conditions and publisher changes change origin hashes; expired and refused sources are unavailable", () => {
  const c = setup("city");
  for (const raw of [
    { ...c.raw, prices: { EMUER: 15 } },
    { ...c.raw, reserved: 2 },
    { ...c.raw, createdBy: "other" },
    { ...c.raw, orderDeadlineMs: until },
  ])
    assert.notEqual(
      c.adapters.city.project(c.id, raw).originHash,
      c.source.originHash,
    );
  for (const raw of [
    { ...c.raw, stock: 2 },
    { ...c.raw, orderDeadlineMs: now - 1 },
    { ...c.raw, aiUseConsent: { allowed: false } },
  ])
    assert.equal(c.adapters.city.project(c.id, raw), null);
  const q = setup("quest");
  for (const raw of [
    { ...q.raw, conditions: "追加条件" },
    { ...q.raw, closesAt: until },
    { ...q.raw, owner: "other" },
  ])
    assert.notEqual(
      q.adapters.quest.project(q.id, raw).originHash,
      q.source.originHash,
    );
  assert.equal(
    q.adapters.quest.project(q.id, { ...q.raw, closesAt: now - 1 }),
    null,
  );
  assert.equal(
    q.adapters.quest.project(q.id, {
      ...q.raw,
      aiUseConsent: { allowed: false },
    }),
    null,
  );
});
