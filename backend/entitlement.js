"use strict";

/**
 * 利用資格（エンタイトルメント）。
 *
 * 「この人はいま何ができるか」を1か所で決める。
 *
 * なぜ Stripe のプランを読むだけでは足りないか:
 *   Founding Emuer（この仕組みより前から使っている人）には、Stripe を通さずに
 *   light 相当を一定期間ただで渡す。決済がないので subscriptions には何も無い。
 *   したがって「契約」と「付与」の両方を見て、最後に強いほうを採る必要がある。
 *
 * 安全のための方針:
 *   - Founding は環境変数を入れるまで動かない。入れ忘れで誰かが締め出されることはない。
 *   - ここは判定するだけ。実際に機能を止めるかどうかは呼ぶ側が決める。
 */

// 下から上へ。数が大きいほど上の段。
const PLAN_RANK = { guest: 0, light: 1, plus: 2, pro: 3 };

// 契約が生きているとみなす Stripe の状態。
// past_due は支払いの再試行中で、まだ会員のまま。ここで締め出すと厳しすぎる。
const LIVE_STATUS = new Set(["active", "trialing", "past_due"]);

const CACHE_MS = 60 * 1000;   // Firestore の読み取りを減らす。60秒で十分。

function createEntitlement(deps) {
  const db = deps && deps.db;
  const cache = new Map();

  /* Founding Emuer の設定。
     EMU_FOUNDING_CUTOFF … この日時より前に作られたアカウントが対象（ISO文字列）
     EMU_FOUNDING_MONTHS … 何か月ただで渡すか（既定 6）
     EMU_FOUNDING_PLAN   … 渡す段（既定 light）
     CUTOFF が無いあいだは Founding は誰にも付かない。 */
  function foundingConfig() {
    const raw = String(process.env.EMU_FOUNDING_CUTOFF || "").trim();
    if (!raw) return null;
    const cutoff = new Date(raw);
    if (isNaN(cutoff.getTime())) {
      console.warn("⚠️ EMU_FOUNDING_CUTOFF が日時として読めません:", raw);
      return null;
    }
    const months = Number(process.env.EMU_FOUNDING_MONTHS || 6);
    const plan = String(process.env.EMU_FOUNDING_PLAN || "light");
    return {
      cutoff,
      months: months > 0 ? months : 6,
      plan: PLAN_RANK[plan] === undefined ? "light" : plan
    };
  }

  function _toDate(v) {
    if (!v) return null;
    if (typeof v.toDate === "function") return v.toDate();
    if (v instanceof Date) return v;
    if (typeof v === "number") return new Date(v);   // ches_accounts.createdAt は数値のことがある
    if (typeof v === "string") { const d = new Date(v); return isNaN(d.getTime()) ? null : d; }
    return null;
  }

  function addMonths(date, months) {
    const d = new Date(date.getTime());
    d.setMonth(d.getMonth() + months);
    return d;
  }

  /* 付与のほう。Founding Emuer なら、いつまで何が使えるかを返す。 */
  function foundingOf(accountData) {
    const conf = foundingConfig();
    if (!conf || !accountData) return null;
    const createdAt = _toDate(accountData.createdAt);
    if (!createdAt) return null;
    if (createdAt.getTime() >= conf.cutoff.getTime()) return null;   // 施行後に来た人は対象外
    const until = addMonths(conf.cutoff, conf.months);
    if (Date.now() >= until.getTime()) return null;                  // 期間が終わっている
    return { plan: conf.plan, until };
  }

  /**
   * いまの利用資格を返す。
   * accountData を渡せば ches_accounts の読み直しを省ける
   * （requireFirebaseUser が req.identity.account に入れている）。
   */
  async function getEntitlement(uid, accountData) {
    if (!uid) return { plan: "guest", source: "none", status: null, foundingUntil: null };

    const hit = cache.get(uid);
    if (hit && hit.expiresAt > Date.now()) return hit.value;

    let paid = null;      // 契約から得た段
    let status = null;
    if (db) {
      try {
        const snap = await db.collection("subscriptions").doc(uid).get();
        if (snap.exists) {
          const v = snap.data() || {};
          status = v.status || null;
          if (LIVE_STATUS.has(String(v.status)) && PLAN_RANK[v.plan] !== undefined) paid = v.plan;
        }
      } catch (e) {
        console.warn("利用資格: 契約を読めませんでした:", e.message);
      }
    }

    let account = accountData || null;
    if (!account && db) {
      try {
        const acc = await db.collection("ches_accounts").doc(uid).get();
        if (acc.exists) account = acc.data();
      } catch (e) {}
    }
    const founding = foundingOf(account);

    // 契約と付与のうち、上の段のほうを採る
    let plan = "guest", source = "none";
    if (paid) { plan = paid; source = "stripe"; }
    if (founding && PLAN_RANK[founding.plan] > PLAN_RANK[plan]) { plan = founding.plan; source = "founding"; }

    const value = {
      plan,
      source,
      status,
      foundingUntil: founding ? founding.until.toISOString() : null
    };
    cache.set(uid, { value, expiresAt: Date.now() + CACHE_MS });
    return value;
  }

  /* 契約が変わったときに呼ぶ。次の問い合わせで最新を読み直す。 */
  function forget(uid) { if (uid) cache.delete(uid); }

  function atLeast(plan, min) {
    return (PLAN_RANK[plan] || 0) >= (PLAN_RANK[min] || 0);
  }

  /**
   * この段以上でないと通さない。requireFirebaseUser の後ろに置く。
   * 通ったときは req.entitlement に判定結果を入れる。
   */
  function requirePlan(min) {
    const need = PLAN_RANK[min] === undefined ? "light" : min;
    return async function (req, res, next) {
      try {
        const uid = req.identity && req.identity.uid;
        const account = req.identity && req.identity.account;
        const ent = await getEntitlement(uid, account);
        req.entitlement = ent;
        if (!atLeast(ent.plan, need)) {
          return res.status(403).json({ error: "PLAN_REQUIRED", required: need, current: ent.plan });
        }
        next();
      } catch (e) {
        console.error("利用資格の判定に失敗:", e.message);
        return res.status(500).json({ error: "ENTITLEMENT_FAILED" });
      }
    };
  }

  return { getEntitlement, requirePlan, forget, atLeast, PLAN_RANK };
}

module.exports = { createEntitlement, PLAN_RANK };
