"use strict";

/**
 * 運営の受領コメント（Emu light 以上）。
 *
 * light の仕事はひとつ。「初めて外へ出した経験に、必ず応えが返る」こと。
 * 他の会員が反応するかは運だが、運営が応えることは約束できる。
 * だから light の核はここにある。
 *
 * 約束の形（曖昧な言い方を混ぜない）:
 *   light 以上の会員は、請求期間中に1件の投稿を「運営確認を希望する」として指定できる。
 *   運営は指定日から7営業日以内に、受領コメントを1回返す。
 *
 * 条件:
 *   - 希望制。押した投稿だけが対象。全投稿を自動で対象にしない
 *   - 1請求期間につき1件
 *   - 禁止事項に該当する投稿、削除した投稿は対象外
 *   - 内容の正しさや成果は保証しない。受領と着眼点を伝えるものであり、専門的な助言ではない
 *   - 7営業日以内に返せなかった場合は、翌月の light 料金相当（500円）を割引する
 *   - 先着100名まで
 */

const express = require("express");

const COL = "review_requests";
const BUSINESS_DAYS = 7;      // 7営業日以内に返す
const CAPACITY = 100;         // 先着100名まで

/* 営業日で数えた期限。土日は数えない（祝日は考慮しない。
   祝日ぶんは余裕として扱い、約束を短く見せないほうを選ぶ）。 */
function dueDateFrom(start, days) {
  const d = new Date(start.getTime());
  let left = days;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) left -= 1;
  }
  return d;
}

function createReviewRouter(deps) {
  const { db, requireFirebaseUser, requireOwner, entitlement } = deps;
  const router = express.Router();
  // 割引を実際に渡すために使う。未設定なら記録だけ残す。
  const stripe = process.env.STRIPE_SECRET_KEY
    ? require("stripe")(process.env.STRIPE_SECRET_KEY) : null;

  function _iso(v) {
    if (!v) return null;
    if (typeof v.toDate === "function") return v.toDate().toISOString();
    if (v instanceof Date) return v.toISOString();
    return null;
  }

  /* いま受け付けている人数。先着100名の判定に使う。
     人数が埋まったら、内容を変えるのではなく受付を止める。 */
  async function seatsTaken() {
    const snap = await db.collection(COL).select("uid").limit(1000).get();
    const uids = new Set();
    snap.forEach(d => { const u = (d.data() || {}).uid; if (u) uids.add(u); });
    return uids.size;
  }

  /* 自分の状態。画面に「今回の分をまだ使っていない」と出すために使う。 */
  router.get("/status", requireFirebaseUser, async (req, res) => {
    try {
      if (!db) return res.status(503).json({ error: "UNAVAILABLE" });
      const uid = req.identity.uid;
      const ent = await entitlement.getEntitlement(uid, req.identity.account);
      const win = await entitlement.usageWindow(uid);

      const mine = await db.collection(COL)
        .where("uid", "==", uid).where("windowKey", "==", win.key).limit(1).get();
      const cur = mine.empty ? null : { id: mine.docs[0].id, ...mine.docs[0].data() };

      const taken = await seatsTaken();
      return res.json({
        ok: true,
        plan: ent.plan,
        eligible: entitlement.atLeast(ent.plan, "light"),
        seatsTaken: taken,
        capacity: CAPACITY,
        accepting: taken < CAPACITY,
        windowKey: win.key,
        resetsAt: win.end.toISOString(),
        request: cur ? {
          id: cur.id, postId: cur.postId, status: cur.status,
          requestedAt: _iso(cur.requestedAt), dueAt: _iso(cur.dueAt),
          answeredAt: _iso(cur.answeredAt), comment: cur.comment || null,
          lateCompensated: !!cur.lateCompensated
        } : null
      });
    } catch (e) {
      console.error("review status error:", e.message);
      return res.status(500).json({ error: "STATUS_FAILED" });
    }
  });

  /* 「この投稿の運営確認を希望する」。請求期間に1件だけ。 */
  router.post("/request", requireFirebaseUser, async (req, res) => {
    try {
      if (!db) return res.status(503).json({ error: "UNAVAILABLE" });
      const uid = req.identity.uid;
      const postId = String((req.body || {}).postId || "").trim();
      if (!postId) return res.status(400).json({ error: "POST_REQUIRED" });

      const ent = await entitlement.getEntitlement(uid, req.identity.account);
      if (entitlement.enforcing() && !entitlement.atLeast(ent.plan, "light")) {
        return res.status(403).json({ error: "PLAN_REQUIRED", required: "light", current: ent.plan });
      }

      // 自分の投稿であることを確かめる。他人の投稿は指定できない。
      const post = await db.collection("posts").doc(postId).get();
      if (!post.exists) return res.status(404).json({ error: "POST_NOT_FOUND" });
      const author = String((post.data() || {}).address || "").toLowerCase();
      if (author !== String(req.identity.walletAddress || "").toLowerCase()) {
        return res.status(403).json({ error: "NOT_YOUR_POST" });
      }

      const win = await entitlement.usageWindow(uid);
      const mine = await db.collection(COL)
        .where("uid", "==", uid).where("windowKey", "==", win.key).limit(1).get();
      if (!mine.empty) {
        return res.status(409).json({
          error: "ALREADY_REQUESTED",
          resetsAt: win.end.toISOString()
        });
      }

      /* 先着100名。埋まったら受付を止める。
         101人目から内容を変える設計にはしない。 */
      const taken = await seatsTaken();
      const already = await db.collection(COL).where("uid", "==", uid).limit(1).get();
      if (already.empty && taken >= CAPACITY) {
        return res.status(409).json({ error: "CAPACITY_FULL", capacity: CAPACITY });
      }

      const now = new Date();
      const ref = await db.collection(COL).add({
        uid, postId,
        walletAddress: String(req.identity.walletAddress || "").toLowerCase(),
        windowKey: win.key,
        status: "pending",
        requestedAt: now,
        dueAt: dueDateFrom(now, BUSINESS_DAYS),
        comment: null, answeredAt: null, lateCompensated: false
      });
      return res.json({
        ok: true, id: ref.id,
        dueAt: dueDateFrom(now, BUSINESS_DAYS).toISOString()
      });
    } catch (e) {
      console.error("review request error:", e.message);
      return res.status(500).json({ error: "REQUEST_FAILED" });
    }
  });

  // ───────── 管理（オーナーのみ） ─────────

  /* 返すべきものの一覧。期限が近い順に出す。 */
  router.get("/admin/list", requireOwner, async (req, res) => {
    try {
      const status = String(req.query.status || "pending");
      let q = db.collection(COL).limit(200);
      if (status !== "all") q = db.collection(COL).where("status", "==", status).limit(200);
      const snap = await q.get();
      const items = [];
      snap.forEach(d => {
        const v = d.data() || {};
        items.push({
          id: d.id, uid: v.uid, postId: v.postId,
          walletAddress: v.walletAddress || null,
          status: v.status,
          requestedAt: _iso(v.requestedAt), dueAt: _iso(v.dueAt),
          answeredAt: _iso(v.answeredAt), comment: v.comment || null,
          lateCompensated: !!v.lateCompensated,
          // 期限を過ぎているか。過ぎていたら補償の対象になる。
          overdue: v.status === "pending" && v.dueAt && _iso(v.dueAt) < new Date().toISOString()
        });
      });
      items.sort((a, b) => String(a.dueAt || "").localeCompare(String(b.dueAt || "")));
      return res.json({ ok: true, items, capacity: CAPACITY });
    } catch (e) {
      console.error("review list error:", e.message);
      return res.status(500).json({ error: "LIST_FAILED" });
    }
  });

  /* 受領コメントを返す。 */
  router.post("/admin/:id/answer", requireOwner, async (req, res) => {
    try {
      const id = String(req.params.id);
      const comment = String((req.body || {}).comment || "").trim();
      if (comment.length < 10) return res.status(400).json({ error: "COMMENT_TOO_SHORT" });

      const ref = db.collection(COL).doc(id);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: "NOT_FOUND" });
      const v = snap.data() || {};
      if (v.status === "answered") return res.status(409).json({ error: "ALREADY_ANSWERED" });

      const now = new Date();
      const due = v.dueAt && typeof v.dueAt.toDate === "function" ? v.dueAt.toDate() : v.dueAt;
      /* 期限を過ぎていたら、補償の対象として印を付ける。
         約束した以上、遅れたことを自分で記録しておく。 */
      const late = due ? now.getTime() > new Date(due).getTime() : false;

      await ref.set({
        status: "answered", comment, answeredAt: now,
        late, lateCompensated: false
      }, { merge: true });

      return res.json({ ok: true, late });
    } catch (e) {
      console.error("review answer error:", e.message);
      return res.status(500).json({ error: "ANSWER_FAILED" });
    }
  });

  /* 遅れた分の割引を実際に渡す。
     規約で「7営業日を過ぎたら翌月の light 料金相当（500円）を割り引く」と
     約束しているので、手作業に頼らずここで Stripe に反映する。

     顧客の残高に -500円 を積む（customer balance）。
     次回の請求書から自動で差し引かれる。クーポンと違い、
     プランや期間に関係なく確実に1回だけ効く。 */
  router.post("/admin/:id/compensate", requireOwner, async (req, res) => {
    try {
      const ref = db.collection(COL).doc(String(req.params.id));
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: "NOT_FOUND" });
      const v = snap.data() || {};
      if (v.lateCompensated) return res.status(409).json({ error: "ALREADY_COMPENSATED" });

      let applied = false, note = "", customerId = null;
      try {
        const sub = await db.collection("subscriptions").doc(String(v.uid)).get();
        customerId = sub.exists ? (sub.data() || {}).stripeCustomerId : null;
      } catch (e) {}

      if (stripe && customerId) {
        /* 同じ件で二重に渡さないよう、申請IDを冪等キーにする。
           途中で失敗して押し直しても、割引は1回だけになる。 */
        await stripe.customers.createBalanceTransaction(customerId, {
          amount: -500, currency: "jpy",
          description: "受領コメントの遅延に対する割引（1件）",
          metadata: { reviewId: String(req.params.id), uid: String(v.uid) }
        }, { idempotencyKey: "review-comp-" + String(req.params.id) });
        applied = true;
        note = "Stripe の顧客残高に 500円 を積みました。次回の請求から差し引かれます。";
      } else {
        note = stripe
          ? "この方の Stripe 顧客が見つからないため、自動では割り引けませんでした。"
          : "Stripe が未設定のため、自動では割り引けませんでした。";
      }

      await ref.set({
        lateCompensated: true,
        compensatedAt: new Date(),
        compensationApplied: applied,
        compensationNote: String((req.body || {}).note || note)
      }, { merge: true });
      return res.json({ ok: true, applied, note });
    } catch (e) {
      console.error("compensate error:", e.message);
      return res.status(500).json({ error: "COMPENSATE_FAILED", message: e.message });
    }
  });

  /* 期限が近い依頼を数える。毎日これを見て、返し忘れに気づけるようにする。
     管理画面を開かないと分からない状態だと、7営業日の約束を落とす。 */
  async function dueSoon() {
    if (!db) return { pending: 0, dueIn2Days: 0, overdue: 0, items: [] };
    const snap = await db.collection(COL).where("status", "==", "pending").limit(200).get();
    const now = Date.now();
    const soon = now + 2 * 24 * 3600 * 1000;
    const items = [];
    let overdue = 0, dueIn2Days = 0;
    snap.forEach(d => {
      const v = d.data() || {};
      const due = v.dueAt && typeof v.dueAt.toDate === "function" ? v.dueAt.toDate() : v.dueAt;
      const t = due ? new Date(due).getTime() : null;
      if (t === null) return;
      if (t < now) { overdue += 1; items.push({ id: d.id, uid: v.uid, dueAt: _iso(v.dueAt), overdue: true }); }
      else if (t < soon) { dueIn2Days += 1; items.push({ id: d.id, uid: v.uid, dueAt: _iso(v.dueAt), overdue: false }); }
    });
    return { pending: snap.size, dueIn2Days, overdue, items };
  }

  /* オーナーが自分で見るための窓口。管理画面のバッジに使う。 */
  router.get("/admin/due", requireOwner, async (req, res) => {
    try { return res.json({ ok: true, ...(await dueSoon()) }); }
    catch (e) { return res.status(500).json({ error: "DUE_FAILED" }); }
  });

  return { router, dueDateFrom, dueSoon, CAPACITY, BUSINESS_DAYS };
}

module.exports = { createReviewRouter, dueDateFrom, CAPACITY, BUSINESS_DAYS };
