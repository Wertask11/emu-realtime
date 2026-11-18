"use strict";
const m = require("./model"),
  {
    createGemini,
    makeSources,
    MODEL_ID,
    containsSensitiveText,
  } = require("./gemini"),
  { createBudget, CAPS } = require("./ai-budget");
function createAI({
  db,
  service,
  env = process.env,
  fetcher = fetch,
  now = Date.now,
}) {
  const provider = createGemini({ env, fetcher, now }),
    budget = createBudget({ db, ref: service.ref, now });
  const control = () => service.ref("system", "ai-control");
  async function settings() {
    const s = await control().get();
    return (
      s.data() || {
        stopped: true,
        freeTierAttested: false,
        model: null,
        embeddingModel: null,
      }
    );
  }
  async function status() {
    const c = await settings();
    return {
      available:
        provider.enabled() &&
        c.stopped === false &&
        c.freeTierAttested === true &&
        !!c.model,
      semanticAvailable:
        provider.enabled() &&
        c.stopped === false &&
        c.freeTierAttested === true &&
        !!c.embeddingModel,
      configured: provider.configured(),
      environmentEnabled: env.KNOWLEDGE_LAB_AI_ENABLED === "true",
      stopped: c.stopped !== false,
      model: c.model || null,
      embeddingModel: c.embeddingModel || null,
      caps: CAPS,
    };
  }
  async function requireEnabled(kind = "analysis") {
    const s = await status();
    if (!(kind === "analysis" ? s.available : s.semanticAvailable))
      m.fail("AI_DISABLED", 503);
    return settings();
  }
  async function configure(a, input) {
    if (!a.owner) m.fail("OWNER_ONLY", 403);
    const c = await settings();
    if (input.stopped === true) {
      await control().set({
        ...c,
        stopped: true,
        updatedAtMs: now(),
        actorSchoolParkId: a.spid,
      });
      return status();
    }
    if (input.freeTierAttested !== true)
      m.fail("AI_FREE_TIER_CONFIRMATION_REQUIRED", 403);
    const model = m.text(input.model, 100, true),
      embeddingModel = m.text(input.embeddingModel || "", 100);
    if (!MODEL_ID.test(model)) m.fail("AI_INVALID_MODEL");
    await provider.checkModel(model, "generateContent");
    // Text-only Embedding 1 protocol is documented and includes retrieval task types.
    // Embedding 2 has a different task-instruction protocol; do not claim it works here.
    if (embeddingModel && embeddingModel !== "gemini-embedding-001")
      m.fail("AI_EMBEDDING_MODEL_UNSUPPORTED");
    if (embeddingModel)
      await provider.checkModel(embeddingModel, "embedContent");
    const limits = {};
    for (const kind of ["analysis", "embedding"]) {
      const n = input[kind + "DailyLimit"] ?? CAPS[kind];
      if (!Number.isInteger(n) || n < 1 || n > CAPS[kind])
        m.fail("AI_LIMIT_INVALID");
      limits[kind + "DailyLimit"] = n;
    }
    await control().set({
      model,
      embeddingModel: embeddingModel || null,
      stopped: false,
      freeTierAttested: true,
      freeTierAttestedAtMs: now(),
      actorSchoolParkId: a.spid,
      ...limits,
      updatedAtMs: now(),
    });
    return status();
  }
  async function sources(a, ids) {
    const posts = await Promise.all(
      ids.map(async (id) => ({ id, ...(await service.rawPost(id, a)) })),
    );
    return makeSources(posts, now());
  }
  /* ───── 掛け合わせ（11/18 オーナー）─────
     メインの知識1つに、最大4つを掛け合わせる。材料は、公開されていて書き手が AI の利用に同意した知識と、
     Knowledge Text の教材（運営が載せたもの。room1_contents。ID は「kt_」＋記録の ID）。
     回数は1人1日3回（ai-budget の perPassportAnalysis。同じ組み合わせの2回目は数えない）。 */
  const KT = /^kt_([A-Za-z0-9]{1,90})$/;
  const plain = (v) => String(v || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/[ \t]+/g, " ").trim();
  async function textMaterial(id) {
    const hit = KT.exec(id);
    if (!hit) m.fail("INVALID_ID");
    const s = await db.collection("room1_contents").doc(hit[1]).get();
    if (!s.exists || typeof s.data().body !== "string" || !plain(s.data().body)) m.fail("NOT_FOUND", 404);
    const d = s.data();
    return {
      id,
      title: plain(d.summary || d.subSubTheme || d.subTheme || d.title || "Knowledge Text").slice(0, 160) || "Knowledge Text",
      body: plain(d.body),
      displayName: "Knowledge Text",
      knowledgeText: true,
      theme: String(d.theme || ""),
      subTheme: String(d.subTheme || ""),
      updatedAt: d.updatedAt || d.createdAt || "",
    };
  }
  async function mixSources(a, ids) {
    if (ids.length < 2 || ids.length > 5) m.fail("AI_SOURCE_COUNT");
    // 1回に送る量（12,000字）を超えないよう、1つあたりの本文を等しく切る
    const per = Math.max(400, Math.floor(11000 / ids.length) - 160);
    const out = [];
    for (const id of ids) {
      const raw = KT.test(id) ? await textMaterial(id) : { id, ...(await service.rawPost(id, a)) };
      if (!raw.knowledgeText && (!m.publicPost(raw) || raw.knowledgeLab?.aiUseConsent?.allowed !== true))
        m.fail("AI_SOURCE_CONSENT_REQUIRED", 403);
      const fullBody = raw.knowledgeText ? raw.body : String(raw.body || "");
      const title = m.text(String(raw.title || "").slice(0, 160) || "（題名なし）", 160, true),
        body = m.text(fullBody.slice(0, per) || title, per, true);
      if (containsSensitiveText(title + "\n" + body)) m.fail("AI_SENSITIVE_SOURCE", 403);
      out.push({
        id,
        title,
        body,
        kind: raw.knowledgeText ? "knowledge-text" : "post",
        authorSchoolParkId: raw.knowledgeText ? null : raw.authorSchoolParkId || null,
        displayName: raw.knowledgeText ? "Knowledge Text" : String(raw.displayName || "Emuer"),
        revision: raw.knowledgeText ? 0 : raw.knowledgeLab?.revision || 0,
        hash: m.hash(raw.knowledgeText
          ? [raw.title, raw.body, raw.updatedAt]
          : [raw.title, raw.body, raw.updatedAt, raw.knowledgeLab?.revision]),
        atMs: now(),
        visibility: "public",
        inputCharacters: body.length,
        totalCharacters: fullBody.length,
        truncated: fullBody.length > body.length,
      });
    }
    return out;
  }
  async function mix(a, input) {
    const config = await requireEnabled();
    if (input.externalAIConsent !== true) m.fail("AI_REQUEST_CONSENT_REQUIRED", 403);
    const mainId = m.id(input.mainId);
    const others = m.list(input.otherIds, 4).filter((id) => id !== mainId);
    if (!others.length) m.fail("AI_SOURCE_COUNT");
    const ids = [mainId, ...others];
    const src = await mixSources(a, ids);
    const cacheId = m.hash([a.spid, src.map((s) => [s.id, s.hash]), config.model, "mix-v1"]),
      cacheRef = service.ref("ai_cache", cacheId),
      previous = await cacheRef.get();
    if (previous.exists && previous.data().state === "complete" && now() - previous.data().createdAtMs < 86400000) {
      await budget.cacheHit();
      return { ...(await get(a, previous.data().runId)), cacheHit: true, quota: await budget.usage(a) };
    }
    const lease = m.hash([cacheId, now(), Math.random()]),
      id = m.hash([cacheId, input.key ? m.id(input.key) : lease]),
      r = service.ref("ai_runs", id);
    const existing = await r.get();
    if (existing.exists && existing.data().state === "complete")
      return { ...(await current(a, { id, ...existing.data() })), cacheHit: true, quota: await budget.usage(a) };
    await db.runTransaction(async (tx) => {
      const s = await tx.get(cacheRef);
      if (s.data()?.state === "generating" && s.data()?.leaseUntil > now()) m.fail("AI_BUSY", 429);
      tx.set(cacheRef, { state: "generating", lease, leaseUntil: now() + 60000, authorSchoolParkId: a.spid, createdAtMs: now() });
    });
    try {
      const result = await budget.call(
        a,
        "analysis",
        () => provider.analyze(config.model, [], src, { mainSourceId: mainId }),
        budget.estimateAnalysis(src.flatMap((p) => [p.title, p.body])),
      );
      const latest = await mixSources(a, ids);
      if (latest.some((p, i) => p.hash !== src[i].hash)) m.fail("AI_SOURCES_CHANGED", 409);
      const value = {
        state: "complete",
        mode: "mix",
        mainId,
        authorSchoolParkId: a.spid,
        fields: [],
        fieldLabels: [],
        sources: src.map(({ body, ...s }) => s),
        analysis: result.analysis,
        model: result.model,
        resolvedModel: result.resolvedModel || null,
        usage: result.usage,
        createdAtMs: now(),
        origin: "ai-hypothesis",
        verification: "unverified",
        consentAtMs: now(),
        provider: "gemini",
        costStatus: "free-project-attested",
        estimatedCharge: 0,
      };
      await db.runTransaction(async (tx) => {
        const c = await tx.get(cacheRef);
        if (c.data()?.lease !== lease) m.fail("AI_BUSY", 429);
        tx.create(r, value);
        tx.set(cacheRef, { state: "complete", runId: id, createdAtMs: now(), authorSchoolParkId: a.spid });
      });
      return { id, ...value, cacheHit: false, quota: await budget.usage(a) };
    } catch (e) {
      await db.runTransaction(async (tx) => {
        const s = await tx.get(cacheRef);
        if (s.data()?.lease === lease) {
          if (previous.exists) tx.set(cacheRef, previous.data());
          else tx.delete(cacheRef);
        }
      });
      throw e;
    }
  }
  async function mixQuota(a) {
    const [st, use] = await Promise.all([status(), budget.usage(a)]);
    return { available: st.available, ...use };
  }
  /* 掛け合わせの材料にできる Knowledge Text の教材の一覧（本文の頭だけ）。誰でも読める（Knowledge Text と同じ） */
  let textsCache = null, textsAt = 0;
  async function texts() {
    if (textsCache && now() - textsAt < 600000) return textsCache;
    const snap = await db.collection("room1_contents").get();
    textsCache = snap.docs
      .filter((d) => typeof d.data().body === "string" && d.data().body.trim())
      .map((d) => {
        const v = d.data();
        return {
          id: "kt_" + d.id,
          title: plain(v.summary || v.subSubTheme || v.subTheme || v.title || "Knowledge Text").slice(0, 160),
          theme: String(v.theme || ""),
          subTheme: String(v.subTheme || ""),
          subSubTheme: String(v.subSubTheme || ""),
          excerpt: plain(v.body).slice(0, 160),
          createdAt: String(v.createdAt || ""),
        };
      })
      .filter((t) => KT.test(t.id))
      .sort((x, y) => x.createdAt.localeCompare(y.createdAt));
    textsAt = now();
    return textsCache;
  }
  async function current(a, run) {
    if (run.mode === "mix") {
      const latest = await mixSources(a, run.sources.map((s) => s.id));
      if (latest.some((p, i) => p.hash !== run.sources[i].hash)) m.fail("AI_SOURCES_CHANGED", 409);
      return run;
    }
    const posts = await sources(
      a,
      run.sources.map((s) => s.id),
    );
    if (posts.some((p, i) => p.hash !== run.sources[i].hash))
      m.fail("AI_SOURCES_CHANGED", 409);
    return run;
  }
  async function get(a, id) {
    const s = await service.ref("ai_runs", m.id(id)).get();
    if (
      !s.exists ||
      s.data().state !== "complete" ||
      s.data().authorSchoolParkId !== a.spid
    )
      m.fail("NOT_FOUND", 404);
    return current(a, { id: s.id, ...s.data() });
  }
  async function analyze(a, input) {
    const config = await requireEnabled();
    if (input.externalAIConsent !== true)
      m.fail("AI_REQUEST_CONSENT_REQUIRED", 403);
    let ids = m.list(input.sourceIds, 6);
    const fields = m.list(input.fields, 3);
    if (fields.length < 2) m.fail("AI_SOURCE_COUNT");
    const valid = await service.validateFacets({ field: fields });
    if (!ids.length) {
      // At most three canonical result pages (60 candidates); send at most three sources.
      // Search preserves the existing reader plan, public visibility and author consent.
      const pool = new Map();
      for (const field of valid.field) {
        const page = await service.search({ field, sort: "updated" }, a);
        for (const p of page.items) {
          if (
            p.knowledgeLab?.aiUseConsent?.allowed === true &&
            !containsSensitiveText(p.title + "\n" + p.body.slice(0, 3000))
          )
            pool.set(p.id, p);
        }
      }
      for (const field of valid.field) {
        if (ids.some((id) => pool.get(id)?.facets.field.includes(field)))
          continue;
        const p = [...pool.values()].find(
          (p) => p.facets.field.includes(field) && !ids.includes(p.id),
        );
        if (p) ids.push(p.id);
      }
      if (ids.length < 2) {
        const p = [...pool.values()].find((p) => !ids.includes(p.id));
        if (p) ids.push(p.id);
      }
    }
    if (ids.length < 2) m.fail("AI_INSUFFICIENT_CONSENTED_SOURCES", 409);
    const terms = await service.taxonomy(),
      fieldLabels = fields.map((id) => ({
        id,
        label: terms.find((t) => t.id === id)?.label || id,
      }));
    const src = await sources(a, ids);
    const canonical = await Promise.all(
      ids.map((id) => service.rawPost(id, a)),
    );
    if (
      valid.field.some(
        (field) => !canonical.some((p) => m.facets(p).field.includes(field)),
      )
    )
      m.fail("AI_FIELD_SOURCES_MISSING", 409);
    const cacheId = m.hash([
        a.spid,
        src.map((s) => [s.id, s.hash]),
        fields,
        fieldLabels,
        config.model,
        "analysis-v2-evidence-ids",
      ]),
      cacheRef = service.ref("ai_cache", cacheId),
      previous = await cacheRef.get();
    if (input.forceRefresh === true && !input.key)
      m.fail("AI_REFRESH_KEY_REQUIRED");
    const lease = m.hash([cacheId, now(), Math.random()]),
      id = m.hash([cacheId, input.key ? m.id(input.key) : lease]),
      r = service.ref("ai_runs", id);
    const existing = await r.get();
    if (existing.exists && existing.data().state === "complete") {
      await budget.cacheHit();
      return {
        ...(await current(a, { id, ...existing.data() })),
        cacheHit: true,
      };
    }
    if (
      input.forceRefresh !== true &&
      previous.exists &&
      previous.data().state === "complete" &&
      now() - previous.data().createdAtMs < 86400000
    ) {
      await budget.cacheHit();
      return { ...(await get(a, previous.data().runId)), cacheHit: true };
    }
    await db.runTransaction(async (tx) => {
      const s = await tx.get(cacheRef);
      if (s.data()?.state === "generating" && s.data()?.leaseUntil > now())
        m.fail("AI_BUSY", 429);
      tx.set(cacheRef, {
        state: "generating",
        lease,
        leaseUntil: now() + 60000,
        authorSchoolParkId: a.spid,
        createdAtMs: now(),
      });
    });
    try {
      const result = await budget.call(
        a,
        "analysis",
        () => provider.analyze(config.model, fieldLabels, src),
        // LAB-01：呼ぶ前に、この分析で使いうる最大の量を見積もって予約する
        budget.estimateAnalysis([
          ...fieldLabels.map((f) => JSON.stringify(f)),
          ...src.flatMap((p) => [p.title, p.body]),
        ]),
      );
      const latest = await sources(a, ids);
      if (latest.some((p, i) => p.hash !== src[i].hash))
        m.fail("AI_SOURCES_CHANGED", 409);
      const value = {
        state: "complete",
        authorSchoolParkId: a.spid,
        fields,
        fieldLabels,
        sources: src.map(({ body, ...s }) => s),
        analysis: result.analysis,
        model: result.model,
        resolvedModel: result.resolvedModel || null,
        usage: result.usage,
        createdAtMs: now(),
        origin: "ai-hypothesis",
        verification: "unverified",
        consentAtMs: now(),
        provider: "gemini",
        costStatus: "free-project-attested",
        estimatedCharge: 0,
      };
      await db.runTransaction(async (tx) => {
        const c = await tx.get(cacheRef);
        if (c.data()?.lease !== lease) m.fail("AI_BUSY", 429);
        tx.create(r, value);
        tx.set(cacheRef, {
          state: "complete",
          runId: id,
          createdAtMs: now(),
          authorSchoolParkId: a.spid,
        });
      });
      return { id, ...value, cacheHit: false };
    } catch (e) {
      await db.runTransaction(async (tx) => {
        const s = await tx.get(cacheRef);
        if (s.data()?.lease === lease) {
          if (previous.exists) tx.set(cacheRef, previous.data());
          else tx.delete(cacheRef);
        }
      });
      throw e;
    }
  }
  return {
    provider,
    budget,
    status,
    settings,
    configure,
    requireEnabled,
    sources,
    get,
    analyze,
    mix,
    mixQuota,
    texts,
    textMaterial,
  };
}
module.exports = { createAI };
