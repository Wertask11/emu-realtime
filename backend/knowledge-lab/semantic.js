"use strict";
const m = require("./model"),
  { containsSensitiveText } = require("./gemini");
const DIM = 768,
  MAX = 20000;
function sourceHash(p) {
  return m.hash([
    p.title,
    p.body,
    m.millis(p.updatedAt || p.createdAt),
    p.knowledgeLab?.revision,
  ]);
}
function pack(values) {
  if (
    !Array.isArray(values) ||
    values.length !== DIM ||
    values.some((v) => !Number.isFinite(v))
  )
    m.fail("EMBEDDING_INVALID_OUTPUT", 502);
  const norm = Math.hypot(...values);
  if (!norm) m.fail("EMBEDDING_INVALID_OUTPUT", 502);
  const b = Buffer.alloc(DIM * 2);
  values.forEach((v, i) =>
    b.writeInt16LE(Math.round((v / norm) * 32767), i * 2),
  );
  return b.toString("base64");
}
function unpack(value) {
  const b = Buffer.from(value, "base64");
  if (b.length !== DIM * 2) m.fail("EMBEDDING_INVALID_STORED_VECTOR", 503);
  const v = Float32Array.from(
      { length: DIM },
      (_, i) => b.readInt16LE(i * 2) / 32767,
    ),
    norm = Math.hypot(...v);
  if (!norm) m.fail("EMBEDDING_INVALID_STORED_VECTOR", 503);
  return v.map((x) => x / norm);
}
function cosine(a, b) {
  return a.reduce((n, v, i) => n + v * b[i], 0);
}
function eligible(p) {
  return m.publicPost(p) && p.knowledgeLab?.aiUseConsent?.allowed === true;
}
function createSemantic({ db, service, ai, now = Date.now }) {
  let cache = null,
    until = 0;
  function enqueue(tx, id, p) {
    if (eligible(p)) {
      tx.set(service.ref("semantic_queue", id), {
        postId: id,
        hash: sourceHash(p),
        queuedAtMs: now(),
      });
    } else {
      tx.delete(service.ref("vectors", id));
      tx.delete(service.ref("semantic_queue", id));
    }
    until = 0;
  }
  async function load(model) {
    if (cache?.model === model && until > now()) return cache.items;
    const result = [];
    let after = null;
    for (;;) {
      let q = db
        .collection("knowledge_lab_vectors")
        .orderBy("__name__")
        .limit(128);
      if (after) q = q.startAfter(after);
      const s = await q.get();
      for (const d of s.docs) {
        const row = d.data();
        if (row.model === model)
          result.push({ id: d.id, ...row, decoded: unpack(row.vector) });
      }
      if (result.length > MAX) m.fail("SEARCH_CAPACITY_REACHED", 503);
      if (s.size < 128) break;
      after = s.docs.at(-1);
    }
    cache = { model, items: result };
    until = now() + 60000;
    return result;
  }
  async function seedPage(a, cursor = null) {
    if (!a.owner) m.fail("OWNER_ONLY", 403);
    let q = db.collection("posts").orderBy("__name__").limit(25);
    if (cursor) q = q.startAfter(m.id(cursor));
    const s = await q.get();
    let queued = 0,
      skipped = 0;
    for (const doc of s.docs) {
      await db.runTransaction(async (tx) => {
        const [p, v] = await Promise.all([
          tx.get(doc.ref),
          tx.get(service.ref("vectors", doc.id)),
        ]);
        if (!p.exists) return;
        if (eligible(p.data())) {
          const conf = await ai.settings();
          if (
            !v.exists ||
            v.data().hash !== sourceHash(p.data()) ||
            v.data().model !== conf.embeddingModel
          ) {
            enqueue(tx, doc.id, p.data());
            queued++;
          }
        } else {
          enqueue(tx, doc.id, p.data());
          skipped++;
        }
      });
    }
    return { queued, skipped, next: s.size === 25 ? s.docs.at(-1).id : null };
  }
  async function indexPage(a) {
    if (!a.owner) m.fail("OWNER_ONLY", 403);
    return drain(a);
  }
  async function maintenance() {
    if (!(await ai.status()).semanticAvailable)
      return { processed: 0, stopped: true };
    // Infrastructure budget bucket, never an Auth user or a Passport claim.
    // Only author-consenting public sources enter this queue; no activity or rewards are created.
    return drain({ spid: "internal-public-indexer" });
  }
  async function drain(a) {
    const config = await ai.requireEnabled("embedding"),
      queue = await db
        .collection("knowledge_lab_semantic_queue")
        .orderBy("__name__")
        .limit(8)
        .get();
    if (queue.empty) return { processed: 0, remaining: 0 };
    const sources = [];
    for (const d of queue.docs) {
      const s = await db.collection("posts").doc(d.id).get();
      if (!s.exists || !eligible(s.data())) {
        await d.ref.delete();
        await service.ref("vectors", d.id).delete();
        continue;
      }
      const p = s.data(),
        text =
          String(p.title || "") + "\n" + String(p.body || "").slice(0, 3800);
      if (containsSensitiveText(text)) {
        await service
          .ref("semantic_errors", d.id)
          .set({ code: "sensitive-input", updatedAtMs: now() });
        await d.ref.delete();
        continue;
      }
      sources.push({ id: d.id, text, hash: sourceHash(p) });
    }
    if (!sources.length) return { processed: 0, blocked: queue.size };
    const result = await ai.budget.call(a, "embedding", () =>
      ai.provider.embedMany(
        config.embeddingModel,
        sources.map((s) => s.text),
      ),
    );
    let processed = 0;
    for (let i = 0; i < sources.length; i++) {
      const item = sources[i];
      await db.runTransaction(async (tx) => {
        const s = await tx.get(db.collection("posts").doc(item.id));
        if (
          !s.exists ||
          !eligible(s.data()) ||
          sourceHash(s.data()) !== item.hash
        )
          return;
        tx.set(service.ref("vectors", item.id), {
          model: config.embeddingModel,
          hash: item.hash,
          vector: pack(result.vectors[i]),
          indexedAtMs: now(),
        });
        tx.delete(service.ref("semantic_queue", item.id));
        processed++;
      });
    }
    until = 0;
    return {
      processed,
      remaining: (
        await db.collection("knowledge_lab_semantic_queue").count().get()
      ).data().count,
    };
  }
  async function search(q, a) {
    if (!a) m.fail("AUTH_REQUIRED", 401);
    const config = await ai.requireEnabled("embedding");
    if (q.sort && q.sort !== "relevance")
      m.fail("SEMANTIC_SORT_RELEVANCE_ONLY");
    if (q.externalAIConsent !== "true")
      m.fail("AI_REQUEST_CONSENT_REQUIRED", 403);
    const params = m.searchParams(q);
    if (!params.q) m.fail("SEMANTIC_QUERY_REQUIRED");
    const plan = await service.readerPlan(a);
    const all = await service.catalog(),
      scope = plan.guest
        ? [...all]
            .filter((p) => p.active)
            .sort(
              (x, y) =>
                y.createdAtMs - x.createdAtMs ||
                x.postId.localeCompare(y.postId),
            )
            .slice(0, 20)
        : all;
    const terms = await service.taxonomy(),
      filtered = m.select(scope, { ...params, q: "", sort: "new" }, terms),
      allowed = new Map(filtered.map((v) => [v.postId, v]));
    const vectors = (await load(config.embeddingModel)).filter((v) =>
      allowed.has(v.id),
    );
    if (!vectors.length)
      return {
        items: [],
        next: null,
        indexedMatches: 0,
        searchMethod: "gemini-embedding-cosine",
        semanticCoverage: 0,
        reason: "NO_CONSENTED_EMBEDDINGS",
        guestCapped: plan.guest && all.length > 20,
      };
    const queryId = m.hash([a.spid, config.embeddingModel, params.q]),
      queryRef = service.ref("query_vectors", queryId),
      previous = await queryRef.get();
    let vector;
    if (previous.exists && now() - previous.data().createdAtMs < 86400000) {
      vector = unpack(previous.data().vector);
      await ai.budget.cacheHit();
    } else {
      const out = await ai.budget.call(a, "embedding", () =>
        ai.provider.embed(config.embeddingModel, params.q),
      );
      vector = unpack(pack(out.vector));
      await queryRef.set({
        vector: pack(out.vector),
        model: config.embeddingModel,
        authorSchoolParkId: a.spid,
        createdAtMs: now(),
      });
    }
    const rows = vectors
      .map((v) => ({ ...v, similarity: cosine(vector, v.decoded) }))
      .sort((x, y) => y.similarity - x.similarity || x.id.localeCompare(y.id));
    const fp = m.hash(params),
      version = m.hash(rows.map((v) => [v.id, v.hash]));
    let offset = 0;
    if (q.cursor) {
      const c = m.parseCursor(q.cursor);
      if (c.q !== fp || c.v !== version) m.fail("SEARCH_CHANGED", 409);
      offset = rows.findIndex((v) => v.id === c.after) + 1;
      if (!offset) m.fail("INVALID_CURSOR");
    }
    const items = [];
    let scanned = offset;
    while (scanned < rows.length && items.length < 20) {
      const portion = rows.slice(scanned, scanned + 20 - items.length),
        posts = await db.getAll(
          ...portion.map((v) => db.collection("posts").doc(v.id)),
        );
      for (let i = 0; i < posts.length; i++) {
        scanned++;
        const s = posts[i],
          v = portion[i];
        if (
          !s.exists ||
          !eligible(s.data()) ||
          sourceHash(s.data()) !== v.hash ||
          !m.select(
            [m.indexPost(s.id, s.data())],
            { ...params, q: "", sort: "new" },
            terms,
          ).length
        )
          continue;
        items.push({
          ...m.safePost(s.id, await service.publicProof(s.id, s.data()), a),
          searchEvidence: {
            method: "meaning",
            similarity: Math.round(v.similarity * 1000) / 1000,
            model: config.embeddingModel,
            excerpt: String(s.data().body || "").slice(0, 150),
            indexedAtMs: v.indexedAtMs,
          },
          savedCount: allowed.get(v.id).savedCount || 0,
        });
      }
    }
    return {
      items,
      next:
        scanned < rows.length
          ? m.cursor({ q: fp, v: version, after: rows[scanned - 1].id })
          : null,
      indexedMatches: rows.length,
      searchMethod: "gemini-embedding-cosine",
      semanticCoverage: vectors.length,
      guestCapped: plan.guest && all.length > 20,
      guestLimit: plan.guest ? 20 : null,
    };
  }
  return { enqueue, seedPage, indexPage, search, maintenance };
}
module.exports = { createSemantic, pack, unpack, cosine, sourceHash, eligible };
