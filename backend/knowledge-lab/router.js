"use strict";
const express = require("express");
const { randomUUID } = require("node:crypto");
const m = require("./model");
const { createService, COL } = require("./service");
const { createProbeTransport, boundedChecks } = require("./probe-transport");

function createKnowledgeLabRouter(deps) {
  const { db, requireFirebaseUser, requireOwner, rateLimit } = deps;
  const env = deps.env || process.env,
    service = createService(deps),
    router = express.Router();
  const rulesNow = deps.rulesNow || Date.now;
  const probeFetch = createProbeTransport({ env });
  const pendingProbeCleanup = new Set();
  let rulesCheckedAt = 0,
    rulesSafe = false,
    rulesCheck = null,
    rulesFailure = null;
  function failureCode(e) {
    const code = e?.code ?? e?.cause?.code;
    if (Number.isInteger(code) && code >= 0 && code <= 16) return code;
    if (
      [
        "ECONNRESET",
        "ETIMEDOUT",
        "ENOTFOUND",
        "ECONNREFUSED",
        "EAI_AGAIN",
        "CERT_HAS_EXPIRED",
        "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
        "SELF_SIGNED_CERT_IN_CHAIN",
        "DEPTH_ZERO_SELF_SIGNED_CERT",
        "ERR_TLS_CERT_ALTNAME_INVALID",
        "UND_ERR_CONNECT_TIMEOUT",
        "UND_ERR_HEADERS_TIMEOUT",
      ].includes(code)
    )
      return code;
    return ["TimeoutError", "AbortError"].includes(e?.name)
      ? e.name
      : "CHECK_UNAVAILABLE";
  }
  function rejected(collection, stage, code, httpStatus) {
    const diagnostic = {
      stage,
      code,
      ...(collection ? { collection } : {}),
      ...(Number.isInteger(httpStatus) ? { httpStatus } : {}),
    };
    if (!rulesFailure) rulesFailure = diagnostic;
    console.warn("Knowledge Lab: Rules check unavailable", diagnostic);
    return false;
  }
  function rulesDiagnostic() {
    return {
      status: rulesSafe ? "verified" : "not_verified",
      transport: probeFetch.modeFor(env.FIRESTORE_EMULATOR_HOST ? "http://127.0.0.1/" : "https://firestore.googleapis.com/"),
      checkedAtMs: rulesCheckedAt || null,
      retryAfterSeconds: rulesCheckedAt
        ? Math.max(
            0,
            Math.ceil((300000 - (rulesNow() - rulesCheckedAt)) / 1000),
          )
        : 0,
      failure: rulesSafe ? null : rulesFailure,
    };
  }
  // An unprotected collection must never receive private user data. Probe contains no user data.
  async function checkRules() {
    if (rulesSafe && rulesNow() - rulesCheckedAt < 300000) return true;
    if (rulesCheck) return rulesCheck;
    if (!rulesSafe && rulesCheckedAt && rulesNow() - rulesCheckedAt < 300000)
      return false;
    rulesFailure = null;
    rulesCheck = (async () => {
      // Retry only documents this process created successfully. Do not accumulate new
      // probes while cleanup is unavailable, or delete a pre-existing document.
      for (const probe of pendingProbeCleanup) {
        try { await probe.delete(); pendingProbeCleanup.delete(probe); }
        catch (e) { return rejected(null, "cleanup", failureCode(e)); }
      }
      const projectId = db?.projectId;
      if (!projectId || !/^[a-z0-9-]+$/.test(projectId))
        return rejected(null, "preflight", "PROJECT_CONFIGURATION_UNAVAILABLE");
      let origin = "https://firestore.googleapis.com";
      if (env.FIRESTORE_EMULATOR_HOST) {
        if (
          !projectId.startsWith("demo-") ||
          !/^127\.0\.0\.1:\d+$/.test(env.FIRESTORE_EMULATOR_HOST)
        )
          return rejected(null, "preflight", "INVALID_EMULATOR_CONFIGURATION");
        origin = "http://" + env.FIRESTORE_EMULATOR_HOST;
      }
      const checks = await boundedChecks(
        [
          "system",
          "private_posts",
          "archived_posts",
          "writers",
          "notes",
          "search",
          "operations",
          "post_control",
          "saved",
          "reports",
          "history",
          "audit",
          "limits",
          "taxonomy",
        ], 2, async (name) => {
          // Never overwrite a pre-existing document or delete one we did not create.
          const probeId = deps.rulesProbeId
            ? m.id(deps.rulesProbeId())
            : "security-probe-" + randomUUID();
          const probe = service.ref(name, probeId);
          let created = false;
          let stage = "admin-probe-write";
          try {
            await probe.create({ probe: "lab-1" });
            created = true;
            pendingProbeCleanup.add(probe);
            stage = "anonymous-access-check";
            const url =
              origin +
              "/v1/projects/" +
              projectId +
              "/databases/(default)/documents/" +
              COL(name) +
              "/" +
              probeId;
            const responses = await Promise.all([
              probeFetch(url),
              probeFetch(url, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  fields: { probe: { stringValue: "lab-1" } },
                }),
              }),
            ]);
            for (const r of responses) {
              const body = await r.json();
              if (
                r.status !== 403 ||
                body.error?.status !== "PERMISSION_DENIED"
              ) {
                return rejected(
                  name,
                  stage,
                  "UNEXPECTED_RULES_RESPONSE",
                  r.status,
                );
              }
            }
            return true;
          } catch (e) {
            return rejected(name, stage, failureCode(e));
          } finally {
            if (created) {
              try {
                await probe.delete();
                pendingProbeCleanup.delete(probe);
              } catch (e) {
                rejected(name, "cleanup", failureCode(e));
                throw e;
              }
            }
          }
        },
      );
      return checks.every(Boolean);
    })();
    try {
      rulesSafe = await rulesCheck;
      rulesCheckedAt = rulesNow();
      return rulesSafe;
    } catch (e) {
      rulesSafe = false;
      rulesCheckedAt = rulesNow();
      if (!rulesFailure) rejected(null, "check", failureCode(e));
      return false;
    } finally {
      rulesCheck = null;
    }
  }
  const enabled = () => env.KNOWLEDGE_LAB_ENABLED === "true";
  router.get("/config", async (req, res) => {
    const safe = enabled() && !!db && (await checkRules());
    res.set("Cache-Control", "no-store").json({
      enabled: safe,
      reason: !enabled() ? "LAUNCH_HOLD" : !safe ? "RULES_NOT_VERIFIED" : null,
      safetyCheck: !enabled()
        ? { status: "held", failure: null }
        : !db
          ? { status: "not_verified", failure: { stage: "firebase-init", code: "DB_UNAVAILABLE" } }
          : rulesDiagnostic(),
      aiAvailable: false,
      searchMethod: "normalized-substring",
      releaseCommit: /^[a-f0-9]{40}$/i.test(env.RENDER_GIT_COMMIT || '') ? env.RENDER_GIT_COMMIT : null,
    });
  });
  router.use(async (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (!enabled() || !db)
      return res.status(503).json({ error: "LAUNCH_HOLD" });
    if (!(await checkRules()))
      return res.status(503).json({ error: "RULES_NOT_VERIFIED", safetyCheck: rulesDiagnostic() });
    next();
  });
  router.use(
    rateLimit({ windowMs: 60000, max: 90, key: "knowledge-lab-read" }),
  );
  router.use(express.json({ limit: "100kb" }));
  const wrap = (fn) => async (req, res, next) => {
    try {
      res.json(await fn(req));
    } catch (e) {
      next(e);
    }
  };
  const actor = async (req, res, next) => {
    try {
      req.labActor = await service.actor(req);
      next();
    } catch (e) {
      next(e);
    }
  };
  const optional = (req, res, next) =>
    req.headers.authorization
      ? requireFirebaseUser(req, res, () => actor(req, res, next))
      : next();
  const signed = [requireFirebaseUser, actor];
  const write = [
    ...signed,
    rateLimit({ windowMs: 60000, max: 20, key: "knowledge-lab-write" }),
  ];
  const admin = [
    requireOwner,
    actor,
    rateLimit({ windowMs: 60000, max: 30, key: "knowledge-lab-admin" }),
  ];
  router.get(
    "/taxonomy",
    wrap(() => service.taxonomy()),
  );
  router.get(
    "/search",
    optional,
    wrap((req) => service.search(req.query, req.labActor)),
  );
  router.get(
    "/posts/:id",
    optional,
    wrap((req) => service.post(req.params.id, req.labActor)),
  );
  router.put(
    "/posts",
    ...write,
    wrap((req) => service.savePost(req.labActor, req.body)),
  );
  router.post(
    "/posts/:id/withdraw",
    ...write,
    wrap((req) =>
      service.removePost(
        req.labActor,
        req.params.id,
        req.body.revision,
        req.body.key,
      ),
    ),
  );
  router.post(
    "/posts/:id/archive",
    ...write,
    wrap((req) =>
      service.archivePost(req.labActor, req.params.id, req.body.revision),
    ),
  );
  router.post(
    "/posts/:id/restore",
    ...write,
    wrap((req) =>
      service.restorePost(req.labActor, req.params.id, req.body.revision),
    ),
  );
  router.get(
    "/posts/:id/history",
    ...signed,
    wrap((req) => service.history(req.labActor, req.params.id)),
  );
  router.post(
    "/index/:id",
    ...write,
    wrap((req) => service.syncIndex(req.params.id, req.labActor)),
  );
  router.get(
    "/me",
    ...signed,
    wrap((req) => service.me(req.labActor)),
  );
  router.get(
    "/me/posts",
    ...signed,
    wrap((req) => service.myPosts(req.labActor, req.query)),
  );
  router.get(
    "/me/public-posts",
    ...signed,
    wrap((req) => service.myPublicPosts(req.labActor, req.query)),
  );
  router.get(
    "/me/archived",
    ...signed,
    wrap(async (req) => {
      const data = await service.ownCollection(
        "archived_posts",
        req.labActor,
        req.query,
      );
      return {
        ...data,
        items: data.items.map((p) => m.safePost(p.id, p, req.labActor)),
      };
    }),
  );
  router.get(
    "/me/notes",
    ...signed,
    wrap((req) => service.ownNotes(req.labActor, req.query)),
  );
  router.get(
    "/me/saved",
    ...signed,
    wrap((req) => service.bookmarks(req.labActor, req.query)),
  );
  router.put(
    "/saved/:id",
    ...write,
    wrap((req) =>
      service.saveBookmark(
        req.labActor,
        req.params.id,
        req.body.saved === true,
      ),
    ),
  );
  router.put(
    "/me/writer",
    ...write,
    wrap((req) => service.profile(req.labActor, req.body)),
  );
  router.get(
    "/writers",
    wrap((req) => service.writers(req.query)),
  );
  router.get(
    "/writers/:id",
    optional,
    wrap((req) => service.writer(req.params.id, req.labActor)),
  );
  router.get(
    "/writers/:id/contributions",
    optional,
    wrap(async (req) => {
      const spid = m.id(req.params.id);
      await service.writer(spid, req.labActor);
      const params = { ...req.query, author: spid };
      const posts = await service.search(params, req.labActor);
      // Do not scan private notes to build a public profile. Query only public records.
      let q = db
        .collection(COL("notes"))
        .where("visibility", "==", "public")
        .where("authorSchoolParkId", "==", spid)
        .orderBy("__name__")
        .limit(21);
      if (req.query.noteCursor) q = q.startAfter(m.id(req.query.noteCursor));
      const s = await q.get(),
        notes = [];
      for (const d of s.docs.slice(0, 20)) {
        try {
          notes.push(await service.note(d.id, null));
        } catch (e) {
          if (![403, 404].includes(e.status)) throw e;
        }
      }
      return {
        posts: posts.items,
        postNext: posts.next,
        notes,
        noteNext: s.size > 20 ? s.docs[19].id : null,
      };
    }),
  );
  router.post(
    "/compare",
    ...write,
    wrap((req) => service.comparison(req.labActor, req.body)),
  );
  router.get('/answers/:id/draft', ...signed, wrap(req => service.answerDraft(req.labActor, req.params.id)));
  router.get('/requests/:id/answers', ...signed, wrap(async req => {
    let q = db.collection('knowledge_answers').where('requestId','==',m.id(req.params.id)).orderBy('__name__').limit(21);
    if (req.query.cursor) q = q.startAfter(m.id(req.query.cursor));
    const s = await q.get();
    const items = [];
    for (const d of s.docs.slice(0,20)) {
      const v=d.data(), spid=await deps.identity.knowledgeParticipant(v.answerAuthor,v.authorSchoolParkId);
      items.push({id:d.id,experience:v.experience,knowledge:v.knowledge,limits:v.limits,status:v.status,canPublish:spid===req.labActor.spid});
    }
    return {items,next:s.size>20?s.docs[19].id:null};
  }));
  router.put(
    "/notes",
    ...write,
    wrap((req) => service.saveNote(req.labActor, req.body)),
  );
  router.get(
    "/notes",
    optional,
    wrap((req) => service.publicNotes(req.query, req.labActor)),
  );
  router.get(
    "/notes/:id",
    optional,
    wrap((req) => service.note(req.params.id, req.labActor)),
  );
  router.post(
    "/notes/:id/archive",
    ...write,
    wrap((req) =>
      service.archiveNote(req.labActor, req.params.id, req.body.revision),
    ),
  );
  router.post('/notes/:id/restore', ...write, wrap(req => service.restoreNote(req.labActor, req.params.id, req.body.revision)));
  router.get('/notes/:id/history', ...signed, wrap(req => service.noteHistory(req.labActor, req.params.id, req.query)));

  // Existing request/answer documents, quota and EMUER policy remain the authority.
  router.get(
    "/requests",
    ...signed,
    wrap(async (req) => {
      let q = db.collection("knowledge_requests").orderBy("__name__").limit(21);
      if (req.query.cursor) q = q.startAfter(m.id(req.query.cursor));
      const s = await q.get();
      return {
        items: s.docs.slice(0, 20).map((d) => ({
          id: d.id,
          ...d.data(),
          createdAt: m.millis(d.data().createdAt),
        })),
        next: s.size > 20 ? s.docs[19].id : null,
      };
    }),
  );
  router.post(
    "/requests",
    ...write,
    wrap(async (req) => {
      if (!deps.emuerEnabled()) m.fail("USE_EXISTING_REQUEST_FLOW", 409);
      const a = req.labActor,
        b = req.body,
        key = m.id(b.key),
        requestId = "klr-" + m.hash([a.spid, key]);
      const question = m.text(b.question, 160, true),
        context = m.text(b.context, 2000, true);
      if (question.length < 2 || context.length < 5)
        m.fail("REQUEST_TOO_SHORT");
      const facets = await service.validateFacets(b.facets);
      return db.runTransaction(async (tx) => {
        const r = db.collection("knowledge_requests").doc(requestId),
          s = await tx.get(r),
          fingerprint = m.hash(b);
        if (s.exists) {
          if (s.data().labFingerprint !== fingerprint)
            m.fail("IDEMPOTENCY_CONFLICT", 409);
          return { id: requestId };
        }
        const consume = await service.quota(tx, a, "request");
        consume();
        tx.create(r, {
          question,
          context,
          problem: question,
          targetExperience: m.text(b.targetExperience || "", 500),
          facets,
          author: a.walletAddress,
          authorSchoolParkId: a.spid,
          bounty: 1,
          rewardPolicy: "emuer-v2-treasury-1",
          settlementStatus: "treasury_review",
          status: "open",
          answerCount: 0,
          createdAt: new Date(),
          labFingerprint: fingerprint,
        });
        return { id: requestId };
      });
    }),
  );
  router.post(
    "/requests/:id/answer",
    ...write,
    wrap(async (req) => {
      const a = req.labActor,
        b = req.body,
        key = m.id(b.key),
        requestId = m.id(req.params.id),
        answerId = "kla-" + m.hash([a.spid, key, requestId]);
      const value = {
        experience: m.text(b.experience, 2000, true),
        knowledge: m.text(b.knowledge, 3000, true),
        limits: m.text(b.limits, 1000, true),
      };
      if (
        value.experience.length < 10 ||
        value.knowledge.length < 10 ||
        value.limits.length < 3
      )
        m.fail("ANSWER_TOO_SHORT");
      return db.runTransaction(async (tx) => {
        const r = db.collection("knowledge_requests").doc(requestId),
          ar = db.collection("knowledge_answers").doc(answerId),
          [s, as] = await Promise.all([tx.get(r), tx.get(ar)]),
          fingerprint = m.hash(b);
        if (as.exists) {
          if (as.data().labFingerprint !== fingerprint)
            m.fail("IDEMPOTENCY_CONFLICT", 409);
          return { id: answerId };
        }
        if (!s.exists || s.data().status !== "open")
          m.fail("REQUEST_CLOSED", 409);
        const participants = await deps.identity.knowledgeParticipants(s.data(), {
          answerAuthor: a.walletAddress, authorSchoolParkId: a.spid,
        });
        if (!participants.ok) m.fail(participants.code, participants.code === 'SELF_ANSWER' ? 403 : 409);
        const consume = await service.quota(tx, a, "answer");
        consume();
        tx.create(ar, {
          ...value,
          requestId,
          requestAuthor: s.data().author,
          answerAuthor: a.walletAddress,
          authorSchoolParkId: a.spid,
          status: "submitted",
          createdAt: new Date(),
          labFingerprint: fingerprint,
        });
        tx.update(r, { answerCount: Number(s.data().answerCount || 0) + 1 });
        return { id: answerId };
      });
    }),
  );
  router.post(
    "/reports",
    ...write,
    wrap(async (req) => {
      const a = req.labActor,
        b = req.body,
        targetId = m.id(b.targetId),
        kind = ["post", "note", "writer"].includes(b.kind) ? b.kind : null;
      if (!kind) m.fail("INVALID_TARGET");
      if (kind === "post") await service.rawPost(targetId, a);
      if (kind === "note") await service.note(targetId, a);
      if (kind === "writer") await service.writer(targetId, a);
      const reason = m.text(b.reason, 1500, true),
        r = service.ref("reports", m.hash([a.spid, kind, targetId]));
      await db.runTransaction(async (tx) => {
        const s = await tx.get(r);
        tx.set(r, {
          authorSchoolParkId: a.spid,
          kind,
          targetId,
          reason,
          status: "open",
          createdAtMs: s.exists ? s.data().createdAtMs : Date.now(),
          updatedAtMs: Date.now(),
        });
      });
      return { ok: true };
    }),
  );
  router.post(
    "/admin/init",
    ...admin,
    wrap((req) => service.init(req.labActor)),
  );
  router.post(
    "/admin/index",
    ...admin,
    wrap((req) => service.rebuild(req.labActor)),
  );
  router.get(
    "/admin/summary",
    ...admin,
    wrap(async () => {
      const counts = {};
      for (const name of [
        "writers",
        "notes",
        "reports",
        "private_posts",
        "search",
      ]) {
        const s = await db.collection(COL(name)).count().get();
        counts[name] = s.data().count;
      }
      const requests = await db.collection("knowledge_requests").count().get();
      const index = await service.ref("system", "index").get();
      const writers7 = await db
        .collection(COL("writers"))
        .where("createdAtMs", ">=", Date.now() - 7 * 86400000)
        .count()
        .get();
      const unanswered = await db
        .collection("knowledge_requests")
        .where("answerCount", "==", 0)
        .count()
        .get();
      const knowledge = await db
        .collection("posts")
        .where("knowledgeLab.quality", "==", "本人の経験（自己申告）")
        .count()
        .get();
      const fieldCounts = {};
      for (const term of (await service.taxonomy()).filter(
        (t) => t.axis === "field" && t.active,
      )) {
        fieldCounts[term.id] = (
          await db
            .collection("posts")
            .where("knowledgeLab.facets.field", "array-contains", term.id)
            .count()
            .get()
        ).data().count;
      }
      return {
        counts: {
          ...counts,
          requests: requests.data().count,
          newWriters7: writers7.data().count,
          unanswered: unanswered.data().count,
          experiencePosts: knowledge.data().count,
        },
        fieldCounts,
        index: index.exists ? index.data() : null,
        limits: {
          indexDocuments: 20000,
          indexCacheMiB: 64,
          noteLimitPerWriter: 1000,
        },
        aiAvailable: false,
      };
    }),
  );
  router.get(
    "/admin/list/:kind",
    ...admin,
    wrap(async (req) => {
      const names = {
        writers: COL("writers"),
        notes: COL("notes"),
        reports: COL("reports"),
        private_posts: COL("private_posts"),
        requests: "knowledge_requests",
        posts: "posts",
      };
      const name = names[req.params.kind];
      if (!name) m.fail("INVALID_LIST");
      let q = db.collection(name).orderBy("__name__").limit(21);
      if (req.query.cursor) q = q.startAfter(m.id(req.query.cursor));
      const s = await q.get();
      return {
        items: s.docs
          .slice(0, 20)
          .filter((d) => d.id !== "security-probe"
            && !(d.id.startsWith("security-probe-") && d.data().probe === "lab-1"))
          .filter((d) => req.params.kind !== "posts" || m.publicPost(d.data()))
          .map((d) => ({
            id: d.id,
            ...d.data(),
            createdAt: m.millis(d.data().createdAt),
            updatedAt: m.millis(d.data().updatedAt),
          })),
        next: s.size > 20 ? s.docs[19].id : null,
      };
    }),
  );
  router.get('/admin/reward-review', ...admin, wrap(async req => {
    let query = db.collection('emuer_v2_rewards').where('kind','==','knowledge-answer').orderBy('__name__').limit(21);
    if(req.query.cursor) query=query.startAfter(m.id(req.query.cursor));
    const s=await query.get(),items=[];
    for(const d of s.docs.slice(0,20)){
      const v=d.data();
      if(!/^[a-zA-Z0-9_-]{1,100}$/.test(v.requestId||'') || !/^[a-zA-Z0-9_-]{1,100}$/.test(v.answerId||'')){
        items.push({id:d.id,status:v.status,identityCheck:'IDENTITY_REVIEW_REQUIRED'});continue;
      }
      const rs=await db.collection('knowledge_requests').doc(v.requestId).get(),as=await db.collection('knowledge_answers').doc(v.answerId).get();
      const result=rs.exists&&as.exists?await deps.identity.knowledgeParticipants(rs.data(),as.data()):{ok:false,code:'IDENTITY_REVIEW_REQUIRED'};
      items.push({id:d.id,requestId:v.requestId,answerId:v.answerId,status:v.status,identityCheck:result.ok?'distinct-passports':result.code});
    }
    return {items,next:s.size>20?s.docs[19].id:null,readOnly:true};
  }));
  router.put(
    "/admin/taxonomy/:id",
    ...admin,
    wrap(async (req) => {
      const a = req.labActor,
        b = req.body,
        id = m.id(req.params.id),
        terms = await service.taxonomy(),
        old = terms.find((t) => t.id === id);
      if (!old && terms.length >= 400) m.fail("TAXONOMY_LIMIT", 403);
      const axis = old?.axis || b.axis;
      if (!m.AXES.includes(axis)) m.fail("INVALID_AXIS");
      const mergedInto = b.mergedInto ? m.id(b.mergedInto) : null;
      if (mergedInto) {
        const dest = terms.find((t) => t.id === mergedInto);
        if (
          !dest ||
          dest.axis !== axis ||
          !dest.active ||
          dest.mergedInto ||
          terms.some((t) => t.mergedInto === id) ||
          mergedInto === id
        )
          m.fail("INVALID_MERGE");
      }
      return db.runTransaction(async (tx) => {
        const r = service.ref("taxonomy", id),
          s = await tx.get(r),
          revision = s.exists ? s.data().revision : 0;
        if (b.revision !== revision) m.fail("REVISION_CONFLICT", 409);
        const value = {
          axis,
          label: m.text(b.label, 60, true),
          active: b.active !== false && !mergedInto,
          mergedInto,
          revision: revision + 1,
          updatedAtMs: Date.now(),
        };
        tx.set(r, value);
        tx.create(db.collection(COL("audit")).doc(), {
          kind: "taxonomy",
          targetId: id,
          actorSchoolParkId: a.spid,
          previous: s.exists ? s.data() : null,
          next: value,
          atMs: Date.now(),
        });
        return { id, ...value };
      });
    }),
  );
  router.post(
    "/admin/reports/:id",
    ...admin,
    wrap(async (req) => {
      const b = req.body,
        status = b.status;
      if (!["open", "reviewing", "resolved", "dismissed"].includes(status))
        m.fail("INVALID_STATUS");
      const r = service.ref("reports", req.params.id),
        s = await r.get();
      if (!s.exists) m.fail("NOT_FOUND", 404);
      const note = m.text(b.note || "", 1500);
      const batch = db.batch();
      batch.update(r, { status, operatorNote: note, updatedAtMs: Date.now() });
      batch.create(db.collection(COL("audit")).doc(), {
        kind: "report",
        targetId: req.params.id,
        actorSchoolParkId: req.labActor.spid,
        status,
        note,
        atMs: Date.now(),
      });
      await batch.commit();
      return { ok: true };
    }),
  );
  router.post(
    "/admin/classify/:id",
    ...admin,
    wrap(async (req) => {
      const postId = m.id(req.params.id),
        facets = await service.validateFacets(req.body.facets),
        reason = m.text(req.body.reason, 500, true);
      await db.runTransaction(async (tx) => {
        const r = db.collection("posts").doc(postId),
          s = await tx.get(r);
        if (!s.exists || !m.publicPost(s.data())) m.fail("NOT_FOUND", 404);
        const p = s.data(),
          rev = p.knowledgeLab?.revision || 0;
        if (req.body.revision !== rev) m.fail("REVISION_CONFLICT", 409);
        const value = {
          ...p,
          knowledgeLab: {
            ...p.knowledgeLab,
            facets,
            classificationSource: "operator",
            quality:
              p.knowledgeLab?.quality ||
              "投稿者の知識・分類は運営が付与（内容未検証）",
            revision: rev + 1,
          },
        };
        tx.set(service.ref("history", postId + "-" + rev), {
          postId,
          previous: p,
          changedAtMs: Date.now(),
          changedBy: req.labActor.spid,
        });
        tx.set(r, value);
        tx.set(service.ref("search", postId), m.indexPost(postId, value));
        tx.create(db.collection(COL("audit")).doc(), {
          kind: "classification",
          targetId: postId,
          actorSchoolParkId: req.labActor.spid,
          reason,
          atMs: Date.now(),
        });
      });
      service.invalidate();
      return { ok: true };
    }),
  );
  router.post(
    "/admin/visibility/:kind/:id",
    ...admin,
    wrap(async (req) => {
      const kind = req.params.kind;
      if (!["writer", "note"].includes(kind)) m.fail("INVALID_TARGET");
      const r = service.ref(
          kind === "writer" ? "writers" : "notes",
          req.params.id,
        ),
        reason = m.text(req.body.reason, 500, true);
      if (!["hide", "release"].includes(req.body.action))
        m.fail("INVALID_ACTION");
      await db.runTransaction(async (tx) => {
        const s = await tx.get(r);
        if (!s.exists) m.fail("NOT_FOUND", 404);
        const v = s.data();
        if (req.body.revision !== v.revision) m.fail("REVISION_CONFLICT", 409);
        tx.update(r, {
          moderated: req.body.action === "hide",
          ...(kind === "writer"
            ? { published: false }
            : { visibility: "private" }),
          revision: v.revision + 1,
          updatedAtMs: Date.now(),
        });
        tx.create(db.collection(COL("audit")).doc(), {
          kind: "moderation-" + kind,
          targetId: req.params.id,
          action: req.body.action,
          actorSchoolParkId: req.labActor.spid,
          reason,
          atMs: Date.now(),
        });
      });
      return { ok: true };
    }),
  );
  router.post(
    "/admin/posts/:id",
    ...admin,
    wrap(async (req) => {
      const postId = m.id(req.params.id),
        b = req.body,
        reason = m.text(b.reason, 500, true);
      if (!["hide", "restore", "feature", "unfeature"].includes(b.action))
        m.fail("INVALID_ACTION");
      await db.runTransaction(async (tx) => {
        const pub = db.collection("posts").doc(postId),
          priv = service.ref("private_posts", postId),
          [ps, ds] = await Promise.all([tx.get(pub), tx.get(priv)]),
          p = ds.exists
            ? ds.data()
            : ps.exists && m.publicPost(ps.data())
              ? ps.data()
              : null;
        if (!p) m.fail("NOT_FOUND", 404);
        if (b.action === "restore" && !p.knowledgeLab?.hidden)
          m.fail("NOT_MODERATED", 409);
        if (
          b.action === "restore" &&
          p.knowledgeLab?.beforeModeration !== "public"
        )
          m.fail("PRIVATE_POST_CANNOT_BE_PUBLISHED", 403);
        const rev = p.knowledgeLab?.revision || 0;
        if (b.revision !== rev) m.fail("REVISION_CONFLICT", 409);
        tx.create(db.collection(COL("audit")).doc(), {
          kind: "moderation",
          targetId: postId,
          actorSchoolParkId: req.labActor.spid,
          action: b.action,
          reason,
          atMs: Date.now(),
        });
        tx.set(service.ref("history", postId + "-" + rev), {
          postId,
          previous: p,
          changedAtMs: Date.now(),
          changedBy: req.labActor.spid,
        });
        const lab = { ...p.knowledgeLab, revision: rev + 1 };
        if (b.action === "hide") {
          lab.hidden = true;
          lab.beforeModeration = p.visibility || "public";
          tx.set(priv, { ...p, visibility: "private", knowledgeLab: lab });
          tx.set(pub, m.tombstone(p, rev + 1));
          tx.set(
            service.ref("search", postId),
            m.indexPost(postId, m.tombstone(p, rev + 1)),
          );
        } else if (b.action === "restore") {
          lab.hidden = false;
          const value = { ...p, visibility: "public", knowledgeLab: lab };
          tx.set(pub, value);
          tx.delete(priv);
          tx.set(service.ref("search", postId), m.indexPost(postId, value));
        } else {
          if (!ps.exists) m.fail("PRIVATE_POST_CANNOT_BE_FEATURED", 403);
          lab.featured = b.action === "feature";
          const value = { ...p, knowledgeLab: lab };
          tx.set(pub, value);
          tx.set(service.ref("search", postId), m.indexPost(postId, value));
        }
      });
      service.invalidate();
      return { ok: true };
    }),
  );
  router.use((e, req, res, next) => {
    if (res.headersSent) return next(e);
    const status = e.status || (e.type === "entity.too.large" ? 413 : 500);
    if (status >= 500)
      console.warn("Knowledge Lab:", e.status ? e.message : "request failed");
    res.status(status).json({
      error: e.status
        ? e.message
        : status === 413
          ? "INPUT_TOO_LARGE"
          : "SERVICE_UNAVAILABLE",
    });
  });
  return { router, service, checkRules };
}
module.exports = { createKnowledgeLabRouter };
