"use strict";

/**
 * SchoolPark ID（＝ Passport ID）。
 *
 * これまで「その人」を表していたのは chesAddress で、これは
 * Firebase の uid から作られていた（keccak256("ches-wallet:v1:" + uid)）。
 * uid はログイン方法ごとに別物になる。
 *
 *   Google   … Firebase が作る uid
 *   LINE     … "line:<LINEのユーザーID>"
 *   メール   … Firebase が作る uid
 *   ウォレット … "wallet:<小文字アドレス>"
 *
 * つまり同じ人でも、入り方を変えれば別の chesAddress になり、
 * 別のパスポート・別の投稿・別の EMUER になっていた。
 * 公式パスの持ち主かどうかも、そのときの名義でしか当たらなかった。
 *
 * ここでは「人」そのものを表す固定の番号を1本立て、
 * ログイン方法はその番号へ入るための入口として、下にぶら下げる。
 *
 *   SchoolPark ID （変わらない・一人に一つ）
 *     ├─ ログイン方法（LINE / Google / メール / ウォレット）
 *     ├─ 連携ウォレット（署名で所有を確かめたもの）
 *     ├─ 名義（walletAddress / chesAddress）← 既存データはこれで紐づいている
 *     └─ 公式パス・Membership・ギルド・Quest・星空・貢献 …
 *
 * 大事な約束:
 *   - 番号を作れるのはサーバーだけ。ブラウザは受け取って表示するだけ。
 *   - ひとつの認証情報は、ひとつの SchoolPark ID にしか結び付かない。
 *     これは Firestore の「同じIDの文書は一度しか作れない」性質で担保する
 *     （ches_wallets と同じ考え方）。
 *   - 既存の名義（walletAddress / chesAddress）は消さない・変えない。
 *     既存データは全部そこにぶら下がっているため、動かした時点で壊れる。
 *   - 同じ人に見える別番号が見つかっても、勝手に統合しない。記録して運営が見る。
 */

const crypto = require("crypto");

const ID_COL      = "sp_identities";        // SchoolPark ID そのもの
const LINK_COL    = "sp_auth_links";        // 認証情報 → SchoolPark ID（ここが重複防止の要）
const TICKET_COL  = "sp_link_tickets";      // ログイン方法を足すときの一時引換券
const DUP_COL     = "sp_identity_duplicates"; // 同一人物かもしれない重複候補（運営確認用）
const AUDIT_COL   = "sp_identity_audit";    // 発行・連携・拒否の記録
const ACCOUNT_COL = "ches_accounts";
const PASS_COL    = "paid_users";

/* 番号の形。SP-XXXX-XXXX-XXXX-XXXX

   使う文字は Crockford Base32（0-9 と A-Z から I・L・O・U を除いたもの）。
   1 と I、0 と O を読み違えないようにするため。人が読み上げ・書き写しできる。

   16文字 ＝ 80ビット。総当たりで当てられる数ではないので、
   番号を順に試して他人のパスポートを探す（列挙）ことはできない。

   メールアドレス・LINEのID・Firebaseのuid・ウォレットアドレスは
   一切混ぜない。番号から本人の素性やログイン方法は分からない。 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ID_RE = /^SP-[0-9A-HJKMNP-TV-Z]{4}(?:-[0-9A-HJKMNP-TV-Z]{4}){3}$/;

const TICKET_TTL_MS = 10 * 60 * 1000;   // 引換券の有効時間（10分）
const PASS_CACHE_MS = 60 * 1000;        // 公式パス判定の覚え置き

function newSchoolParkId() {
  /* 乱数から作る。連番にすると「隣の番号」を試せてしまう。 */
  const bytes = crypto.randomBytes(16);
  let out = "";
  for (let i = 0; i < 16; i += 1) {
    if (i > 0 && i % 4 === 0) out += "-";
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return "SP-" + out;
}

function isSchoolParkId(value) {
  return ID_RE.test(String(value || ""));
}

/* 認証情報の置き場所（文書ID）。

   kind は "fb"（Firebase のログイン）か "wallet"（署名で確かめたウォレット）。
   Firestore の文書IDに使えない形が来たときは、取り違えないように
   ハッシュへ逃がす（実際には uid もアドレスも安全な形しか来ない）。 */
function linkIdFor(kind, subject) {
  const raw = String(subject || "").trim();
  if (!raw) throw new Error("BAD_SUBJECT");
  const safe = /^[A-Za-z0-9:_.-]{1,200}$/.test(raw) && raw.indexOf("..") < 0
    ? raw
    : "h_" + crypto.createHash("sha256").update(raw).digest("hex").slice(0, 40);
  return kind + ":" + safe;
}

function lower(v) { return String(v || "").trim().toLowerCase(); }

/* アドレスの表記ゆれ。paid_users には小文字のものと
   チェックサム表記（大文字まじり）のものが混ざって現存する。 */
function addressForms(address, ethers) {
  const raw = String(address || "").trim();
  if (!raw) return [];
  const forms = [raw.toLowerCase(), raw];
  if (ethers) {
    try { forms.push(ethers.utils.getAddress(raw.toLowerCase())); } catch (e) { /* 形が違うだけ */ }
  }
  return [...new Set(forms.filter(Boolean))];
}

function isAddress(v) { return /^0x[0-9a-fA-F]{40}$/.test(String(v || "").trim()); }

/* ログイン方法の呼び名。表示と記録にだけ使う（権限には使わない）。 */
function providerOf(uid, account, signInProvider) {
  const u = String(uid || "");
  if (u.indexOf("line:") === 0) return "line";
  if (u.indexOf("wallet:") === 0) return "wallet";
  const s = String(signInProvider || "").toLowerCase();
  if (s.indexOf("google") >= 0) return "google";
  if (s === "password" || s.indexOf("email") >= 0) return "email";
  const p = String((account && account.provider) || "").toLowerCase();
  if (p.indexOf("line") >= 0) return "line";
  if (p.indexOf("google") >= 0) return "google";
  if (p === "password" || p.indexOf("email") >= 0) return "email";
  if (p.indexOf("wallet") >= 0) return "wallet";
  return p || "unknown";
}

const PROVIDER_LABEL = {
  line: "LINE", google: "Google", email: "メール",
  wallet: "ウォレット", unknown: "不明"
};

/* そのアカウントが名乗っている名義をぜんぶ集める。
   既存データ（投稿・Quest・星空・EMUER）はこの名義にぶら下がっているので、
   SchoolPark ID の下に「別名義」として保持する。書き換えはしない。 */
function addressesFromAccount(account) {
  if (!account) return [];
  const out = [];
  for (const v of [account.walletAddress, account.chesAddress]) {
    const a = lower(v);
    if (a && isAddress(a) && out.indexOf(a) < 0) out.push(a);
  }
  return out;
}

function mergeLists(a, b) {
  const out = Array.isArray(a) ? a.slice() : [];
  for (const v of (Array.isArray(b) ? b : [])) if (v && out.indexOf(v) < 0) out.push(v);
  return out;
}

function createIdentity(deps) {
  const db = deps && deps.db;
  const ethers = (deps && deps.ethers) || safeEthers();
  const passCache = new Map();

  /* ───────────────────── 読み取り ───────────────────── */

  async function readIdentity(spid) {
    if (!db || !isSchoolParkId(spid)) return null;
    const snap = await db.collection(ID_COL).doc(spid).get();
    return snap.exists ? (snap.data() || null) : null;
  }

  /* uid から SchoolPark ID を引く。作らない（読むだけ）。
     入場判定のように何度も呼ばれるところは、こちらを使う。 */
  async function findByUid(uid) {
    if (!db || !uid) return null;
    try {
      const snap = await db.collection(LINK_COL).doc(linkIdFor("fb", uid)).get();
      if (!snap.exists) return null;
      const spid = String((snap.data() || {}).spid || "");
      return isSchoolParkId(spid) ? spid : null;
    } catch (e) {
      console.warn("SchoolPark ID: uid からの引き当てに失敗:", e.message);
      return null;
    }
  }

  async function findByAddress(address) {
    if (!db || !isAddress(address)) return null;
    try {
      const snap = await db.collection(LINK_COL).doc(linkIdFor("wallet", lower(address))).get();
      if (!snap.exists) return null;
      const spid = String((snap.data() || {}).spid || "");
      return isSchoolParkId(spid) ? spid : null;
    } catch (e) { return null; }
  }

  /* ───────────────────── 記録 ───────────────────── */

  async function audit(action, detail) {
    if (!db) return;
    try {
      await db.collection(AUDIT_COL).add({
        action: String(action || ""), at: new Date(), ...(detail || {})
      });
    } catch (e) { /* 記録に失敗しても本筋は止めない */ }
  }

  /* 同じ人かもしれない別番号が見つかったときの記録。
     ここでは絶対に統合しない。運営が中身（EMUER・投稿・Quest・ギルド・
     星空・公式パス・Membership・ウォレット・実績）を見て決める。 */
  async function flagDuplicate(info) {
    if (!db) return null;
    const a = String((info && info.spid) || "");
    const b = String((info && info.otherSpid) || "");
    /* 同じ組み合わせを何度も積まない。IDは並び順を固定して作る。 */
    const pair = [a, b].sort().join("__");
    const id = crypto.createHash("sha256")
      .update(pair + "|" + String((info && info.reason) || "")).digest("hex").slice(0, 32);
    try {
      const ref = db.collection(DUP_COL).doc(id);
      const snap = await ref.get();
      const now = new Date();
      if (snap.exists) {
        await ref.set({ lastSeenAt: now, seenCount: (Number((snap.data() || {}).seenCount) || 1) + 1 }, { merge: true });
        return id;
      }
      await ref.set({
        id,
        spid: a, otherSpid: b,
        reason: String((info && info.reason) || "unknown"),
        detail: String((info && info.detail) || "").slice(0, 400),
        status: "pending_review",     // 運営が見るまでこのまま
        seenCount: 1,
        createdAt: now, lastSeenAt: now
      });
      await audit("duplicate.flagged", { spid: a, otherSpid: b, reason: (info && info.reason) || "" });
      return id;
    } catch (e) {
      console.warn("SchoolPark ID: 重複候補を記録できませんでした:", e.message);
      return null;
    }
  }

  /* ───────────────────── 発行と解決 ───────────────────── */

  /**
   * 認証済みの uid から SchoolPark ID を出す。無ければ一度だけ作る。
   *
   * ログインのたびに呼ばれる前提なので、
   *   - すでにある人は「読むだけ」で終わる（書き込みをしない）
   *   - 無い人だけ取引（トランザクション）で作る
   * 同時に何本来ても、認証情報1つにつき番号は1つしか生まれない。
   * これは sp_auth_links の文書が「一度しか作れない」ことで担保する。
   */
  async function resolveForUid(uid, opts) {
    const o = opts || {};
    if (!db) throw new Error("NO_DB");
    const u = String(uid || "").trim();
    if (!u) throw new Error("BAD_UID");

    const linkId = linkIdFor("fb", u);
    const linkRef = db.collection(LINK_COL).doc(linkId);
    const accRef = db.collection(ACCOUNT_COL).doc(u);

    /* ウォレットで入ってきた場合の「このアドレスは誰のものか」。

       uid が "wallet:0x…" になるのは /api/auth/wallet だけで、
       そこは署名（personal_sign）で所有を確かめてから custom token を出す。
       つまり、このアドレスの持ち主であることは確認済み。

       そのアドレスがすでにどこかの SchoolPark ID に連携されているなら、
       新しい番号を作らずに、そちらへ合流する。
       これが無いと「LINEで作ってウォレットを連携した人」が、
       次にウォレットで入ったときに別の番号になってしまう。 */
    const uidWalletAddress = u.indexOf("wallet:") === 0 ? lower(u.slice("wallet:".length)) : "";
    const walletLinkRef = isAddress(uidWalletAddress)
      ? db.collection(LINK_COL).doc(linkIdFor("wallet", uidWalletAddress))
      : null;

    // ふだんの道。すでに番号がある人は、ここで終わる。
    const existing = await linkRef.get();
    if (existing.exists) {
      const spid = String((existing.data() || {}).spid || "");
      if (isSchoolParkId(spid)) {
        const identity = await readIdentity(spid);
        if (identity) return { spid, identity, isNew: false };
        // 番号の本体が無い（途中で落ちた）。下の取引で直す。
      }
    }
    if (o.create === false) return null;

    let out = null;
    let lastError = null;
    for (let attempt = 0; attempt < 3 && !out; attempt += 1) {
      try {
        out = await db.runTransaction(async (tx) => {
          /* 取引の中では「読む」を全部先に済ませる（Firestore の決まり）。 */
          const lSnap = await tx.get(linkRef);
          const aSnap = await tx.get(accRef);
          const wSnap = walletLinkRef ? await tx.get(walletLinkRef) : null;
          const account = aSnap.exists ? (aSnap.data() || {}) : null;

          let spid = lSnap.exists ? String((lSnap.data() || {}).spid || "") : "";
          /* 途中まで進んで落ちた分を拾う（ches_accounts には書けたが
             逆引きを作れなかった、など）。作り直すと番号が増えてしまう。 */
          if (!spid && account && isSchoolParkId(account.spid)) spid = String(account.spid);
          /* 署名で確かめたウォレットが、すでにどこかの番号のものなら、そこへ合流する。 */
          if (!spid && wSnap && wSnap.exists) {
            const owner = String((wSnap.data() || {}).spid || "");
            if (isSchoolParkId(owner)) spid = owner;
          }
          const minted = !spid;
          if (minted) spid = newSchoolParkId();

          const idRef = db.collection(ID_COL).doc(spid);
          const iSnap = await tx.get(idRef);
          if (minted && iSnap.exists) throw new Error("ID_COLLISION");   // 作り直す

          const now = Date.now();
          const prev = iSnap.exists ? (iSnap.data() || {}) : null;
          const provider = providerOf(u, account, o.signInProvider);
          const links = Array.isArray(prev && prev.links) ? prev.links.slice() : [];
          if (!links.some((l) => l && l.linkId === linkId)) {
            links.push({
              linkId, kind: "fb", provider,
              label: PROVIDER_LABEL[provider] || provider,
              subject: u, linkedAt: now, linkedBy: o.linkedBy || "login"
            });
          }
          const addresses = mergeLists(prev && prev.addresses, addressesFromAccount(account));

          if (!lSnap.exists) {
            /* create は「すでにあれば必ず失敗する」。
               同時に2本走っても、番号が2つ生まれることはない。 */
            tx.create(linkRef, {
              linkId, kind: "fb", provider, subject: u, spid,
              linkedAt: new Date(), linkedBy: o.linkedBy || "login"
            });
          }
          tx.set(idRef, {
            spid,
            version: 1,
            status: (prev && prev.status) || "active",
            primaryUid: (prev && prev.primaryUid) || u,
            links, addresses,
            createdAt: (prev && prev.createdAt) || now,
            updatedAt: now
          }, { merge: true });

          /* ches_accounts へ控えを書く。Firestore のルールが
             「この番号は自分のものか」を見るのに使う。
             まだ記録が無い人には作らない（walletAddress の無い
             欠けた記録ができると、APIが本人を確認できなくなるため）。 */
          if (aSnap.exists && String(account.spid || "") !== spid) {
            tx.set(accRef, { spid, spidLinkedAt: now }, { merge: true });
          }

          return { spid, isNew: minted, account };
        });
      } catch (e) {
        lastError = e;
        if (String(e && e.message) === "ID_COLLISION") continue;   // 番号を引き直す
        /* 同時に作られた（create が負けた）ときは、読み直して合流する。
           読み直しにも失敗したときは、番号を作らずに失敗として返す。
           通信の不調で新しいパスポートが生まれないようにするため。 */
        try {
          const again = await linkRef.get();
          if (again.exists) {
            const spid = String((again.data() || {}).spid || "");
            if (isSchoolParkId(spid)) { out = { spid, isNew: false, account: null }; break; }
          }
        } catch (readError) { /* 下の throw で失敗として返す */ }
        if (attempt >= 2) throw e;
      }
    }
    if (!out) throw (lastError || new Error("RESOLVE_FAILED"));

    if (out.isNew) await audit("identity.issued", { spid: out.spid, uid: u });

    /* ウォレットで入った人は、その実アドレスも
       「この番号のもの」として登録しておく。

       すでに登録済みなら何もしない。ここを毎回走らせると、
       ログインのたびに取引がもう1本増える（ふだんの道を重くしない）。
       登録に失敗しても入場は止めない。 */
    let identity = await readIdentity(out.spid);
    const acc = out.account || (await safeAccount(u));
    const real = lower(acc && acc.walletAddress);
    const alreadyLinked = !!(identity && Array.isArray(identity.links)
      && identity.links.some((l) => l && l.kind === "wallet" && l.subject === real));
    if (real && isAddress(real) && u.indexOf("wallet:") === 0 && !alreadyLinked) {
      try {
        await registerWalletLink(out.spid, real, { source: "wallet-login" });
        identity = await readIdentity(out.spid);
      } catch (e) { /* 重複候補は registerWalletLink が記録済み */ }
    }
    return { spid: out.spid, identity, isNew: !!out.isNew };
  }

  async function safeAccount(uid) {
    try {
      const s = await db.collection(ACCOUNT_COL).doc(uid).get();
      return s.exists ? (s.data() || null) : null;
    } catch (e) { return null; }
  }

  /**
   * ウォレットアドレスをこの番号のものとして登録する。
   * 署名で所有を確かめたあとにだけ呼ぶこと（ここでは署名を見ない）。
   *
   * すでに別の番号のものなら、横取りせずに断る。
   * 断ったことは重複候補として残す（同じ人の可能性があるため）。
   */
  async function registerWalletLink(spid, address, opts) {
    const o = opts || {};
    if (!db) throw new Error("NO_DB");
    if (!isSchoolParkId(spid)) throw new Error("BAD_SPID");
    const addr = lower(address);
    if (!isAddress(addr)) throw new Error("BAD_ADDRESS");

    const linkId = linkIdFor("wallet", addr);
    const linkRef = db.collection(LINK_COL).doc(linkId);
    const idRef = db.collection(ID_COL).doc(spid);

    let conflict = null;
    const result = await db.runTransaction(async (tx) => {
      const lSnap = await tx.get(linkRef);
      const iSnap = await tx.get(idRef);
      if (!iSnap.exists) throw new Error("IDENTITY_NOT_FOUND");

      if (lSnap.exists) {
        const owner = String((lSnap.data() || {}).spid || "");
        if (owner !== spid) { conflict = owner; return { ok: false, owner }; }
        /* 自分のもの。名義だけ確実に載せておく。 */
        const cur = iSnap.data() || {};
        tx.set(idRef, {
          addresses: mergeLists(cur.addresses, [addr]), updatedAt: Date.now()
        }, { merge: true });
        return { ok: true, already: true };
      }

      const now = Date.now();
      const cur = iSnap.data() || {};
      const links = Array.isArray(cur.links) ? cur.links.slice() : [];
      if (!links.some((l) => l && l.linkId === linkId)) {
        links.push({
          linkId, kind: "wallet", provider: "wallet", label: "連携ウォレット",
          subject: addr, linkedAt: now, linkedBy: o.source || "link"
        });
      }
      tx.create(linkRef, {
        linkId, kind: "wallet", provider: "wallet", subject: addr, spid,
        linkedAt: new Date(), linkedBy: o.source || "link"
      });
      tx.set(idRef, {
        links, addresses: mergeLists(cur.addresses, [addr]), updatedAt: now
      }, { merge: true });
      return { ok: true, already: false };
    });

    if (!result.ok) {
      await flagDuplicate({
        spid, otherSpid: conflict, reason: "wallet-already-linked",
        detail: "ウォレット " + addr + " はすでに別の SchoolPark ID のものです。"
      });
      const err = new Error("WALLET_LINKED_TO_OTHER");
      err.otherSpid = conflict;
      throw err;
    }
    if (!result.already) {
      await audit("wallet.linked", { spid, address: addr, source: o.source || "link" });
      passCache.delete(spid);
    }
    return { spid, address: addr, already: !!result.already };
  }

  /* ───────────────────── ログイン方法を足す ───────────────────── */

  /**
   * 引換券を出す。いま入っている SchoolPark ID に紐づく、
   * 10分だけ有効な1回きりの券。
   *
   * 券だけでは何もできない。使うときにも、足そうとしている
   * ログイン方法の正式な認証（Firebase の ID トークン）が要る。
   */
  async function issueLinkTicket(spid, uid) {
    if (!db) throw new Error("NO_DB");
    if (!isSchoolParkId(spid)) throw new Error("BAD_SPID");
    const ticket = crypto.randomBytes(24).toString("hex");
    const now = Date.now();
    await db.collection(TICKET_COL).doc(ticket).set({
      ticket, spid, issuedForUid: String(uid || ""),
      createdAt: now, expiresAt: now + TICKET_TTL_MS, usedAt: null
    });
    await audit("link.ticket.issued", { spid, uid: String(uid || "") });
    return { ticket, spid, expiresAt: new Date(now + TICKET_TTL_MS).toISOString(), expiresInMs: TICKET_TTL_MS };
  }

  /**
   * 引換券を使って、いま認証した方法を既存の SchoolPark ID に足す。
   *
   * 断る場合:
   *   - 券が無い・期限切れ・使用済み
   *   - その認証情報が、すでに別の SchoolPark ID のものになっている
   *     （＝勝手に付け替えない。重複候補として記録して運営が見る）
   */
  async function completeLinkWithTicket(ticketId, uid, opts) {
    const o = opts || {};
    if (!db) throw new Error("NO_DB");
    const t = String(ticketId || "").trim();
    const u = String(uid || "").trim();
    if (!t || !u) throw new Error("MISSING_PARAMS");

    const ticketRef = db.collection(TICKET_COL).doc(t);
    const linkId = linkIdFor("fb", u);
    const linkRef = db.collection(LINK_COL).doc(linkId);
    const accRef = db.collection(ACCOUNT_COL).doc(u);

    let conflict = null;
    const res = await db.runTransaction(async (tx) => {
      const tSnap = await tx.get(ticketRef);
      if (!tSnap.exists) throw new Error("TICKET_NOT_FOUND");
      const ticket = tSnap.data() || {};
      if (ticket.usedAt) throw new Error("TICKET_USED");
      if (Number(ticket.expiresAt) <= Date.now()) throw new Error("TICKET_EXPIRED");
      const spid = String(ticket.spid || "");
      if (!isSchoolParkId(spid)) throw new Error("TICKET_BROKEN");

      const idRef = db.collection(ID_COL).doc(spid);
      const lSnap = await tx.get(linkRef);
      const iSnap = await tx.get(idRef);
      const aSnap = await tx.get(accRef);
      if (!iSnap.exists) throw new Error("IDENTITY_NOT_FOUND");

      if (lSnap.exists) {
        const owner = String((lSnap.data() || {}).spid || "");
        if (owner !== spid) { conflict = owner; return { ok: false, spid, owner }; }
        tx.set(ticketRef, { usedAt: Date.now(), usedByUid: u }, { merge: true });
        return { ok: true, spid, already: true };
      }

      const account = aSnap.exists ? (aSnap.data() || {}) : null;
      const now = Date.now();
      const provider = providerOf(u, account, o.signInProvider);
      const cur = iSnap.data() || {};
      const links = Array.isArray(cur.links) ? cur.links.slice() : [];
      links.push({
        linkId, kind: "fb", provider,
        label: PROVIDER_LABEL[provider] || provider,
        subject: u, linkedAt: now, linkedBy: "link-ticket"
      });

      tx.create(linkRef, {
        linkId, kind: "fb", provider, subject: u, spid,
        linkedAt: new Date(), linkedBy: "link-ticket"
      });
      tx.set(idRef, {
        links,
        addresses: mergeLists(cur.addresses, addressesFromAccount(account)),
        updatedAt: now
      }, { merge: true });
      if (aSnap.exists && String((account || {}).spid || "") !== spid) {
        tx.set(accRef, { spid, spidLinkedAt: now }, { merge: true });
      }
      tx.set(ticketRef, { usedAt: now, usedByUid: u }, { merge: true });
      return { ok: true, spid, already: false };
    });

    if (!res.ok) {
      await flagDuplicate({
        spid: res.spid, otherSpid: conflict, reason: "auth-already-linked",
        detail: "このログイン方法は、すでに別の SchoolPark ID のものです。"
      });
      await audit("link.refused", { spid: res.spid, otherSpid: conflict, uid: u });
      const err = new Error("AUTH_LINKED_TO_OTHER");
      err.otherSpid = conflict;
      err.spid = res.spid;
      throw err;
    }
    if (!res.already) {
      await audit("link.completed", { spid: res.spid, uid: u });
      passCache.delete(res.spid);
    }

    /* ウォレットで入った方法を足した場合は、その実アドレスも登録する。 */
    const acc = await safeAccount(u);
    const real = lower(acc && acc.walletAddress);
    if (real && isAddress(real) && u.indexOf("wallet:") === 0) {
      try { await registerWalletLink(res.spid, real, { source: "link-ticket" }); } catch (e) {}
    }

    const identity = await readIdentity(res.spid);
    return { spid: res.spid, identity, already: !!res.already };
  }

  /* ───────────────────── 公式パス ───────────────────── */

  /**
   * この SchoolPark ID が公式パスを持っているか。
   *
   * 番号にぶら下がっている名義（連携済みウォレット・walletAddress・
   * chesAddress）を全部見る。いまウォレットを繋いでいなくても、
   * 一度でも正式に連携していれば当たる。
   */
  async function holdsOfficialPass(spid) {
    if (!db || !isSchoolParkId(spid)) return false;
    const hit = passCache.get(spid);
    if (hit && hit.expiresAt > Date.now()) return hit.value;

    let value = false;
    try {
      const identity = await readIdentity(spid);
      const addresses = (identity && Array.isArray(identity.addresses)) ? identity.addresses : [];
      const seen = {};
      outer:
      for (const base of addresses) {
        for (const form of addressForms(base, ethers)) {
          if (!form || seen[form]) continue;
          seen[form] = true;
          const p = await db.collection(PASS_COL).doc(form).get();
          if (p.exists) { value = true; break outer; }
        }
      }
    } catch (e) {
      console.warn("SchoolPark ID: 公式パスを読めませんでした:", e.message);
      return false;   // 読めないときは「持っている」とはしない（旧判定が別に走る）
    }
    passCache.set(spid, { value, expiresAt: Date.now() + PASS_CACHE_MS });
    return value;
  }

  /* uid から。入場判定はこれを旧判定と OR で使う（旧判定は消さない）。 */
  async function holdsOfficialPassForUid(uid) {
    const spid = await findByUid(uid);
    if (!spid) return false;
    return holdsOfficialPass(spid);
  }

  function forget(spid) { if (spid) passCache.delete(spid); }

  /* ───────────────────── 運営が見るもの ───────────────────── */

  /* 画面へ返す形。他人の情報は入れない。 */
  function publicView(identity) {
    if (!identity) return null;
    const links = (Array.isArray(identity.links) ? identity.links : []).map(function (l) {
      return {
        kind: l.kind || "", provider: l.provider || "",
        label: l.label || PROVIDER_LABEL[l.provider] || l.provider || "",
        /* ウォレットは本人のものなので出す。LINE/Google の内部IDは出さない。 */
        address: l.kind === "wallet" ? String(l.subject || "") : "",
        linkedAt: l.linkedAt || 0
      };
    });
    return {
      schoolParkId: identity.spid,
      createdAt: identity.createdAt || 0,
      status: identity.status || "active",
      links,
      addresses: Array.isArray(identity.addresses) ? identity.addresses : [],
      duplicateReview: !!identity.duplicateReview
    };
  }

  async function listDuplicates(limit) {
    if (!db) return [];
    const snap = await db.collection(DUP_COL).limit(Math.min(500, Number(limit) || 100)).get();
    const rows = [];
    snap.forEach(function (d) {
      const v = d.data() || {};
      rows.push({
        id: d.id, spid: v.spid || "", otherSpid: v.otherSpid || "",
        reason: v.reason || "", detail: v.detail || "",
        status: v.status || "pending_review",
        seenCount: Number(v.seenCount) || 1,
        createdAt: v.createdAt && v.createdAt.toDate ? v.createdAt.toDate().toISOString() : null
      });
    });
    rows.sort(function (a, b) { return String(b.createdAt || "").localeCompare(String(a.createdAt || "")); });
    return rows;
  }

  /* この番号について、サーバーが何を見ているかをそのまま返す（運営用）。 */
  async function whois(query) {
    const q = query || {};
    let spid = isSchoolParkId(q.spid) ? String(q.spid) : null;
    if (!spid && q.uid) spid = await findByUid(q.uid);
    if (!spid && q.address) spid = await findByAddress(q.address);
    if (!spid) return { found: false, spid: null };
    const identity = await readIdentity(spid);
    const hasPass = await holdsOfficialPass(spid);
    return { found: !!identity, spid, identity, hasOfficialPass: hasPass };
  }

  /* ───────────────────── 既存ユーザーの移行 ───────────────────── */

  /**
   * 既存の ches_accounts に SchoolPark ID を割り当てる。
   *
   * 既定は空打ち（dryRun）。何件に何をすることになるのかを先に見るためのもの。
   * 何度実行しても同じ結果になる（すでに番号がある人には触らない）。
   *
   * ここでは既存データを一切動かさない。
   *   - walletAddress / chesAddress はそのまま
   *   - 投稿・Quest・ギルド・星空・EMUER・公式パスもそのまま
   *   - 追加されるのは「この記録はこの番号のもの」という紐づけだけ
   */
  async function backfill(opts) {
    const o = opts || {};
    const dryRun = o.dryRun !== false;
    const limit = Math.min(5000, Number(o.limit) || 2000);
    if (!db) throw new Error("NO_DB");

    const snap = await db.collection(ACCOUNT_COL).limit(limit).get();
    const out = { dryRun, scanned: snap.size, alreadyHasId: 0, wouldIssue: 0, issued: 0, failed: 0, errors: [] };
    for (const doc of snap.docs) {
      const uid = doc.id;
      const data = doc.data() || {};
      if (isSchoolParkId(data.spid)) { out.alreadyHasId += 1; continue; }
      const found = await findByUid(uid);
      if (found) { out.alreadyHasId += 1; continue; }
      out.wouldIssue += 1;
      if (dryRun) continue;
      try {
        await resolveForUid(uid, { linkedBy: "backfill" });
        out.issued += 1;
      } catch (e) {
        out.failed += 1;
        if (out.errors.length < 20) out.errors.push({ uid, error: e.message });
      }
    }
    return out;
  }

  return {
    // 番号そのもの
    newSchoolParkId, isSchoolParkId, linkIdFor,
    // 解決・発行
    resolveForUid, findByUid, findByAddress, readIdentity, publicView,
    // 連携
    issueLinkTicket, completeLinkWithTicket, registerWalletLink,
    // 公式パス
    holdsOfficialPass, holdsOfficialPassForUid, forget,
    // 運営
    listDuplicates, whois, flagDuplicate, backfill, audit,
    // 定数
    ID_COL, LINK_COL, TICKET_COL, DUP_COL, AUDIT_COL, TICKET_TTL_MS
  };
}

function safeEthers() {
  try { return require("ethers"); } catch (e) { return null; }
}

module.exports = {
  createIdentity,
  newSchoolParkId, isSchoolParkId, linkIdFor, providerOf, addressesFromAccount,
  ID_COL, LINK_COL, TICKET_COL, DUP_COL, AUDIT_COL
};
