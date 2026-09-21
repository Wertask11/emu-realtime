"use strict";

/**
 * SchoolPark ID の窓口（/api/identity）。
 *
 * 番号を作れるのはここだけ。ブラウザは受け取って表示するだけで、
 * 自分で番号を作ったり、他人の番号を名乗ったりはできない。
 *
 * どの入り口でも、まず Firebase の ID トークンを検証する
 * （requireFirebaseUser）。localStorage の値は一切信用しない。
 */

const express = require("express");
const { randomUUID } = require("crypto");

function createIdentityRouter(deps) {
  const {
    db, identity, requireFirebaseUser, requireOwner, rateLimit,
    ethers, walletNonces, purgeWalletNonces, walletNonceTtlMs
  } = deps || {};
  const router = express.Router();

  const NONCE_TTL = Number(walletNonceTtlMs) || 5 * 60 * 1000;

  const limitRead = rateLimit
    ? rateLimit({ windowMs: 60_000, max: 60, key: "identity-read" })
    : (req, res, next) => next();
  const limitWrite = rateLimit
    ? rateLimit({ windowMs: 60_000, max: 20, key: "identity-write" })
    : (req, res, next) => next();

  function unavailable(res) {
    return res.status(503).json({ error: "IDENTITY_UNAVAILABLE" });
  }

  /* 画面へ返す一式。公式パスの有無もここで返す。
     ウォレットを繋いでいなくても、連携済みなら true になる。 */
  async function summarize(spid, extra) {
    const record = await identity.readIdentity(spid);
    const view = identity.publicView(record) || { schoolParkId: spid };
    let hasOfficialPass = false;
    try { hasOfficialPass = await identity.holdsOfficialPass(spid); } catch (e) {}
    return { ok: true, ...view, hasOfficialPass, ...(extra || {}) };
  }

  /* ───────── いまの自分の SchoolPark ID ─────────
     無ければ一度だけ作る。何度呼んでも増えない。 */
  async function resolveHandler(req, res) {
    if (!db || !identity) return unavailable(res);
    res.set("Cache-Control", "no-store, max-age=0");
    try {
      const out = await identity.resolveForUid(req.identity.uid, {
        signInProvider: req.identity.signInProvider,
        linkedBy: "login"
      });
      const body = await summarize(out.spid, { isNew: !!out.isNew });
      return res.json(body);
    } catch (e) {
      console.error("SchoolPark ID の解決に失敗:", e.message);
      /* ここで新しい番号を作らない。失敗したら失敗と返し、
         画面は「確認中」を出して、次の機会に読み直す。 */
      return res.status(500).json({ error: "RESOLVE_FAILED" });
    }
  }

  router.get("/me", requireFirebaseUser, limitRead, resolveHandler);
  router.post("/resolve", requireFirebaseUser, limitRead, resolveHandler);

  /* ───────── ログイン方法を足す：① 引換券をもらう ─────────

     いま入っている SchoolPark ID に紐づく、10分だけ有効な1回きりの券。
     券は、いまのパスポートへログイン済みでないと受け取れない。 */
  router.post("/link/ticket", requireFirebaseUser, limitWrite, async (req, res) => {
    if (!db || !identity) return unavailable(res);
    try {
      const out = await identity.resolveForUid(req.identity.uid, {
        signInProvider: req.identity.signInProvider, linkedBy: "login"
      });
      const ticket = await identity.issueLinkTicket(out.spid, req.identity.uid);
      return res.json({ ok: true, ...ticket });
    } catch (e) {
      console.error("連携の引換券を作れませんでした:", e.message);
      return res.status(500).json({ error: "TICKET_FAILED" });
    }
  });

  /* ───────── ログイン方法を足す：② 新しい方法で認証して券を使う ─────────

     Authorization は「これから足すログイン方法」の ID トークン。
     つまり、足す側の本人確認は Firebase の正式な認証結果で行う。
     名前・表示名・メールアドレスの一致では、絶対に結び付けない。 */
  router.post("/link/complete", requireFirebaseUser, limitWrite, async (req, res) => {
    if (!db || !identity) return unavailable(res);
    const ticket = String((req.body && req.body.ticket) || "").trim();
    if (!ticket) return res.status(400).json({ error: "MISSING_TICKET" });
    try {
      const out = await identity.completeLinkWithTicket(ticket, req.identity.uid, {
        signInProvider: req.identity.signInProvider
      });
      const body = await summarize(out.spid, { already: !!out.already });
      return res.json(body);
    } catch (e) {
      const code = String(e && e.message || "");
      if (code === "AUTH_LINKED_TO_OTHER") {
        /* 付け替えない。同じ人かもしれないので、重複候補として記録済み。 */
        return res.status(409).json({
          error: "AUTH_LINKED_TO_OTHER",
          message: "このログイン方法は、すでに別の SchoolPark ID で使われています。"
            + "運営の確認が必要です。"
        });
      }
      if (["TICKET_NOT_FOUND", "TICKET_USED", "TICKET_EXPIRED", "TICKET_BROKEN"].includes(code)) {
        return res.status(400).json({ error: code });
      }
      console.error("連携に失敗:", code);
      return res.status(500).json({ error: "LINK_FAILED" });
    }
  });

  /* ───────── ウォレットを連携する ─────────

     所有の確認は署名（personal_sign / EIP-191）。手数料はかからない。
     アドレスを名乗るだけでは連携できない。 */
  router.get("/link/wallet/nonce", requireFirebaseUser, limitRead, (req, res) => {
    if (!ethers || !walletNonces) return unavailable(res);
    let address;
    try {
      address = ethers.utils.getAddress(String(req.query.address || "").trim());
    } catch (e) {
      return res.status(400).json({ error: "INVALID_ADDRESS" });
    }
    if (typeof purgeWalletNonces === "function") purgeWalletNonces();
    if (walletNonces.size > 5000) return res.status(503).json({ error: "BUSY" });

    const nonce = randomUUID();
    const issuedAt = new Date().toISOString();
    const message = [
      "SchoolPark Passport にこのウォレットを連携します。",
      "このメッセージへの署名でウォレットの所有を確認します（手数料はかかりません）。",
      "",
      "address: " + address,
      "nonce: " + nonce,
      "issuedAt: " + issuedAt
    ].join("\n");

    walletNonces.set(nonce, {
      address, message, purpose: "link",
      uid: req.identity.uid,
      expiresAt: Date.now() + NONCE_TTL
    });
    return res.json({ nonce, message, issuedAt, expiresInMs: NONCE_TTL });
  });

  router.post("/link/wallet", requireFirebaseUser, limitWrite, async (req, res) => {
    if (!db || !identity || !ethers || !walletNonces) return unavailable(res);
    try {
      const { address, nonce, signature } = req.body || {};
      if (!address || !nonce || !signature) return res.status(400).json({ error: "MISSING_PARAMS" });

      if (typeof purgeWalletNonces === "function") purgeWalletNonces();
      const issued = walletNonces.get(String(nonce));
      // 1回限り。検証の成否にかかわらず捨てる（使い回しを防ぐ）。
      walletNonces.delete(String(nonce));
      if (!issued) return res.status(401).json({ error: "NONCE_EXPIRED" });
      if (issued.purpose !== "link") return res.status(401).json({ error: "NONCE_PURPOSE" });
      /* 券を出した本人と、いま署名している本人が同じであること。 */
      if (issued.uid && issued.uid !== req.identity.uid) {
        return res.status(403).json({ error: "NONCE_OWNER_MISMATCH" });
      }

      let checksummed;
      try { checksummed = ethers.utils.getAddress(String(address).trim()); }
      catch (e) { return res.status(400).json({ error: "INVALID_ADDRESS" }); }
      if (checksummed !== issued.address) return res.status(401).json({ error: "ADDRESS_MISMATCH" });

      let recovered;
      try { recovered = ethers.utils.verifyMessage(issued.message, String(signature)); }
      catch (e) { return res.status(401).json({ error: "INVALID_SIGNATURE" }); }
      if (recovered !== checksummed) return res.status(401).json({ error: "INVALID_SIGNATURE" });

      const me = await identity.resolveForUid(req.identity.uid, {
        signInProvider: req.identity.signInProvider, linkedBy: "login"
      });
      await identity.registerWalletLink(me.spid, checksummed.toLowerCase(), { source: "passport-link" });
      const body = await summarize(me.spid, { linkedAddress: checksummed });
      return res.json(body);
    } catch (e) {
      const code = String(e && e.message || "");
      if (code === "WALLET_LINKED_TO_OTHER") {
        return res.status(409).json({
          error: "WALLET_LINKED_TO_OTHER",
          message: "このウォレットは、すでに別の SchoolPark ID に連携されています。"
            + "運営の確認が必要です。"
        });
      }
      console.error("ウォレット連携に失敗:", code);
      return res.status(500).json({ error: "WALLET_LINK_FAILED" });
    }
  });

  /* ───────── 運営用 ─────────
     どれも requireOwner（ログイン済みの運営本人）でしか通らない。 */

  router.get("/admin/whois", requireOwner, async (req, res) => {
    if (!db || !identity) return unavailable(res);
    try {
      const out = await identity.whois({
        spid: req.query.spid, uid: req.query.uid, address: req.query.address
      });
      return res.json({ ok: true, ...out });
    } catch (e) {
      return res.status(500).json({ error: "WHOIS_FAILED" });
    }
  });

  router.get("/admin/duplicates", requireOwner, async (req, res) => {
    if (!db || !identity) return unavailable(res);
    try {
      const rows = await identity.listDuplicates(Number(req.query.limit) || 100);
      return res.json({ ok: true, total: rows.length, duplicates: rows });
    } catch (e) {
      return res.status(500).json({ error: "DUPLICATES_FAILED" });
    }
  });

  /* 既存ユーザーへの割り当て。既定は空打ち（何件になるかを見るだけ）。
     実行するときは明示的に dry=0 を付ける。 */
  router.post("/admin/backfill", requireOwner, limitWrite, async (req, res) => {
    if (!db || !identity) return unavailable(res);
    try {
      const dry = String((req.query.dry ?? req.body?.dry) ?? "1") !== "0";
      const out = await identity.backfill({ dryRun: dry, limit: Number(req.query.limit) || 2000 });
      return res.json({ ok: true, ...out });
    } catch (e) {
      console.error("割り当てに失敗:", e.message);
      return res.status(500).json({ error: "BACKFILL_FAILED" });
    }
  });

  return { router };
}

module.exports = { createIdentityRouter };
