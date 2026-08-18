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

/* 制限が始まる日（日本時間 2026-09-01 0:00）。
   規約 第10条により 8/17 に掲示済み（効力発生日の15日前）。
   この日までは、これまでどおり全員が全部使える。
   画面側の EMU_ENFORCE_FROM と必ず同じ日にすること。 */
const ENFORCE_FROM = Date.parse("2026-08-31T15:00:00Z");
function enforcing() { return Date.now() >= ENFORCE_FROM; }

/* 各段の上限。数える単位は暦月ではなく請求期間（契約開始日から次回更新日の前日まで）。
   無料の人には請求期間がないので、その場合だけ暦月で数える。 */
const LIMITS = {
  guest: { post: 0,  request: 0,  answer: 0,  ichinichi: 0,  discussion: 0, library: 0,    guestPlay: 3 },
  light: { post: 2,  request: 1,  answer: 5,  ichinichi: 7,  discussion: 0, library: 30,   guestPlay: 9999 },
  plus:  { post: 30, request: 10, answer: 30, ichinichi: 31, discussion: 10, library: 1000, guestPlay: 9999 },
  pro:   { post: 30, request: 10, answer: 30, ichinichi: 31, discussion: 10, library: 1000, guestPlay: 9999 }
};

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

  /* ウォレットアドレスから資格を引く。
     Socket.io（議論の発言）は uid を持たずアドレスしか分からないため、
     ここで uid に読み替えてから判定する。 */
  const addrCache = new Map();
  async function getEntitlementByAddress(address) {
    const addr = String(address || "").toLowerCase();
    if (!addr || !db) return { plan: "guest", source: "none" };

    const hit = addrCache.get(addr);
    let uid = hit && hit.expiresAt > Date.now() ? hit.uid : null;
    if (!uid) {
      try {
        const w = await db.collection("ches_wallets").doc(addr).get();
        if (w.exists) uid = (w.data() || {}).uid || null;
        if (!uid) {
          // ches_wallets はチェックサム表記で入っていることがあるので、こちらでも引く
          const q = await db.collection("ches_accounts").where("walletAddress", "==", addr).limit(1).get();
          if (!q.empty) uid = q.docs[0].id;
        }
      } catch (e) {
        console.warn("利用資格: アドレスからの引き当てに失敗:", e.message);
      }
      if (uid) addrCache.set(addr, { uid, expiresAt: Date.now() + 10 * 60 * 1000 });
    }
    if (!uid) return { plan: "guest", source: "none" };
    return getEntitlement(uid);
  }

  function atLeast(plan, min) {
    return (PLAN_RANK[plan] || 0) >= (PLAN_RANK[min] || 0);
  }

  /**
   * この段以上でないと通さない。requireFirebaseUser の後ろに置く。
   * 通ったときは req.entitlement に判定結果を入れる。
   *
   * 施行日（9/1）より前は誰も止めない。掲示した約束どおりにするため。
   */
  function requirePlan(min) {
    const need = PLAN_RANK[min] === undefined ? "light" : min;
    return async function (req, res, next) {
      try {
        const uid = req.identity && req.identity.uid;
        const account = req.identity && req.identity.account;
        const ent = await getEntitlement(uid, account);
        req.entitlement = ent;
        if (enforcing() && !atLeast(ent.plan, need)) {
          return res.status(403).json({ error: "PLAN_REQUIRED", required: need, current: ent.plan });
        }
        next();
      } catch (e) {
        console.error("利用資格の判定に失敗:", e.message);
        return res.status(500).json({ error: "ENTITLEMENT_FAILED" });
      }
    };
  }

  /* 上限を数える期間。契約している人は請求期間、していない人は暦月。
     暦月にすると月末に入会した人が翌日に上限が復活してしまうため、
     契約がある人は必ず請求期間で数える。 */
  async function usageWindow(uid) {
    const now = new Date();
    if (db) {
      try {
        const snap = await db.collection("subscriptions").doc(uid).get();
        if (snap.exists) {
          const end = _toDate((snap.data() || {}).currentPeriodEnd);
          if (end && end.getTime() > now.getTime()) {
            const start = addMonths(end, -1);
            return { key: "p" + start.toISOString().slice(0, 10), start, end };
          }
        }
      } catch (e) {}
    }
    // 契約がなければ暦月（日本時間）
    const jst = new Date(now.getTime() + 9 * 3600 * 1000);
    const key = "m" + jst.toISOString().slice(0, 7);
    const start = new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), 1) - 9 * 3600 * 1000);
    return { key, start, end: addMonths(start, 1) };
  }

  function limitOf(plan, kind) {
    const row = LIMITS[plan] || LIMITS.guest;
    return row[kind] === undefined ? 0 : row[kind];
  }

  /**
   * 上限を1つ使う。使えたら true、上限に達していたら false。
   * 施行日より前は何も数えず、必ず通す。
   */
  async function consume(uid, kind, opts) {
    const o = opts || {};
    if (!enforcing() && !o.force) return { ok: true, enforcing: false };
    const ent = await getEntitlement(uid, o.account);
    const limit = limitOf(ent.plan, kind);
    if (limit <= 0) return { ok: false, plan: ent.plan, limit: 0, used: 0 };
    if (!db) return { ok: true, plan: ent.plan, limit, used: 0 };

    const win = await usageWindow(uid);
    const ref = db.collection("plan_usage").doc(uid + "_" + win.key);
    let used = 0;
    try {
      const snap = await ref.get();
      used = snap.exists ? Number((snap.data() || {})[kind]) || 0 : 0;
    } catch (e) {}
    if (used >= limit) return { ok: false, plan: ent.plan, limit, used, resetsAt: win.end.toISOString() };

    if (!o.dryRun) {
      try {
        const inc = {};
        inc[kind] = used + 1;
        await ref.set({ uid, windowKey: win.key, windowEndsAt: win.end, updatedAt: new Date(), ...inc }, { merge: true });
      } catch (e) {
        console.warn("上限の記録に失敗:", e.message);
      }
    }
    return { ok: true, plan: ent.plan, limit, used: used + 1, resetsAt: win.end.toISOString() };
  }

  /** いまの使用状況をまとめて返す（画面に出す用）。 */
  async function usageOf(uid, accountData) {
    const ent = await getEntitlement(uid, accountData);
    const win = await usageWindow(uid);
    let data = {};
    if (db) {
      try {
        const snap = await db.collection("plan_usage").doc(uid + "_" + win.key).get();
        if (snap.exists) data = snap.data() || {};
      } catch (e) {}
    }
    const out = { plan: ent.plan, enforcing: enforcing(), resetsAt: win.end.toISOString(), items: {} };
    Object.keys(LIMITS.plus).forEach(function (kind) {
      out.items[kind] = { used: Number(data[kind]) || 0, limit: limitOf(ent.plan, kind) };
    });
    return out;
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
        const rec = {
          uid: doc.id, plan,
          source: plan === "pro" ? "owner" : "official-pass",
          walletAddress: addr,
          startsAt,
          grantedBy: label, createdAt: new Date()
        };
        /* オーナーの分は期限を切らない。null を入れるのではなく項目ごと持たせない。
           Firestore ルールで「無ければ期限なし」と読ませるため。 */
        if (plan !== "pro") rec.expiresAt = expiresAt;
        await ref.set(rec);
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

  return { getEntitlement, getEntitlementByAddress, requirePlan, forget, atLeast, grantInitial, consume, usageOf, usageWindow, limitOf, enforcing, PLAN_RANK, LIMITS, GRANTS_COL, ENFORCE_FROM };
}

module.exports = { createEntitlement, PLAN_RANK, LIMITS, ENFORCE_FROM };
