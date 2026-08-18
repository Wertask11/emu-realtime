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

/* 月額プランは3つ。金額とStripeのPrice IDはサーバー側だけが持ち、
   クライアントから渡ってくるのはキー（light/standard/member）だけにする。
   金額を客側に決めさせない。 */
const PLANS = {
  light:    { key: "light",    amount: 500,   envPrice: "STRIPE_PRICE_LIGHT", label: "Emu light" },
  plus:     { key: "plus",     amount: 3000,  envPrice: "STRIPE_PRICE_PLUS",  label: "Emu plus" },
  pro:      { key: "pro",      amount: 10000, envPrice: "STRIPE_PRICE_PRO",   label: "Emu pro" }
};
const DEFAULT_PLAN = "pro";

// 「語り合える一人」保証は Emu pro（月額10,000円）にだけ付く
const GUARANTEED_PLAN = "pro";
const PLAN_AMOUNT_JPY = PLANS.pro.amount;   // 既存の呼び出し互換のため残す

// 返金額はサーバー側が Stripe の支払い記録から決める。クライアントの申告は使わない。
const GUARANTEE_DAYS = 30;              // 保証期間
const REFUND_WINDOW_OPEN_DAY = 31;      // 入会31日目から
const REFUND_WINDOW_DAYS = 7;           // 7日間

const SUBSCRIPTIONS_COL = "subscriptions";
const BILLING_EVENTS_COL = "billing_events";
const REFUND_REQUESTS_COL = "refund_requests";
const AUDIT_COL = "admin_audit_logs";

const DAY_MS = 24 * 60 * 60 * 1000;

function createBillingRouter(deps) {
  const { db, requireFirebaseUser, requireOwner, rateLimit, webhookPath, entitlement } = deps;

  const secretKey = process.env.STRIPE_SECRET_KEY || "";

  /* 各プランの Price ID。環境変数が無いプランは「売っていない」扱いにする。
     STRIPE_PRICE_ID は本会員の旧名。移行のあいだは拾えるようにしておく。 */
  function priceIdOf(planKey) {
    const plan = PLANS[planKey];
    if (!plan) return "";
    const id = process.env[plan.envPrice] || "";
    if (id) return id;
    if (planKey === "pro") return process.env.STRIPE_PRICE_ID || "";
    return "";
  }
  function availablePlans() {
    return Object.keys(PLANS).filter(function (k) { return !!priceIdOf(k); });
  }
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

  /* 「語り合える一人」保証の起点。
     firstSubscribedAt は「初めてお金を払った日」で、light や plus で入会した日も入る。
     これを保証の起点にすると、あとから pro に上がった人の保証が
     light に入った日から数えられ、pro になった時点で返金申請の窓が
     閉じていることになる。そこで保証の起点は guaranteeStartsAt に分けた。

     guaranteeStartsAt が無い会員は、この仕組みより前からの pro なので、
     これまでどおり firstSubscribedAt を起点にする（保証期間を変えない）。 */
  function guaranteeStartOf(sub) {
    if (!sub) return null;
    if (sub.guaranteeStartsAt) return sub.guaranteeStartsAt;
    if (sub.plan && sub.plan !== GUARANTEED_PLAN) return null;
    return sub.firstSubscribedAt || null;
  }

  /* 日時を ISO 文字列にする。Firestore の Timestamp と素の Date が混ざるため。 */
  function _isoOf(v) {
    if (!v) return null;
    if (typeof v.toDate === "function") return v.toDate().toISOString();
    if (v instanceof Date) return v.toISOString();
    return null;
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

      /* 受け取るのはプランのキーだけ。金額やPrice IDを客側から受けない。
         知らないキーが来たら弾く（存在しない安いプランを作られないように）。 */
      const planKey = String(req.body && req.body.plan || DEFAULT_PLAN);
      if (!PLANS[planKey]) return res.status(400).json({ error: "UNKNOWN_PLAN" });
      const priceId = priceIdOf(planKey);
      if (!priceId) return res.status(503).json({ error: "PRICE_NOT_CONFIGURED", plan: planKey });

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
      // 決済に進んだプランを控えておく（Webhook が来る前でも画面に出せる）
      await subRef(uid).set({ pendingPlan: planKey }, { merge: true });

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        line_items: [{ price: priceId, quantity: 1 }],
        // 冪等性の担保と、Webhook 側で uid を引くためのひも付け
        client_reference_id: uid,
        // どのプランで契約したかは Stripe 側にも残す（Webhook と返金の判定で使う）
        subscription_data: { metadata: { uid, walletAddress, plan: planKey } },
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
      const plans = availablePlans().map(function (k) {
        return { key: k, amount: PLANS[k].amount, label: PLANS[k].label,
                 guaranteed: k === GUARANTEED_PLAN };
      });
      if (!sub) {
        return res.json({ ok: true, status: "none", plans,
                          planAmount: PLAN_AMOUNT_JPY });
      }

      /* Stripe を正として読み直す。
         Webhook は届くまでに間があり、届かないこともある（サーバーが眠っていた等）。
         Firestore の写しだけを見ていると、解約したのに「有効」のままに見えてしまう。
         ここで実物を1件読んで、写しも直しておく。 */
      if (stripe && sub.stripeSubscriptionId) {
        try {
          const live = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);
          const cancel = cancellationOf(live);
          const fresh = {
            status: live.status,
            cancelAtPeriodEnd: cancel.pending,
            // 解約予定があるなら、その日が「終わる日」
            currentPeriodEnd: cancel.at || periodEndOf(live)
          };
          const metaPlan = live.metadata && live.metadata.plan;
          if (metaPlan && PLANS[metaPlan]) fresh.plan = metaPlan;
          // 中身が変わっていたときだけ書き戻す（毎回書くと無駄な更新が増える）
          const changed = sub.status !== fresh.status
            || !!sub.cancelAtPeriodEnd !== fresh.cancelAtPeriodEnd
            || (fresh.plan && sub.plan !== fresh.plan);
          Object.assign(sub, fresh);
          if (changed) {
            await subRef(req.identity.uid).set(
              Object.assign({ updatedAt: new Date() }, fresh), { merge: true });
          }
        } catch (e) {
          // 読めなければ写しのまま返す。表示が止まるよりはよい
          console.warn("subscription 再取得に失敗:", e.message);
        }
      }

      const currentPlan = sub.plan || sub.pendingPlan || null;
      // 保証の起点は pro になった日。light や plus に入った日ではない。
      const win = guaranteeWindow(guaranteeStartOf(sub));

      /* いま何ができるか。契約だけでなく Founding Emuer の付与も含む。
         画面はこれを見て機能を出し分ける（プラン名だけでは付与分が拾えない）。 */
      let ent = null;
      if (entitlement) {
        try { ent = await entitlement.getEntitlement(req.identity.uid, req.identity.account); } catch (e) {}
      }
      const now = Date.now();
      return res.json({
        ok: true,
        status: sub.status || "none",
        plans,
        plan: currentPlan,
        planLabel: currentPlan && PLANS[currentPlan] ? PLANS[currentPlan].label : null,
        /* いま使える段。契約が無くても Founding Emuer なら light が入る。
           画面で機能を出し分けるときは plan ではなくこちらを見る。 */
        entitlement: ent ? ent.plan : (currentPlan || "guest"),
        entitlementSource: ent ? ent.source : (currentPlan ? "stripe" : "none"),
        foundingUntil: ent ? ent.foundingUntil : null,
        // 保証は本会員にだけ付く
        guaranteed: currentPlan === GUARANTEED_PLAN,
        planAmount: currentPlan && PLANS[currentPlan] ? PLANS[currentPlan].amount : PLAN_AMOUNT_JPY,
        // Firestore から読むと Timestamp、Stripe から読み直すと Date になる。どちらでも通す
        currentPeriodEnd: _isoOf(sub.currentPeriodEnd),
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
      if (!sub) return res.status(404).json({ error: "NO_SUBSCRIPTION" });

      /* 「語り合える一人」保証は Emu pro（月額10,000円）の約束。
         下位プランでこの返金を受けられると、規約に書いていない返金になってしまう。 */
      if ((sub.plan || DEFAULT_PLAN) !== GUARANTEED_PLAN) {
        return res.status(400).json({ error: "PLAN_NOT_GUARANTEED", plan: sub.plan || null });
      }

      // 保証の起点は pro になった日。light や plus に入った日から数えない。
      if (!guaranteeStartOf(sub)) return res.status(404).json({ error: "NO_SUBSCRIPTION" });

      // 一人につき初回入会時の1回限り
      if (sub.refundStatus && sub.refundStatus !== "rejected") {
        return res.status(409).json({ error: "ALREADY_REQUESTED", refundStatus: sub.refundStatus });
      }

      // 申請期間: pro になった日から31日目、そこから7日間
      const win = guaranteeWindow(guaranteeStartOf(sub));
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

  /* 会員の一覧。誰が light / plus / pro なのかを見るための画面用。
     いままで一覧する手段がなく、「いま誰がどのプランか」をオーナーが
     確認できなかった。

     あわせて、次のプランへ声をかける目安になる数も返す。
     人数が少ないうちは、階段は機能ではなく「誰に声をかけるか」で決まるため、
     その判断材料をここに集める。数の元は価値プロフィールと同じ。 */
  router.get("/admin/members", requireOwner, async (req, res) => {
    try {
      const snap = await db.collection(SUBSCRIPTIONS_COL).limit(300).get();

      // 会員ごとに、名前と住所（投稿の集計に使う）を引く
      const rows = [];
      for (const doc of snap.docs) {
        const v = doc.data() || {};
        const uid = doc.id;
        let name = "", address = "", email = v.email || "";
        try {
          const acc = await db.collection("ches_accounts").doc(uid).get();
          if (acc.exists) {
            const a = acc.data() || {};
            name = a.displayName || "";
            email = email || a.email || "";
            address = String(a.walletAddress || a.chesAddress || "").toLowerCase();
          }
        } catch (e) {}

        /* 声をかける目安。§22 の移行シグナルのうち、いまのデータで数えられるもの。
           ・posts        … 届けた知識の数
           ・elevated     … 他の人の改善を採り入れて育った投稿（考えが変わった記録）
           ・asked        … 自分から知識を募集した数（自分から問いを出した）
           ・answered     … 誰かの募集に答えた数（人に届けた） */
        const signals = { posts: 0, elevated: 0, asked: 0, answered: 0, helpful: 0 };
        if (address) {
          try {
            const ps = await db.collection("posts").where("address", "==", address).limit(300).get();
            ps.forEach(d => {
              const p = d.data() || {};
              signals.posts += 1;
              signals.helpful += Number(p.goodCount) || 0;
              if ((Number(p.acceptedChangeCount) || 0) > 0) signals.elevated += 1;
            });
          } catch (e) {}
          try {
            const rq = await db.collection("knowledge_requests").where("author", "==", address).limit(100).get();
            signals.asked = rq.size;
          } catch (e) {}
          try {
            const an = await db.collection("knowledge_answers").where("answerAuthor", "==", address).limit(100).get();
            signals.answered = an.size;
          } catch (e) {}
        }

        const plan = v.plan && PLANS[v.plan] ? v.plan : null;
        rows.push({
          uid, name, email, address,
          plan,
          planLabel: plan ? PLANS[plan].label : "（不明）",
          amount: plan ? PLANS[plan].amount : null,
          status: v.status || "unknown",
          cancelAtPeriodEnd: !!v.cancelAtPeriodEnd,
          currentPeriodEnd: _isoOf(v.currentPeriodEnd),
          firstSubscribedAt: _isoOf(v.firstSubscribedAt),
          signals
        });
      }

      // 上の段から並べ、同じ段では新しい人を先に
      const order = { pro: 0, plus: 1, light: 2 };
      rows.sort((a, b) => {
        const oa = order[a.plan] === undefined ? 9 : order[a.plan];
        const ob = order[b.plan] === undefined ? 9 : order[b.plan];
        if (oa !== ob) return oa - ob;
        return String(b.firstSubscribedAt || "").localeCompare(String(a.firstSubscribedAt || ""));
      });

      const active = rows.filter(r => r.status === "active" || r.status === "trialing");
      const countOf = k => active.filter(r => r.plan === k).length;
      const summary = {
        total: rows.length,
        active: active.length,
        light: countOf("light"),
        plus: countOf("plus"),
        pro: countOf("pro"),
        mrr: active.reduce((s, r) => s + (Number(r.amount) || 0), 0)
      };

      return res.json({ ok: true, items: rows, summary });
    } catch (e) {
      console.error("admin members error:", e.message);
      return res.status(500).json({ error: "LIST_FAILED" });
    }
  });

  /* プランを変える。解約して入り直さずに上の段へ行けるようにする。

     いままでは checkout が「契約中は 409」で弾いていたため、
     上げるには一度解約するしかなかった。商品階段の設計と噛み合っていない。

     日割りはその場で請求する（always_invoice）。次回請求書に足すだけだと
     「上がった実感」がないため。更新日（billing_cycle_anchor）は変えない。
     変えると「更新日が動いた」という別の混乱が起きる。

     pro へ初めて上がったときの保証の起点は、Webhook 側（upsertSubscription）で
     guaranteeStartsAt に記録される。ここでは触らない。 */
  router.post("/change-plan", requireStripe, requireFirebaseUser, checkoutRateLimit, async (req, res) => {
    try {
      const uid = req.identity.uid;
      const next = String((req.body || {}).plan || "");
      if (!PLANS[next]) return res.status(400).json({ error: "BAD_PLAN" });

      const sub = await readSubscription(uid);
      if (!sub || !sub.stripeSubscriptionId) return res.status(404).json({ error: "NO_SUBSCRIPTION" });
      if (!["active", "trialing", "past_due"].includes(String(sub.status))) {
        return res.status(409).json({ error: "NOT_ACTIVE", status: sub.status || null });
      }
      if (sub.plan === next) return res.status(409).json({ error: "SAME_PLAN", plan: next });

      const price = priceIdOf(next);
      if (!price) return res.status(503).json({ error: "PRICE_NOT_CONFIGURED", plan: next });

      const current = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);
      const item = current.items && current.items.data && current.items.data[0];
      if (!item) return res.status(500).json({ error: "NO_SUBSCRIPTION_ITEM" });

      const updated = await stripe.subscriptions.update(sub.stripeSubscriptionId, {
        items: [{ id: item.id, price: price }],
        proration_behavior: "always_invoice",
        metadata: { ...(current.metadata || {}), plan: next, uid: uid }
      });

      // 画面をすぐ正しくするため、Webhook を待たずに写しを更新する
      await upsertSubscription(uid, updated, {});
      return res.json({ ok: true, plan: next, planLabel: PLANS[next].label });
    } catch (e) {
      console.error("change-plan error:", e.message);
      return res.status(500).json({ error: "CHANGE_FAILED", message: e.message });
    }
  });

  /* 見学中の遊びの回数を1つ使う。サーバーで数えるのは、
     端末に置くとブラウザを変えるだけで回避できてしまうため。 */
  router.post("/play-ticket", requireFirebaseUser, async (req, res) => {
    try {
      if (!entitlement) return res.json({ ok: true });
      const ent = await entitlement.getEntitlement(req.identity.uid, req.identity.account);
      if (entitlement.atLeast(ent.plan, "light")) return res.json({ ok: true, unlimited: true });
      const room = await entitlement.consume(req.identity.uid, "guestPlay", { account: req.identity.account });
      if (!room.ok) return res.status(403).json({ ok: false, ...room });
      return res.json({ ok: true, used: room.used, limit: room.limit });
    } catch (e) {
      return res.json({ ok: true });   // 数えられないときは遊ばせる。締め出さない
    }
  });

  /* 月次の「学びの軌跡」（Emu plus 以上）。
     「今月あなたは、18個の知識を受け取り、7人へ経験を届け、3つの考えを改善しました。」

     新しいデータは持たない。価値プロフィールと同じ元データから数える。
     存在しない分析結果は作らない。実際に取れる数字だけを出す。 */
  router.get("/journey", requireFirebaseUser, async (req, res) => {
    try {
      if (!db || !entitlement) return res.status(503).json({ error: "UNAVAILABLE" });
      const uid = req.identity.uid;
      const address = String(req.identity.walletAddress || "").toLowerCase();
      const ent = await entitlement.getEntitlement(uid, req.identity.account);
      if (entitlement.enforcing() && !entitlement.atLeast(ent.plan, "plus")) {
        return res.status(403).json({ error: "PLAN_REQUIRED", required: "plus", current: ent.plan });
      }

      const win = await entitlement.usageWindow(uid);
      const since = win.start;

      const j = { received: 0, deliveredTo: 0, improved: 0, posted: 0, helpful: 0, answered: 0 };

      // 受け取った学び：自分が「役に立った」を押した知識の数
      try {
        /* 期間で絞る。絞らないと『今月18個』と出しながら累計を見せてしまう。
           Good を押した日は記録していないため、投稿の作成日で近似する。 */
        const got = await db.collection("posts")
          .where("goodUsers", "array-contains", address)
          .where("createdAt", ">=", since).limit(500).get();
        j.received = got.size;
      } catch (e) {}

      // 届けた相手の数（重複なし）と、自分の投稿・改善が育った数
      try {
        const mine = await db.collection("posts").where("address", "==", address)
          .where("createdAt", ">=", since).limit(500).get();
        const people = new Set();
        mine.forEach(d => {
          const p = d.data() || {};
          j.posted += 1;
          j.helpful += Number(p.goodCount) || 0;
          if ((Number(p.acceptedChangeCount) || 0) > 0) j.improved += 1;
          (Array.isArray(p.goodUsers) ? p.goodUsers : []).forEach(a => { if (a) people.add(String(a).toLowerCase()); });
        });
        j.deliveredTo = people.size;
      } catch (e) {}

      // 誰かの募集に答えた数
      try {
        const ans = await db.collection("knowledge_answers")
          .where("answerAuthor", "==", address)
          .where("createdAt", ">=", since).limit(500).get();
        j.answered = ans.size;
      } catch (e) {}

      /* 読み上げる一文。数がゼロの項目は入れない。
         中身のない文を作らないため。 */
      const parts = [];
      if (j.received > 0)    parts.push(j.received + "個の知識を受け取り");
      if (j.deliveredTo > 0) parts.push(j.deliveredTo + "人へ経験を届け");
      if (j.improved > 0)    parts.push(j.improved + "つの考えを改善しました");
      const sentence = parts.length
        ? "あなたは、" + parts.join("、") + (j.improved > 0 ? "" : "ました") + "。"
        : "まだ記録がありません。ひとつ書いてみることから始まります。";

      return res.json({
        ok: true, plan: ent.plan,
        since: since.toISOString(), until: win.end.toISOString(),
        counts: j, sentence
      });
    } catch (e) {
      console.error("journey error:", e.message);
      return res.status(500).json({ error: "JOURNEY_FAILED" });
    }
  });

  /* いま何をどれだけ使ったか。画面に「あと◯件」と出すために使う。 */
  router.get("/usage", requireFirebaseUser, async (req, res) => {
    try {
      if (!entitlement) return res.status(503).json({ error: "ENTITLEMENT_UNAVAILABLE" });
      const usage = await entitlement.usageOf(req.identity.uid, req.identity.account);
      return res.json({ ok: true, ...usage });
    } catch (e) {
      console.error("usage error:", e.message);
      return res.status(500).json({ error: "USAGE_FAILED" });
    }
  });

  /* 施行のときの最初の付与。公式パス保有者に plus、オーナーに pro を渡す。
     既定は空打ち（dryRun）で、何人に配ることになるのかを先に見られる。
     実際に配るときだけ { dryRun: false } を送る。 */
  router.post("/admin/founding/grant", requireOwner, async (req, res) => {
    try {
      if (!entitlement || typeof entitlement.grantInitial !== "function") {
        return res.status(503).json({ error: "ENTITLEMENT_UNAVAILABLE" });
      }
      const body = req.body || {};
      const result = await entitlement.grantInitial({
        months: body.months,
        grantedBy: body.grantedBy,
        dryRun: body.dryRun !== false
      });
      return res.json({ ok: true, ...result });
    } catch (e) {
      console.error("founding grant error:", e.message);
      return res.status(400).json({ error: e.message || "GRANT_FAILED" });
    }
  });

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

      const target = await findFirstPaymentToRefund(sub.stripeSubscriptionId);
      if (!target) return res.status(400).json({ error: "NO_PAID_INVOICE" });

      const refund = await stripe.refunds.create(Object.assign({
        reason: "requested_by_customer",
        metadata: { uid: reqData.uid, refundRequestId: id }
      }, target), { idempotencyKey: `refund_${id}` });

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

  /* 初月分の支払いを特定して、返金の宛先を返す。
     Invoice.charge は 2026-07-29 の API では廃止されており、支払いは
     Invoice.payments（InvoicePayment のリスト）から辿る。
     PaymentIntent と Charge のどちらで返ってくるかは決済の作られ方で変わるため、
     両方に対応する。返すのは refunds.create にそのまま渡せる形。 */
  async function findFirstPaymentToRefund(subscriptionId) {
    const invoices = await stripe.invoices.list({ subscription: subscriptionId, limit: 100 });
    const paid = invoices.data
      .filter(inv => inv.status === "paid")
      .sort((a, b) => a.created - b.created);

    for (const inv of paid) {
      // expand しないと payments が付かない場合があるので、無ければ取り直す
      let payments = inv.payments && inv.payments.data;
      if (!payments || !payments.length) {
        const listed = await stripe.invoicePayments.list({ invoice: inv.id, limit: 10 });
        payments = listed.data;
      }
      for (const p of payments || []) {
        if (p.status !== "paid") continue;
        const pay = p.payment || {};
        const pi = typeof pay.payment_intent === "string" ? pay.payment_intent
          : (pay.payment_intent && pay.payment_intent.id);
        if (pi) return { payment_intent: pi };
        const ch = typeof pay.charge === "string" ? pay.charge
          : (pay.charge && pay.charge.id);
        if (ch) return { charge: ch };
      }
    }
    return null;
  }

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
      // 2026-07-29 の API で subscription_details は invoice.parent の下へ移動した。
      // 古い形の請求書が届いても拾えるよう、両方を見る。
      const details = (obj.parent && obj.parent.subscription_details) || obj.subscription_details;
      const uid = details && details.metadata ? details.metadata.uid : null;
      if (uid) await subRef(uid).set({ status: "past_due", updatedAt: new Date() }, { merge: true });
      return;
    }

    if (event.type === "charge.refunded") {
      const uid = obj.metadata && obj.metadata.uid;
      if (uid) await subRef(uid).set({ refundStatus: "refunded", refundedAt: new Date() }, { merge: true });
    }
  }

  /* 次回更新日。2026-07-29 の API で current_period_end は Subscription から
     SubscriptionItem へ移動した。古い形でも読めるよう両方を見る。 */
  /* 解約の申し込みが済んでいるか。
     cancel_at_period_end は非推奨になり、いまは解約予定の日時が cancel_at に入る。
     片方だけを見ていると、カスタマーポータルで解約しても「有効」のままに見える。
     両方を見て、終わる日も返す。 */
  function cancellationOf(subscription) {
    const atUnix = subscription.cancel_at || null;
    const flagged = !!subscription.cancel_at_period_end;
    const at = atUnix ? new Date(atUnix * 1000) : null;
    // 過去の日付は「もう終わった」ので予定とは扱わない
    const pending = flagged || (at && at.getTime() > Date.now());
    return { pending: !!pending, at: at };
  }

  function periodEndOf(subscription) {
    const item = subscription.items && subscription.items.data && subscription.items.data[0];
    const unix = (item && item.current_period_end) || subscription.current_period_end;
    return unix ? new Date(unix * 1000) : null;
  }

  async function upsertSubscription(uid, subscription, opts) {
    const patch = {
      uid,
      stripeSubscriptionId: subscription.id,
      stripeCustomerId: typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id,
      status: subscription.status,
      cancelAtPeriodEnd: cancellationOf(subscription).pending,
      currentPeriodEnd: cancellationOf(subscription).at || periodEndOf(subscription),
      updatedAt: new Date()
    };
    /* 契約したプラン。Stripe 側の metadata が正で、無ければ Price ID から引き当てる。
       ここを Firestore に写しておかないと、返金の可否も画面の表示もプラン別にできない。 */
    const metaPlan = subscription.metadata && subscription.metadata.plan;
    if (metaPlan && PLANS[metaPlan]) {
      patch.plan = metaPlan;
    } else {
      const item = subscription.items && subscription.items.data && subscription.items.data[0];
      const pid = item && item.price && item.price.id;
      const hit = pid && Object.keys(PLANS).find(function (k) { return priceIdOf(k) === pid; });
      if (hit) patch.plan = hit;
    }
    const existing = await subRef(uid).get();
    const before = existing.exists ? existing.data() : {};

    // 初めてお金を払った日。プランを問わず1回だけ記録する（会員歴の目安）。
    if (opts.first && !before.firstSubscribedAt) {
      patch.firstSubscribedAt = new Date();
    }

    /* 「語り合える一人」保証の起点。pro になった時にだけ記録する。
       opts.first は新規の Checkout を通ったときにしか渡らないため、
       light や plus から pro へ変更した場合（subscription.update）でも
       確実に記録されるよう、ここでは opts.first を条件にしない。

       再入会や上下の行き来で保証が何度も始まらないよう、
       一度記録したら二度と上書きしない。 */
    if (patch.plan === GUARANTEED_PLAN && !before.guaranteeStartsAt) {
      patch.guaranteeStartsAt = new Date();
    }

    await subRef(uid).set(patch, { merge: true });

    /* 利用資格の控えを捨てる。ここを忘れると、解約したりプランを変えたりしても
       しばらく前の資格のまま通ってしまう。 */
    if (entitlement && typeof entitlement.forget === "function") entitlement.forget(uid);
  }

  return { router, webhookPath, webhookHandler, handleWebhook, guaranteeWindow, PLAN_AMOUNT_JPY };
}

module.exports = { createBillingRouter, PLAN_AMOUNT_JPY, GUARANTEE_DAYS };
