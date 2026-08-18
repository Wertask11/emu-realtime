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

// 付与の置き場。運営（サーバー）だけが書ける。
const GRANTS_COL = "entitlements";

function createEntitlement(deps) {
  const db = deps && deps.db;
  const cache = new Map();

  function _toDate(v) {
    if (!v) return null;
    if (typeof v.toDate === "function") return v.toDate();
    if (v instanceof Date) return v;
    if (typeof v === "number") return new Date(v);   // ches_accounts.createdAt は数値のことがある
    if (typeof v === "string") { const d = new Date(v); return isNaN(d.getTime()) ? null : d; }
    return null;
  }

  /* 付与のほう。entitlements/{uid} を読む。

     以前は ches_accounts.createdAt から毎回その場で判定していたが、やめた。
     基準日を変えたときやデータが揺れたときに、誰にいつ何を渡したのかを
     追えなくなるため。付与は施行のときに1件ずつ書き、以後はそれを読むだけにする。
     このレコードは運営（サーバー）しか書けない。 */
  async function grantOf(uid) {
    if (!db || !uid) return null;
    try {
      const snap = await db.collection(GRANTS_COL).doc(uid).get();
      if (!snap.exists) return null;
      const v = snap.data() || {};
      if (PLAN_RANK[v.plan] === undefined) return null;
      const starts = _toDate(v.startsAt);
      const expires = _toDate(v.expiresAt);
      const now = Date.now();
      if (starts && now < starts.getTime()) return null;   // まだ始まっていない
      if (expires && now >= expires.getTime()) return null; // もう終わっている
      return { plan: v.plan, source: v.source || "grant", until: expires };
    } catch (e) {
      console.warn("利用資格: 付与を読めませんでした:", e.message);
      return null;
    }
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

    const granted = await grantOf(uid);

    // 契約と付与のうち、上の段のほうを採る
    let plan = "guest", source = "none";
    if (paid) { plan = paid; source = "stripe"; }
    if (granted && PLAN_RANK[granted.plan] > PLAN_RANK[plan]) { plan = granted.plan; source = granted.source; }

    const value = {
      plan,
      source,
      status,
      foundingUntil: granted && granted.until ? granted.until.toISOString() : null
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

  function addMonths(date, months) {
    const d = new Date(date.getTime());
    d.setMonth(d.getMonth() + months);
    return d;
  }

  /**
   * 施行のときに1回だけ実行する、最初の付与。
   *
   *   公式パス（NFT）を持っている人 … plus
   *   オーナー                      … pro（Emuを盛り上げるために全部使えるようにする）
   *   それ以外                      … 何も配らない（無料の人のまま）
   *
   * 公式パスの持ち主は Firestore の paid_users（小文字のウォレットアドレスが鍵）で見る。
   * すでに付与があるアカウントには触らない（二度実行しても増えない）。
   *
   * dryRun のときは書き込まず、人数だけ数える。
   * 「誰に何人配ることになるのか」を先に見てから実行できるようにするため。
   */
  async function grantInitial(opts) {
    const o = opts || {};
    const months = Number(o.months) > 0 ? Number(o.months) : 6;
    const label = String(o.grantedBy || "initial");
    const dryRun = o.dryRun !== false;   // 既定は空打ち。うっかり配らないように
    const owner = String(o.ownerAddress || process.env.SP_OWNER_ADDRESS || "").toLowerCase();
    if (!db) throw new Error("NO_DB");

    const startsAt = new Date();
    const expiresAt = addMonths(startsAt, months);
    const accounts = await db.collection("ches_accounts").limit(2000).get();

    const result = { plusTarget: 0, proTarget: 0, granted: 0, skipped: 0, noPass: 0 };
    for (const doc of accounts.docs) {
      const addr = String((doc.data() || {}).walletAddress || "").toLowerCase();
      if (!addr) { result.noPass += 1; continue; }

      let plan = null;
      if (owner && addr === owner) {
        plan = "pro";                       // オーナーは全部使えるようにする
      } else {
        const pass = await db.collection("paid_users").doc(addr).get();
        if (pass.exists) plan = "plus";     // 公式パス保有者
      }
      if (!plan) { result.noPass += 1; continue; }

      if (plan === "pro") result.proTarget += 1; else result.plusTarget += 1;

      const ref = db.collection(GRANTS_COL).doc(doc.id);
      const exists = await ref.get();
      if (exists.exists) { result.skipped += 1; continue; }   // すでに配ってある
      if (!dryRun) {
        await ref.set({
          uid: doc.id, plan,
          source: plan === "pro" ? "owner" : "official-pass",
          walletAddress: addr,
          startsAt,
          // オーナーの分は期限を切らない
          expiresAt: plan === "pro" ? null : expiresAt,
          grantedBy: label, createdAt: new Date()
        });
        forget(doc.id);
      }
      result.granted += 1;
    }
    return {
      dryRun, months,
      startsAt: startsAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      scanned: accounts.size,
      ...result
    };
  }

  return { getEntitlement, requirePlan, forget, atLeast, grantInitial, PLAN_RANK, GRANTS_COL };
}

module.exports = { createEntitlement, PLAN_RANK };
