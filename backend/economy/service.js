"use strict";
const { configuration, hash, fail, day } = require("./config");
const { safeText } = require("./agent");
const { randomUUID } = require("node:crypto");
const { createFreeTierGuard, providerDay, LIMITS } = require("./free-tier");
const PRODUCT = "agent_schoolpark-explorer-v1";
const LIVE = [
  "awaiting_payment",
  "queued",
  "running",
  "result_saved",
  "refund_pending",
];
const TERMINAL = ["completed", "refunded", "failed", "expired"];
function createEconomy({
  db,
  identity,
  entitlement,
  payments,
  sources,
  agent,
  env = process.env,
  now = Date.now,
}) {
  const config = () => configuration(env, now());
  const ref = (kind, id) => db.collection("emuer_v2_agent_" + kind).doc(id);
  const freeTier = createFreeTierGuard({ db, now });
  async function actor(auth) {
    if (!auth?.uid) fail("AUTH_REQUIRED", 401);
    const spid = await identity.findByUid(auth.uid),
      p = spid && (await identity.readIdentity(spid));
    if (!p || p.status !== "active") fail("PASSPORT_REQUIRED", 403);
    return { ...auth, spid };
  }
  async function status() {
    const c = config(),
      p = (await ref("products", PRODUCT).get()).data(),
      safety = (await ref("system", "provider-safety").get()).data(),
      providerUsage =
        (await ref("free_usage", providerDay(now())).get()).data() || {};
    const blockers = [...c.blockers];
    if (safety?.stopped === true)
      blockers.push("PROVIDER_USAGE_REVIEW_REQUIRED");
    if (
      (providerUsage.count || 0) >= LIMITS.dailyRequests ||
      (providerUsage.reservedTokens || 0) + c.reserveTokens > LIMITS.dailyTokens
    )
      blockers.push("AI_PROVIDER_DAY_LIMIT");
    if (
      !p ||
      p.status !== "live" ||
      ![c.name, "SchoolPark Explorer"].includes(p.name) ||
      p.prices?.EMUER !== c.price ||
      p.termsVersion !== c.termsVersion
    )
      blockers.push("SERVICE_PRODUCT_UNVERIFIED");
    return {
      service: { ...c, enabled: !blockers.length, blockers },
      external: require("./external").capability,
    };
  }
  async function allowed(a, reserved = false) {
    const c = (await status()).service;
    if (!reserved && c.blockers.includes("AI_PROVIDER_DAY_LIMIT"))
      fail("AI_PROVIDER_DAY_LIMIT", 429);
    if (
      c.blockers.some(
        (reason) => !reserved || reason !== "AI_PROVIDER_DAY_LIMIT",
      )
    )
      fail("SERVICE_DISABLED", 503);
    // Paid requests must re-read membership on quote, payment and execution:
    // an expired grant or a changed subscription cannot use a cached higher tier.
    const plan = (
      await entitlement.getEntitlement(a.uid, a.account, { fresh: true })
    ).plan;
    if (!c.plans.includes(plan)) fail("SERVICE_NOT_ELIGIBLE", 403);
    const e = (await ref("eligibility", hash(a.spid)).get()).data();
    // Do not infer age from LINE/Google login or self-declared dates. Provider policy gate is server-owned.
    if (
      e?.adultVerified !== true ||
      e?.providerAllowed !== true ||
      !(e.validUntilMs > now())
    )
      fail("AI_AUDIENCE_NOT_VERIFIED", 403);
    const worker = (await ref("system", "worker-health").get()).data();
    if (worker?.healthy !== true || !(worker.validUntilMs > now()))
      fail("WORKER_UNHEALTHY", 503);
    return c;
  }
  async function quote(a, input) {
    const c = await allowed(a),
      goal = safeText(input.goal, 300);
    const searchProfile = c.searchProfile;
    const contextPermissions = {
      balance: input.balanceConsent === true,
      achievements: input.achievementsConsent === true,
    };
    if (
      (contextPermissions.balance && !searchProfile?.balanceAvailable) ||
      (contextPermissions.achievements && !searchProfile?.achievementsAvailable)
    )
      fail("PRIVATE_CONTEXT_UNAVAILABLE", 403);
    const qr = ref("quote_usage", hash([a.spid, Math.floor(now() / 60000)]));
    await db.runTransaction(async (tx) => {
      const s = await tx.get(qr),
        count = s.data()?.count || 0;
      if (count >= 6) fail("QUOTE_RATE_LIMIT", 429);
      tx.set(qr, { count: count + 1, deleteAfter: new Date(now() + 86400000) });
    });
    const id = randomUUID(),
      q = {
        spid: a.spid,
        uid: a.uid,
        wallet: String(a.walletAddress || "").toLowerCase(),
        goal,
        serviceId: c.id,
        price: c.price,
        termsVersion: c.termsVersion,
        searchProfile,
        scopeSnapshot: c.scope,
        contextPermissions,
        expiresAtMs: now() + 10 * 60000,
        deleteAfter: new Date(now() + 30 * 86400000),
      };
    await ref("quotes", id).create(q);
    return {
      id,
      price: c.price,
      currency: c.currency,
      scope: c.scope,
      searchProfile,
      contextPermissions,
      refund: c.refund,
      termsVersion: c.termsVersion,
      expiresAtMs: q.expiresAtMs,
      method: "emuer_ledger",
      quotas: {
        globalDaily: c.globalDaily,
        personDaily: c.personDaily,
        concurrency: c.concurrency,
      },
      notice:
        (searchProfile
          ? "横断探索の同意版: " +
            searchProfile.version +
            "。Googleへ送るのは定義済みのテーマ・目的と検証済み公開資料です。入力原文・残高・本人実績は送りません。本人情報で絞る場合は依頼料金支払い後の状態を参照します。 "
          : "") +
        "未受取EMUERから支払います。入力文はサービス内で照合し、AIへ目的の種類と対象の公開資料だけを送信します。氏名・住所・秘密は入力しないでください。受付した依頼は失敗時も当日の利用枠に数えます。商品交換枠は消費しません。無料AI枠を保護するため、依頼全体で2件/分・米国太平洋時間でも20依頼/日の追加制限があります。枠不足や障害では受付を停止し、処理を提供できない依頼は全額返却します。",
    };
  }
  async function owned(a, id) {
    if (!/^[a-f0-9]{40}$/.test(String(id))) fail("JOB_NOT_FOUND", 404);
    const j = (await ref("jobs", id).get()).data();
    if (!j || j.spid !== a.spid) fail("JOB_NOT_FOUND", 404);
    return j;
  }
  async function submit(a, b) {
    if (b.method && b.method !== "emuer_ledger")
      fail("PAYMENT_METHOD_DISABLED", 400);
    if (!/^[A-Za-z0-9_-]{16,80}$/.test(b.requestId || ""))
      fail("IDEMPOTENCY_KEY_REQUIRED", 400);
    if (b.paymentConsent !== true || b.aiConsent !== true)
      fail("CONSENT_REQUIRED", 400);
    const id = hash([a.spid, b.requestId]).slice(0, 40),
      jr = ref("jobs", id);
    const fingerprint = hash([b.quoteId, b.termsVersion, "emuer_ledger"]);
    const prior = (await jr.get()).data();
    if (prior) {
      if (prior.fingerprint !== fingerprint) fail("IDEMPOTENCY_KEY_CONFLICT");
      return view(a, id);
    }
    const c = await allowed(a);
    if (typeof b.quoteId !== "string" || !/^[a-f0-9-]{36}$/.test(b.quoteId))
      fail("INVALID_QUOTE", 400);
    const qr = ref("quotes", b.quoteId),
      bucket = day(now()),
      gr = ref("usage", bucket),
      pr = ref("usage", hash([bucket, a.spid]));
    await db.runTransaction(async (tx) => {
      const [js, qs, gs, ps] = await Promise.all([
        tx.get(jr),
        tx.get(qr),
        tx.get(gr),
        tx.get(pr),
      ]);
      if (js.exists) {
        if (js.data().fingerprint !== fingerprint)
          fail("IDEMPOTENCY_KEY_CONFLICT");
        return;
      }
      const q = qs.data(),
        g = gs.data() || {},
        p = ps.data() || {};
      if (
        !q ||
        q.spid !== a.spid ||
        q.expiresAtMs <= now() ||
        q.usedBy ||
        q.wallet !== String(a.walletAddress || "").toLowerCase() ||
        q.price !== c.price ||
        q.termsVersion !== c.termsVersion ||
        b.termsVersion !== q.termsVersion ||
        (q.searchProfile?.fingerprint || null) !==
          (c.searchProfile?.fingerprint || null) ||
        (q.searchProfile &&
          b.searchConsentVersion !== q.searchProfile.version) ||
        (q.contextPermissions?.balance &&
          (b.balanceConsent !== true || !c.searchProfile?.balanceAvailable)) ||
        (q.contextPermissions?.achievements &&
          (b.achievementsConsent !== true ||
            !c.searchProfile?.achievementsAvailable))
      )
        fail("QUOTE_EXPIRED_OR_CHANGED");
      if ((g.count || 0) >= c.globalDaily || (p.count || 0) >= c.personDaily)
        fail("AI_DAILY_LIMIT", 429);
      if ((g.reservedTokens || 0) + c.reserveTokens > c.tokenBudget)
        fail("AI_BUDGET_LIMIT", 429);
      const providerReservation = await freeTier.admission(tx, c.reserveTokens);
      tx.create(jr, {
        spid: a.spid,
        uid: a.uid,
        walletAddress: q.wallet,
        goal: q.goal,
        fingerprint,
        orderId: "agent_" + id,
        state: "awaiting_payment",
        createdAtMs: now(),
        updatedAtMs: now(),
        paymentUntilMs: now() + 10 * 60000,
        bucket,
        providerBucket: providerReservation.bucket,
        price: q.price,
        quoteId: b.quoteId,
        termsVersion: q.termsVersion,
        searchProfile: q.searchProfile || null,
        scopeSnapshot: q.scopeSnapshot || null,
        contextPermissions: q.contextPermissions || {
          balance: false,
          achievements: false,
        },
        consentAtMs: now(),
        events: [{ state: "awaiting_payment", atMs: now() }],
        deleteAfter: new Date(now() + 30 * 86400000),
        result: null,
      });
      tx.set(qr, { usedBy: id }, { merge: true });
      tx.set(
        gr,
        {
          count: (g.count || 0) + 1,
          reservedTokens: (g.reservedTokens || 0) + c.reserveTokens,
        },
        { merge: true },
      );
      tx.set(pr, { count: (p.count || 0) + 1 }, { merge: true });
      providerReservation.commit();
    });
    await pay(id);
    return view(a, id);
  }
  async function transition(id, from, patch, token) {
    return db.runTransaction(async (tx) => {
      const r = ref("jobs", id),
        s = await tx.get(r),
        j = s.data();
      if (!j || !from.includes(j.state) || (token && j.leaseToken !== token))
        return false;
      tx.set(
        r,
        {
          ...patch,
          events: [...(j.events || []), { state: patch.state, atMs: now() }],
          updatedAtMs: now(),
        },
        { merge: true },
      );
      return true;
    });
  }
  async function pay(id) {
    const jr = ref("jobs", id),
      j = (await jr.get()).data();
    if (!j || j.state !== "awaiting_payment") return;
    if (j.paymentUntilMs <= now()) {
      await transition(id, ["awaiting_payment"], {
        state: "expired",
        error: "PAYMENT_EXPIRED",
      });
      return;
    }
    // Check the same server-owned identity mapping again during restart recovery.
    let a;
    try {
      a = await actor({ uid: j.uid, walletAddress: j.walletAddress });
      if (a.spid !== j.spid) fail("IDENTITY_CHANGED");
      await allowed(a, true); // Capacity is already reserved by this durable job.
      await payments.pay({
        id: j.orderId,
        actor: a,
        jobId: id,
        productId: PRODUCT,
        gate: {
          ref: jr,
          validate(s, product) {
            const priced = product.data();
            if (
              priced?.prices?.EMUER !== j.price ||
              priced?.termsVersion !== j.termsVersion
            )
              fail("SERVICE_PRICE_CHANGED");
            const cur = s.data();
            if (cur?.providerBucket !== providerDay(now()))
              fail("FREE_QUOTA_WINDOW_EXPIRED");
            if (
              !cur ||
              cur.state !== "awaiting_payment" ||
              cur.paymentUntilMs <= now() ||
              cur.fingerprint !== j.fingerprint
            )
              fail("PAYMENT_CLOSED");
          },
          patch: {
            state: "queued",
            paidAtMs: now(),
            updatedAtMs: now(),
            events: [...(j.events || []), { state: "queued", atMs: now() }],
          },
        },
      });
    } catch (e) {
      // No payment is guessed from a failed network read. Existing ledger pay + queued are one transaction.
      if (
        [
          "INSUFFICIENT_EMUER",
          "WALLET_REQUIRED",
          "SERVICE_NOT_ELIGIBLE",
          "AI_AUDIENCE_NOT_VERIFIED",
          "IDENTITY_CHANGED",
          "FREE_QUOTA_WINDOW_EXPIRED",
        ].includes(e.message)
      )
        await transition(id, ["awaiting_payment"], {
          state: "failed",
          error: e.message,
        });
      // Transient/unknown failures stay recoverable; do not return provider/RPC errors to clients/logs.
    }
  }
  async function view(a, id, includeResult = true) {
    const j = await owned(a, id);
    const order = await payments.get(j.orderId);
    let result = includeResult ? j.result : null;
    if (result?.results && j.searchProfile) {
      result = await sources.cross.revalidateResult(
        a,
        result,
        j.searchProfile,
        j.contextPermissions,
      );
    } else if (result?.results)
      result = {
        ...result,
        results: await sources.revalidate(a, j.goal, result.results),
      };
    return {
      id,
      state: j.state,
      price: j.price,
      createdAtMs: j.createdAtMs,
      updatedAtMs: j.updatedAtMs,
      error: j.error || null,
      hasResult: !!j.result,
      searchProfile: j.searchProfile || null,
      scopeSnapshot: j.scopeSnapshot || null,
      progress: j.progress || null,
      events: (j.events || []).map((e) => ({ state: e.state, atMs: e.atMs })),
      payment: order
        ? {
            status: order.status,
            method: order.method,
            amount: order.amount,
            refunded: order.status === "refunded",
          }
        : null,
      result,
    };
  }
  async function processing(a) {
    const s = await db
      .collection("emuer_v2_agent_jobs")
      .where("spid", "==", a.spid)
      .limit(101)
      .get();
    if (s.size > 100) return null;
    let amount = 0;
    for (const d of s.docs) {
      const j = d.data();
      if (
        !["queued", "running", "result_saved", "refund_pending"].includes(
          j.state,
        )
      )
        continue;
      const o = await payments.get(j.orderId);
      if (!o) return null;
      if (o.status !== "refunded") amount += o.amount;
    }
    return String(amount);
  }
  async function history(a) {
    const s = await db
      .collection("emuer_v2_agent_jobs")
      .where("spid", "==", a.spid)
      .limit(100)
      .get();
    return Promise.all(
      s.docs
        .sort((x, y) => y.data().createdAtMs - x.data().createdAtMs)
        .slice(0, 50)
        .map((d) => view(a, d.id, false)),
    );
  }
  async function refund(id) {
    const j = (await ref("jobs", id).get()).data();
    if (j?.state !== "refund_pending") return;
    try {
      const result = await payments.refund(j.orderId, id);
      if (result.status === "refunded")
        await transition(id, ["refund_pending"], {
          state: "refunded",
          refundedAtMs: now(),
        });
    } catch (_) {
      /* Durable refund_pending. Never claim a return without confirmation. */
    }
  }
  async function settle(id) {
    const j = (await ref("jobs", id).get()).data();
    if (j?.state !== "result_saved") return;
    try {
      await payments.fulfill(j.orderId, id);
      await transition(id, ["result_saved"], { state: "completed" });
    } catch (_) {
      /* Saved result survives a restart; do not invoke AI again. */
    }
  }
  async function reportProgress(id, token, progress) {
    await db.runTransaction(async (tx) => {
      const r = ref("jobs", id),
        snap = await tx.get(r),
        j = snap.data();
      if (
        !j ||
        j.state !== "running" ||
        j.leaseToken !== token ||
        j.leaseUntilMs <= now()
      )
        fail("LEASE_EXPIRED");
      tx.set(r, { progress }, { merge: true });
    });
  }
  async function work(id) {
    const token = randomUUID(),
      slots = ref("system", "slots"),
      jr = ref("jobs", id);
    const leased = await db.runTransaction(async (tx) => {
      const [js, ss] = await Promise.all([tx.get(jr), tx.get(slots)]),
        j = js.data();
      if (!j || j.state !== "queued" || j.retryAfterMs > now()) return false;
      const active = (ss.data()?.active || []).filter((v) => v.untilMs > now());
      if (active.length >= config().concurrency) return false;
      tx.set(
        jr,
        {
          state: "running",
          events: [...(j.events || []), { state: "running", atMs: now() }],
          leaseToken: token,
          leaseUntilMs: now() + 300000,
          updatedAtMs: now(),
        },
        { merge: true },
      );
      tx.set(slots, {
        active: [...active, { token, untilMs: now() + 300000 }],
      });
      return true;
    });
    if (!leased) return;
    try {
      const j = (await jr.get()).data(),
        a = await actor({ uid: j.uid, walletAddress: j.walletAddress });
      if (a.spid !== j.spid) fail("IDENTITY_CHANGED");
      const c = await allowed(a, true);
      const budget = (await ref("usage", j.bucket).get()).data();
      if (
        j.termsVersion !== c.termsVersion ||
        j.bucket !== day(now()) ||
        j.providerBucket !== providerDay(now()) ||
        now() > j.paymentUntilMs ||
        !budget ||
        budget.reservedTokens > c.tokenBudget
      )
        fail("EXECUTION_BUDGET_EXPIRED");
      const payment = await payments.get(j.orderId);
      if (payment?.status !== "paid") fail("PAYMENT_NOT_CONFIRMED");
      let bundle = null;
      if (j.searchProfile) {
        try {
          if (!sources.cross) fail("CROSS_SEARCH_DISABLED", 503);
          await reportProgress(id, token, "collecting_public_sources");
          bundle = await sources.cross.collect(
            a,
            j.goal,
            j.searchProfile,
            j.contextPermissions,
          );
        } catch (error) {
          error.generationAttempted = false;
          throw error;
        }
      }
      const material = bundle
        ? bundle.sources
        : await sources.candidates(a, j.goal);
      // Source scans may be slow. A fenced worker must not begin a provider request after losing its lease.
      const fresh = (await jr.get()).data();
      if (
        fresh.state !== "running" ||
        fresh.leaseToken !== token ||
        fresh.leaseUntilMs < now() + 90000
      )
        fail("LEASE_EXPIRED");
      await jr.set({ providerAttemptedAtMs: now() }, { merge: true });
      const result = await agent(
        j.goal,
        material,
        async (selected) => {
          await allowed(a, true);
          const checked = j.searchProfile
            ? (
                await sources.cross.current(
                  a,
                  selected,
                  j.searchProfile,
                  j.contextPermissions,
                  { checkPrivate: false },
                )
              ).sources
            : await sources.candidates(a, j.goal);
          const current = new Map(checked.map((s) => [s.key, s]));
          for (const s of selected) {
            const live = current.get(s.key);
            if (!live || live.title !== s.title || live.summary !== s.summary)
              fail("AI_SOURCE_CHANGED", 409);
          }
          if (j.searchProfile)
            await reportProgress(id, token, "comparing_verified_sources");
          const ready = (await jr.get()).data();
          if (
            ready.state !== "running" ||
            ready.leaseToken !== token ||
            ready.leaseUntilMs < now() + 60000
          )
            fail("LEASE_EXPIRED");
        },
        (operation) => freeTier.beforeCall(operation, id, token),
        bundle
          ? { profileVersion: j.searchProfile.version, plan: bundle.plan }
          : {},
      );
      if (bundle) {
        result.coverage = bundle.coverage;
        result.profileVersion = j.searchProfile.version;
        result.searchMetrics = {
          searchMs: bundle.searchMs,
          searchRounds: 2,
          candidateLimit: 12,
          selectedByProvider: result.results.length,
          generationCalls: result.usage.providerCalled ? 1 : 0,
        };
        result.privateContext = bundle.context;
        result.referencedDomains = [
          ...new Set(result.results.map((s) => s.domain)),
        ];
        result.limitations = bundle.coverage
          .filter((d) =>
            ["disabled", "unavailable", "no_approved_data"].includes(d.state),
          )
          .map(
            (d) =>
              d.label +
              {
                disabled: "はこの依頼の連携対象外です。",
                unavailable: "の取得に失敗したため回答に使っていません。",
                no_approved_data:
                  "には今回利用できるAI許諾済み資料がありません。",
              }[d.state],
          );
        if (bundle.plan.domains.includes("knowledge_lab"))
          result.limitations.push(
            "研究ノートの直接探索はAI利用許諾の連携待ちです。公開投稿として残された研究成果は、投稿の許諾に従って扱います。",
          );
        if (
          j.contextPermissions?.balance &&
          bundle.context.balance.state !== "ready"
        )
          result.limitations.push(
            "利用可能残高を確認できなかったため、所持額に収まることは保証していません。",
          );
      }
      await recordUsage(id, j.bucket, result.usage);
      if (
        await transition(
          id,
          ["running"],
          { state: "result_saved", result },
          token,
        )
      )
        await settle(id);
    } catch (error) {
      if (
        error.message === "AI_PROVIDER_THROTTLED" &&
        error.generationAttempted === false
      ) {
        await transition(
          id,
          ["running"],
          {
            state: "queued",
            retryAfterMs: now() + 60000,
            providerAttemptedAtMs: null,
          },
          token,
        );
        return;
      }
      if (error.providerFault) {
        await ref("system", "provider-safety").set(
          {
            stopped: true,
            reason: [
              "AI_FREE_QUOTA_EXHAUSTED",
              "AI_MODEL_UNAVAILABLE",
              "AI_PROVIDER_AUTH_FAILED",
              "AI_PROVIDER_REQUEST_REJECTED",
            ].includes(error.message)
              ? error.message
              : "AI_PROVIDER_UNAVAILABLE",
            providerError: [
              "AI_FREE_QUOTA_EXHAUSTED",
              "AI_MODEL_UNAVAILABLE",
              "AI_PROVIDER_AUTH_FAILED",
              "AI_PROVIDER_REQUEST_REJECTED",
            ].includes(error.message)
              ? error.message
              : "AI_PROVIDER_UNAVAILABLE",
            atMs: now(),
          },
          { merge: true },
        );
      }
      if (error.generationAttempted === false && !error.usage)
        await recordUsage(id, (await jr.get()).data().bucket, {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          providerReported: true,
          providerCalled: false,
        });
      if (error.usage)
        await recordUsage(id, (await jr.get()).data().bucket, error.usage);
      if (error.usageReviewRequired) {
        await ref("system", "provider-safety").set(
          {
            stopped: true,
            reason: "USAGE_ACCOUNTING_UNVERIFIED",
            atMs: now(),
          },
          { merge: true },
        );
        if (!error.usage) await markUnknownUsage(id);
      }
      await transition(
        id,
        ["running"],
        { state: "refund_pending", error: "AGENT_FAILED", result: null },
        token,
      );
      await refund(id);
    } finally {
      await db.runTransaction(async (tx) => {
        const s = await tx.get(slots);
        tx.set(slots, {
          active: (s.data()?.active || []).filter((v) => v.token !== token),
        });
      });
    }
  }
  async function markUnknownUsage(id) {
    const uncertain = await db.runTransaction(async (tx) => {
      const jr = ref("jobs", id),
        js = await tx.get(jr),
        j = js.data();
      if (!j || j.usageRecorded) return false;
      if (j.usageUncertain) return true;
      const gr = ref("usage", j.bucket),
        gs = await tx.get(gr);
      tx.set(jr, { usageUncertain: true }, { merge: true });
      tx.set(
        gr,
        { unknownCalls: (gs.data()?.unknownCalls || 0) + 1 },
        { merge: true },
      );
      return true;
    });
    if (uncertain)
      await ref("system", "provider-safety").set(
        {
          stopped: true,
          reason: "USAGE_ACCOUNTING_UNVERIFIED",
          atMs: now(),
        },
        { merge: true },
      );
  }
  async function recordUsage(id, bucket, usage) {
    if (
      !usage ||
      usage.providerReported !== true ||
      !Number.isSafeInteger(usage.totalTokens) ||
      usage.totalTokens < 0
    )
      throw Object.assign(new Error("AI_USAGE_UNREPORTED"), {
        usageReviewRequired: true,
      });
    await db.runTransaction(async (tx) => {
      const jr = ref("jobs", id),
        gr = ref("usage", bucket),
        [js, gs] = await Promise.all([tx.get(jr), tx.get(gr)]);
      if (js.data()?.usageRecorded) return;
      const g = gs.data() || {};
      tx.set(jr, { usageRecorded: true, tokenUsage: usage }, { merge: true });
      tx.set(
        gr,
        {
          observedTokens: (g.observedTokens || 0) + usage.totalTokens,
          inputTokens: (g.inputTokens || 0) + (usage.inputTokens || 0),
          outputTokens: (g.outputTokens || 0) + (usage.outputTokens || 0),
        },
        { merge: true },
      );
    });
  }
  async function workerHealth(success, complete = true) {
    await ref("system", "worker-health").set(
      {
        healthy: success,
        lastCycleAtMs: now(),
        ...(success && complete ? { lastSuccessAtMs: now() } : {}),
        validUntilMs: success ? now() + 90000 : now(),
        error: success ? null : "WORKER_CYCLE_FAILED",
      },
      { merge: true },
    );
  }
  async function operations() {
    const counts = {};
    for (const state of LIVE)
      counts[state] = (
        await db
          .collection("emuer_v2_agent_jobs")
          .where("state", "==", state)
          .limit(101)
          .get()
      ).size;
    return {
      worker: (await ref("system", "worker-health").get()).data() || null,
      usage: (await ref("usage", day(now())).get()).data() || {},
      freeTier: await freeTier.snapshot(),
      providerSafety:
        (await ref("system", "provider-safety").get()).data() || null,
      pending: counts,
    };
  }
  async function purge() {
    const cutoff = new Date(now());
    const throttle = await db
      .collection("emuer_v2_agent_quote_usage")
      .where("deleteAfter", "<=", cutoff)
      .limit(100)
      .get();
    for (const d of throttle.docs) await d.ref.delete();
    const quotes = await db
      .collection("emuer_v2_agent_quotes")
      .where("deleteAfter", "<=", cutoff)
      .limit(100)
      .get();
    for (const d of quotes.docs) await d.ref.delete();
    const jobs = await db
      .collection("emuer_v2_agent_jobs")
      .where("deleteAfter", "<=", cutoff)
      .limit(100)
      .get();
    for (const d of jobs.docs)
      await db.runTransaction(async (tx) => {
        const s = await tx.get(d.ref),
          j = s.data();
        if (j && TERMINAL.includes(j.state))
          tx.set(
            d.ref,
            {
              goal: null,
              result: null,
              deleteAfter: null,
              contentDeletedAtMs: now(),
            },
            { merge: true },
          );
      });
  }
  async function tick() {
    // Per-state queries avoid completed jobs starving recovery. No automatic retries of unknown AI outcomes.
    for (const state of LIVE) {
      const s = await db
        .collection("emuer_v2_agent_jobs")
        .where("state", "==", state)
        .limit(100)
        .get();
      if (state === "queued") {
        await Promise.all(s.docs.map((d) => work(d.id)));
        continue;
      }
      for (const d of s.docs) {
        if (state === "awaiting_payment") await pay(d.id);
        if (state === "running" && d.data().leaseUntilMs <= now()) {
          if (d.data().providerAttemptedAtMs && !d.data().usageRecorded)
            await markUnknownUsage(d.id);
          await transition(
            d.id,
            ["running"],
            {
              state: "refund_pending",
              result: null,
              error: "WORKER_INTERRUPTED",
            },
            d.data().leaseToken,
          );
          await refund(d.id);
        }
        if (state === "refund_pending") await refund(d.id);
        if (state === "result_saved") await settle(d.id);
      }
    }
  }
  return {
    config,
    status,
    actor,
    quote,
    submit,
    view,
    history,
    tick,
    work,
    ref,
    payments,
    sources,
    allowed,
    processing,
    purge,
    workerHealth,
    operations,
    LIVE,
    TERMINAL,
  };
}
module.exports = { createEconomy, PRODUCT };
