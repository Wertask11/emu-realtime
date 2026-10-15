"use strict";
// Controlled vector mocks test retrieval/privacy. Actual Gemini meaning quality requires a separate live API run.
const { test, before, after } = require("node:test"),
  assert = require("node:assert/strict");
const { createFixture } = require("./fixture.cjs");
const {
  pack,
  unpack,
  cosine,
} = require("../../backend/knowledge-lab/semantic");
let f,
  alice,
  owner,
  ids = [],
  calls = 0;
const actor = (role) => ({
  ...f.users[role],
  walletAddress: f.users[role].account.walletAddress.toLowerCase(),
  owner: role === "owner",
});
const vector = (n = 0) =>
  Array.from({ length: 768 }, (_, i) => (i === n ? 1 : 0));
const response = (d) => new Response(JSON.stringify(d), { status: 200 });
async function mock(url, opts) {
  if (opts.method === "GET")
    return response({
      models: [
        {
          name: "models/gemini-test-flash",
          supportedGenerationMethods: ["generateContent"],
        },
        {
          name: "models/gemini-embedding-001",
          supportedGenerationMethods: ["embedContent"],
        },
      ],
    });
  calls++;
  const input = JSON.parse(opts.body);
  if (url.endsWith(":batchEmbedContents"))
    return response({
      embeddings: input.requests.map((r, i) => ({ values: vector(i) })),
    });
  return response({ embedding: { values: vector(0) } });
}
before(async () => {
  f = await createFixture({
    aiEnv: {
      GEMINI_API_KEY: "emulator-only-key",
      GEMINI_FREE_TIER_CONFIRMED: "true",
      KNOWLEDGE_LAB_AI_ENABLED: "true",
    },
    aiFetcher: mock,
  });
  alice = actor("alice");
  owner = actor("owner");
  await f.call("PUT", "/admin/ai", "owner", {
    model: "gemini-test-flash",
    embeddingModel: "gemini-embedding-001",
    freeTierAttested: true,
  });
  for (const [i, title] of [
    "開業資金の工夫",
    "学校で試した授業法",
    "秘密の実践",
    "未同意の一般知識",
  ].entries()) {
    ids.push(
      (
        await f.api.service.savePost(alice, {
          key: "semantic-source-" + i,
          title,
          body: "検証環境だけの本文。誰かの実データではありません。",
          visibility: i === 2 ? "private" : "public",
          aiUseConsent: i !== 3,
          facets: { field: ["field-business"] },
        })
      ).id,
    );
  }
  await f.api.service.rebuild(owner);
  await f.api.service.waitForRebuild();
});
after(async () => {
  await f?.close();
});
test("normalized quantized vectors retain cosine similarity without fake keyword expansion", () => {
  const v = Array.from({ length: 768 }, (_, i) => Math.sin(i));
  const a = unpack(pack(v));
  assert.ok(Math.abs(cosine(a, a) - 1) < 0.00001);
  assert.throws(() => pack([1, 2]), /EMBEDDING_INVALID_OUTPUT/);
});
test("private and non-consenting posts are excluded before external embeddings; indexing is Owner-only", async () => {
  assert.equal(
    (await f.call("POST", "/admin/semantic-index", "alice", {})).status,
    403,
  );
  const s = await f.call("POST", "/admin/semantic-seed", "owner", {});
  assert.equal(s.status, 200);
  const index = await f.call("POST", "/admin/semantic-index", "owner", {});
  assert.equal(index.status, 200);
  assert.equal(index.body.processed, 2);
  assert.equal(calls, 1);
  const vec = await f.db.collection("knowledge_lab_vectors").get();
  assert.equal(vec.size, 2);
  assert.ok(vec.docs.every((d) => ids.slice(0, 2).includes(d.id)));
});
test("semantic search requires actual user consent, ranks mock embeddings, returns provenance and caches queries", async () => {
  const path =
    "/search?mode=semantic&sort=relevance&q=" +
    encodeURIComponent("会社を辞めて独立したい");
  assert.equal((await f.call("GET", path, "alice")).status, 403);
  const out = await f.call("GET", path + "&externalAIConsent=true", "alice");
  assert.equal(out.status, 200);
  assert.equal(out.body.items.length, 2);
  assert.equal(out.body.items[0].searchEvidence.method, "meaning");
  assert.equal(out.body.items[0].searchEvidence.model, "gemini-embedding-001");
  const before = calls;
  await f.call("GET", path + "&externalAIConsent=true", "alice");
  assert.equal(calls, before);
});
test("stale vector never returns edited canonical content until it is re-embedded", async () => {
  const first = (await f.db.collection("knowledge_lab_vectors").get()).docs[0]
      .id,
    p = (await f.call("GET", "/posts/" + first, "alice")).body;
  await f.api.service.savePost(alice, {
    key: "semantic-change",
    id: first,
    revision: p.revision,
    title: p.title,
    body: "編集された後の新しい内容",
    facets: p.facets,
    visibility: "public",
    aiUseConsent: true,
  });
  const out = await f.call(
    "GET",
    "/search?mode=semantic&sort=relevance&q=意味&externalAIConsent=true",
    "alice",
  );
  assert.ok(!out.body.items.some((p) => p.id === first));
  assert.equal(
    (await f.api.service.ref("semantic_queue", first).get()).exists,
    true,
  );
});
test("background index maintenance processes an actual changed queue and respects the Owner stop without creating identities", async () => {
  const result = await f.api.semantic.maintenance();
  assert.equal(result.processed, 1);
  assert.equal(
    (await f.db.collection("knowledge_lab_semantic_queue").get()).size,
    0,
  );
  await f.call("PUT", "/admin/ai", "owner", { stopped: true });
  const before = calls;
  assert.equal((await f.api.semantic.maintenance()).stopped, true);
  assert.equal(calls, before);
  assert.equal((await f.db.collection("sp_stars").get()).size, 0);
  await f.call("PUT", "/admin/ai", "owner", {
    model: "gemini-test-flash",
    embeddingModel: "gemini-embedding-001",
    freeTierAttested: true,
  });
});
test("consent revocation removes vectors and excludes old cached corpus before query results", async () => {
  for (const id of ids.slice(0, 2)) {
    const p = (await f.call("GET", "/posts/" + id, "alice")).body;
    await f.api.service.savePost(alice, {
      key: "semantic-revoke-" + id,
      id,
      revision: p.revision,
      title: p.title,
      body: p.body,
      facets: p.facets,
      visibility: "public",
      aiUseConsent: false,
    });
  }
  assert.equal((await f.db.collection("knowledge_lab_vectors").get()).size, 0);
  const out = await f.call(
    "GET",
    "/search?mode=semantic&sort=relevance&q=意味&externalAIConsent=true",
    "alice",
  );
  assert.equal(out.status, 200);
  assert.equal(out.body.items.length, 0);
  assert.equal(out.body.reason, "NO_CONSENTED_EMBEDDINGS");
});
test("verification, classification, moderation and archive keep semantic queue and visibility in sync", async () => {
  const source = await f.api.service.savePost(alice, {
    key: "queue-lifecycle",
    title: "索引更新の検証",
    body: "保存した公開知識の分類と公開範囲をエミュレーターで確認した記録です。",
    visibility: "public",
    aiUseConsent: true,
    facets: { field: ["field-business"] },
  });
  await f.api.semantic.maintenance();
  let p = (await f.call("GET", "/posts/" + source.id, "alice")).body;
  assert.equal(
    (
      await f.call("POST", "/admin/verify/" + source.id, "owner", {
        revision: p.revision,
        summary: "検証環境で確認した範囲",
        evidence:
          "これはエミュレーターの検証記録です。本番で第三者確認した記録ではありません。",
        reviewed: true,
      })
    ).status,
    200,
  );
  assert.equal(
    (await f.api.service.ref("semantic_queue", source.id).get()).exists,
    true,
  );
  p = (await f.call("GET", "/posts/" + source.id, "alice")).body;
  assert.equal(
    (
      await f.call("POST", "/admin/classify/" + source.id, "owner", {
        revision: p.revision,
        facets: { field: ["field-business"] },
        reason: "既存分類の再確認",
      })
    ).status,
    200,
  );
  for (const action of ["feature", "hide", "restore"]) {
    p = (await f.call("GET", "/posts/" + source.id, "owner")).body;
    assert.equal(
      (
        await f.call("POST", "/admin/posts/" + source.id, "owner", {
          action,
          revision: p.revision,
          reason: "検証環境内の公開状態確認",
        })
      ).status,
      200,
    );
    assert.equal(
      (await f.api.service.ref("semantic_queue", source.id).get()).exists,
      action !== "hide",
    );
    if (action === "hide")
      assert.equal(
        (await f.api.service.ref("vectors", source.id).get()).exists,
        false,
      );
  }
  await f.api.semantic.maintenance();
  p = (await f.call("GET", "/posts/" + source.id, "alice")).body;
  assert.equal(
    (
      await f.call("POST", "/posts/" + source.id + "/archive", "alice", {
        revision: p.revision,
      })
    ).status,
    200,
  );
  assert.equal(
    (await f.api.service.ref("vectors", source.id).get()).exists,
    false,
  );
  assert.equal(
    (await f.api.service.ref("semantic_queue", source.id).get()).exists,
    false,
  );
});
