"use strict";
// Explicit local Auth/Firestore demo + real Gemini. Never connects to production
// Firebase, real wallets, real EMUER or user data. One generation, no auto retry.
if (process.env.EXPLORER_LIVE_TEST_APPROVED !== "true")
  throw Error("EXPLICIT_LOCAL_LIVE_TEST_REQUIRED");
const fs = require("node:fs"),
  assert = require("node:assert/strict");
const { createFixture } = require("./fixture.cjs"),
  { VERSION, TASKS } = require("../../backend/economy/tasks");
const type = process.env.EXPLORER_LIVE_TASK || "guild_plan";
if (!["guild_plan", "quest_plan", "city_comparison"].includes(type))
  throw Error("EXPLICIT_LOCAL_TASK_REQUIRED");
const role = type === "quest_plan" ? "pro" : "alice";
(async () => {
  const evidence = {
    taskType: type,
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
    if (type !== "guild_plan") {
      const manifest = JSON.parse(
        fs.readFileSync(process.env.EXPLORER_OFFICIAL_REVIEW_PATH || ""),
      );
      assert.equal(manifest.success, true);
      const domain = type === "quest_plan" ? "quest" : "city";
      const record =
        manifest.records.find(
          (r) =>
            r.domain === domain &&
            (domain !== "quest" || r.facts.guild === "WEB3 Guild"),
        ) || manifest.records.find((r) => r.domain === domain);
      assert.ok(record);
      const originals = require("./official-material-review.cjs"),
        { hash } = require("../../backend/economy/config");
      const id = record.sourceKey.split(":")[1];
      let raw;
      if (domain === "quest") {
        const seed = originals.seeds.find(
          (s) =>
            s.file === record.originalFile &&
            hash([
              s.row.title,
              s.row.brief || null,
              s.row.given || null,
              s.row.conditions || null,
            ]) === record.originalHash,
        );
        assert.ok(seed);
        raw = {
          ...seed.row,
          status: "OPEN",
          visibility: "public",
          owner: "local-test-operator",
          closesAt: record.facts.deadlineMs,
        };
      } else {
        const c = originals.catalog.find((c) => c.id === id);
        assert.ok(c);
        raw = {
          name: c.name,
          description: c.description,
          fulfillment: c.fulfillment,
          cancelPolicy: c.cancelPolicy,
          status: "live",
          shopId: "schoolpark-official",
          createdBy: "local-test-operator",
          prices: { EMUER: record.facts.priceEmuer },
          stock: record.facts.stockAvailable,
          sold: 0,
          reserved: 0,
          orderDeadlineMs: record.facts.deadlineMs,
        };
      }
      const collection = domain === "quest" ? "sp_quests" : "mitemiru_products";
      const existing = await f.db.collection(collection).get();
      for (const d of existing.docs) await d.ref.delete();
      await f.db.collection(collection).doc(id).set(raw);
      const source =
        await f.economy.service.sources.cross.adapters[domain].get(id);
      assert.equal(
        hash([source.title, source.summary]),
        record.contentHash,
        "EXACT_REVIEWED_PUBLIC_TEXT_ONLY",
      );
      await f.economy.service
        .ref("source_approvals", hash(source.key))
        .set({
          purpose: require("../../backend/economy/search/profile").PURPOSE,
          piiReviewed: true,
          aiUseApproved: true,
          rightsVerified: true,
          authorPermissionConfirmed: true,
          contentHash: record.contentHash,
          originHash: source.originHash,
          validUntilMs: Date.now() + 86400000,
          artifactUseApproved: true,
          artifactPurpose: VERSION,
          artifactAllowedTasks: Object.keys(TASKS),
        });
      for (const d of ["GUILD", "SERVICE", "QUEST", "CITY"])
        f.env["ECONOMY_SOURCE_" + d] = "false";
      f.env["ECONOMY_SOURCE_" + domain.toUpperCase()] = "true";
      allowed.length = 0;
      allowed.push([source.title, source.summary]);
      evidence.corpus =
        "repository text matched to reviewed current official public-source snapshot; private operator identifiers replaced by local test identifiers";
    }
    const q = await f.call(role, "POST", "/quotes", {
      goal:
        type === "city_comparison"
          ? "EMUERで商品と体験を比較する準備をしたい"
          : "Web3を学んでクエストとギルドの活動を準備したい",
      taskType: type,
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
    const j = await f.call(role, "POST", "/jobs", b);
    assert.equal(j.status, 200);
    await f.economy.tick();
    const done = await f.call(role, "GET", "/jobs/" + j.body.job.id);
    assert.equal(
      done.body.job.state,
      "completed",
      JSON.stringify({
        state: done.body.job.state,
        error: done.body.job.error,
      }),
    );
    const a = await f.call(role, "GET", "/artifacts/" + j.body.job.id);
    assert.equal(a.status, 200);
    assert.ok(a.body.artifact.content);
    const edit = await f.call(role, "POST", "/artifacts/" + j.body.job.id, {
      editConsent: true,
      revision: 1,
      title: "本人が確認した準備用の計画",
      content: a.body.artifact.content + "\n自分で確認する項目を追加します。",
    });
    assert.equal(edit.status, 200);
    assert.equal(edit.body.artifact.revision, 2);
    const replay = await f.call(role, "POST", "/jobs", b);
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
