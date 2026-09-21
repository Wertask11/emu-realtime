"use strict";

/**
 * SchoolPark ID の窓口（/api/identity）を、実際に HTTP で叩いて確かめる。
 *
 * ここで守りたいのは次の3つ。
 *   1. ログインのたびに番号が増えないこと
 *   2. ウォレットの連携が、本物の署名でしか通らないこと
 *   3. 他人のパスポートへ、別人のログイン方法を足せないこと
 *
 * Firestore の代わりは fake-firestore（取引の性質まで真似てある）。
 * 署名は ethers の本物の鍵で作る（検証を素通しにしない）。
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const ethers = require("ethers");

const { createIdentity } = require("./identity");
const { createIdentityRouter } = require("./identity-router");
const { makeFirestore } = require("./fake-firestore");

const LINE_UID = "line:U1111";
const LINE_ADDR = "0x1111111111111111111111111111111111111111";
const GOOGLE_UID = "googleuid2222";
const GOOGLE_ADDR = "0x2222222222222222222222222222222222222222";
const OTHER_UID = "line:U9999";
const OTHER_ADDR = "0x9999999999999999999999999999999999999999";
const OWNER_UID = "owneruid";
const OWNER_ADDR = "0xdcc687c05f130e57597a8525771299a4efb6edf7";

function account(uid, provider, addr) {
  return { uid, provider, walletAddress: addr, chesAddress: addr, createdAt: 1 };
}

async function startServer(seed) {
  const db = makeFirestore({
    ches_accounts: {
      [LINE_UID]: account(LINE_UID, "line", LINE_ADDR),
      [GOOGLE_UID]: account(GOOGLE_UID, "google", GOOGLE_ADDR),
      [OTHER_UID]: account(OTHER_UID, "line", OTHER_ADDR),
      [OWNER_UID]: account(OWNER_UID, "google", OWNER_ADDR)
    },
    ...(seed || {})
  });
  const identity = createIdentity({ db, ethers });

  /* 本物の requireFirebaseUser の代わり。
     本物は ID トークンを検証してから uid を決める。ここでは
     ヘッダで uid を指定する（窓口の筋道だけを確かめるため）。 */
  async function requireFirebaseUser(req, res, next) {
    const uid = String(req.headers["x-test-uid"] || "");
    if (!uid) return res.status(401).json({ error: "AUTH_REQUIRED" });
    const snap = await db.collection("ches_accounts").doc(uid).get();
    if (!snap.exists) return res.status(403).json({ error: "ACCOUNT_NOT_FOUND" });
    const data = snap.data();
    req.identity = {
      uid, walletAddress: String(data.walletAddress || "").toLowerCase(),
      account: data, signInProvider: String(req.headers["x-test-provider"] || "")
    };
    next();
  }
  function requireOwner(req, res, next) {
    requireFirebaseUser(req, res, () => {
      if (req.identity.walletAddress !== OWNER_ADDR) return res.status(403).json({ error: "OWNER_ONLY" });
      next();
    });
  }

  const walletNonces = new Map();
  const purgeWalletNonces = () => {
    const now = Date.now();
    for (const [k, v] of walletNonces) if (v.expiresAt <= now) walletNonces.delete(k);
  };

  const app = express();
  app.use(express.json());
  const api = createIdentityRouter({
    db, identity, requireFirebaseUser, requireOwner,
    ethers, walletNonces, purgeWalletNonces, walletNonceTtlMs: 5 * 60 * 1000
  });
  app.use("/api/identity", api.router);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port + "/api/identity";

  async function call(method, path, opts) {
    const o = opts || {};
    const res = await fetch(base + path, {
      method,
      headers: Object.assign(
        { "Content-Type": "application/json" },
        o.uid ? { "x-test-uid": o.uid } : {}
      ),
      body: o.body ? JSON.stringify(o.body) : undefined
    });
    let json = null;
    try { json = await res.json(); } catch (e) { json = null; }
    return { status: res.status, body: json || {} };
  }

  return { db, identity, call, close: () => new Promise((r) => server.close(r)) };
}

test("窓口: 認証が無ければ、番号は取れないし作られない", async () => {
  const s = await startServer();
  try {
    const anon = await s.call("POST", "/resolve");
    assert.equal(anon.status, 401);
    assert.equal(s.db._count("sp_identities"), 0, "認証なしで番号を作ってはいけない");

    const ghost = await s.call("POST", "/resolve", { uid: "someone-who-does-not-exist" });
    assert.equal(ghost.status, 403);
    assert.equal(s.db._count("sp_identities"), 0);
  } finally { await s.close(); }
});

test("窓口: ログインのたびに呼んでも、番号は1つのまま", async () => {
  const s = await startServer();
  try {
    const first = await s.call("POST", "/resolve", { uid: LINE_UID });
    assert.equal(first.status, 200);
    assert.match(first.body.schoolParkId, /^SP-/);
    assert.equal(first.body.isNew, true);

    for (let i = 0; i < 5; i += 1) {
      const again = await s.call("POST", "/resolve", { uid: LINE_UID });
      assert.equal(again.body.schoolParkId, first.body.schoolParkId);
      assert.equal(again.body.isNew, false);
    }
    assert.equal(s.db._count("sp_identities"), 1);

    // GET /me でも同じ番号
    const me = await s.call("GET", "/me", { uid: LINE_UID });
    assert.equal(me.body.schoolParkId, first.body.schoolParkId);
  } finally { await s.close(); }
});

test("窓口: 引換券で、別のログイン方法を同じ番号へ足せる", async () => {
  const s = await startServer();
  try {
    const mine = await s.call("POST", "/resolve", { uid: LINE_UID });
    const ticket = await s.call("POST", "/link/ticket", { uid: LINE_UID });
    assert.equal(ticket.status, 200);
    assert.ok(ticket.body.ticket);

    // Google で認証した状態で券を使う
    const linked = await s.call("POST", "/link/complete", {
      uid: GOOGLE_UID, body: { ticket: ticket.body.ticket }
    });
    assert.equal(linked.status, 200);
    assert.equal(linked.body.schoolParkId, mine.body.schoolParkId);

    // 以後、Google で入っても同じ番号
    const viaGoogle = await s.call("POST", "/resolve", { uid: GOOGLE_UID });
    assert.equal(viaGoogle.body.schoolParkId, mine.body.schoolParkId);
    assert.equal(viaGoogle.body.isNew, false);
    assert.equal(s.db._count("sp_identities"), 1);

    // 使い終わった券は二度と通らない
    const reuse = await s.call("POST", "/link/complete", {
      uid: OTHER_UID, body: { ticket: ticket.body.ticket }
    });
    assert.equal(reuse.status, 400);
    assert.equal(reuse.body.error, "TICKET_USED");
  } finally { await s.close(); }
});

test("窓口: すでに別の番号を持つログイン方法は、横取りできない", async () => {
  const s = await startServer();
  try {
    const mine = await s.call("POST", "/resolve", { uid: LINE_UID });
    const theirs = await s.call("POST", "/resolve", { uid: OTHER_UID });
    assert.notEqual(mine.body.schoolParkId, theirs.body.schoolParkId);

    const ticket = await s.call("POST", "/link/ticket", { uid: LINE_UID });
    const stolen = await s.call("POST", "/link/complete", {
      uid: OTHER_UID, body: { ticket: ticket.body.ticket }
    });
    assert.equal(stolen.status, 409);
    assert.equal(stolen.body.error, "AUTH_LINKED_TO_OTHER");

    // 相手の番号は動いていない
    const stillTheirs = await s.call("POST", "/resolve", { uid: OTHER_UID });
    assert.equal(stillTheirs.body.schoolParkId, theirs.body.schoolParkId);
    assert.equal(s.db._count("sp_identities"), 2);
  } finally { await s.close(); }
});

test("窓口: ウォレット連携は、本物の署名でしか通らない", async () => {
  const wallet = ethers.Wallet.createRandom();
  const address = ethers.utils.getAddress(wallet.address);
  const impostor = ethers.Wallet.createRandom();

  // 公式パスは、このウォレットの名義で持っている
  const s = await startServer({ paid_users: { [address.toLowerCase()]: { label: "official" } } });
  try {
    const mine = await s.call("POST", "/resolve", { uid: LINE_UID });
    assert.equal(mine.body.hasOfficialPass, false, "連携前は当たらない");

    // ① 署名する文言をもらう
    const nonce = await s.call("GET", "/link/wallet/nonce?address=" + address, { uid: LINE_UID });
    assert.equal(nonce.status, 200);
    assert.ok(nonce.body.message.includes(address));

    // ② 別人の鍵で署名しても通らない
    const forged = await impostor.signMessage(nonce.body.message);
    const rejected = await s.call("POST", "/link/wallet", {
      uid: LINE_UID, body: { address, nonce: nonce.body.nonce, signature: forged }
    });
    assert.equal(rejected.status, 401);
    assert.equal(rejected.body.error, "INVALID_SIGNATURE");

    // ③ 本人の鍵なら通る（nonce は使い切ったので取り直す）
    const nonce2 = await s.call("GET", "/link/wallet/nonce?address=" + address, { uid: LINE_UID });
    const signature = await wallet.signMessage(nonce2.body.message);
    const ok = await s.call("POST", "/link/wallet", {
      uid: LINE_UID, body: { address, nonce: nonce2.body.nonce, signature }
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.schoolParkId, mine.body.schoolParkId);
    assert.equal(ok.body.hasOfficialPass, true,
      "連携後は、ウォレットを繋いでいなくても公式パス保有者と分かる");
    assert.equal(ok.body.links.some((l) => l.kind === "wallet"), true);

    // ④ 同じ nonce は二度使えない
    const replay = await s.call("POST", "/link/wallet", {
      uid: LINE_UID, body: { address, nonce: nonce2.body.nonce, signature }
    });
    assert.equal(replay.status, 401);
    assert.equal(replay.body.error, "NONCE_EXPIRED");

    // ⑤ 他人がその nonce/署名を横から使うこともできない
    const nonce3 = await s.call("GET", "/link/wallet/nonce?address=" + address, { uid: LINE_UID });
    const sig3 = await wallet.signMessage(nonce3.body.message);
    const hijack = await s.call("POST", "/link/wallet", {
      uid: OTHER_UID, body: { address, nonce: nonce3.body.nonce, signature: sig3 }
    });
    assert.equal(hijack.status, 403);
    assert.equal(hijack.body.error, "NONCE_OWNER_MISMATCH");
  } finally { await s.close(); }
});

test("窓口: 他人が連携済みのウォレットは連携できず、重複候補として残る", async () => {
  const wallet = ethers.Wallet.createRandom();
  const address = ethers.utils.getAddress(wallet.address);
  const s = await startServer();
  try {
    // 先に OTHER が連携する
    await s.call("POST", "/resolve", { uid: OTHER_UID });
    const n1 = await s.call("GET", "/link/wallet/nonce?address=" + address, { uid: OTHER_UID });
    await s.call("POST", "/link/wallet", {
      uid: OTHER_UID, body: { address, nonce: n1.body.nonce, signature: await wallet.signMessage(n1.body.message) }
    });

    // あとから LINE が同じウォレットを連携しようとする
    await s.call("POST", "/resolve", { uid: LINE_UID });
    const n2 = await s.call("GET", "/link/wallet/nonce?address=" + address, { uid: LINE_UID });
    const conflict = await s.call("POST", "/link/wallet", {
      uid: LINE_UID, body: { address, nonce: n2.body.nonce, signature: await wallet.signMessage(n2.body.message) }
    });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.error, "WALLET_LINKED_TO_OTHER");

    // 運営には重複候補として見えている（自動では統合しない）
    const dups = await s.call("GET", "/admin/duplicates", { uid: OWNER_UID });
    assert.equal(dups.status, 200);
    assert.equal(dups.body.total, 1);
    assert.equal(dups.body.duplicates[0].status, "pending_review");
  } finally { await s.close(); }
});

test("窓口: 運営用の入り口は、運営以外には開かない", async () => {
  const s = await startServer();
  try {
    for (const path of ["/admin/duplicates", "/admin/whois?uid=" + LINE_UID]) {
      const denied = await s.call("GET", path, { uid: LINE_UID });
      assert.equal(denied.status, 403, path);
    }
    const backfillDenied = await s.call("POST", "/admin/backfill", { uid: LINE_UID });
    assert.equal(backfillDenied.status, 403);

    // 運営なら通る。既定は空打ち（書き込まない）。
    const dry = await s.call("POST", "/admin/backfill", { uid: OWNER_UID });
    assert.equal(dry.status, 200);
    assert.equal(dry.body.dryRun, true);
    assert.equal(dry.body.issued, 0);
    assert.equal(s.db._count("sp_identities"), 0, "空打ちで書き込んではいけない");
  } finally { await s.close(); }
});

/* ───── 発行前の確認（はじめまして？） ─────

   ここがいちばん効く。前から使っている人が、別の入り方で「はじめる」を
   押してしまうと、気づかないうちに2つ目のパスポートができる。
   /status は「番号を作らずに」状態だけ返し、画面はそれを見て確認を出す。 */

test("窓口: /status は番号を作らない", async () => {
  const s = await startServer();
  try {
    const st = await s.call("GET", "/status", { uid: LINE_UID });
    assert.equal(st.status, 200);
    assert.equal(st.body.exists, false);
    assert.equal(st.body.schoolParkId, null);
    assert.equal(s.db._count("sp_identities"), 0, "状態を見ただけで番号を作ってはいけない");
    assert.equal(s.db._count("sp_auth_links"), 0);

    // 何度見ても作られない
    await s.call("GET", "/status", { uid: LINE_UID });
    await s.call("GET", "/status", { uid: LINE_UID });
    assert.equal(s.db._count("sp_identities"), 0);
  } finally { await s.close(); }
});

test("窓口: いま作られたアカウントは looksNew（確認を出す）", async () => {
  const s = await startServer();
  try {
    // ログイン方法を増やすと、その方法ぶんの ches_accounts が新しく作られる。
    // その状態を再現する。
    await s.db.collection("ches_accounts").doc(GOOGLE_UID)
      .set({ createdAt: Date.now() }, { merge: true });
    const st = await s.call("GET", "/status", { uid: GOOGLE_UID });
    assert.equal(st.body.exists, false);
    assert.equal(st.body.looksNew, true, "新しいアカウントは確認を出す側に倒す");
  } finally { await s.close(); }
});

test("窓口: 前からいる人には確認を出さない（looksNew が false）", async () => {
  const s = await startServer();
  try {
    // 番号の仕組みより前から居る人
    await s.db.collection("ches_accounts").doc(LINE_UID)
      .set({ createdAt: Date.now() - 90 * 24 * 60 * 60 * 1000 }, { merge: true });
    const st = await s.call("GET", "/status", { uid: LINE_UID });
    assert.equal(st.body.exists, false);
    assert.equal(st.body.looksNew, false, "前からいる人を驚かせない");
  } finally { await s.close(); }
});

test("窓口: すでに番号がある人には、二度と確認を出さない", async () => {
  const s = await startServer();
  try {
    const mine = await s.call("POST", "/resolve", { uid: LINE_UID });
    const st = await s.call("GET", "/status", { uid: LINE_UID });
    assert.equal(st.body.exists, true);
    assert.equal(st.body.looksNew, false);
    assert.equal(st.body.schoolParkId, mine.body.schoolParkId);
  } finally { await s.close(); }
});

test("窓口: /status も認証が要る", async () => {
  const s = await startServer();
  try {
    const anon = await s.call("GET", "/status");
    assert.equal(anon.status, 401);
    assert.equal(s.db._count("sp_identities"), 0);
  } finally { await s.close(); }
});

test("窓口: 他人の番号は覗けない（列挙もできない）", async () => {
  const s = await startServer();
  try {
    const theirs = await s.call("POST", "/resolve", { uid: OTHER_UID });
    const mine = await s.call("GET", "/me", { uid: LINE_UID });
    // /me は必ず自分の番号しか返さない
    assert.notEqual(mine.body.schoolParkId, theirs.body.schoolParkId);
    // 番号を指定して他人のものを読む入り口は、運営用しかない
    const peek = await s.call("GET", "/admin/whois?spid=" + theirs.body.schoolParkId, { uid: LINE_UID });
    assert.equal(peek.status, 403);
  } finally { await s.close(); }
});
