"use strict";
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { createFixture } = require("./fixture.cjs");
const m = require("../../backend/knowledge-lab/model");
let f, alice, bob, owner, pid;
const actor = (role) => ({
  ...f.users[role],
  walletAddress: f.users[role].account.walletAddress.toLowerCase(),
  owner: role === "owner",
});
const post = (key, more = {}) => ({
  key,
  title: "保存と分類の検証",
  body: "エミュレーター内だけの経験知。",
  visibility: "public",
  facets: {
    field: ["field-education"],
    industry: ["industry-education"],
    occupation: ["occupation-teacher"],
  },
  ...more,
});
before(async () => {
  f = await createFixture();
  alice = actor("alice");
  bob = actor("bob");
  owner = actor("owner");
  pid = (await f.api.service.savePost(alice, post("first"))).id;
  await f.api.service.rebuild(owner);
  await f.api.service.waitForRebuild();
});
after(async () => {
  await f?.close();
});
const count = async () =>
  (await f.api.service.ref("post_metrics", pid).get()).data()?.savedCount || 0;
test("ten independent axes preserve old job terms without guessing; Owner seed is repeatable", async () => {
  const terms = await f.api.service.taxonomy();
  assert.equal(terms.length, 97);
  assert.ok(terms.some((t) => t.axis === "job"));
  for (const axis of m.PUBLIC_AXES)
    assert.ok(terms.some((t) => t.axis === axis));
  await f.api.service.init(owner);
  assert.equal((await f.api.service.taxonomy()).length, 97);
});
test("saved ordering unavailable until actual legacy-bookmark migration; non-owner cannot migrate", async () => {
  assert.equal(
    (await f.call("GET", "/search?sort=saved", "alice")).status,
    503,
  );
  assert.equal(
    (await f.call("POST", "/admin/save-metrics", "alice", {})).status,
    403,
  );
});
test("concurrent same-Passport saves increment once, distinct Passports increment separately", async () => {
  await Promise.all([
    f.api.service.saveBookmark(bob, pid, true),
    f.api.service.saveBookmark(bob, pid, true),
  ]);
  assert.equal(await count(), 1);
  await f.api.service.saveBookmark(alice, pid, true);
  assert.equal(await count(), 2);
});
test("legacy bookmarks migrate once and counters survive reruns", async () => {
  await f.api.service
    .ref("saved", m.hash(["SP-legacy-test", pid]))
    .set({ authorSchoolParkId: "SP-legacy-test", postId: pid, createdAtMs: 1 });
  const a = await f.call("POST", "/admin/save-metrics", "owner", {});
  assert.equal(a.status, 200);
  assert.equal(a.body.state, "ready");
  assert.equal(await count(), 3);
  await f.call("POST", "/admin/save-metrics", "owner", {});
  assert.equal(await count(), 3);
});
test("double unsave cannot subtract twice and public response exposes aggregates, not bookmark identities", async () => {
  await Promise.all([
    f.api.service.saveBookmark(bob, pid, false),
    f.api.service.saveBookmark(bob, pid, false),
  ]);
  assert.equal(await count(), 2);
  const result = await f.call("GET", "/search?sort=saved", "alice");
  assert.equal(result.status, 200);
  const item = result.body.items.find((p) => p.id === pid);
  assert.equal(item.savedCount, 2);
  assert.equal(JSON.stringify(item).includes("SP-legacy-test"), false);
});
test("editing, index refresh and full rebuild retain saved counters", async () => {
  await f.api.service.savePost(
    alice,
    post("edit", { id: pid, revision: 1, body: "編集後の検証内容" }),
  );
  await f.api.service.syncIndex(pid, bob);
  await f.api.service.rebuild(owner);
  await f.api.service.waitForRebuild();
  assert.equal(
    (await f.api.service.ref("search", pid).get()).data().savedCount,
    2,
  );
});
test("withdrawn canonical source stays out of saved-sorted search and cannot be indexed by another user", async () => {
  await f.api.service.removePost(alice, pid, 2, "withdraw");
  await assert.rejects(f.api.service.syncIndex(pid, bob), /NOT_OWNER/);
  assert.ok(
    !(await f.api.service.search({ sort: "saved" }, bob)).items.some(
      (p) => p.id === pid,
    ),
  );
});
test("private-first bookmark counter restored on first publication without double counting", async () => {
  const p = (
    await f.api.service.savePost(
      alice,
      post("private-first", { visibility: "private" }),
    )
  ).id;
  await f.api.service.saveBookmark(alice, p, true);
  await f.api.service.savePost(
    alice,
    post("first-publish", { id: p, revision: 1 }),
  );
  assert.equal(
    (await f.api.service.ref("search", p).get()).data().savedCount,
    1,
  );
});
test("Owner synonyms and renamed classification match existing IDs without rewriting a post", async () => {
  const r = await f.call("PUT", "/admin/taxonomy/occupation-teacher", "owner", {
    axis: "occupation",
    label: "教職",
    aliases: ["先生"],
    active: true,
    revision: 1,
    order: 1,
  });
  assert.equal(r.status, 200);
  const found = await f.call(
    "GET",
    "/search?q=" + encodeURIComponent("先生"),
    "alice",
  );
  assert.ok(found.body.items.length);
  assert.ok(
    found.body.items.every((p) =>
      p.facets.occupation.includes("occupation-teacher"),
    ),
  );
});
