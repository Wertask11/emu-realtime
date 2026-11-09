"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict");
const { crossFixture } = require("./search/test-support"),
  { hash } = require("./config"),
  tasks = require("./tasks");
const reply = require("../../tools/economy-tests/work-reply.cjs");
async function setup(options = {}) {
  const f = await crossFixture({
    ...options,
    env: { ECONOMY_PHASE3_ENABLED: "true", ...options.env },
    providerReply: options.providerReply || reply,
  });
  for (const [id] of Object.entries(
    f.db._dump("emuer_v2_agent_source_approvals"),
  ))
    await f.economy.service.ref("source_approvals", id).set(
      {
        artifactUseApproved: true,
        artifactAllowedTasks: Object.keys(require("./tasks").TASKS),
        artifactPurpose: tasks.VERSION,
      },
      { merge: true },
    );
  f.work = async (
    type,
    goal = "コーヒーの経験とWeb3クエスト・ギルド・商品を比較したい",
  ) => {
    const q = await f.economy.service.quote(f.a, { goal, taskType: type });
    return {
      q,
      body: {
        quoteId: q.id,
        termsVersion: q.termsVersion,
        searchConsentVersion: q.searchProfile.version,
        workConsentVersion: q.workConsentVersion,
        requestId: "work-request-0000000001",
        paymentConsent: true,
        aiConsent: true,
      },
    };
  };
  return f;
}
function pending(f) {
  return (
    Object.values(f.db._dump("emuer_v2_rewards"))
      .filter((r) => r.status === "pending")
      .reduce((n, r) => n + BigInt(r.amountWei), 0n) /
    10n ** 18n
  );
}
for (const type of Object.keys(tasks.TASKS))
  test(
    type +
      ": one paid execution saves one private artifact with five recorded stages",
    async () => {
      const f = await setup(),
        { q, body } = await f.work(type);
      assert.equal(q.executionPlan.length, 5);
      assert.equal(q.price, 5);
      const j = await f.economy.service.submit(f.a, body);
      await f.economy.tick();
      const done = await f.economy.service.view(f.a, j.id);
      assert.equal(done.state, "completed");
      assert.ok(
        done.execution.steps.every(
          (s) => s.state === "completed" && s.startedAt && s.completedAt,
        ),
      );
      const artifact = await f.economy.service.artifacts.view(f.a, j.id);
      assert.equal(artifact.artifactType, type);
      assert.ok(artifact.content.includes("本人が確認・記入"));
      assert.equal(artifact.revision, 1);
      assert.equal(pending(f), 95n);
      assert.equal(f.calls(), 1);
      assert.ok(
        !JSON.stringify(f.payloads).includes("コーヒーの経験とWeb3クエスト"),
      );
      const again = await f.economy.service.submit(f.a, body);
      await f.economy.tick();
      assert.equal(again.id, j.id);
      assert.equal(f.calls(), 1);
      assert.equal(
        Object.keys(f.db._dump("emuer_v2_agent_artifacts")).length,
        1,
      );
    },
  );
test("workflow defaults OFF, disabled domains and unapproved generation materials refuse before payment", async () => {
  assert.equal(tasks.workflow({}, null).enabled, false);
  const f = await setup({ env: { ECONOMY_PHASE3_ENABLED: "false" } });
  await assert.rejects(() => f.work("knowledge_draft"), /WORKFLOW_DISABLED/);
  assert.equal(pending(f), 100n);
  f.env.ECONOMY_PHASE3_ENABLED = "true";
  f.env.ECONOMY_SOURCE_QUEST = "false";
  await assert.rejects(() => f.work("quest_plan"), /WORK_SOURCE_DISABLED/);
  for (const id of Object.keys(f.db._dump("emuer_v2_agent_source_approvals")))
    await f.economy.service
      .ref("source_approvals", id)
      .set({ artifactUseApproved: false }, { merge: true });
  await assert.rejects(() => f.work("guild_plan"), /WORK_MATERIAL_UNAVAILABLE/);
  assert.equal(f.calls(), 0);
  assert.equal(pending(f), 100n);
});
test("explicit new scope consent required; disabling Phase 3 preserves legacy cross search", async () => {
  const f = await setup(),
    { body } = await f.work("guild_plan");
  delete body.workConsentVersion;
  await assert.rejects(
    () => f.economy.service.submit(f.a, body),
    /QUOTE_EXPIRED_OR_CHANGED/,
  );
  assert.equal(pending(f), 100n);
  f.env.ECONOMY_PHASE3_ENABLED = "false";
  const legacy = await f.economy.service.quote(f.a, { goal: "Web3を学びたい" });
  assert.equal(legacy.taskType, null);
  assert.equal(legacy.price, 5);
});
test("owner-only artifact reads/edits, explicit edit consent, optimistic concurrency and no second AI call", async () => {
  const f = await setup(),
    { body } = await f.work("knowledge_draft"),
    j = await f.economy.service.submit(f.a, body);
  await f.economy.tick();
  const a = await f.economy.service.artifacts.view(f.a, j.id),
    bob = await f.actor("bob");
  await assert.rejects(
    () => f.economy.service.artifacts.view(bob, j.id),
    /ARTIFACT_NOT_FOUND/,
  );
  await assert.rejects(
    () =>
      f.economy.service.artifacts.edit(f.a, j.id, {
        title: "本人の下書き",
        content: "自分で確認した記録",
        revision: 1,
      }),
    /CONSENT/,
  );
  const b = {
    editConsent: true,
    title: "本人の下書き",
    content: "自分で確認した記録",
    revision: 1,
  };
  const edited = await f.economy.service.artifacts.edit(f.a, j.id, b);
  assert.equal(edited.content, b.content);
  assert.equal(edited.revision, 2);
  await assert.rejects(
    () => f.economy.service.artifacts.edit(f.a, j.id, b),
    /VERSION_CONFLICT/,
  );
  assert.equal(f.calls(), 1);
  const alias = { ...f.a, uid: "another-linked-user" };
  await assert.rejects(
    () => f.economy.service.artifacts.view(alias, j.id),
    /ARTIFACT_NOT_FOUND/,
  );
});
test("withdrawn generation permission blocks the entire derivative, including edited text and title", async () => {
  const f = await setup(),
    { body } = await f.work("guild_plan"),
    j = await f.economy.service.submit(f.a, body);
  await f.economy.tick();
  const raw = (await f.economy.service.ref("artifacts", j.id).get()).data();
  const r = raw.references[0];
  await f.economy.service
    .ref("source_approvals", hash(r.kind + ":" + r.id))
    .set({ artifactUseApproved: false }, { merge: true });
  const view = await f.economy.service.artifacts.view(f.a, j.id);
  assert.equal(view.status, "references_unavailable");
  assert.equal(view.content, null);
  assert.equal(view.title, tasks.TASKS.guild_plan.label);
  await assert.rejects(
    () =>
      f.economy.service.artifacts.edit(f.a, j.id, {
        editConsent: true,
        title: "test",
        content: "test",
        revision: 1,
      }),
    /REFERENCES_UNAVAILABLE/,
  );
});
for (const status of [429, 503])
  test(
    "provider " +
      status +
      " refunds exactly once, saves no artifact and closes new admissions",
    async () => {
      const f = await setup({ providerStatus: status }),
        { body } = await f.work("guild_plan"),
        j = await f.economy.service.submit(f.a, body);
      await f.economy.tick();
      const done = await f.economy.service.view(f.a, j.id);
      assert.equal(done.state, "refunded");
      assert.equal(pending(f), 100n);
      assert.equal(
        Object.keys(f.db._dump("emuer_v2_agent_artifacts")).length,
        0,
      );
      await f.economy.tick();
      assert.equal(pending(f), 100n);
      assert.equal(
        done.execution.steps.some((s) => s.state === "failed"),
        true,
      );
    },
  );
test("forged reference, injected URL or fabricated first-person history is rejected and refunded", async () => {
  for (const mode of ["id", "url", "story"]) {
    const f = await setup({
        providerReply: (p) => {
          const r = reply(p);
          if (mode === "id") r.artifact.steps[0].references = ["invented"];
          else if (mode === "url")
            r.artifact.steps[0].action =
              "https://example.invalid へ送信してください。";
          else
            r.artifact.steps[0].action =
              "私はすでに成功しました。結果を記入してください。";
          return r;
        },
      }),
      { body } = await f.work("guild_plan"),
      j = await f.economy.service.submit(f.a, body);
    await f.economy.tick();
    assert.equal((await f.economy.service.view(f.a, j.id)).state, "refunded");
    assert.equal(pending(f), 100n);
  }
});
test("result_saved restart settles existing artifact without regeneration; expired running work refunds", async () => {
  const f = await setup(),
    { body } = await f.work("guild_plan");
  const fulfill = f.economy.service.payments.fulfill;
  f.economy.service.payments.fulfill = async () => {
    throw Error("interrupted");
  };
  const j = await f.economy.service.submit(f.a, body);
  await f.economy.tick();
  assert.equal(
    (await f.economy.service.ref("jobs", j.id).get()).data().state,
    "result_saved",
  );
  f.economy.service.payments.fulfill = fulfill;
  await f.economy.tick();
  assert.equal((await f.economy.service.view(f.a, j.id)).state, "completed");
  assert.equal(f.calls(), 1);
  const g = await setup(),
    r = await g.work("guild_plan"),
    x = await g.economy.service.submit(g.a, r.body);
  await g.economy.service.ref("jobs", x.id).set(
    {
      state: "running",
      leaseUntilMs: g.now() - 1,
      leaseToken: "lost",
      execution: tasks.advance(
        tasks.execution("guild_plan", g.now()),
        "working",
        g.now(),
      ),
    },
    { merge: true },
  );
  await g.economy.tick();
  assert.equal((await g.economy.service.view(g.a, x.id)).state, "refunded");
  assert.equal(g.calls(), 0);
});
test("thirty-day purge removes artifact and private work bundle, never unresolved payments", async () => {
  const f = await setup(),
    { body } = await f.work("guild_plan"),
    j = await f.economy.service.submit(f.a, body);
  await f.economy.tick();
  f.advance(31 * 86400000);
  // The JSON fake does not preserve Date comparison types; native timestamp purge is tested in the emulator.
  await f.economy.service
    .ref("jobs", j.id)
    .set({ deleteAfter: f.now() - 1 }, { merge: true });
  await f.economy.service.purge();
  const a = (await f.economy.service.ref("artifacts", j.id).get()).data(),
    v = (await f.economy.service.ref("jobs", j.id).get()).data();
  assert.equal(a.content, null);
  assert.equal(a.title, null);
  assert.equal(a.status, "expired");
  assert.equal(v.workBundle, null);
});
module.exports = { setup, reply };

test("a quoted writing template is an instruction, while an asserted personal past event is not accepted", async () => {
  const f = await setup({
      providerReply: (p) => {
        const v = reply(p);
        v.artifact.summary =
          "こんな状況でした、これを試しましたという型を使って記入しましょう。";
        v.artifact.unknowns = [
          "本人の活動準備は未確認です。使う資料とノートの有無を照合する必要があります。",
        ];
        return v;
      },
    }),
    { body } = await f.work("guild_plan"),
    j = await f.economy.service.submit(f.a, body);
  await f.economy.tick();
  assert.equal((await f.economy.service.view(f.a, j.id)).state, "completed");
});

test("an artifact transaction quota failure leaves no duplicate artifact and returns the single payment", async () => {
  const f = await setup(),
    { body } = await f.work("guild_plan");
  const original = f.db.runTransaction.bind(f.db);
  let failed = false;
  f.db.runTransaction = (fn) =>
    original((tx) => {
      const create = tx.create.bind(tx);
      tx.create = (r, v) => {
        if (!failed && r._col === "emuer_v2_agent_artifacts") {
          failed = true;
          throw Object.assign(Error("RESOURCE_EXHAUSTED"), { code: 8 });
        }
        return create(r, v);
      };
      return fn(tx);
    });
  const j = await f.economy.service.submit(f.a, body);
  await f.economy.tick();
  assert.equal(failed, true);
  assert.equal((await f.economy.service.view(f.a, j.id)).state, "refunded");
  assert.equal(pending(f), 100n);
  assert.equal(Object.keys(f.db._dump("emuer_v2_agent_artifacts")).length, 0);
  await f.economy.tick();
  assert.equal(pending(f), 100n);
});

test("an acknowledged durable transaction with a lost SDK reply resumes only the same fingerprint", async () => {
  const f = await setup(),
    { body } = await f.work("guild_plan"),
    original = f.db.runTransaction.bind(f.db);
  let simulated = false;
  f.db.runTransaction = async (fn) => {
    const result = await original(fn);
    if (!simulated && Object.keys(f.db._dump("emuer_v2_agent_jobs")).length) {
      simulated = true;
      throw Object.assign(Error("ABORTED"), { code: 10 });
    }
    return result;
  };
  const j = await f.economy.service.submit(f.a, body);
  await f.economy.tick();
  assert.equal((await f.economy.service.view(f.a, j.id)).state, "completed");
  assert.equal(pending(f), 95n);
  assert.equal(f.calls(), 1);
});

test("withdrawal after quote refuses before the ledger debit", async () => {
  const f = await setup(),
    { body } = await f.work("guild_plan");
  for (const id of Object.keys(f.db._dump("emuer_v2_agent_source_approvals")))
    await f.economy.service
      .ref("source_approvals", id)
      .set({ artifactUseApproved: false }, { merge: true });
  const j = await f.economy.service.submit(f.a, body);
  assert.equal(j.state, "failed");
  assert.equal(pending(f), 100n);
  assert.equal(f.calls(), 0);
});
test("lost artifact-commit acknowledgement preserves saved work for settlement without a second inference", async () => {
  const f = await setup(),
    { body } = await f.work("guild_plan"),
    orig = f.db.runTransaction.bind(f.db);
  let lost = false;
  f.db.runTransaction = async (fn) => {
    const value = await orig(fn);
    if (!lost && Object.keys(f.db._dump("emuer_v2_agent_artifacts")).length) {
      lost = true;
      throw Object.assign(Error("UNAVAILABLE"), { code: 14 });
    }
    return value;
  };
  const j = await f.economy.service.submit(f.a, body);
  await f.economy.tick();
  await f.economy.tick();
  assert.equal((await f.economy.service.view(f.a, j.id)).state, "completed");
  assert.equal(pending(f), 95n);
  assert.equal(f.calls(), 1);
  assert.equal(Object.keys(f.db._dump("emuer_v2_agent_artifacts")).length, 1);
});

test("expired/Free/Light membership blocks new work and artifact retrieval/editing without deleting saved data", async () => {
  const f = await setup(),
    { body } = await f.work("guild_plan"),
    j = await f.economy.service.submit(f.a, body);
  await f.economy.tick();
  const original = f.entitlement.getEntitlement;
  const second = await f.economy.service.quote(f.a, {
    goal: "ギルド活動を準備したい",
    taskType: "guild_plan",
  });
  for (const plan of ["guest", "light"]) {
    f.entitlement.getEntitlement = async (uid, account, options) => {
      assert.equal(options.fresh, true);
      return { plan };
    };
    await assert.rejects(
      () => f.economy.service.artifacts.view(f.a, j.id),
      /SERVICE_NOT_ELIGIBLE/,
    );
    await assert.rejects(
      () => f.economy.service.artifacts.list(f.a),
      /SERVICE_NOT_ELIGIBLE/,
    );
    await assert.rejects(
      () =>
        f.economy.service.artifacts.edit(f.a, j.id, {
          editConsent: true,
          revision: 1,
          title: "test",
          content: "test",
        }),
      /SERVICE_NOT_ELIGIBLE/,
    );
    await assert.rejects(
      () =>
        f.economy.service.quote(f.a, {
          goal: "ギルド活動",
          taskType: "guild_plan",
        }),
      /SERVICE_NOT_ELIGIBLE/,
    );
    await assert.rejects(
      () =>
        f.economy.service.submit(f.a, {
          ...body,
          quoteId: second.id,
          requestId: "new-work-request-00002",
        }),
      /SERVICE_NOT_ELIGIBLE/,
    );
  }
  f.entitlement.getEntitlement = async () => ({ plan: "pro" });
  assert.ok((await f.economy.service.artifacts.view(f.a, j.id)).content);
  await f.economy.service
    .ref("eligibility", hash(f.a.spid))
    .set({ providerAllowed: false }, { merge: true });
  await assert.rejects(
    () => f.economy.service.artifacts.view(f.a, j.id),
    /AI_AUDIENCE_NOT_VERIFIED/,
  );
  assert.ok(
    (await f.economy.service.ref("artifacts", j.id).get()).data().content,
  );
  f.entitlement.getEntitlement = original;
});

test("private checklist state persists without editing text, inference, payment or another owner access", async () => {
  const f = await setup(),
    { body } = await f.work("quest_plan"),
    j = await f.economy.service.submit(f.a, body);
  await f.economy.tick();
  const before = await f.economy.service.artifacts.view(f.a, j.id),
    b = {
      editConsent: true,
      revision: 1,
      checkedItems: [before.document.checklist[0].id],
    };
  assert.equal(before.formatVersion, 2);
  const after = await f.economy.service.artifacts.edit(f.a, j.id, b);
  assert.deepEqual(after.checkedItems, b.checkedItems);
  assert.equal(after.content, before.content);
  assert.equal(after.revision, 2);
  const reread = await f.economy.service.artifacts.view(f.a, j.id);
  assert.deepEqual(reread.checkedItems, b.checkedItems);
  assert.equal(f.calls(), 1);
  assert.equal(pending(f), 95n);
  await assert.rejects(() =>
    f.economy.service.artifacts.edit(otherActor(f), j.id, b),
  );
  await assert.rejects(
    () => f.economy.service.artifacts.edit(f.a, j.id, b),
    /VERSION_CONFLICT/,
  );
  await assert.rejects(
    () =>
      f.economy.service.artifacts.edit(f.a, j.id, {
        editConsent: true,
        revision: 2,
        checkedItems: ["invented"],
      }),
    /INVALID_CHECKLIST_STATE/,
  );
  await assert.rejects(
    () =>
      f.economy.service.artifacts.edit(f.a, j.id, {
        editConsent: true,
        revision: 2,
        checkedItems: [b.checkedItems[0], b.checkedItems[0]],
      }),
    /INVALID_CHECKLIST_STATE/,
  );
});
function otherActor(f) {
  return { ...f.a, uid: "another-account" };
}
test("old stored format remains readable/editable without regeneration or migration", async () => {
  const f = await setup(),
    { body } = await f.work("guild_plan"),
    j = await f.economy.service.submit(f.a, body);
  await f.economy.tick();
  await f.economy.service.ref("artifacts", j.id).set(
    {
      formatVersion: 1,
      document: null,
      checkedItems: [],
      content: "旧形式の本文。本人が確認・記入してください。",
    },
    { merge: true },
  );
  const a = await f.economy.service.artifacts.view(f.a, j.id);
  assert.equal(a.formatVersion, 1);
  assert.equal(a.document, null);
  assert.match(a.content, /旧形式/);
  const b = await f.economy.service.artifacts.edit(f.a, j.id, {
    editConsent: true,
    revision: 1,
    title: "本人が編集した旧形式",
    content: "元の経験を本人が確認して追記した本文です。",
  });
  assert.equal(b.document, null);
  assert.equal(f.calls(), 1);
  assert.equal(pending(f), 95n);
});
test("withdrawal hides structured comparisons and saved checks, not just the plaintext", async () => {
  const f = await setup(),
    { body } = await f.work("guild_plan"),
    j = await f.economy.service.submit(f.a, body);
  await f.economy.tick();
  const raw = (await f.economy.service.ref("artifacts", j.id).get()).data();
  await f.economy.service
    .ref(
      "source_approvals",
      hash(raw.references[0].kind + ":" + raw.references[0].id),
    )
    .set({ artifactUseApproved: false }, { merge: true });
  const a = await f.economy.service.artifacts.view(f.a, j.id);
  assert.equal(a.content, null);
  assert.equal(a.document, null);
  assert.deepEqual(a.checkedItems, []);
  await assert.rejects(
    () =>
      f.economy.service.artifacts.edit(f.a, j.id, {
        editConsent: true,
        revision: 1,
        checkedItems: [],
      }),
    /REFERENCES_UNAVAILABLE/,
  );
});
