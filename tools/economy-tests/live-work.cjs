"use strict";
// Explicit local Auth/Firestore demo + real Gemini. Never connects to production
// Firebase, real wallets, real EMUER or user data. One generation, no auto retry.
if (process.env.EXPLORER_LIVE_TEST_APPROVED !== "true")
  throw Error("EXPLICIT_LOCAL_LIVE_TEST_REQUIRED");
const fs = require("node:fs"),
  assert = require("node:assert/strict");
const { createFixture } = require("./fixture.cjs"),
  { VERSION } = require("../../backend/economy/tasks");
(async () => {
  const evidence = {
    provider: "real Gemini",
    firebase: "dedicated local emulator",
    payment: "demo ledger only",
    productionPayment: false,
    calls: [],
  };
  let f;
  try {
    const allowed = require("../../backend/economy/search/guides")
      .guides(Date.now())
      .filter((s) => s.domain === "service")
      .map((s) => [s.title, s.summary]);
    for (const g of require("../../frontend/public/schoolpark/guild-store")
      .OFFICIAL)
      allowed.push([g.name, g.concept]);
    f = await createFixture({
      crossDomain: true,
      phase3: true,
      providerFetcher: async (url, options) => {
        const payload = JSON.parse(options.body),
          raw = payload.generateContentRequest || payload;
        const data = JSON.parse(raw.contents[0].parts[0].text);
        assert.ok(
          data.sources.length &&
            data.sources.every((s) =>
              allowed.some(
                ([title, summary]) =>
                  s.title === title && s.summary === summary,
              ),
            ),
          "ONLY_REPOSITORY_OWNED_PUBLIC_TEXT",
        );
        const r = await fetch(url, options);
        evidence.calls.push({
          operation: url.endsWith(":countTokens")
            ? "countTokens"
            : "generateContent",
          http: r.status,
        });
        return r;
      },
    });
    f.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    for (const domain of [
      "KNOWLEDGE_LAB",
      "KNOWLEDGE_TEXT",
      "QUEST",
      "CITY",
      "EMUER",
      "PASSPORT",
      "ACTIVITIES",
    ])
      f.env["ECONOMY_SOURCE_" + domain] = "false";
    const q = await f.call("alice", "POST", "/quotes", {
      goal: "学んだ知識を実践するギルド活動の準備をしたい",
      taskType: "guild_plan",
    });
    assert.equal(q.status, 200, JSON.stringify(q.body));
    const b = {
      quoteId: q.body.quote.id,
      termsVersion: q.body.quote.termsVersion,
      searchConsentVersion: q.body.quote.searchProfile.version,
      workConsentVersion: VERSION,
      requestId: "live-local-work-00000001",
      paymentConsent: true,
      aiConsent: true,
    };
    const j = await f.call("alice", "POST", "/jobs", b);
    assert.equal(j.status, 200);
    await f.economy.tick();
    const done = await f.call("alice", "GET", "/jobs/" + j.body.job.id);
    assert.equal(
      done.body.job.state,
      "completed",
      JSON.stringify({
        state: done.body.job.state,
        error: done.body.job.error,
      }),
    );
    const a = await f.call("alice", "GET", "/artifacts/" + j.body.job.id);
    assert.equal(a.status, 200);
    assert.ok(a.body.artifact.content);
    const edit = await f.call("alice", "POST", "/artifacts/" + j.body.job.id, {
      editConsent: true,
      revision: 1,
      title: "本人が確認したギルド活動の準備",
      content: a.body.artifact.content + "\n自分で確認する項目を追加します。",
    });
    assert.equal(edit.status, 200);
    assert.equal(edit.body.artifact.revision, 2);
    const replay = await f.call("alice", "POST", "/jobs", b);
    assert.equal(replay.body.job.id, j.body.job.id);
    assert.equal(
      evidence.calls.filter((c) => c.operation === "generateContent").length,
      1,
    );
    const raw = (
      await f.economy.service.ref("jobs", j.body.job.id).get()
    ).data();
    evidence.success = true;
    evidence.usage = raw.tokenUsage;
    evidence.steps = raw.execution.steps;
    evidence.artifact = {
      type: a.body.artifact.artifactType,
      referenceCount: a.body.artifact.references.length,
      saved: true,
      edited: true,
      reopened: edit.body.artifact.revision === 2,
    };
    evidence.payment = {
      amount: done.body.job.payment.amount,
      method: done.body.job.payment.method,
      status: done.body.job.payment.status,
    };
  } catch (e) {
    evidence.success = false;
    evidence.error = /^[A-Z_]+$/.test(e.message)
      ? e.message
      : "LOCAL_REAL_PROVIDER_ACCEPTANCE_FAILED";
    process.exitCode = 1;
  } finally {
    if (f) await f.close();
    fs.writeFileSync(
      process.env.EXPLORER_EVIDENCE_PATH || "/tmp/reizo-live-work.json",
      JSON.stringify(evidence, null, 2),
    );
    console.log(JSON.stringify(evidence));
  }
})();
