"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict");
const { createPractice, settings } = require("./practice"),
  { makeFirestore } = require("../fake-firestore"),
  { TASKS } = require("./tasks");
function fixture(type = "quest_plan") {
  const db = makeFirestore(),
    a = { uid: "alice", spid: "school-id" };
  let clock = 1000,
    valid = true,
    plan = "plus",
    phase4 = true;
  const source = {
    id: "a".repeat(40),
    artifactType: type,
    title: "公式計画",
    content: "元資料の計画",
    document: {
      checklist: [
        { id: "check-1", text: "公式募集画面を開き受付条件を照合する" },
        { id: "check-2", text: "記録シートに試した方法を書く" },
      ],
    },
    references: [],
  };
  const env = { ECONOMY_PHASE4_ENABLED: "true" },
    ref = (k, id) => db.collection("emuer_v2_agent_" + k).doc(id);
  const p = createPractice({
    db,
    ref,
    env,
    now: () => clock,
    requireAccess: async (actor) => {
      if (!["plus", "pro"].includes(plan))
        throw Object.assign(Error("SERVICE_NOT_ELIGIBLE"), { status: 403 });
    },
    artifacts: {
      view: async (actor, id) => {
        if (actor.uid !== a.uid || id !== source.id)
          throw Object.assign(Error("ARTIFACT_NOT_FOUND"), { status: 404 });
        return {
          ...source,
          content: valid ? source.content : null,
          document: valid ? source.document : null,
        };
      },
    },
  });
  return {
    p,
    db,
    a,
    env,
    source,
    ref,
    setPlan: (v) => {
      plan = v;
    },
    withdraw: () => {
      valid = false;
    },
    advance: (ms) => {
      clock += ms;
    },
    start: () => p.start(a, { sourceArtifactId: source.id }),
  };
}
for (const type of Object.keys(TASKS))
  test(
    type + ": private practice lifecycle, no artifact mutation",
    async () => {
      const f = fixture(type),
        original = JSON.stringify(f.source),
        s = await f.start();
      assert.equal(s.artifactType, type);
      assert.equal(s.status, "active");
      assert.equal(s.postingDraft.missing.length, 9);
      assert.equal(s.ownerUid, undefined);
      const duplicate = await f.start();
      assert.equal(duplicate.id, s.id);
      assert.equal(duplicate.revision, 1);
      let v = await f.p.edit(f.a, s.id, {
        revision: 1,
        requestId: "pause-request-01",
        status: "paused",
        notes: "本人の実践メモ",
      });
      assert.equal(v.status, "paused");
      v = await f.p.edit(f.a, s.id, {
        revision: 2,
        requestId: "resume-request-1",
        status: "active",
      });
      assert.equal(v.status, "active");
      await assert.rejects(
        f.p.edit(f.a, s.id, {
          revision: 3,
          requestId: "complete-request",
          status: "completed",
        }),
        /PRACTICE_COMPLETION_CONFIRMATION_REQUIRED/,
      );
      v = await f.p.edit(f.a, s.id, {
        revision: 3,
        requestId: "check-request-01",
        checklistItems: s.checklistItems.map((c) => ({
          id: c.id,
          state: "done",
          note: "実施済み",
        })),
      });
      assert.equal(v.progress.done, 2);
      assert.equal(v.checklistItems[0].performedAt, 1000);
      v = await f.p.edit(f.a, s.id, {
        revision: 4,
        requestId: "complete-done-01",
        status: "completed",
      });
      assert.equal(v.status, "completed");
      assert.equal(v.completedAt, 1000);
      assert.equal(JSON.stringify(f.source), original);
      assert.equal((await f.p.list(f.a)).length, 1);
    },
  );
test("current plan expiry, Free/Light and owner/SchoolPark ID gates", async () => {
  const f = fixture(),
    s = await f.start();
  for (const plan of ["free", "light"]) {
    f.setPlan(plan);
    for (const fn of [
      () => f.start(),
      () => f.p.view(f.a, s.id),
      () => f.p.list(f.a),
      () =>
        f.p.edit(f.a, s.id, {
          revision: 1,
          requestId: "denied-request1",
          notes: "no",
        }),
    ])
      await assert.rejects(fn(), /SERVICE_NOT_ELIGIBLE/);
  }
  f.setPlan("pro");
  for (const a of [
    { ...f.a, uid: "bob" },
    { ...f.a, spid: "other-id" },
  ])
    await assert.rejects(f.p.view(a, s.id), /PRACTICE_NOT_FOUND/);
});
test("flag default OFF does not alter Phase 3 price or allow model generation", async () => {
  assert.deepEqual(settings({}), {
    enabled: false,
    additionalPrice: 0,
    retentionDays: 30,
    additionalGenerationEnabled: false,
  });
  const f = fixture();
  f.env.ECONOMY_PHASE4_ENABLED = "false";
  await assert.rejects(f.start(), /PRACTICE_DISABLED/);
  assert.equal(require("./config").SERVICE.price, 5);
});
test("concurrent updates and lost acknowledgement replay are safe", async () => {
  const f = fixture(),
    s = await f.start(),
    b = {
      revision: 1,
      requestId: "offline-retry-01",
      notes: "通信前に入力した実践",
    };
  const r = await Promise.allSettled([
    f.p.edit(f.a, s.id, b),
    f.p.edit(f.a, s.id, {
      ...b,
      requestId: "other-request-01",
      notes: "別タブ",
    }),
  ]);
  assert.equal(r.filter((x) => x.status === "fulfilled").length, 1);
  const winner = r.find((x) => x.status === "fulfilled").value;
  const body =
    winner.notes === b.notes
      ? b
      : { ...b, requestId: "other-request-01", notes: "別タブ" };
  const replay = await f.p.edit(f.a, s.id, body);
  assert.equal(replay.revision, 2);
  await assert.rejects(
    f.p.edit(f.a, s.id, { ...body, notes: "変更した再送" }),
    /PRACTICE_REQUEST_CONFLICT/,
  );
});
test("source withdrawal hides derived checklist, preserves own record without using revoked source", async () => {
  const f = fixture(),
    s = await f.start();
  await f.p.edit(f.a, s.id, {
    revision: 1,
    requestId: "own-record-note1",
    observations: {
      actions: "温度を二通りに変えて試した",
      result: "違いを記録した",
    },
  });
  f.withdraw();
  let v = await f.p.view(f.a, s.id);
  assert.equal(v.sourceAvailable, false);
  assert.ok(!JSON.stringify(v).includes("公式募集画面"));
  assert.ok(v.postingDraft.content.includes("温度を二通り"));
  await assert.rejects(
    f.p.edit(f.a, s.id, {
      revision: 2,
      requestId: "revoked-check01",
      checklistItems: s.checklistItems.map((c) => ({
        id: c.id,
        state: "done",
        note: "",
      })),
    }),
    /ARTIFACT_REFERENCES_UNAVAILABLE/,
  );
  v = await f.p.edit(f.a, s.id, {
    revision: 2,
    requestId: "own-note-after1",
    notes: "自分の記録だけ追記",
  });
  assert.equal(v.notes, "自分の記録だけ追記");
});
test("retention denies expired record, hourly bounded cleanup erases private contents", async () => {
  const f = fixture(),
    s = await f.start();
  f.advance(30 * 86400000 + 1);
  await assert.rejects(f.p.view(f.a, s.id), /PRACTICE_EXPIRED/);
  assert.equal((await f.p.list(f.a)).length, 0);
  await f.p.purge();
  assert.equal((await f.ref("practice", s.id).get()).exists, false);
});
test("legacy artifact requires owner-written checklist and never regenerates it", async () => {
  const f = fixture();
  f.source.document = null;
  await assert.rejects(f.start(), /PRACTICE_MANUAL_ITEMS_REQUIRED/);
  const s = await f.p.start(f.a, {
    sourceArtifactId: f.source.id,
    manualItems: ["自分で温度を記録する"],
  });
  assert.equal(s.checklistItems[0].text, "自分で温度を記録する");
});
test("posting draft never invents experience or promotes plan text to results", async () => {
  const f = fixture(),
    s = await f.start();
  assert.ok(s.postingDraft.content.includes("［未記入］"));
  assert.ok(!s.postingDraft.content.includes(f.source.content));
  let v = await f.p.edit(f.a, s.id, {
    revision: 1,
    requestId: "reflection-edit1",
    observations: {
      actions: "実際に二回試した",
      method: "条件を記録した",
      result: "差を観察した",
    },
    reflections: { goal: "味を比べる", learning: "温度の差に気づいた" },
  });
  assert.ok(v.postingDraft.content.includes("実際に二回試した"));
  assert.ok(v.postingDraft.missing.includes("アドバイス"));
});
test("invalid fields, giant notes and forged item ids are rejected", async () => {
  const f = fixture(),
    s = await f.start();
  for (const b of [
    { ownerUid: "bob" },
    { notes: "a".repeat(3001) },
    { observations: { hidden: "no" } },
    { checklistItems: [{ id: "forged", state: "done", note: "" }] },
  ])
    await assert.rejects(
      f.p.edit(f.a, s.id, { revision: 1, requestId: "invalid-request1", ...b }),
      /INVALID_INPUT/,
    );
});
test("Firestore quota error fails closed without touching original artifact or ledger", async () => {
  const f = fixture(),
    original = f.db.runTransaction;
  f.db.runTransaction = async () => {
    throw Object.assign(Error("RESOURCE_EXHAUSTED"), { code: 8 });
  };
  await assert.rejects(f.start(), /RESOURCE_EXHAUSTED/);
  f.db.runTransaction = original;
  assert.equal(Object.keys(f.db._dump("emuer_v2_agent_practice")).length, 0);
});
test("cancel keeps own notes and a restarted service restores the same durable session", async () => {
  const f = fixture(),
    s = await f.start();
  await f.p.edit(f.a, s.id, {
    revision: 1,
    requestId: "cancel-notes-01",
    status: "cancelled",
    notes: "本人が中止を選んだ記録",
  });
  const restarted = createPractice({
    db: f.db,
    ref: f.ref,
    env: f.env,
    now: () => 1000,
    requireAccess: async () => {},
    artifacts: { view: async () => f.source },
  });
  const reopened = await restarted.view(f.a, s.id);
  assert.equal(reopened.status, "cancelled");
  assert.equal(reopened.notes, "本人が中止を選んだ記録");
  assert.equal((await f.start()).id, s.id);
  await assert.rejects(
    restarted.edit(f.a, s.id, {
      revision: 2,
      requestId: "invalid-resume01",
      status: "active",
    }),
    /PRACTICE_INVALID_TRANSITION/,
  );
});
test("incomplete completion needs acknowledgement once; later notes remain editable", async () => {
  const f = fixture(),
    s = await f.start();
  const v = await f.p.edit(f.a, s.id, {
    revision: 1,
    requestId: "finish-with-note",
    status: "completed",
    confirmIncomplete: true,
  });
  const edited = await f.p.edit(f.a, s.id, {
    revision: v.revision,
    requestId: "edit-after-done",
    notes: "実践後に気づいた点",
  });
  assert.equal(edited.notes, "実践後に気づいた点");
});
test("posting checks are private owner choices and unknown checks are rejected", async () => {
  const f = fixture(),
    s = await f.start();
  const v = await f.p.edit(f.a, s.id, {
    revision: 1,
    requestId: "posting-checks01",
    postingChecks: ["experience", "privacy", "rights"],
  });
  assert.equal(v.postingChecks.length, 3);
  await assert.rejects(
    f.p.edit(f.a, s.id, {
      revision: 2,
      requestId: "forged-checks01",
      postingChecks: ["published"],
    }),
    /INVALID_INPUT/,
  );
});
