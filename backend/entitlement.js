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
/* 「制限なし」を表す数。無限を入れると、記録や画面で扱いに困る
   （JSONに載らない・比較のたびに例外を考える）ので、届かない大きさの数にする。
   画面に出すときは、この数以上なら「制限なし」と書く。
   firestore.rules の UNLIMITED と必ず同じ値にすること。 */
const UNLIMITED = 1000000;

const LIMITS = {
  guest: { post: 0,  request: 0,  answer: 0,  ichinichi: 0,  discussion: 0, library: 0,    guestPlay: 3 },
  light: { post: 2,  request: 1,  answer: 5,  ichinichi: 7,  discussion: 0, library: 30,   guestPlay: 9999 },
  plus:  { post: 30, request: 10, answer: 30, ichinichi: 31, discussion: 10, library: 1000, guestPlay: 9999 },
  /* pro は投稿の数を数えない。ほかの項目は plus と同じ。 */
  pro:   { post: UNLIMITED, request: 10, answer: 30, ichinichi: 31, discussion: 10, library: 1000, guestPlay: 9999 }
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

  /* 公式パス（NFT）を持っているか。
     持ち主は paid_users にアドレスを鍵にして入っている。

     鍵が小文字で入っているとは限らない（アドレスは大文字混じりの
     チェックサム表記で作られる）ので、両方の形で見る。
     ウォレットで入った人と、LINE等で入った人でアドレスが違うので、
     walletAddress と chesAddress の両方を見る。 */
  async function holdsOfficialPass(uid, accountData) {
    if (!db || !uid) return false;
    let acc = accountData;
    if (!acc) {
      try {
        const s = await db.collection("ches_accounts").doc(uid).get();
        acc = s.exists ? (s.data() || {}) : null;
      } catch (e) { return false; }
    }
    if (!acc) return false;

    const seen = {};
    for (const base of [acc.walletAddress, acc.chesAddress]) {
      const raw = String(base || "").trim();
      if (!raw) continue;
      const forms = [raw.toLowerCase(), raw];
      try {
        const ethers = require("ethers");
        forms.push(ethers.utils.getAddress(raw.toLowerCase()));
      } catch (e) { /* 形が違うときは、そのぶんだけ諦める */ }
      for (const f of forms) {
        if (!f || seen[f]) continue;
        seen[f] = true;
        try {
          const p = await db.collection("paid_users").doc(f).get();
          if (p.exists) return true;
        } catch (e) { /* 読めないときは「持っていない」とはせず、次を試す */ }
      }
    }
    return false;
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
    const hasPass = await holdsOfficialPass(uid, accountData);

    /* 契約・付与・公式パスのうち、いちばん上の段を採る。

       公式パス（NFT）は買い切りで、画面には
       「公式パスをお持ちの方には、Emu plus 相当を無償でお渡しします」
       と書いてある。期限は書いていない。
       以前は施行時の一括付与でしか見ておらず、その付与には6か月の期限が
       付いていたので、切れたあと見学に落ちてしまう形だった。
       ここで毎回見るようにして、持っているあいだはずっと plus にする。
       手放したら paid_users から消せば、その時点で戻る。 */
    let plan = "guest", source = "none";
    if (paid) { plan = paid; source = "stripe"; }
    if (granted && PLAN_RANK[granted.plan] > PLAN_RANK[plan]) { plan = granted.plan; source = granted.source; }
    if (hasPass && PLAN_RANK.plus > PLAN_RANK[plan]) { plan = "plus"; source = "official-pass"; }

    const value = {
      plan,
      source,
      status,
      hasPass,
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
  /* SchoolParkパスポートのID（＝アドレス）から、その人の uid を引く。
     見つからなければ null。

     アドレスは deriveWalletAddress が ethers.getAddress を通しているので、
     Firestore には「0x195f4478EE3865eE1DD360b79E121C638BDD42aC」のような
     大文字混じり（チェックサム表記）で入っている。
     Firestore の一致検索は大文字小文字を区別するため、小文字だけで探すと
     どれにも当たらず「そのIDの人が見つかりません」になる。
     小文字・チェックサム表記・渡された形の3つで探す。 */
  function addressForms(address) {
    const raw = String(address || "").trim();
    if (!raw) return [];
    const lower = raw.toLowerCase();
    const forms = [lower, raw];
    try {
      const ethers = require("ethers");
      forms.push(ethers.utils.getAddress(lower));   // チェックサム表記
    } catch (e) { /* 形が違う・ethers が無い場合は、そのぶんだけ諦める */ }
    return [...new Set(forms.filter(Boolean))];
  }

  async function uidOfAddress(address) {
    const key = String(address || "").trim().toLowerCase();
    if (!key || !db) return null;

    const hit = addrCache.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.uid;

    let uid = null;
    const forms = addressForms(address);
    try {
      for (const form of forms) {
        const w = await db.collection("ches_wallets").doc(form).get();
        if (w.exists) { uid = (w.data() || {}).uid || null; if (uid) break; }
      }
      /* ches_wallets に無いこともある（登録が済んでいない、古いアカウントなど）。
         その場合はアカウントそのものを引く。
         LINE・Google・メールで入った人は chesAddress のほうにしか入らない。 */
      if (!uid) {
        outer:
        for (const field of ["walletAddress", "chesAddress"]) {
          for (const form of forms) {
            const q = await db.collection("ches_accounts").where(field, "==", form).limit(1).get();
            if (!q.empty) { uid = q.docs[0].id; break outer; }
          }
        }
      }
    } catch (e) {
      console.warn("利用資格: アドレスからの引き当てに失敗:", e.message);
    }
    if (uid) addrCache.set(key, { uid, expiresAt: Date.now() + 10 * 60 * 1000 });
    return uid;
  }

  async function getEntitlementByAddress(address) {
    const uid = await uidOfAddress(address);
    if (!uid) return { plan: "guest", source: "none" };
    return getEntitlement(uid);
  }

  /* 運営が1人ずつ渡す。SchoolParkパスポートのIDで指定する。
     期限は任意（入れなければ期限なし）。同じ人に渡し直すと上書きする。 */
  async function grantOne(opts) {
    const o = opts || {};
    const addr = String(o.address || "").trim().toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(addr)) throw new Error("BAD_ADDRESS");
    if (PLAN_RANK[o.plan] === undefined || o.plan === "guest") throw new Error("BAD_PLAN");
    if (!db) throw new Error("NO_DB");

    const uid = await uidOfAddress(addr);
    if (!uid) throw new Error("USER_NOT_FOUND");

    let expiresAt = null;
    if (o.expiresAt) {
      const d = new Date(o.expiresAt);
      if (isNaN(d.getTime())) throw new Error("BAD_EXPIRES");
      if (d.getTime() <= Date.now()) throw new Error("EXPIRES_IN_PAST");
      expiresAt = d;
    }

    const rec = {
      uid: uid, plan: o.plan, source: "admin",
      walletAddress: addr,
      startsAt: new Date(),
      grantedBy: String(o.grantedBy || "admin").slice(0, 120),
      note: String(o.note || "").slice(0, 200),
      createdAt: new Date()
    };
    /* 期限なしのときは項目ごと持たせない。
       null を入れると「期限がある」と読まれてしまうため。 */
    if (expiresAt) rec.expiresAt = expiresAt;

    await db.collection(GRANTS_COL).doc(uid).set(rec);
    forget(uid);
    return { uid: uid, plan: o.plan, address: addr, expiresAt: expiresAt ? expiresAt.toISOString() : null };
  }

  /* 渡したものを取り消す。契約（Stripe）には触らない。 */
  async function revokeOne(address) {
    const addr = String(address || "").trim().toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(addr)) throw new Error("BAD_ADDRESS");
    if (!db) throw new Error("NO_DB");
    const uid = await uidOfAddress(addr);
    if (!uid) throw new Error("USER_NOT_FOUND");
    await db.collection(GRANTS_COL).doc(uid).delete();
    forget(uid);
    return { uid: uid, address: addr };
  }

  /* 指定したIDについて、サーバーが何を見ているかをそのまま返す。
     「渡したのに反映されない」ときに、どこで食い違っているかを見るためのもの。 */
  async function whois(address) {
    const forms = addressForms(address);
    const out = { input: String(address || "").trim(), forms: forms, uid: null, foundBy: null,
      account: null, grant: null, subscription: null, effective: null };
    if (!db || !forms.length) return out;

    for (const form of forms) {
      const w = await db.collection("ches_wallets").doc(form).get();
      if (w.exists && (w.data() || {}).uid) {
        out.uid = w.data().uid; out.foundBy = "ches_wallets/" + form; break;
      }
    }
    if (!out.uid) {
      outer:
      for (const field of ["walletAddress", "chesAddress"]) {
        for (const form of forms) {
          const q = await db.collection("ches_accounts").where(field, "==", form).limit(1).get();
          if (!q.empty) { out.uid = q.docs[0].id; out.foundBy = field + " == " + form; break outer; }
        }
      }
    }
    if (!out.uid) return out;

    const acc = await db.collection("ches_accounts").doc(out.uid).get();
    if (acc.exists) {
      const d = acc.data() || {};
      out.account = { uid: out.uid, provider: d.provider || "", displayName: d.displayName || "",
        walletAddress: d.walletAddress || "", chesAddress: d.chesAddress || "" };
    } else {
      out.account = { uid: out.uid, missing: true };
    }

    const g = await db.collection(GRANTS_COL).doc(out.uid).get();
    if (g.exists) {
      const v = g.data() || {};
      const st = _toDate(v.startsAt), ex = _toDate(v.expiresAt);
      out.grant = { plan: v.plan || "", source: v.source || "", walletAddress: v.walletAddress || "",
        startsAt: st ? st.toISOString() : null, expiresAt: ex ? ex.toISOString() : null,
        notStartedYet: !!(st && Date.now() < st.getTime()),
        alreadyExpired: !!(ex && Date.now() >= ex.getTime()) };
    }

    const sub = await db.collection("subscriptions").doc(out.uid).get();
    if (sub.exists) {
      const v = sub.data() || {};
      out.subscription = { status: v.status || "", plan: v.plan || "" };
    }

    forget(out.uid);
    const ent = await getEntitlement(out.uid);
    out.effective = { plan: ent.plan, source: ent.source };
    return out;
  }

  /* いま渡してあるものの一覧。期限切れも「切れた」と分かるように返す。 */
  async function listGrants(limit) {
    if (!db) return [];
    const snap = await db.collection(GRANTS_COL).limit(Math.min(500, limit || 200)).get();
    const now = Date.now();
    const rows = [];
    snap.forEach(function (d) {
      const v = d.data() || {};
      const exp = _toDate(v.expiresAt);
      rows.push({
        uid: d.id,
        plan: v.plan || "",
        source: v.source || "",
        address: v.walletAddress || "",
        note: v.note || "",
        grantedBy: v.grantedBy || "",
        startsAt: _toDate(v.startsAt) ? _toDate(v.startsAt).toISOString() : null,
        expiresAt: exp ? exp.toISOString() : null,
        expired: !!(exp && now >= exp.getTime())
      });
    });
    rows.sort(function (a, b) { return String(b.startsAt || "").localeCompare(String(a.startsAt || "")); });
    return rows;
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

    if (o.dryRun) {
      let used = 0;
      try { const s = await ref.get(); used = s.exists ? Number((s.data() || {})[kind]) || 0 : 0; } catch (e) {}
      return { ok: used < limit, plan: ent.plan, limit, used, resetsAt: win.end.toISOString() };
    }

    /* 読んでから書くと、同時に押されたときに回数が失われて上限を超えられる。
       読み取りと書き込みをひとつの取引にまとめて、必ず1ずつ進むようにする。 */
    try {
      const used = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const now = snap.exists ? Number((snap.data() || {})[kind]) || 0 : 0;
        if (now >= limit) return null;                 // 上限に達している
        const patch = { uid, windowKey: win.key, windowEndsAt: win.end, updatedAt: new Date() };
        patch[kind] = now + 1;
        tx.set(ref, patch, { merge: true });
        return now + 1;
      });
      if (used === null) {
        let cur = limit;
        try { const s = await ref.get(); cur = s.exists ? Number((s.data() || {})[kind]) || 0 : 0; } catch (e) {}
        return { ok: false, plan: ent.plan, limit, used: cur, resetsAt: win.end.toISOString() };
      }
      return { ok: true, plan: ent.plan, limit, used, resetsAt: win.end.toISOString() };
    } catch (e) {
      console.warn("上限の記録に失敗:", e.message);
      // 数えられないときは止めない。数えられないことを理由に締め出さない。
      return { ok: true, plan: ent.plan, limit, used: 0, resetsAt: win.end.toISOString() };
    }
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
   *   オーナー                        … pro（Emuを盛り上げるために全部使えるようにする。期限なし）
   *   公式パス（NFT）を持っている人   … plus を6か月
   *   施行日より前からいる人（それ以外）… light を6か月
   *   施行日より後に来た人             … 何も配らない（見学から始まる）
   *
   * 重なる場合は上の段を採る（公式パスを優先）。
   *
   * 施行日前からいる人に light を渡すのは、制限を入れた翌日に
   * 「昨日まで書けたものが書けない」を起こさないため。
   * 宣伝で来てくれた人も、この期間内なら守られる。
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

    /* 「施行日より前からいる人」の基準。
       既定は制限が始まる日（9/1）。実行した時刻を基準にすると、
       いつ押したかで対象が変わってしまい、誰が Founding なのかが
       運営の操作タイミング次第になる。決めた日を基準にする。 */
    const cutoff = o.cutoff ? new Date(o.cutoff) : new Date(ENFORCE_FROM);
    if (isNaN(cutoff.getTime())) throw new Error("BAD_CUTOFF");

    const result = { proTarget: 0, plusTarget: 0, lightTarget: 0, granted: 0, skipped: 0, tooNew: 0 };
    for (const doc of accounts.docs) {
      const data = doc.data() || {};
      const addr = String(data.walletAddress || "").toLowerCase();

      let plan = null;
      if (owner && addr && addr === owner) {
        plan = "pro";                              // オーナーは全部使えるようにする
      } else if (addr) {
        const pass = await db.collection("paid_users").doc(addr).get();
        if (pass.exists) plan = "plus";            // 公式パス保有者（重なったらこちらが優先）
      }
      if (!plan) {
        // 施行日より前からいる人には light を渡す
        const createdAt = _toDate(data.createdAt);
        if (createdAt && createdAt.getTime() < cutoff.getTime()) plan = "light";
      }
      if (!plan) { result.tooNew += 1; continue; }   // 施行日より後に来た人

      if (plan === "pro") result.proTarget += 1;
      else if (plan === "plus") result.plusTarget += 1;
      else result.lightTarget += 1;

      const ref = db.collection(GRANTS_COL).doc(doc.id);
      const exists = await ref.get();
      if (exists.exists) { result.skipped += 1; continue; }   // すでに配ってある
      if (!dryRun) {
        const rec = {
          uid: doc.id, plan,
          source: plan === "pro" ? "owner" : (plan === "plus" ? "official-pass" : "founding"),
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
      cutoff: cutoff.toISOString(),
      startsAt: startsAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      scanned: accounts.size,
      ...result
    };
  }

  return { getEntitlement, getEntitlementByAddress, uidOfAddress, requirePlan, forget, atLeast,
    grantInitial, grantOne, revokeOne, listGrants, whois,
    consume, usageOf, usageWindow, limitOf, enforcing, PLAN_RANK, LIMITS, GRANTS_COL, ENFORCE_FROM };
}

module.exports = { createEntitlement, PLAN_RANK, LIMITS, ENFORCE_FROM };
