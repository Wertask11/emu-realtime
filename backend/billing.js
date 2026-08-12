"use strict";

/**
 * Emu 有料会員（月額10,000円）の課金・解約・返金。
 *
 * 方針:
 *  - 金額と会員状態の正は常に Stripe 側。Firestore は Webhook で追随する読み取り用の写し。
 *    クライアントの申告で会員状態を書き換えることは一切しない。
 *  - Webhook は署名検証必須。処理済みイベントIDを記録して二重適用を防ぐ。
 *  - 返金は「申請 → オーナー承認 → Stripe へ返金」の三段。自動返金はしない。
 */

const express = require("express");

const PLAN_AMOUNT_JPY = 10000;          // 月額（確定）
// 返金額は常に初月料金の全額。金額はサーバー側で決め、クライアントの申告は使わない。
const GUARANTEE_DAYS = 30;              // 保証期間
const REFUND_WINDOW_OPEN_DAY = 31;      // 入会31日目から
const REFUND_WINDOW_DAYS = 7;           // 7日間

const SUBSCRIPTIONS_COL = "subscriptions";
const BILLING_EVENTS_COL = "billing_events";
const REFUND_REQUESTS_COL = "refund_requests";
const AUDIT_COL = "admin_audit_logs";

const DAY_MS = 24 * 60 * 60 * 1000;

function createBillingRouter(deps) {
  const { db, requireFirebaseUser, requireOwner, rateLimit, webhookPath } = deps;

  const secretKey = process.env.STRIPE_SECRET_KEY || "";
  const priceId = process.env.STRIPE_PRICE_ID || "";
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";
  const siteOrigin = process.env.PUBLIC_SITE_ORIGIN || "https://schoolpark-emu.vercel.app";

  const stripe = secretKey ? require("stripe")(secretKey) : null;
  if (!stripe) {
    console.warn("⚠️ STRIPE_SECRET_KEY 未設定。課金APIは 503 を返します。");
  }

  const router = express.Router();

  function requireStripe(req, res, next) {
    if (!stripe || !db) return res.status(503).json({ error: "BILLING_UNAVAILABLE" });
    next();
  }

  const checkoutRateLimit = rateLimit({ windowMs: 60_000, max: 5, key: "checkout" });
  const refundRateLimit = rateLimit({ windowMs: 60 * 60_000, max: 5, key: "refund" });

  // ───────── 保証ウィンドウの計算 ─────────
  /* 初回入会日から、保証期間・返金申請期間を導出する。
     ここだけで日付を決めることで、規約の文面と実装がずれないようにする。 */
  function guaranteeWindow(firstSubscribedAt) {
    if (!firstSubscribedAt) return null;
    const start = firstSubscribedAt instanceof Date ? firstSubscribedAt : firstSubscribedAt.toDate();
    const guaranteeEnd = new Date(start.getTime() + GUARANTEE_DAYS * DAY_MS);
    const refundOpen = new Date(start.getTime() + (REFUND_WINDOW_OPEN_DAY - 1) * DAY_MS);
    const refundClose = new Date(refundOpen.getTime() + REFUND_WINDOW_DAYS * DAY_MS);
    return { start, guaranteeEnd, refundOpen, refundClose };
  }

  function subRef(uid) { return db.collection(SUBSCRIPTIONS_COL).doc(uid); }

  async function readSubscription(uid) {
    const snap = await subRef(uid).get();
    return snap.exists ? snap.data() : null;
  }

  async function audit(actorUid, action, target, detail) {
    try {
      await db.collection(AUDIT_COL).add({
        actorUid, action, target, detail: detail || null, createdAt: new Date()
      });
    } catch (e) {
      console.warn("監査ログ書き込み失敗:", e.message);
    }
  }

  // ───────── 決済の開始 ─────────
  router.post("/checkout", requireStripe, requireFirebaseUser, checkoutRateLimit, async (req, res) => {
    try {
      const { uid, walletAddress, account } = req.identity;
      if (!priceId) return res.status(503).json({ error: "PRICE_NOT_CONFIGURED" });

      const existing = await readSubscription(uid);
      if (existing && existing.status === "active") {
        return res.status(409).json({ error: "ALREADY_SUBSCRIBED" });
      }

      // Stripe の顧客は uid につき1つに固定する。作り直すと課金履歴が分断されるため。
      let customerId = existing && existing.stripeCustomerId;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: account.email || undefined,
          metadata: { uid, walletAddress }
        });
        customerId = customer.id;
        await subRef(uid).set({
          uid, walletAddress, email: account.email || null,
          stripeCustomerId: customerId, status: "none", createdAt: new Date()
        }, { merge: true });
      }

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        line_items: [{ price: priceId, quantity: 1 }],
        // 冪等性の担保と、Webhook 側で uid を引くためのひも付け
        client_reference_id: uid,
        subscription_data: { metadata: { uid, walletAddress } },
        success_url: `${siteOrigin}/?billing=success`,
        cancel_url: `${siteOrigin}/?billing=cancel`,
        locale: "ja"
      });

      return res.json({ ok: true, url: session.url });
    } catch (e) {
      console.error("checkout error:", e.message);
      return res.status(500).json({ error: "CHECKOUT_FAILED" });
    }
  });

  // ───────── 会員状態の照会 ─────────
  router.get("/status", requireFirebaseUser, async (req, res) => {
    try {
      if (!db) return res.status(503).json({ error: "BILLING_UNAVAILABLE" });
      const sub = await readSubscription(req.identity.uid);
      if (!sub) {
        return res.json({ ok: true, status: "none", planAmount: PLAN_AMOUNT_JPY });
      }
      const win = guaranteeWindow(sub.firstSubscribedAt);
      const now = Date.now();
      return res.json({
        ok: true,
        status: sub.status || "none",
        planAmount: PLAN_AMOUNT_JPY,
        currentPeriodEnd: sub.currentPeriodEnd ? sub.currentPeriodEnd.toDate().toISOString() : null,
        cancelAtPeriodEnd: !!sub.cancelAtPeriodEnd,
        firstSubscribedAt: win ? win.start.toISOString() : null,
        guarantee: win ? {
          endsAt: win.guaranteeEnd.toISOString(),
          refundOpensAt: win.refundOpen.toISOString(),
          refundClosesAt: win.refundClose.toISOString(),
          refundOpenNow: now >= win.refundOpen.getTime() && now < win.refundClose.getTime()
        } : null,
        refundStatus: sub.refundStatus || null
      });
    } catch (e) {
      console.error("billing status error:", e.message);
      return res.status(500).json({ error: "STATUS_FAILED" });
    }
  });

  // ───────── 解約・支払い方法の変更（Stripe の顧客ポータル） ─────────
  router.post("/portal", requireStripe, requireFirebaseUser, checkoutRateLimit, async (req, res) => {
    try {
      const sub = await readSubscription(req.identity.uid);
      if (!sub || !sub.stripeCustomerId) return res.status(404).json({ error: "NO_SUBSCRIPTION" });
      const session = await stripe.billingPortal.sessions.create({
        customer: sub.stripeCustomerId,
        return_url: `${siteOrigin}/?billing=portal-return`,
        locale: "ja"
      });
      return res.json({ ok: true, url: session.url });
    } catch (e) {
      console.error("portal error:", e.message);
      return res.status(500).json({ error: "PORTAL_FAILED" });
    }
  });

  // ───────── 返金申請 ─────────
  router.post("/refund/request", requireFirebaseUser, refundRateLimit, async (req, res) => {
    try {
      if (!db) return res.status(503).json({ error: "BILLING_UNAVAILABLE" });
      const { uid, walletAddress } = req.identity;
      const sub = await readSubscription(uid);
      if (!sub || !sub.firstSubscribedAt) return res.status(404).json({ error: "NO_SUBSCRIPTION" });

      // 一人につき初回入会時の1回限り
      if (sub.refundStatus && sub.refundStatus !== "rejected") {
        return res.status(409).json({ error: "ALREADY_REQUESTED", refundStatus: sub.refundStatus });
      }

      // 申請期間: 入会31日目から7日間
      const win = guaranteeWindow(sub.firstSubscribedAt);
      const now = Date.now();
      if (now < win.refundOpen.getTime()) {
        return res.status(400).json({ error: "WINDOW_NOT_OPEN", opensAt: win.refundOpen.toISOString() });
      }
      if (now >= win.refundClose.getTime()) {
        return res.status(400).json({ error: "WINDOW_CLOSED", closedAt: win.refundClose.toISOString() });
      }

      const survey = req.body && typeof req.body.survey === "object" ? req.body.survey : {};
      const reason = String((req.body && req.body.reason) || "").slice(0, 2000);

      const doc = await db.collection(REFUND_REQUESTS_COL).add({
        uid, walletAddress,
        email: sub.email || null,
        reason,
        survey: {
          profileCompleted: !!survey.profileCompleted,
          themesRegistered: Number(survey.themesRegistered) || 0,
          slotsRegistered: !!survey.slotsRegistered,
          sessionsJoined: Number(survey.sessionsJoined) || 0,
          ratedAfterSessions: !!survey.ratedAfterSessions,
          wantsFounderCall: !!survey.wantsFounderCall
        },
        status: "pending",
        amountRequested: PLAN_AMOUNT_JPY,
        stripeSubscriptionId: sub.stripeSubscriptionId || null,
        requestedAt: new Date()
      });

      await subRef(uid).set({ refundStatus: "pending", refundRequestId: doc.id }, { merge: true });
      return res.json({ ok: true, requestId: doc.id, status: "pending" });
    } catch (e) {
      console.error("refund request error:", e.message);
      return res.status(500).json({ error: "REFUND_REQUEST_FAILED" });
    }
  });

  router.get("/refund/status", requireFirebaseUser, async (req, res) => {
    try {
      if (!db) return res.status(503).json({ error: "BILLING_UNAVAILABLE" });
      const sub = await readSubscription(req.identity.uid);
      if (!sub || !sub.refundRequestId) return res.json({ ok: true, status: "none" });
      const snap = await db.collection(REFUND_REQUESTS_COL).doc(sub.refundRequestId).get();
      if (!snap.exists) return res.json({ ok: true, status: "none" });
      const d = snap.data();
      return res.json({
        ok: true,
        status: d.status,
        requestedAt: d.requestedAt ? d.requestedAt.toDate().toISOString() : null,
        decidedAt: d.decidedAt ? d.decidedAt.toDate().toISOString() : null,
        refundedAmount: d.refundedAmount || null
      });
    } catch (e) {
      console.error("refund status error:", e.message);
      return res.status(500).json({ error: "STATUS_FAILED" });
    }
  });

  // ───────── 管理（オーナーのみ） ─────────
  router.get("/admin/refunds", requireOwner, async (req, res) => {
    try {
      const status = String(req.query.status || "pending");
      let q = db.collection(REFUND_REQUESTS_COL).orderBy("requestedAt", "desc").limit(100);
      if (status !== "all") q = db.collection(REFUND_REQUESTS_COL).where("status", "==", status).limit(100);
      const snap = await q.get();
      const items = [];
      snap.forEach(d => {
        const v = d.data();
        items.push({
          id: d.id, uid: v.uid, email: v.email, reason: v.reason,
          survey: v.survey, status: v.status,
          amountRequested: v.amountRequested,
          requestedAt: v.requestedAt ? v.requestedAt.toDate().toISOString() : null,
          decidedAt: v.decidedAt ? v.decidedAt.toDate().toISOString() : null,
          adminNote: v.adminNote || null
        });
      });
      items.sort((a, b) => String(b.requestedAt || "").localeCompare(String(a.requestedAt || "")));
      return res.json({ ok: true, items });
    } catch (e) {
      console.error("admin refunds error:", e.message);
      return res.status(500).json({ error: "LIST_FAILED" });
    }
  });

  /* 承認すると実際に Stripe へ返金する。取り消せない操作なので、
     ここでだけ返金APIを呼び、金額はサーバー側で決める（クライアントの申告は使わない）。 */
  router.post("/admin/refunds/:id/decide", requireStripe, requireOwner, async (req, res) => {
    try {
      const id = String(req.params.id);
      const decision = String(req.body.decision || "");
      const adminNote = String(req.body.adminNote || "").slice(0, 2000);
      if (!["approve", "reject"].includes(decision)) return res.status(400).json({ error: "INVALID_DECISION" });

      const ref = db.collection(REFUND_REQUESTS_COL).doc(id);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: "NOT_FOUND" });
      const reqData = snap.data();
      if (reqData.status !== "pending") return res.status(409).json({ error: "ALREADY_DECIDED", status: reqData.status });

      if (decision === "reject") {
        await ref.update({ status: "rejected", adminNote, decidedAt: new Date(), decidedBy: req.identity.uid });
        await subRef(reqData.uid).set({ refundStatus: "rejected" }, { merge: true });
        await audit(req.identity.uid, "refund_reject", id, { adminNote });
        return res.json({ ok: true, status: "rejected" });
      }

      // 承認: 初月分の請求を特定して返金する
      const sub = await readSubscription(reqData.uid);
      if (!sub || !sub.stripeSubscriptionId) return res.status(400).json({ error: "NO_STRIPE_SUBSCRIPTION" });

      const invoices = await stripe.invoices.list({
        subscription: sub.stripeSubscriptionId, limit: 100
      });
      const paid = invoices.data
        .filter(inv => inv.status === "paid" && inv.charge)
        .sort((a, b) => a.created - b.created);
      if (!paid.length) return res.status(400).json({ error: "NO_PAID_INVOICE" });

      const firstCharge = paid[0].charge;
      const refund = await stripe.refunds.create({
        charge: firstCharge,
        reason: "requested_by_customer",
        metadata: { uid: reqData.uid, refundRequestId: id }
      }, { idempotencyKey: `refund_${id}` });

      await ref.update({
        status: "refunded",
        adminNote,
        decidedAt: new Date(),
        decidedBy: req.identity.uid,
        stripeRefundId: refund.id,
        refundedAmount: refund.amount
      });
      await subRef(reqData.uid).set({ refundStatus: "refunded", refundedAt: new Date() }, { merge: true });
      await audit(req.identity.uid, "refund_approve", id, {
        stripeRefundId: refund.id, amount: refund.amount
      });

      return res.json({ ok: true, status: "refunded", refundId: refund.id, amount: refund.amount });
    } catch (e) {
      console.error("refund decide error:", e.message);
      return res.status(500).json({ error: "REFUND_FAILED", message: e.message });
    }
  });

  // ───────── Webhook ─────────
  /* Stripe の署名検証には生のボディが必要。server.js 側で JSON パーサーを迂回させている。 */
  const webhookHandler = express.raw({ type: "application/json" });

  async function handleWebhook(req, res) {
    if (!stripe || !db) return res.status(503).send("unavailable");
    if (!webhookSecret) {
      console.error("STRIPE_WEBHOOK_SECRET 未設定のため Webhook を拒否");
      return res.status(503).send("webhook not configured");
    }

    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], webhookSecret);
    } catch (e) {
      console.error("Webhook 署名検証失敗:", e.message);
      return res.status(400).send(`Webhook Error: ${e.message}`);
    }

    // 同じイベントが再送されても状態を二重に動かさない
    const eventRef = db.collection(BILLING_EVENTS_COL).doc(event.id);
    try {
      const created = await db.runTransaction(async (tx) => {
        const existing = await tx.get(eventRef);
        if (existing.exists) return false;
        tx.set(eventRef, { type: event.type, receivedAt: new Date() });
        return true;
      });
      if (!created) return res.json({ received: true, duplicate: true });
    } catch (e) {
      console.error("Webhook 冪等性チェック失敗:", e.message);
      return res.status(500).send("idempotency error");
    }

    try {
      await applyEvent(event);
    } catch (e) {
      // 記録済みイベントを消して、Stripe の再送で復旧できるようにする
      console.error("Webhook 適用失敗:", event.type, e.message);
      await eventRef.delete().catch(() => {});
      return res.status(500).send("apply error");
    }
    return res.json({ received: true });
  }

  async function applyEvent(event) {
    const obj = event.data.object;

    if (event.type === "checkout.session.completed") {
      const uid = obj.client_reference_id;
      if (!uid || !obj.subscription) return;
      const subscription = await stripe.subscriptions.retrieve(obj.subscription);
      await upsertSubscription(uid, subscription, { first: true });
      return;
    }

    if (event.type === "customer.subscription.created" ||
        event.type === "customer.subscription.updated" ||
        event.type === "customer.subscription.deleted") {
      const uid = obj.metadata && obj.metadata.uid;
      if (!uid) return;
      await upsertSubscription(uid, obj, {});
      return;
    }

    if (event.type === "invoice.payment_failed") {
      const uid = obj.subscription_details && obj.subscription_details.metadata
        ? obj.subscription_details.metadata.uid : null;
      if (uid) await subRef(uid).set({ status: "past_due", updatedAt: new Date() }, { merge: true });
      return;
    }

    if (event.type === "charge.refunded") {
      const uid = obj.metadata && obj.metadata.uid;
      if (uid) await subRef(uid).set({ refundStatus: "refunded", refundedAt: new Date() }, { merge: true });
    }
  }

  async function upsertSubscription(uid, subscription, opts) {
    const patch = {
      uid,
      stripeSubscriptionId: subscription.id,
      stripeCustomerId: typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id,
      status: subscription.status,
      cancelAtPeriodEnd: !!subscription.cancel_at_period_end,
      currentPeriodEnd: subscription.current_period_end ? new Date(subscription.current_period_end * 1000) : null,
      updatedAt: new Date()
    };
    // 保証期間の起点は最初の入会日。再入会で上書きすると保証が延びてしまうので、
    // 既に記録がある場合は触らない。
    const existing = await subRef(uid).get();
    if (opts.first && (!existing.exists || !existing.data().firstSubscribedAt)) {
      patch.firstSubscribedAt = new Date();
    }
    await subRef(uid).set(patch, { merge: true });
  }

  return { router, webhookPath, webhookHandler, handleWebhook, guaranteeWindow, PLAN_AMOUNT_JPY };
}

module.exports = { createBillingRouter, PLAN_AMOUNT_JPY, GUARANTEE_DAYS };
