"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  { createFixture } = require("./fixture.cjs");
const { TASKS, VERSION } = require("../../backend/economy/tasks"),
  { hash } = require("../../backend/economy/config");
for (const type of Object.keys(TASKS))
  test(
    "native " +
      type +
      ": auth/payment/save/list/edit/reopen/private ownership and withdrawal",
    async () => {
      const f = await createFixture({ crossDomain: true, phase3: true });
      const role = ["quest_plan", "city_comparison"].includes(type)
        ? "pro"
        : "alice";
      try {
        const q = await f.call(role, "POST", "/quotes", {
          goal: "コーヒーの経験を整理してWeb3クエスト・ギルド・City商品を比較したい",
          taskType: type,
        });
        assert.equal(q.status, 200, JSON.stringify(q.body));
        const body = {
          quoteId: q.body.quote.id,
          termsVersion: q.body.quote.termsVersion,
          requestId: "native-work-0000000001",
          paymentConsent: true,
          aiConsent: true,
          searchConsentVersion: q.body.quote.searchProfile.version,
          workConsentVersion: VERSION,
        };
        const j = await f.call(role, "POST", "/jobs", body);
        assert.equal(j.status, 200, JSON.stringify(j.body));
        await f.economy.tick();
        const done = await f.call(role, "GET", "/jobs/" + j.body.job.id);
        assert.equal(
          done.body.job.state,
          "completed",
          JSON.stringify(done.body),
        );
        const id = done.body.job.artifactId;
        const list = await f.call(role, "GET", "/artifacts");
        assert.equal(list.status, 200);
        assert.equal(list.body.artifacts.length, 1);
        const read = await f.call(role, "GET", "/artifacts/" + id);
        assert.equal(read.status, 200);
        assert.equal(read.body.artifact.artifactType, type);
        assert.ok(read.body.artifact.content);
        assert.equal(
          (await f.call("bob", "GET", "/artifacts/" + id)).status,
          404,
        );
        assert.deepEqual(
          (await f.call("bob", "GET", "/artifacts")).body.artifacts,
          [],
        );
        assert.equal(
          (await f.call(null, "GET", "/artifacts/" + id)).status,
          401,
        );
        const edit = {
          editConsent: true,
          revision: 1,
          title: "本人が確認した計画",
          content: "自分で確認して実践する手順を追記しました。",
        };
        assert.equal(
          (await f.call("bob", "POST", "/artifacts/" + id, edit)).status,
          404,
        );
        const writes = await Promise.all([
          f.call(role, "POST", "/artifacts/" + id, edit),
          f.call(role, "POST", "/artifacts/" + id, edit),
        ]);
        assert.deepEqual(writes.map((x) => x.status).sort(), [200, 409]);
        const reopen = await f.call(role, "GET", "/artifacts/" + id);
        assert.equal(reopen.body.artifact.revision, 2);
        assert.equal(reopen.body.artifact.content, edit.content);
        assert.equal(reopen.body.artifact.formatVersion, 2);
        const checkId = reopen.body.artifact.document.checklist[0].id;
        const checked = await f.call(role, "POST", "/artifacts/" + id, {
          editConsent: true,
          revision: 2,
          checkedItems: [checkId],
        });
        assert.equal(checked.status, 200);
        assert.deepEqual(
          (await f.call(role, "GET", "/artifacts/" + id)).body.artifact
            .checkedItems,
          [checkId],
        );
        assert.equal(
          (
            await f.call("bob", "POST", "/artifacts/" + id, {
              editConsent: true,
              revision: 3,
              checkedItems: [],
            })
          ).status,
          404,
        );
        const replay = await f.call(role, "POST", "/jobs", body);
        assert.equal(replay.body.job.id, id);
        await f.economy.tick();
        assert.equal(f.providerPayloads.length, 1);
        const raw = (await f.economy.service.ref("artifacts", id).get()).data(),
          r = raw.references[0];
        await f.economy.service
          .ref("source_approvals", hash(r.kind + ":" + r.id))
          .set({ artifactUseApproved: false }, { merge: true });
        const revoked = await f.call(role, "GET", "/artifacts/" + id);
        assert.equal(revoked.body.artifact.content, null);
        assert.equal(revoked.body.artifact.document, null);
        assert.deepEqual(revoked.body.artifact.checkedItems, []);
        assert.equal(revoked.body.artifact.status, "references_unavailable");
        // Real Timestamp comparison, unlike the small JSON unit fake.
        await f.economy.service
          .ref("jobs", id)
          .set({ deleteAfter: new Date(Date.now() - 1000) }, { merge: true });
        await f.economy.service.purge();
        assert.equal(
          (await f.economy.service.ref("artifacts", id).get()).data().content,
          null,
        );
        assert.equal(
          (await f.call(role, "GET", "/artifacts")).body.artifacts.length,
          0,
        );
      } finally {
        await f.close();
      }
    },
  );

test("native membership expiry and Light gift reject every new-work/artifact route; renewal restores the retained artifact", async () => {
  const f = await createFixture({ crossDomain: true, phase3: true });
  try {
    const q = await f.call("alice", "POST", "/quotes", {
        goal: "ギルド活動の準備",
        taskType: "guild_plan",
      }),
      q2 = await f.call("alice", "POST", "/quotes", {
        goal: "次の活動の準備",
        taskType: "guild_plan",
      });
    assert.equal(q.status, 200);
    const b = {
        quoteId: q.body.quote.id,
        termsVersion: q.body.quote.termsVersion,
        searchConsentVersion: q.body.quote.searchProfile.version,
        workConsentVersion: VERSION,
        requestId: "access-test-request-0001",
        paymentConsent: true,
        aiConsent: true,
      },
      j = await f.call("alice", "POST", "/jobs", b);
    await f.economy.tick();
    const id = j.body.job.id;
    for (const r of ["guest", "light"])
      assert.equal(
        (
          await f.call(r, "POST", "/quotes", {
            goal: "活動の準備",
            taskType: "guild_plan",
          })
        ).status,
        403,
      );
    for (const entitlement of [
      {
        plan: "light",
        source: "emu-gift",
        expiresAt: new Date(Date.now() + 86400000),
      },
      {
        plan: "pro",
        source: "emulator-test",
        expiresAt: new Date(Date.now() - 1000),
      },
    ]) {
      await f.db
        .collection("entitlements")
        .doc(f.users.alice.uid)
        .set({ startsAt: new Date(0), ...entitlement });
      for (const route of ["/artifacts", "/artifacts/" + id])
        assert.equal((await f.call("alice", "GET", route)).status, 403);
      assert.equal(
        (
          await f.call("alice", "POST", "/artifacts/" + id, {
            editConsent: true,
            revision: 1,
            title: "test",
            content: "test",
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await f.call("alice", "POST", "/quotes", {
            goal: "活動",
            taskType: "guild_plan",
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await f.call("alice", "POST", "/jobs", {
            ...b,
            quoteId: q2.body.quote.id,
            requestId: "access-test-request-0002",
          })
        ).status,
        403,
      );
    }
    await f.db
      .collection("entitlements")
      .doc(f.users.alice.uid)
      .set({ plan: "plus", startsAt: new Date(0), source: "emulator-test" });
    assert.equal(
      (await f.call("alice", "GET", "/artifacts/" + id)).status,
      200,
    );
    assert.equal(
      (
        await f.db
          .collection("mitemiru_orders")
          .where("serviceJobId", "==", id)
          .get()
      ).size,
      1,
    );
  } finally {
    await f.close();
  }
});
