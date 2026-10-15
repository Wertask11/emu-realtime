"use strict";
const m = require("./model");
const seed = require("./taxonomy.json");
const COL = (name) => "knowledge_lab_" + name;
const MAX_INDEX = 20000,
  MAX_BYTES = 64 * 1024 * 1024,
  PAGE = 128;

function createService({
  db,
  identity,
  entitlement,
  isOwner,
  emuerEnabled = () => false,
  now = Date.now,
  queueSemantic = () => {},
  verifyAI = async () => m.fail("AI_DISABLED", 503),
}) {
  let cache = null,
    cacheUntil = 0,
    cacheLoadedAt = 0,
    deltaAt = 0,
    generation = 0,
    loading = null,
    rebuilding = null;
  const ref = (col, key) =>
    db.collection(COL(col)).doc(key === "security-probe" ? key : m.id(key));
  const metrics = require("./analytics").createAnalytics({ db, ref, now });
  const track = (...args) =>
    metrics
      .track(...args)
      .catch(() => console.warn("Knowledge Lab: metrics update pending"));
  const activity = require("./activity").createActivity({ db, ref, now });
  const savedMetrics = require("./saved-metrics").createSavedMetrics({
    db,
    ref,
    now,
  });
  async function actor(req) {
    const a = req.identity;
    if (!a) m.fail("AUTH_REQUIRED", 401);
    const spid = await identity.findByUid(a.uid);
    if (!spid) m.fail("PASSPORT_REQUIRED", 409);
    return { ...a, spid, owner: isOwner(a) };
  }
  async function taxonomy() {
    const s = await db.collection(COL("taxonomy")).limit(401).get();
    if (s.size > 400) m.fail("TAXONOMY_LIMIT", 503);
    return s.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
  async function validateFacets(value = {}, old = null) {
    if (!value || typeof value !== "object" || Array.isArray(value))
      m.fail("INVALID_FACETS");
    const terms = await taxonomy(),
      map = new Map(terms.map((t) => [t.id, t]));
    const result = {};
    for (const axis of m.AXES) {
      result[axis] = m.list(value[axis]);
      for (const id of result[axis]) {
        const term = map.get(id);
        if (
          !term ||
          term.axis !== axis ||
          ((!term.active || term.mergedInto) && !old?.[axis]?.includes(id))
        )
          m.fail("INVALID_CLASSIFICATION");
      }
    }
    return result;
  }
  async function init(a) {
    if (!a.owner) m.fail("OWNER_ONLY", 403);
    for (const term of seed) {
      await db.runTransaction(async (tx) => {
        const r = ref("taxonomy", term.id),
          snap = await tx.get(r);
        if (!snap.exists)
          tx.create(r, {
            ...term,
            active: true,
            revision: 1,
            updatedAtMs: now(),
          });
      });
    }
    return { taxonomyCount: (await taxonomy()).length };
  }
  function invalidate() {
    cacheUntil = 0;
  }
  async function catalog() {
    if (cache && cacheUntil > now()) return cache;
    if (loading) return loading;
    loading = (async () => {
      const status = await ref("system", "index").get();
      if (!status.exists || status.data().state !== "ready")
        m.fail("INDEX_NOT_READY", 503);
      const full =
        !cache ||
        now() - cacheLoadedAt >= 3600000 ||
        generation !== status.data().finishedAtMs;
      const rows = new Map(full ? [] : cache.map((row) => [row.postId, row]));
      let after = null,
        bytes = full
          ? 0
          : cache.reduce(
              (sum, row) => sum + Buffer.byteLength(JSON.stringify(row)),
              0,
            );
      for (;;) {
        let q = full
          ? db.collection(COL("search")).orderBy("__name__").limit(PAGE)
          : db
              .collection(COL("search"))
              .where("indexedAtMs", ">=", Math.max(0, deltaAt - 600000))
              .orderBy("indexedAtMs")
              .limit(PAGE);
        if (after) q = q.startAfter(after);
        const s = await q.get();
        for (const d of s.docs) {
          const row = d.data();
          if (!row.postId) continue;
          if (rows.has(row.postId))
            bytes -= Buffer.byteLength(JSON.stringify(rows.get(row.postId)));
          bytes += Buffer.byteLength(JSON.stringify(row));
          rows.set(row.postId, row);
        }
        if (rows.size > MAX_INDEX || bytes > MAX_BYTES)
          m.fail("SEARCH_CAPACITY_REACHED", 503);
        if (s.size < PAGE) break;
        after = s.docs.at(-1);
      }
      const values = [...rows.values()];
      bytes = values.reduce(
        (sum, row) => sum + Buffer.byteLength(JSON.stringify(row)),
        0,
      );
      if (bytes > MAX_BYTES) m.fail("SEARCH_CAPACITY_REACHED", 503);
      cache = values;
      generation = status.data().finishedAtMs;
      deltaAt = now();
      if (full) cacheLoadedAt = now();
      cacheUntil = now() + 60000;
      return cache;
    })();
    try {
      return await loading;
    } finally {
      loading = null;
    }
  }
  async function rebuild(a) {
    if (!a.owner) m.fail("OWNER_ONLY", 403);
    if (rebuilding) return { state: "building" };
    // A durable lease prevents two Render instances from launching the same expensive scan.
    await db.runTransaction(async (tx) => {
      const r = ref("system", "index"),
        s = await tx.get(r);
      if (
        s.exists &&
        s.data().state === "building" &&
        s.data().leaseUntil > now()
      )
        m.fail("INDEX_BUSY", 409);
      tx.set(r, {
        state: "building",
        processed: 0,
        leaseUntil: now() + 600000,
        startedAtMs: now(),
      });
    });
    rebuilding = (async () => {
      let after = null,
        count = 0,
        bytes = 0;
      try {
        for (;;) {
          let q = db.collection("posts").orderBy("__name__").limit(25);
          if (after) q = q.startAfter(after);
          const s = await q.get();
          const batch = db.batch();
          for (const d of s.docs) {
            const p = d.data();
            const row = m.indexPost(d.id, p, now());
            count++;
            bytes += Buffer.byteLength(JSON.stringify(row));
            if (count > MAX_INDEX || bytes > MAX_BYTES)
              m.fail("SEARCH_CAPACITY_REACHED", 503);
            batch.set(ref("search", d.id), row, { merge: true });
          }
          await batch.commit();
          await ref("system", "index").set(
            { processed: count, leaseUntil: now() + 600000 },
            { merge: true },
          );
          if (s.size < 25) break;
          after = s.docs.at(-1);
        }
        // Deleted source IDs are never returned: search hydrates each root post below.
        await ref("system", "index").set({
          state: "ready",
          processed: count,
          finishedAtMs: now(),
          leaseUntil: 0,
        });
        invalidate();
      } catch (e) {
        await ref("system", "index").set({
          state: "failed",
          error: e.status ? e.message : "INDEX_FAILED",
          leaseUntil: 0,
          processed: count,
          finishedAtMs: now(),
        });
      }
    })();
    rebuilding.finally(() => {
      rebuilding = null;
    });
    return { state: "building" };
  }
  async function waitForRebuild() {
    if (rebuilding) await rebuilding;
  }
  async function syncIndex(postId, a) {
    const r = db.collection("posts").doc(m.id(postId));
    await db.runTransaction(async (tx) => {
      const s = await tx.get(r);
      if (!s.exists) {
        tx.delete(ref("search", postId));
        return;
      }
      if (!m.publicPost(s.data()) && !m.owner(s.data(), a) && !a.owner)
        m.fail("NOT_OWNER", 403);
      tx.set(ref("search", postId), m.indexPost(postId, s.data(), now()), {
        merge: true,
      });
      queueSemantic(tx, postId, s.data());
    });
    invalidate();
    return { ok: true };
  }
  async function syncPublicPost(postId) {
    const r = db.collection("posts").doc(m.id(postId));
    await db.runTransaction(async (tx) => {
      const s = await tx.get(r);
      if (s.exists) {
        tx.set(ref("search", postId), m.indexPost(postId, s.data(), now()), {
          merge: true,
        });
        queueSemantic(tx, postId, s.data());
      } else tx.delete(ref("search", postId));
    });
    invalidate();
  }
  async function search(q, a = null) {
    const params = m.searchParams(q),
      terms = await taxonomy(),
      all = await catalog();
    if (
      params.sort === "saved" &&
      (await savedMetrics.status()).state !== "ready"
    )
      m.fail("SAVED_METRICS_NOT_READY", 503);
    const plan = a
      ? (await entitlement.getEntitlement(a.uid, a.account)).plan
      : "guest";
    const guest = entitlement.limitOf(plan, "post") <= 0;
    const scope = guest
      ? [...all]
          .filter((p) => p.active)
          .sort(
            (x, y) =>
              y.createdAtMs - x.createdAtMs || x.postId.localeCompare(y.postId),
          )
          .slice(0, 20)
      : all;
    const rows = m.select(scope, params, terms);
    const fp = m.hash(params),
      version = m.hash(rows.map((r) => [r.postId, r.indexedAtMs]));
    let start = 0;
    if (q.cursor) {
      const c = m.parseCursor(q.cursor);
      if (c.q !== fp || c.v !== version) m.fail("SEARCH_CHANGED", 409);
      start = rows.findIndex((r) => r.postId === c.after) + 1;
      if (!start) m.fail("INVALID_CURSOR");
    }
    const limit = 20,
      items = [];
    let scanned = start;
    // Recheck canonical documents, never return stale index text or private source content.
    while (scanned < rows.length && items.length < limit) {
      const portion = rows.slice(
        scanned,
        scanned + Math.min(PAGE, limit - items.length),
      );
      const snaps = await db.getAll(
        ...portion.map((r) => db.collection("posts").doc(r.postId)),
      );
      for (let i = 0; i < snaps.length; i++) {
        scanned++;
        const s = snaps[i];
        if (
          s.exists &&
          m.publicPost(s.data()) &&
          m.select([m.indexPost(s.id, s.data())], params, terms).length
        )
          items.push({
            ...m.safePost(s.id, await publicProof(s.id, s.data()), a),
            savedCount: portion[i].savedCount || 0,
            searchEvidence: {
              keywords: m.keywordTerms(params.q),
              classifications: m.AXES.filter((axis) => params[axis]?.length),
            },
          });
      }
    }
    return {
      items,
      next:
        scanned < rows.length
          ? m.cursor({ q: fp, v: version, after: rows[scanned - 1].postId })
          : null,
      indexedMatches: rows.length,
      guestCapped: guest && all.length > 20,
      guestLimit: guest ? 20 : null,
      indexCheckedAt: cacheUntil - 60000,
      searchMethod: "japanese-lexical",
      aiAvailable: false,
    };
  }
  async function rawPost(postId, a = null) {
    m.id(postId);
    const pub = await db.collection("posts").doc(postId).get();
    if (pub.exists && m.publicPost(pub.data())) {
      if (!a?.owner && !m.owner(pub.data(), a)) {
        const plan = a
          ? (await entitlement.getEntitlement(a.uid, a.account)).plan
          : "guest";
        if (entitlement.limitOf(plan, "post") <= 0) {
          const s = await db
            .collection("posts")
            .orderBy("createdAt", "desc")
            .limit(20)
            .get();
          if (!s.docs.some((d) => d.id === postId))
            m.fail("READER_PLAN_REQUIRED", 403);
        }
      }
      return pub.data();
    }
    if (!a) m.fail("NOT_FOUND", 404);
    const priv = await ref("private_posts", postId).get();
    if (priv.exists && (a.owner || m.owner(priv.data(), a))) return priv.data();
    const archived = await ref("archived_posts", postId).get();
    if (!archived.exists || (!a.owner && !m.owner(archived.data(), a)))
      m.fail("NOT_FOUND", 404);
    return archived.data();
  }
  async function publicProof(postId, p) {
    const proof = p.knowledgeLab?.thirdPartyConfirmation;
    if (!proof) return p;
    let record = null;
    try {
      const s = await ref("verification", m.id(proof.recordId)).get();
      if (s.exists) record = s.data();
    } catch (e) {
      if (e.message !== "INVALID_ID") throw e;
    }
    const valid =
      record &&
      record.postId === postId &&
      record.confirmedRevision === p.knowledgeLab.revision &&
      record.reviewerSchoolParkId === proof.reviewerSchoolParkId;
    return {
      ...p,
      knowledgeLab: {
        ...p.knowledgeLab,
        thirdPartyConfirmation: valid
          ? {
              recordId: proof.recordId,
              summary: record.summary,
              atMs: record.atMs,
              reviewerSchoolParkId: record.reviewerSchoolParkId,
              confirmedRevision: record.confirmedRevision,
            }
          : null,
      },
    };
  }
  async function post(postId, a = null) {
    return m.safePost(
      postId,
      await publicProof(postId, await rawPost(postId, a)),
      a,
    );
  }
  async function quota(tx, a, kind) {
    const ent = await entitlement.getEntitlement(a.uid, a.account);
    const jst = new Date(now() + 9 * 3600000),
      key =
        a.uid + "_r_m" + jst.getUTCFullYear() + "-" + (jst.getUTCMonth() + 1);
    const r = db.collection("plan_usage").doc(key),
      s = await tx.get(r),
      data = s.exists ? s.data() : {};
    const cap = entitlement.limitOf(ent.plan, kind),
      used = Number(data[kind] || 0);
    if (!Number.isFinite(used) || cap <= 0 || used >= cap)
      m.fail("PLAN_LIMIT_REACHED", 403);
    return () =>
      tx.set(
        r,
        { [kind]: used + 1, updatedAt: new Date(now()) },
        { merge: true },
      );
  }
  async function draftQuota(tx, a, delta) {
    const r = db.collection("plan_counts").doc(a.uid),
      s = await tx.get(r);
    const used = Number(s.exists ? s.data().drafts || 0 : 0);
    if (delta > 0) {
      const ent = await entitlement.getEntitlement(a.uid, a.account);
      if (used >= entitlement.limitOf(ent.plan, "library"))
        m.fail("LIBRARY_FULL", 403);
    }
    return () =>
      tx.set(
        r,
        { drafts: Math.max(0, used + delta), updatedAt: new Date(now()) },
        { merge: true },
      );
  }
  function operation(a, key, kind) {
    m.id(key);
    return ref("operations", m.hash([a.spid, kind, key]));
  }
  async function answerDraft(a, answerId) {
    const s = await db
      .collection("knowledge_answers")
      .doc(m.id(answerId))
      .get();
    if (!s.exists) m.fail("NOT_FOUND", 404);
    const answer = s.data();
    const who = await identity.knowledgeParticipant(
      answer.answerAuthor,
      answer.authorSchoolParkId,
    );
    if (!who) m.fail("IDENTITY_REVIEW_REQUIRED", 409);
    if (who !== a.spid) m.fail("NOT_OWNER", 403);
    const requestId = m.id(answer.requestId),
      request = await db.collection("knowledge_requests").doc(requestId).get();
    if (!request.exists) m.fail("NOT_FOUND", 404);
    const postId = "kla-" + m.hash([a.spid, answerId]);
    const present = await Promise.all([
      db.collection("posts").doc(postId).get(),
      ref("private_posts", postId).get(),
      ref("archived_posts", postId).get(),
    ]);
    return {
      answerId,
      requestId,
      postId,
      existingPostId: present.some((s) => s.exists) ? postId : null,
      title: String(request.data().question || "回答から届ける経験知").slice(
        0,
        160,
      ),
      body: answer.knowledge || "",
      happened: answer.experience || "",
      advice: answer.limits || "",
      facets: request.data().facets || {},
    };
  }
  async function savePost(a, input) {
    const originResearch =
      input.sourceNoteId && !input.id
        ? await note(m.id(input.sourceNoteId), a)
        : null;
    if (originResearch && originResearch.authorSchoolParkId !== a.spid)
      m.fail("NOT_OWNER", 403);
    if (originResearch?.archived) m.fail("ARCHIVED_NOTE_RESTORE_REQUIRED", 409);
    if (
      originResearch &&
      input.visibility === "public" &&
      input.researchPublicationConsent !== true
    )
      m.fail("RESEARCH_PUBLICATION_CONSENT_REQUIRED", 403);
    const originAnswer =
      input.answerId && !input.id
        ? await answerDraft(a, m.id(input.answerId))
        : null;
    if (
      originAnswer &&
      input.visibility === "public" &&
      input.answerPublicationConsent !== true
    )
      m.fail("ANSWER_PUBLICATION_CONSENT_REQUIRED", 403);
    const postId = input.id
      ? m.id(input.id)
      : originAnswer
        ? originAnswer.postId
        : "kl-" + m.hash([a.spid, m.id(input.key)]);
    const visibility = input.visibility || "draft";
    if (!["public", "private", "draft"].includes(visibility))
      m.fail("INVALID_VISIBILITY");
    const title = m.text(input.title, 160, true),
      body = m.text(input.body, 5000, true);
    const previous = input.id ? await rawPost(postId, a) : null;
    if (
      input.id &&
      input.answerId &&
      previous?.knowledgeLab?.sourceAnswer?.answerId !== input.answerId
    )
      m.fail("INVALID_ANSWER_POST_ID");
    if (
      previous?.knowledgeLab?.sourceAnswer &&
      visibility === "public" &&
      input.answerPublicationConsent !== true
    )
      m.fail("ANSWER_PUBLICATION_CONSENT_REQUIRED", 403);
    if (previous && !m.owner(previous, a)) m.fail("NOT_OWNER", 403);
    if (previous?.visibility === "archived")
      m.fail("ARCHIVED_POST_RESTORE_REQUIRED", 409);
    const facets = await validateFacets(
      input.facets,
      previous ? m.facets(previous) : null,
    );
    const details = {
      period: m.text(input.period || "", 120),
      happened: m.text(input.happened || "", 2000),
      learned: m.text(input.learned || "", 2000),
      advice: m.text(input.advice || "", 2000),
      sources: m.text(input.sources || "", 1500),
      aiUseConsent:
        input.aiUseConsent === undefined
          ? previous?.knowledgeLab?.aiUseConsent || { allowed: false }
          : {
              allowed: input.aiUseConsent === true,
              version: 1,
              actorSchoolParkId: a.spid,
              atMs: now(),
            },
      verification: [
        "self-reported",
        "tested-by-author",
        "in-progress",
        "needs-update",
      ].includes(input.verification)
        ? input.verification
        : "self-reported",
    };
    const tags = m
      .text(input.tags || "", 500)
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
      .join(",");
    const paidType =
      a.owner || (await entitlement.holdsOfficialPass(a.uid, a.account));
    const pub = db.collection("posts").doc(postId),
      priv = ref("private_posts", postId),
      op = operation(a, input.key, "post"),
      t = now();
    const fingerprint = m.hash({ ...input, id: postId });
    const result = await db.runTransaction(async (tx) => {
      const [seen, ps, ds, writer, control, metrics, research] =
        await Promise.all([
          tx.get(op),
          tx.get(pub),
          tx.get(priv),
          tx.get(ref("writers", a.spid)),
          tx.get(ref("post_control", postId)),
          tx.get(ref("post_metrics", postId)),
          originResearch
            ? tx.get(ref("notes", originResearch.id))
            : Promise.resolve(null),
        ]);
      if (seen.exists) {
        if (seen.data().fingerprint !== fingerprint)
          m.fail("IDEMPOTENCY_CONFLICT", 409);
        return seen.data().result;
      }
      if (
        originResearch &&
        (!research?.exists ||
          research.data().revision !== originResearch.revision ||
          research.data().archived ||
          research.data().authorSchoolParkId !== a.spid)
      )
        m.fail("REVISION_CONFLICT", 409);
      const old = ds.exists
        ? ds.data()
        : ps.exists && m.publicPost(ps.data())
          ? ps.data()
          : null;
      if (old && !m.owner(old, a)) m.fail("NOT_OWNER", 403);
      if (originAnswer && !input.id && (ps.exists || ds.exists))
        m.fail("ANSWER_ALREADY_POSTED", 409);
      if (old?.knowledgeLab?.hidden) m.fail("MODERATED_POST", 403);
      const revision = old?.knowledgeLab?.revision || 0;
      if (old && input.revision !== revision) m.fail("REVISION_CONFLICT", 409);
      let consume = () => {},
        count = () => {};
      if (
        visibility === "public" &&
        !ps.exists &&
        !old?.knowledgeLab?.publishedOnce
      )
        consume = await quota(tx, a, "post");
      const nextPrivate = visibility !== "public";
      if (nextPrivate && !ds.exists) count = await draftQuota(tx, a, 1);
      else if (
        !nextPrivate &&
        ds.exists &&
        control.exists &&
        control.data().privateQuotaUid
      )
        count = await draftQuota(
          tx,
          { ...a, uid: control.data().privateQuotaUid },
          -1,
        );
      const profile =
        writer.exists && writer.data().published ? writer.data() : null;
      const value = {
        ...(old || {}),
        title,
        body,
        tags,
        address: old?.address || a.walletAddress,
        userType: old?.userType || (paidType ? "paid" : "free"),
        userId: old?.userId || a.walletAddress,
        displayName: profile?.displayName || old?.displayName || "Emuer",
        authorSchoolParkId: a.spid,
        visibility,
        createdAt: old?.createdAt || new Date(t),
        updatedAt: new Date(t),
        goodCount: old?.goodCount || 0,
        changeCount: old?.changeCount || 0,
        knowledgeLab: {
          facets,
          ...details,
          ...(originAnswer || old?.knowledgeLab?.sourceAnswer
            ? {
                sourceAnswer: originAnswer
                  ? {
                      requestId: originAnswer.requestId,
                      answerId: originAnswer.answerId,
                    }
                  : old.knowledgeLab.sourceAnswer,
                ...(visibility === "public"
                  ? { answerPublicationConsentAtMs: t }
                  : {}),
              }
            : {}),
          ...(originResearch && research.data().visibility === "public"
            ? { sourceResearch: { noteId: originResearch.id, consentAtMs: t } }
            : old?.knowledgeLab?.sourceResearch
              ? { sourceResearch: old.knowledgeLab.sourceResearch }
              : {}),
          revision: revision + 1,
          publishedOnce:
            visibility === "public" ||
            ps.exists ||
            !!old?.knowledgeLab?.publishedOnce,
          quality: "本人の経験（自己申告）",
          thirdPartyConfirmation: null,
          hidden: false,
        },
      };
      const recordActivity = await activity.prepare(tx, a, [
        {
          kind: "experience-posted",
          targetId: postId,
          visibility,
          existingOnly: visibility !== "public",
        },
      ]);
      queueSemantic(tx, postId, value);
      recordActivity();
      if (originResearch)
        tx.set(ref("derived_links", postId), {
          postId,
          noteId: originResearch.id,
          authorSchoolParkId: a.spid,
          createdAtMs: t,
        });
      consume();
      count();
      tx.set(
        ref("post_control", postId),
        {
          authorSchoolParkId: a.spid,
          privateQuotaUid: nextPrivate
            ? ds.exists
              ? control.data()?.privateQuotaUid || null
              : a.uid
            : null,
        },
        { merge: true },
      );
      if (old)
        tx.set(ref("history", postId + "-" + revision), {
          postId,
          authorSchoolParkId: a.spid,
          previous: old,
          changedAtMs: t,
          changedBy: a.spid,
        });
      if (visibility === "public") {
        tx.set(pub, value);
        tx.delete(priv);
        tx.set(
          ref("search", postId),
          {
            ...m.indexPost(postId, value, t),
            savedCount: metrics.exists ? metrics.data().savedCount || 0 : 0,
          },
          { merge: true },
        );
      } else {
        tx.set(priv, value);
        if (value.knowledgeLab.publishedOnce)
          tx.set(pub, m.tombstone(value, value.knowledgeLab.revision, t));
        else tx.delete(pub);
        if (value.knowledgeLab.publishedOnce)
          tx.set(
            ref("search", postId),
            m.indexPost(
              postId,
              m.tombstone(value, value.knowledgeLab.revision, t),
              t,
            ),
          );
        else tx.delete(ref("search", postId));
      }
      const out = { id: postId, revision: revision + 1, visibility };
      tx.create(op, { fingerprint, result: out, createdAtMs: t });
      return out;
    });
    invalidate();
    if (visibility === "public") await track(a, "publish", postId);
    return result;
  }
  async function removePost(a, postId, revision, key) {
    const p = await rawPost(postId, a);
    if (!m.owner(p, a)) m.fail("NOT_OWNER", 403);
    // A withdrawal keeps data recoverable and prevents public source leakage.
    return savePost(a, {
      id: postId,
      revision,
      key,
      title: p.title,
      body: p.body,
      tags: Array.isArray(p.tags) ? p.tags.join(",") : p.tags,
      visibility: "private",
      ...p.knowledgeLab,
      facets: m.facets(p),
      previousFacets: m.facets(p),
    });
  }
  async function archivePost(a, postId, revision) {
    m.id(postId);
    const pub = db.collection("posts").doc(postId),
      priv = ref("private_posts", postId),
      archive = ref("archived_posts", postId);
    await db.runTransaction(async (tx) => {
      const [ps, ds, cs] = await Promise.all([
          tx.get(pub),
          tx.get(priv),
          tx.get(ref("post_control", postId)),
        ]),
        p = ds.exists
          ? ds.data()
          : ps.exists && m.publicPost(ps.data())
            ? ps.data()
            : null;
      if (!p || !m.owner(p, a)) m.fail("NOT_FOUND", 404);
      if (p.knowledgeLab?.hidden) m.fail("MODERATED_POST", 403);
      const rev = p.knowledgeLab?.revision || 0;
      if (revision !== rev) m.fail("REVISION_CONFLICT", 409);
      let count = () => {};
      if (ds.exists && cs.exists && cs.data().privateQuotaUid)
        count = await draftQuota(
          tx,
          { ...a, uid: cs.data().privateQuotaUid },
          -1,
        );
      count();
      tx.set(archive, {
        ...p,
        authorSchoolParkId: a.spid,
        visibility: "archived",
        knowledgeLab: {
          ...p.knowledgeLab,
          revision: rev + 1,
          publishedOnce: ps.exists || !!p.knowledgeLab?.publishedOnce,
        },
        archivedAtMs: now(),
      });
      if (p.knowledgeLab?.publishedOnce || ps.exists)
        tx.set(pub, m.tombstone(p, rev + 1, now()));
      else tx.delete(pub);
      tx.delete(priv);
      queueSemantic(tx, postId, { ...p, visibility: "archived" });
      if (p.knowledgeLab?.publishedOnce || ps.exists)
        tx.set(
          ref("search", postId),
          m.indexPost(postId, m.tombstone(p, rev + 1, now()), now()),
        );
      else tx.delete(ref("search", postId));
      tx.set(
        ref("post_control", postId),
        { authorSchoolParkId: a.spid, privateQuotaUid: null },
        { merge: true },
      );
    });
    invalidate();
    return { ok: true };
  }
  async function restorePost(a, postId, revision) {
    const ar = ref("archived_posts", postId),
      pr = ref("private_posts", postId);
    await db.runTransaction(async (tx) => {
      const [s, pub, privateSnap] = await Promise.all([
        tx.get(ar),
        tx.get(db.collection("posts").doc(postId)),
        tx.get(pr),
      ]);
      if (!s.exists || !m.owner(s.data(), a)) m.fail("NOT_FOUND", 404);
      if ((pub.exists && m.publicPost(pub.data())) || privateSnap.exists)
        m.fail("REVISION_CONFLICT", 409);
      const p = s.data(),
        rev = p.knowledgeLab?.revision || 0;
      if (revision !== rev) m.fail("REVISION_CONFLICT", 409);
      const count = await draftQuota(tx, a, 1);
      count();
      tx.set(pr, {
        ...p,
        visibility: "draft",
        knowledgeLab: { ...p.knowledgeLab, revision: rev + 1 },
      });
      tx.delete(ar);
      tx.set(
        ref("post_control", postId),
        { authorSchoolParkId: a.spid, privateQuotaUid: a.uid },
        { merge: true },
      );
    });
    return { ok: true };
  }
  async function ownCollection(name, a, q = {}) {
    const limit = 20;
    let query = db
      .collection(COL(name))
      .where("authorSchoolParkId", "==", a.spid)
      .orderBy("__name__")
      .limit(limit + 1);
    if (q.cursor) query = query.startAfter(m.id(q.cursor));
    const s = await query.get();
    return {
      items: s.docs.slice(0, limit).map((d) => ({ id: d.id, ...d.data() })),
      next: s.size > limit ? s.docs[limit - 1].id : null,
    };
  }
  async function myPosts(a, q = {}) {
    // Single-field ownership queries are bounded; normal legacy posts remain editable via detail URL.
    const s = await ownCollection("private_posts", a, q);
    s.items = s.items.map((p) => m.safePost(p.id, p, a));
    return s;
  }
  async function myPublicPosts(a, q = {}) {
    let query = db
      .collection("posts")
      .where("authorSchoolParkId", "==", a.spid)
      .orderBy("__name__")
      .limit(21);
    if (q.cursor) query = query.startAfter(m.id(q.cursor));
    const s = await query.get();
    return {
      items: s.docs
        .slice(0, 20)
        .filter((d) => m.publicPost(d.data()))
        .map((d) => m.safePost(d.id, d.data(), a)),
      next: s.size > 20 ? s.docs[19].id : null,
    };
  }
  async function profile(a, input) {
    const previous = await ref("writers", a.spid).get();
    const facets = await validateFacets(
        input.facets,
        previous.exists ? previous.data().facets : null,
      ),
      displayName = m.text(input.displayName, 60, true),
      bio = m.text(input.bio || "", 1000);
    const published = input.published === true;
    if (published && input.consent !== true)
      m.fail("PUBLIC_PROFILE_CONSENT_REQUIRED");
    const icon = input.icon || "";
    if (icon && !/^https:\/\//.test(icon)) m.fail("INVALID_ICON");
    m.text(icon, 500);
    const result = await db.runTransaction(async (tx) => {
      const r = ref("writers", a.spid),
        s = await tx.get(r),
        revision = s.exists ? s.data().revision : 0;
      if (input.revision !== revision) m.fail("REVISION_CONFLICT", 409);
      if (s.exists && s.data().moderated && published)
        m.fail("MODERATED_PROFILE", 403);
      const value = {
        authorSchoolParkId: a.spid,
        displayName,
        bio,
        icon,
        facets,
        published,
        moderated: s.exists && !!s.data().moderated,
        consentVersion: published ? "lab-1" : null,
        qualification: "self-reported",
        revision: revision + 1,
        createdAtMs: s.exists ? s.data().createdAtMs : now(),
        updatedAtMs: now(),
      };
      tx.set(r, value);
      return value;
    });
    await track(a, "register", a.spid);
    return result;
  }
  async function writer(spid, a) {
    const s = await ref("writers", spid).get();
    if (!s.exists || (!s.data().published && a?.spid !== spid && !a?.owner))
      m.fail("NOT_FOUND", 404);
    return { id: spid, ...s.data() };
  }
  async function writers(q = {}) {
    let query = db
      .collection(COL("writers"))
      .where("published", "==", true)
      .orderBy("__name__")
      .limit(21);
    if (q.cursor) query = query.startAfter(m.id(q.cursor));
    const s = await query.get();
    return {
      items: s.docs.slice(0, 20).map((d) => ({ id: d.id, ...d.data() })),
      next: s.size > 20 ? s.docs[19].id : null,
    };
  }
  async function me(a) {
    const s = await ref("writers", a.spid).get();
    const ent = await entitlement.getEntitlement(a.uid, a.account);
    return {
      schoolParkId: a.spid,
      owner: a.owner,
      writer: s.exists ? s.data() : null,
      plan: ent.plan,
      aiAvailable: false,
    };
  }
  async function sources(ids, a, publicOnly = false) {
    if (ids.length < 2 || ids.length > 6) m.fail("SELECT_TWO_TO_SIX_SOURCES");
    const values = [];
    for (const id of ids) {
      const p = await rawPost(id, a);
      if (publicOnly && p.visibility && p.visibility !== "public")
        m.fail("PRIVATE_SOURCE", 403);
      values.push(m.safePost(id, p, a));
    }
    return values;
  }
  async function comparison(a, input) {
    const values = await sources(m.list(input.sourceIds, 6), a);
    const common = {},
      differences = {};
    for (const axis of m.AXES) {
      const sets = values.map((p) => m.facets(p)[axis]);
      common[axis] = sets[0].filter((id) => sets.every((s) => s.includes(id)));
      differences[axis] = [...new Set(sets.flat())].filter(
        (id) => !common[axis].includes(id),
      );
    }
    return {
      sources: values,
      common,
      differences,
      aiAvailable: false,
      prompts: [
        "同じやり方が通用する条件は何でしょう？",
        "分野ごとに変える必要がある部分は何でしょう？",
        "小さく試すとしたら何を確かめますか？",
      ],
      promptType: "定型の問い・生成AIではありません",
    };
  }
  async function saveNote(a, input) {
    const key = m.id(input.key),
      noteId = input.id ? m.id(input.id) : "note-" + m.hash([a.spid, key]);
    const visibility = input.visibility === "public" ? "public" : "private";
    const sourceIds = m.list(input.sourceIds, 6);
    const fields = m.list(input.fields, 3);
    if (fields.length < 2) m.fail("SELECT_TWO_OR_THREE_FIELDS");
    const previous = await ref("notes", noteId).get();
    await validateFacets(
      { field: fields },
      previous.exists ? { field: previous.data().fields } : null,
    );
    await sources(sourceIds, a, visibility === "public");
    const aiRunId =
      input.aiRunId === null
        ? null
        : input.aiRunId || previous.data()?.aiRunId || null;
    const run = aiRunId ? await verifyAI(a, aiRunId) : null;
    if (
      run &&
      (m.hash(run.sources.map((s) => s.id).sort()) !==
        m.hash([...sourceIds].sort()) ||
        m.hash([...run.fields].sort()) !== m.hash([...fields].sort()))
    )
      m.fail("AI_SOURCES_CHANGED", 409);
    const value = {
      authorSchoolParkId: a.spid,
      title: m.text(input.title, 160, true),
      fields,
      sourceIds,
      question: m.text(input.question || "", 2000),
      hypothesis: m.text(input.hypothesis || "", 3000),
      plan: m.text(input.plan || "", 3000),
      result: m.text(input.result || "", 3000),
      visibility,
      origin: run ? "ai-hypothesis-human-editable" : "human",
      ...(run
        ? {
            aiRunId,
            aiAnalysis: run.analysis,
            aiSources: run.sources,
            aiModel: run.model,
            aiGeneratedAtMs: run.createdAtMs,
          }
        : {}),
      verification: input.result?.trim()
        ? "author-reported-result"
        : "unverified-hypothesis",
      updatedAtMs: now(),
    };
    const result = await db.runTransaction(async (tx) => {
      const r = ref("notes", noteId),
        op = operation(a, key, "note");
      const [s, os, ...posts] = await Promise.all([
        tx.get(r),
        tx.get(op),
        ...sourceIds.map((id) => tx.get(db.collection("posts").doc(id))),
      ]);
      const fingerprint = m.hash(input);
      if (os.exists) {
        if (os.data().fingerprint !== fingerprint)
          m.fail("IDEMPOTENCY_CONFLICT", 409);
        return os.data().result;
      }
      if (
        visibility === "public" &&
        posts.some((s) => !s.exists || !m.publicPost(s.data()))
      )
        m.fail("PRIVATE_SOURCE", 403);
      if (s.exists && s.data().authorSchoolParkId !== a.spid)
        m.fail("NOT_OWNER", 403);
      if (s.exists && s.data().moderated) m.fail("MODERATED_NOTE", 403);
      if (s.exists && s.data().archived)
        m.fail("ARCHIVED_NOTE_RESTORE_REQUIRED", 409);
      const revision = s.exists ? s.data().revision : 0;
      if (s.exists && input.revision !== revision)
        m.fail("REVISION_CONFLICT", 409);
      value.revision = revision + 1;
      value.createdAtMs = s.exists ? s.data().createdAtMs : now();
      value.archived = false;
      const recordActivity = await activity.prepare(tx, a, [
        { kind: "research-created", targetId: noteId, visibility },
        ...(s.exists &&
        ["question", "hypothesis", "plan", "result"].some(
          (key) => s.data()[key] !== value[key],
        )
          ? [{ kind: "research-contributed", targetId: noteId, visibility }]
          : []),
        ...(value.result.trim()
          ? [
              { kind: "hypothesis-practiced", targetId: noteId, visibility },
              { kind: "practice-reported", targetId: noteId, visibility },
            ]
          : []),
      ]);
      if (!s.exists) {
        const count = await tx.get(ref("limits", a.spid));
        const n = count.exists ? count.data().notes || 0 : 0;
        if (n >= 1000) m.fail("NOTE_LIMIT", 403);
        tx.set(ref("limits", a.spid), { notes: n + 1 }, { merge: true });
      }
      recordActivity();
      if (s.exists)
        tx.set(ref("history", noteId + "-" + revision), {
          noteId,
          authorSchoolParkId: a.spid,
          previous: s.data(),
          next: value,
          actorSchoolParkId: a.spid,
          changedAtMs: now(),
        });
      tx.set(r, value);
      const out = { id: noteId, revision: value.revision };
      tx.set(op, { fingerprint, result: out, createdAtMs: now() });
      return out;
    });
    await track(a, "research", noteId);
    if (value.result.trim()) await track(a, "practice", noteId);
    return result;
  }
  async function note(noteId, a = null) {
    const s = await ref("notes", noteId).get();
    if (!s.exists) m.fail("NOT_FOUND", 404);
    const v = s.data();
    if (v.authorSchoolParkId === a?.spid || a?.owner)
      return { id: noteId, ...v };
    if (v.archived) m.fail("NOT_FOUND", 404);
    if (v.visibility !== "public") m.fail("NOT_FOUND", 404);
    try {
      await sources(v.sourceIds, a, true);
    } catch (_) {
      m.fail("SOURCE_WITHDRAWN", 404);
    }
    return { id: noteId, ...v };
  }
  async function publicNotes(q = {}, a = null) {
    let query = db
      .collection(COL("notes"))
      .where("visibility", "==", "public")
      .orderBy("__name__")
      .limit(21);
    if (q.cursor) query = query.startAfter(m.id(q.cursor));
    const s = await query.get(),
      items = [];
    for (const d of s.docs.slice(0, 20)) {
      try {
        items.push(await note(d.id, a));
      } catch (e) {
        if (e.status !== 404) throw e;
      }
    }
    return { items, next: s.size > 20 ? s.docs[19].id : null };
  }
  async function archiveNote(a, noteId, revision) {
    return db.runTransaction(async (tx) => {
      const r = ref("notes", noteId),
        s = await tx.get(r);
      if (!s.exists || s.data().authorSchoolParkId !== a.spid)
        m.fail("NOT_FOUND", 404);
      if (s.data().revision !== revision) m.fail("REVISION_CONFLICT", 409);
      const next = {
        ...s.data(),
        archived: true,
        visibility: "private",
        revision: revision + 1,
        updatedAtMs: now(),
      };
      tx.set(ref("history", noteId + "-" + revision), {
        noteId,
        authorSchoolParkId: a.spid,
        actorSchoolParkId: a.spid,
        previous: s.data(),
        next,
        changedAtMs: now(),
        action: "archive",
      });
      tx.set(r, next);
      return { ok: true };
    });
  }
  async function restoreNote(a, noteId, revision) {
    return db.runTransaction(async (tx) => {
      const r = ref("notes", noteId),
        s = await tx.get(r);
      if (!s.exists || s.data().authorSchoolParkId !== a.spid)
        m.fail("NOT_FOUND", 404);
      if (s.data().revision !== revision) m.fail("REVISION_CONFLICT", 409);
      if (!s.data().archived || s.data().moderated)
        m.fail("NOTE_NOT_RESTORABLE", 409);
      const next = {
        ...s.data(),
        archived: false,
        visibility: "private",
        revision: revision + 1,
        updatedAtMs: now(),
      };
      tx.set(ref("history", noteId + "-" + revision), {
        noteId,
        authorSchoolParkId: a.spid,
        actorSchoolParkId: a.spid,
        previous: s.data(),
        next,
        changedAtMs: now(),
        action: "restore",
      });
      tx.set(r, next);
      return { id: noteId, revision: next.revision };
    });
  }
  async function ownNotes(a, q = {}) {
    const result = await ownCollection("notes", a, q);
    result.items = result.items.filter(
      (n) => !!n.archived === (q.archived === "1"),
    );
    return result;
  }
  async function noteHistory(a, noteId, q = {}) {
    const current = await note(noteId, a);
    if (!a.owner && current.authorSchoolParkId !== a.spid)
      m.fail("NOT_OWNER", 403);
    let query = db
      .collection(COL("history"))
      .where("noteId", "==", m.id(noteId))
      .orderBy("__name__")
      .limit(21);
    if (q.cursor) query = query.startAfter(m.id(q.cursor));
    const s = await query.get();
    return {
      current,
      items: s.docs.slice(0, 20).map((d) => ({ id: d.id, ...d.data() })),
      next: s.size > 20 ? s.docs[19].id : null,
    };
  }
  async function reconcileActivity(a, q = {}) {
    const aliases = [
      ...new Set(
        [a.walletAddress, a.account?.chesAddress]
          .filter(Boolean)
          .map((v) => v.toLowerCase()),
      ),
    ];
    if (!aliases.length) return { confirmed: 0, needsReview: 1, next: null };
    let query = db
      .collection("post_changes")
      .where("fromAddress", "in", aliases)
      .orderBy("__name__")
      .limit(20);
    if (q.cursor) query = query.startAfter(m.id(q.cursor));
    const changes = await query.get();
    let confirmed = 0,
      needsReview = 0;
    for (const doc of changes.docs) {
      await db.runTransaction(async (tx) => {
        const change = await tx.get(doc.ref);
        if (!change.exists || change.data().status !== "accepted") return;
        if (!/^[a-zA-Z0-9_-]{1,100}$/.test(change.data().postId || "")) {
          needsReview++;
          return;
        }
        const post = await tx.get(
          db.collection("posts").doc(m.id(change.data().postId)),
        );
        if (!post.exists) return;
        const who = await identity.knowledgeParticipant(
          change.data().fromAddress,
          change.data().authorSchoolParkId,
        );
        const recipient = await identity.knowledgeParticipant(
          post.data().address,
          post.data().authorSchoolParkId,
        );
        if (who !== a.spid || !recipient) {
          needsReview++;
          return;
        }
        if (recipient === a.spid) return;
        const record = await activity.prepare(tx, a, [
          {
            kind: "knowledge-improved",
            targetId: doc.id,
            visibility: "private",
          },
        ]);
        record();
        confirmed++;
      });
    }
    return {
      confirmed,
      needsReview,
      next: changes.size === 20 ? changes.docs.at(-1).id : null,
    };
  }
  async function saveBookmark(a, postId, on) {
    await rawPost(postId, a);
    const result = await savedMetrics.save(a, postId, on);
    if (on) await track(a, "save", postId);
    invalidate();
    return result;
  }
  async function bookmarks(a, q) {
    const result = await ownCollection("saved", a, q);
    const items = [];
    for (const item of result.items) {
      try {
        items.push(await post(item.postId, a));
      } catch (e) {
        if (e.status !== 404) throw e;
      }
    }
    return { ...result, items };
  }
  async function history(a, postId) {
    const p = await rawPost(postId, a);
    if (!m.owner(p, a) && !a.owner) m.fail("NOT_OWNER", 403);
    const s = await db
      .collection(COL("history"))
      .where("postId", "==", m.id(postId))
      .limit(50)
      .get();
    return { items: s.docs.map((d) => ({ id: d.id, ...d.data() })) };
  }
  return {
    savedMetrics,
    activity,
    reconcileActivity,
    metrics,
    queueSemantic,
    catalog,
    publicProof,
    readerPlan: async (a) => {
      const plan = a
        ? (await entitlement.getEntitlement(a.uid, a.account)).plan
        : "guest";
      return { plan, guest: entitlement.limitOf(plan, "post") <= 0 };
    },
    actor,
    taxonomy,
    validateFacets,
    init,
    rebuild,
    waitForRebuild,
    syncIndex,
    syncPublicPost,
    search,
    rawPost,
    post,
    quota,
    savePost,
    answerDraft,
    removePost,
    archivePost,
    restorePost,
    myPosts,
    myPublicPosts,
    ownCollection,
    profile,
    writer,
    writers,
    me,
    comparison,
    saveNote,
    note,
    publicNotes,
    archiveNote,
    restoreNote,
    ownNotes,
    noteHistory,
    saveBookmark,
    bookmarks,
    history,
    ref,
    invalidate,
  };
}
module.exports = { createService, COL, MAX_INDEX, MAX_BYTES };
