"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  { createFixture } = require("./fixture.cjs"),
  { TASKS } = require("../../backend/economy/tasks");
async function generate(f, type) {
  const q = await f.call("alice", "POST", "/quotes", {
    goal: "コーヒーの経験とWeb3のクエスト・ギルド・City商品を比較したい",
    taskType: type,
  });
  assert.equal(q.status, 200, JSON.stringify(q.body));
  const j = await f.call("alice", "POST", "/jobs", {
    quoteId: q.body.quote.id,
    termsVersion: q.body.quote.termsVersion,
    requestId: "phase4-local-request1",
    paymentConsent: true,
    aiConsent: true,
    searchConsentVersion: q.body.quote.searchProfile.version,
    workConsentVersion: q.body.quote.workConsentVersion,
  });
  assert.equal(j.status, 200, JSON.stringify(j.body));
  await f.economy.tick();
  const done = await f.call("alice", "GET", "/jobs/" + j.body.job.id);
  assert.equal(done.body.job.state, "completed", JSON.stringify(done.body));
  return done.body.job.artifactId;
}
for (const type of Object.keys(TASKS))
  test(
    "native Phase4 " +
      type +
      ": owner-only lifecycle/edit/replay/expiry and unchanged payment",
    async () => {
      const f = await createFixture({
        crossDomain: true,
        phase3: true,
        phase4: true,
      });
      try {
        const artifact = await generate(f, type),
          raw = (
            await f.db
              .collection("emuer_v2_agent_artifacts")
              .doc(artifact)
              .get()
          ).data(),
          providerCalls = f.providerPayloads.length;
        const start = await f.call("alice", "POST", "/practice", {
          sourceArtifactId: artifact,
        });
        assert.equal(start.status, 200, JSON.stringify(start.body));
        const s = start.body.session,
          id = s.id;
        assert.equal(s.artifactType, type);
        assert.equal(s.progress.total, raw.document.checklist.length);
        const again = await Promise.all([
          f.call("alice", "POST", "/practice", { sourceArtifactId: artifact }),
          f.call("alice", "POST", "/practice", { sourceArtifactId: artifact }),
        ]);
        assert.ok(
          again.every((x) => x.status === 200 && x.body.session.id === id),
        );
        assert.equal(
          (await f.call("alice", "GET", "/practice")).body.sessions.length,
          1,
        );
        assert.equal(
          (await f.call(null, "GET", "/practice/" + id)).status,
          401,
        );
        assert.equal(
          (await f.call("bob", "GET", "/practice/" + id)).status,
          404,
        );
        assert.equal(
          (
            await f.call("bob", "POST", "/practice/" + id, {
              revision: 1,
              requestId: "stolen-request01",
              notes: "forged",
            })
          ).status,
          404,
        );
        let response = await f.call("alice", "POST", "/practice/" + id, {
          revision: 1,
          requestId: "practice-pause01",
          status: "paused",
          notes: "少し休んで再開する",
        });
        assert.equal(response.status, 200);
        assert.equal(response.body.session.status, "paused");
        response = await f.call("alice", "POST", "/practice/" + id, {
          revision: 2,
          requestId: "practice-resume1",
          status: "active",
        });
        assert.equal(response.status, 200);
        const body = {
          revision: 3,
          requestId: "practice-notes01",
          postTitle: "実際に試した学び",
          observations: {
            actions: "自分で二つの条件を試した",
            method: "同じ材料で条件を比べた",
            result: "違いを記録した",
            failures: "一回目は記録を忘れた",
            insights: "条件を揃えると比較できた",
            next: "次は時間も記録する",
          },
          reflections: {
            goal: "条件による違いを学ぶ",
            actual: "二回比較した",
            success: "条件を揃えた",
            failure: "記録を忘れた",
            learning: "記録の大切さ",
            next: "再度比べる",
          },
          advice: "実施時に記録を残す",
          checklistItems: s.checklistItems.map((c) => ({
            id: c.id,
            state: "done",
            note: "本人が実践した",
          })),
        };
        response = await f.call("alice", "POST", "/practice/" + id, body);
        assert.equal(response.status, 200, JSON.stringify(response.body));
        assert.equal(response.body.session.revision, 4);
        assert.equal(response.body.session.progress.done, s.progress.total);
        assert.equal(response.body.session.postingDraft.missing.length, 0);
        const retry = await f.call("alice", "POST", "/practice/" + id, body);
        assert.equal(retry.status, 200);
        assert.equal(retry.body.session.revision, 4);
        assert.equal(
          (
            await f.call("alice", "POST", "/practice/" + id, {
              ...body,
              notes: "違う再送",
            })
          ).status,
          409,
        );
        response = await f.call("alice", "POST", "/practice/" + id, {
          revision: 4,
          requestId: "practice-finish1",
          status: "completed",
        });
        assert.equal(response.status, 200);
        assert.equal(response.body.session.status, "completed");
        const reread = await f.call("alice", "GET", "/practice/" + id);
        assert.equal(reread.body.session.reflections.learning, "記録の大切さ");
        const member = await fetch(f.base + "/test/membership", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ role: "alice", plan: "light" }),
        });
        assert.equal(member.status, 200);
        for (const route of ["/practice", "/practice/" + id])
          assert.equal((await f.call("alice", "GET", route)).status, 403);
        assert.equal(
          (
            await f.call("alice", "POST", "/practice/" + id, {
              revision: 5,
              requestId: "expired-plan001",
              notes: "拒否",
            })
          ).status,
          403,
        );
        assert.equal(
          (await f.db.collection("emuer_v2_agent_jobs").get()).size,
          1,
        );
        assert.equal((await f.db.collection("mitemiru_orders").get()).size, 1);
        assert.equal(f.providerPayloads.length, providerCalls);
        assert.deepEqual(
          (
            await f.db
              .collection("emuer_v2_agent_artifacts")
              .doc(artifact)
              .get()
          ).data(),
          raw,
        );
      } finally {
        await f.close();
      }
    },
  );
