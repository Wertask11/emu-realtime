"use strict";
const { test, before, after } = require("node:test"),
  assert = require("node:assert/strict");
const { createFixture } = require("./fixture.cjs");
let f,
  alice,
  bob,
  owner,
  sources = [],
  nid,
  pid;
const actor = (role) => ({
  ...f.users[role],
  walletAddress: f.users[role].account.walletAddress.toLowerCase(),
  owner: role === "owner",
});
const post = (key, extra = {}) => ({
  key,
  title: "検証環境の経験知",
  body: "教育現場で小さく試した内容を記録しました。",
  visibility: "public",
  facets: { field: ["field-education"], job: ["job-teacher"] },
  ...extra,
});
before(async () => {
  f = await createFixture();
  alice = actor("alice");
  bob = actor("bob");
  owner = actor("owner");
  for (let i = 0; i < 2; i++)
    sources.push((await f.api.service.savePost(alice, post("source-" + i))).id);
  const n = await f.api.service.saveNote(alice, {
    key: "note",
    title: "非公開の研究",
    sourceIds: sources,
    fields: ["field-education", "field-it"],
    visibility: "private",
    hypothesis: "私用の仮説",
  });
  nid = n.id;
  await f.api.service.rebuild(owner);
  await f.api.service.waitForRebuild();
});
after(async () => {
  await f?.close();
});
test("manual legacy mapping requires Owner choice and consent, preserves original IDs/body and is rerunnable", async () => {
  const mapping = {
    job: "job-teacher",
    industry: ["industry-education"],
    occupation: ["occupation-teacher"],
  };
  assert.equal(
    (await f.call("POST", "/admin/taxonomy-migration/preview", "bob", mapping))
      .status,
    403,
  );
  const preview = await f.call(
    "POST",
    "/admin/taxonomy-migration/preview",
    "owner",
    mapping,
  );
  assert.equal(preview.status, 200);
  assert.equal(preview.body.items.length, 2);
  const input = {
    ...mapping,
    posts: preview.body.items.map((p) => ({ id: p.id, revision: p.revision })),
    reason: "教員の経験であることを本文と照合し、運営が対応付けを決めました。",
  };
  assert.equal(
    (await f.call("POST", "/admin/taxonomy-migration/apply", "owner", input))
      .status,
    403,
  );
  const before = (await f.db.collection("posts").doc(sources[0]).get()).data()
    .body;
  const apply = await f.call(
    "POST",
    "/admin/taxonomy-migration/apply",
    "owner",
    { ...input, confirmed: true },
  );
  assert.equal(apply.status, 200);
  assert.ok(apply.body.items.every((p) => p.status === "applied"));
  const after = (await f.db.collection("posts").doc(sources[0]).get()).data();
  assert.equal(after.body, before);
  assert.ok(after.knowledgeLab.facets.job.includes("job-teacher"));
  assert.ok(after.knowledgeLab.facets.industry.includes("industry-education"));
  assert.equal(
    (
      await f.call("POST", "/admin/taxonomy-migration/apply", "owner", {
        ...input,
        confirmed: true,
      })
    ).body.items[0].status,
    "already-applied",
  );
});
test("private research cannot be copied by another user; publication requires explicit author consent", async () => {
  const payload = post("derived", { sourceNoteId: nid });
  assert.equal((await f.call("PUT", "/posts", "bob", payload)).status, 404);
  assert.equal((await f.call("PUT", "/posts", "alice", payload)).status, 403);
  const out = await f.call("PUT", "/posts", "alice", {
    ...payload,
    researchPublicationConsent: true,
  });
  assert.equal(out.status, 200);
  pid = out.body.id;
  const raw = (await f.db.collection("posts").doc(pid).get()).data();
  assert.equal(raw.knowledgeLab.sourceResearch, undefined);
  assert.equal(
    (await f.api.service.ref("derived_links", pid).get()).data().noteId,
    nid,
  );
  assert.equal(
    (await f.call("GET", "/notes/" + nid + "/derived", "bob")).status,
    404,
  );
  assert.ok(
    (
      await f.call("GET", "/notes/" + nid + "/derived", "alice")
    ).body.items.some((p) => p.id === pid),
  );
});
test("public research keeps explicit references, withdrawal protects derived list without deleting author knowledge", async () => {
  await f.api.service.saveNote(alice, {
    key: "public-note",
    id: nid,
    revision: 1,
    title: "公開を選んだ研究",
    sourceIds: sources,
    fields: ["field-education", "field-it"],
    visibility: "public",
    result: "試した結果を本人が報告しました。",
  });
  const out = await f.call(
    "PUT",
    "/posts",
    "alice",
    post("public-derived", {
      sourceNoteId: nid,
      researchPublicationConsent: true,
    }),
  );
  assert.equal(out.status, 200);
  assert.equal(
    (await f.db.collection("posts").doc(out.body.id).get()).data().knowledgeLab
      .sourceResearch.noteId,
    nid,
  );
  const pub = await f.call("GET", "/notes/" + nid + "/derived", "bob");
  assert.equal(pub.status, 200);
  assert.ok(pub.body.items.some((p) => p.id === out.body.id));
  await f.api.service.saveNote(alice, {
    key: "private-again",
    id: nid,
    revision: 2,
    title: "非公開へ戻した研究",
    sourceIds: sources,
    fields: ["field-education", "field-it"],
    visibility: "private",
  });
  assert.equal(
    (await f.call("GET", "/notes/" + nid + "/derived", "bob")).status,
    404,
  );
  assert.equal(
    (await f.call("GET", "/posts/" + out.body.id, "bob")).status,
    200,
  );
});
test("research updates and repeated publish calls do not duplicate canonical-Passport activity", async () => {
  const out = await f.call("GET", "/me/activity", "alice");
  assert.equal(out.status, 200);
  assert.equal(out.body.counts["research-created"].count, 1);
  assert.equal(out.body.counts["practice-reported"].count, 1);
  assert.equal(out.body.counts["experience-posted"].count, 4);
  const n = await f.api.service.note(nid, alice);
  await f.api.service.saveNote(
    { ...alice, uid: "other-emulator-login-same-person" },
    {
      ...n,
      key: "same-passport-update",
      revision: n.revision,
      result: "追記した実践結果",
    },
  );
  assert.equal(
    (await f.call("GET", "/me/activity", "alice")).body.counts[
      "research-created"
    ].count,
    1,
  );
  assert.equal(
    (await f.call("GET", "/me/activity", "bob")).body.counts["research-created"]
      .count,
    0,
  );
  assert.equal((await f.db.collection("sp_stars").get()).size, 0);
  assert.equal((await f.db.collection("emuer_v2_rewards").get()).size, 0);
});
test("third-party confirmation needs actual Owner review record; ordinary author cannot claim verified status", async () => {
  const p = (await f.call("GET", "/posts/" + pid, "alice")).body;
  const input = {
    revision: p.revision,
    summary: "引用した資料と記載条件のみを確認",
    evidence:
      "検証環境で実際に確認した資料の記録。実在する本番の確認として扱わない。",
    reviewed: true,
  };
  assert.equal(
    (await f.call("POST", "/admin/verify/" + pid, "alice", input)).status,
    403,
  );
  const confirm = await f.call("POST", "/admin/verify/" + pid, "owner", input);
  assert.equal(confirm.status, 200);
  const records = await f.call(
    "GET",
    "/posts/" + pid + "/verification",
    "alice",
  );
  assert.equal(records.body.items.length, 1);
  assert.equal(
    (await f.call("GET", "/posts/" + pid + "/verification", "bob")).status,
    403,
  );
  const edit = await f.call(
    "PUT",
    "/posts",
    "alice",
    post("revised", {
      id: pid,
      revision: confirm.body.revision,
      body: "確認後に変更した内容",
    }),
  );
  assert.equal(edit.status, 200);
  assert.equal(
    (await f.call("GET", "/posts/" + pid, "alice")).body.knowledgeLab
      .thirdPartyConfirmation,
    null,
  );
});
test("Owner cannot self-confirm and forged current verification cannot be submitted through normal editing", async () => {
  const own = await f.api.service.savePost(owner, post("owner-post"));
  assert.equal(
    (
      await f.call("POST", "/admin/verify/" + own.id, "owner", {
        revision: 1,
        summary: "自分の投稿",
        evidence:
          "自己確認は第三者確認ではありません。自分で書いた経験の自己評価です。",
        reviewed: true,
      })
    ).status,
    403,
  );
  const p = (await f.call("GET", "/posts/" + pid, "alice")).body;
  const out = await f.call(
    "PUT",
    "/posts",
    "alice",
    post("fake-proof", {
      id: pid,
      revision: p.revision,
      thirdPartyConfirmation: { recordId: "fake" },
      verification: "third-party-confirmed",
    }),
  );
  assert.equal(out.status, 200);
  assert.equal(
    (await f.call("GET", "/posts/" + pid, "alice")).body.knowledgeLab
      .verification,
    "self-reported",
  );
});
test("metrics deduplicate saves/views and contain neither search text nor private note content", async () => {
  await f.api.service.profile(alice, {
    revision: 0,
    displayName: "検証用の書き手",
    bio: "エミュレーターだけの自己紹介",
    facets: { field: ["field-education"] },
    published: false,
  });
  await f.call("GET", "/posts/" + pid + "?intent=view", "alice");
  await f.call("GET", "/posts/" + pid + "?intent=view", "alice");
  await f.api.service.saveBookmark(alice, pid, true);
  await f.api.service.saveBookmark(alice, pid, true);
  await f.call(
    "GET",
    "/search?q=" + encodeURIComponent("個人的な検索文の例"),
    "alice",
  );
  const events = await f.db.collection("knowledge_lab_metric_events").get();
  const values = events.docs.map((d) => d.data());
  assert.equal(values.filter((v) => v.kind === "view").length, 1);
  assert.equal(values.filter((v) => v.kind === "save").length, 1);
  const json = JSON.stringify(values);
  assert.equal(json.includes("個人的な検索文の例"), false);
  assert.equal(json.includes("私用の仮説"), false);
  await f.api.service.metrics.snapshot();
  const summary = await f.call("GET", "/admin/summary", "owner");
  assert.equal(summary.status, 200);
  assert.equal(summary.body.analytics.zeroSearchRate.denominator, 1);
  assert.equal((await f.call("GET", "/admin/summary", "bob")).status, 403);
});
test("raw post metadata cannot fake third-party verification without a matching protected record", async () => {
  const r = f.db.collection("posts").doc(pid),
    p = (await r.get()).data();
  await r.update({
    knowledgeLab: {
      ...p.knowledgeLab,
      thirdPartyConfirmation: {
        recordId: "invented-proof",
        reviewerSchoolParkId: owner.spid,
        confirmedRevision: p.knowledgeLab.revision,
      },
    },
  });
  const publicPost = await f.call("GET", "/posts/" + pid, "bob");
  assert.equal(publicPost.status, 200);
  assert.equal(publicPost.body.knowledgeLab.thirdPartyConfirmation, null);
});
test("accepted improvements use canonical different Passports, deduplicate activities and hold malformed legacy data", async () => {
  const own = (await f.api.service.savePost(bob, post("improvement-target")))
    .id;
  await f.db
    .collection("post_changes")
    .doc("actual-improvement")
    .set({ postId: own, fromAddress: alice.walletAddress, status: "accepted" });
  await f.db
    .collection("post_changes")
    .doc("malformed-improvement")
    .set({
      postId: "../bad",
      fromAddress: alice.walletAddress,
      status: "accepted",
    });
  await f.db
    .collection("post_changes")
    .doc("self-improvement")
    .set({ postId: pid, fromAddress: alice.walletAddress, status: "accepted" });
  const sync = await f.call("POST", "/me/activity/reconcile", "alice", {});
  assert.equal(sync.status, 200);
  assert.equal(sync.body.confirmed, 1);
  assert.equal(sync.body.needsReview, 1);
  await f.call("POST", "/me/activity/reconcile", "alice", {});
  const activity = await f.call("GET", "/me/activity", "alice");
  assert.equal(activity.body.counts["knowledge-improved"].count, 1);
  assert.equal((await f.db.collection("sp_stars").get()).size, 0);
});
test("publication reach and zero-result fields use deduplicated real events without search text", async () => {
  const metric = f.api.service.metrics;
  await metric.track(alice, "publish", "reach-post");
  await metric.track(bob, "view", "reach-post-day", [], "reach-post");
  await metric.track(bob, "view", "reach-post-day", [], "reach-post");
  await metric.track(bob, "search", "field-search", ["field-health"]);
  await metric.track(bob, "zero-search", "field-search", ["field-health"]);
  const snapshot = await metric.snapshot();
  assert.ok(snapshot.publicationToView.numerator >= 1);
  assert.equal(snapshot.zeroFields["field-health"], 1);
});
