"use strict";
// Explicit live-provider verification. Never part of the mock regression suite.
// Uses only local emulator accounts/documents and clearly labelled synthetic examples.
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
async function main() {
  if (!process.env.GEMINI_API_KEY) throw Error("GEMINI_SECRET_REQUIRED");
  if (process.env.GEMINI_FREE_TIER_CONFIRMED !== "true")
    throw Error("FREE_TIER_CONFIRMATION_REQUIRED");
  const env = {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GEMINI_FREE_TIER_CONFIRMED: "true",
    KNOWLEDGE_LAB_AI_ENABLED: "true",
  };
  const provider = require("../../backend/knowledge-lab/gemini").createGemini({
    env,
  });
  const models = await provider.models();
  if (process.argv.includes("--list-models")) {
    console.log(JSON.stringify({ provider: "live Gemini", models }, null, 2));
    return;
  }
  const model = process.env.GEMINI_ANALYSIS_MODEL;
  if (!model) throw Error("SELECT_AN_ACTUAL_FREE_TIER_MODEL_FIRST");
  await provider.checkModel(model, "generateContent");
  await provider.checkModel("gemini-embedding-001", "embedContent");
  const { createFixture } = require("./fixture.cjs");
  const role = process.env.LAB_LIVE_ACTOR || "alice";
  if (!["alice", "bob"].includes(role)) throw Error("LOCAL_ACTOR_REQUIRED");
  const f = await createFixture({
    aiEnv: env,
    // Never erase live-call receipts or daily limits when rerunning this driver.
    reset: false,
  });
  f.api.close(); // Disable the background worker; this run has an explicit bounded call count.
  const invoke = async (method, route, role, input) => {
    const r = await f.call(method, route, role, input);
    if (r.status !== 200) throw Error(r.body.error || "LIVE_CHECK_FAILED");
    return r.body;
  };
  try {
    await invoke("PUT", "/admin/ai", "owner", {
      model,
      embeddingModel: "gemini-embedding-001",
      freeTierAttested: true,
    });
    const examples = [
      [
        "開業資金を分ける",
        "勤め先を離れ個人事業主として開業する前に、生活費と設備費を別々に積み立てた。最初の顧客から代金を受け取るまでの期間を長めに見積もった。",
        "field-business",
      ],
      [
        "少人数で授業の準備を試す",
        "全員に教える前に、少人数で教材を試した。分かりにくい手順を見つけて説明を短くし、初回に必要な準備を減らした。",
        "field-education",
      ],
      [
        "パン生地の温度を記録する",
        "生地を仕込んだときの室温と発酵時間を記録し、焼き上がりを比べた。暖かい日は発酵が早かった。",
        "field-business",
      ],
    ];
    const ids = [];
    for (const [i, [title, body, field]] of examples.entries()) {
      const p = await invoke("PUT", "/posts", "alice", {
        key: "live-api-source-" + i,
        title: "LOCAL API検証用・架空ケース：" + title,
        body:
          "これはローカルAPI検証用の架空ケースです。実在ユーザーの経験や検証結果ではありません。\n" +
          body,
        visibility: "public",
        aiUseConsent: true,
        facets: { field: [field] },
      });
      ids.push(p.id);
    }
    const owner = { ...f.users.owner, owner: true };
    await f.api.service.rebuild(owner);
    await f.api.service.waitForRebuild();
    const input = {
      sourceIds: ids.slice(0, 2),
      fields: ["field-business", "field-education"],
      externalAIConsent: true,
    };
    const run = await invoke("POST", "/ai/analyze", role, input);
    assert.equal(run.origin, "ai-hypothesis");
    assert.equal(run.verification, "unverified");
    assert.equal(run.model, model);
    const noteInput = {
      key: "live-api-note",
      title: "LOCAL 実Gemini分析の保存検証",
      ...input,
      visibility: "private",
      aiRunId: run.id,
      hypothesis: "実API出力の保存を確認する。現実で検証した仮説ではない。",
    };
    const saved = await invoke("PUT", "/notes", role, noteInput);
    const note = await invoke("GET", "/notes/" + saved.id, role);
    assert.deepEqual(note.aiAnalysis, run.analysis);
    await invoke("PUT", "/notes", role, {
      ...noteInput,
      key: "live-api-note-edit",
      id: saved.id,
      revision: 1,
      result:
        "APIから受け取った未検証の分析をエミュレーターに保存し、読み戻した。",
    });
    const history = await invoke(
      "GET",
      "/notes/" + saved.id + "/history",
      role,
    );
    await invoke("POST", "/admin/semantic-seed", "owner", {});
    const indexing = await invoke("POST", "/admin/semantic-index", "owner", {});
    const vectors = await f.db.getAll(
      ...ids.map((id) => f.api.service.ref("vectors", id)),
    );
    // A repeat may reuse already indexed sources without another embedding call.
    assert.ok(
      vectors.every(
        (v) => v.exists && v.data().model === "gemini-embedding-001",
      ),
    );
    const query = "会社を辞めて独立したい";
    const search = await invoke(
      "GET",
      "/search?mode=semantic&sort=relevance&externalAIConsent=true&q=" +
        encodeURIComponent(query),
      role,
    );
    assert.equal(search.items[0]?.id || search.items[0]?.postId, ids[0]);
    assert.equal(search.items[0].searchEvidence.method, "meaning");
    const dir = path.resolve(
      process.env.LAB_LIVE_OUTPUT ||
        "/workspace/outputs/knowledge-lab-completion/live-gemini",
    );
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "results.json"),
      JSON.stringify(
        {
          checkedAt: new Date().toISOString(),
          environment: "local Auth/Firestore emulators + live Gemini",
          productionWrites: false,
          localActor: role,
          emulatorDataAndQuotasPreserved: true,
          examples:
            "explicitly labelled synthetic cases, not real user experiences",
          model,
          embeddingModel: "gemini-embedding-001",
          sourceIds: ids,
          run,
          savedNoteId: saved.id,
          history,
          indexing,
          query,
          search,
          evidenceLimit:
            "Live protocol/citation/persistence and this Japanese retrieval example only; not Production acceptance or broad semantic quality proof",
        },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify({
        provider: "live Gemini",
        result: "PASS",
        productionWrites: false,
        model,
        output: dir,
      }),
    );
  } finally {
    await f.close();
  }
}
main().catch((e) => {
  // Never print raw provider errors, request headers, keys or payloads.
  const code = /^[A-Z][A-Z0-9_]+$/.test(e.message)
    ? e.message
    : "LIVE_CHECK_FAILED";
  console.error(JSON.stringify({ result: "NOT VERIFIED", code }));
  process.exitCode = 1;
});
