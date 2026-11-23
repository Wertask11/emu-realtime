"use strict";
/* 運営の書き手アカウント（11/18 オーナー）：ChatGPT・Muse などが、オーナーとは別の書き手として投稿するためのアカウント。
   作る・止める・キーを作り直すのは運営だけ。書き手は「書き手キー」でログインの証をもらう。キーはハッシュしか残さない。 */
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { makeFirestore } = require("./fake-firestore");
const { createWriterAccountsRouter, hashKey, deriveAddress } = require("./writer-accounts");
const { ensureVerifiedAccount } = require("./verified-platform");

async function setup() {
  const db = makeFirestore({});
  let owner = true;
  const tokens = [], revoked = [];
  const firebaseAdmin = { auth: () => ({
    createCustomToken: async (uid, claims) => { tokens.push({ uid, claims }); return "token:" + uid; },
    revokeRefreshTokens: async (uid) => { revoked.push(uid); },
  }) };
  const { admin, auth } = createWriterAccountsRouter({
    db, firebaseAdmin,
    requireOwner: (req, res, next) => { if (!owner) return res.status(403).json({ error: "OWNER_ONLY" }); req.identity = { walletAddress: "0xowner" }; next(); },
    rateLimit: () => (req, res, next) => next(),
  });
  const app = express();
  app.use(express.json());
  app.use("/api/auth", auth);
  app.use("/api/admin/writer-accounts", admin);
  const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body) => {
    const r = await fetch(base + path, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json() };
  };
  return { db, call, tokens, revoked, setOwner: (v) => { owner = v; }, close: () => server.close() };
}

test("運営が書き手を作ると、キーが1回だけ返る。記録にはキーのハッシュしか残らない", async () => {
  const t = await setup();
  try {
    const r = await t.call("POST", "/api/admin/writer-accounts", { name: "みどり先生", note: "ChatGPT 1人目" });
    assert.equal(r.status, 200);
    assert.match(r.body.key, /^emw_[A-Za-z0-9_-]{32}$/);
    assert.equal(r.body.account.name, "みどり先生");
    const id = r.body.account.id;
    const doc = (await t.db.collection("writer_accounts").doc(id).get()).data();
    assert.equal(doc.keyHash, hashKey(r.body.key));
    assert.ok(!JSON.stringify(doc).includes(r.body.key), "キーそのものは残さない");
    assert.equal(doc.uid, "writer:" + id);
    assert.equal(doc.address, deriveAddress("writer:" + id).toLowerCase());
    const list = await t.call("GET", "/api/admin/writer-accounts");
    assert.equal(list.body.items.length, 1);
    assert.ok(!JSON.stringify(list.body).includes("keyHash"), "一覧にハッシュも出さない");
  } finally { t.close(); }
});

test("書き手キーでログインの証をもらう。名前が付く。違うキー・止めた書き手は断る", async () => {
  const t = await setup();
  try {
    const { body } = await t.call("POST", "/api/admin/writer-accounts", { name: "Muse 2" });
    const ok = await t.call("POST", "/api/auth/writer", { key: body.key });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.firebaseToken, "token:writer:" + body.account.id);
    assert.equal(ok.body.profile.name, "Muse 2");
    assert.deepEqual(t.tokens[0].claims, { provider: "writer", name: "Muse 2" });
    assert.equal((await t.call("POST", "/api/auth/writer", { key: "emw_" + "x".repeat(32) })).status, 401);
    assert.equal((await t.call("POST", "/api/auth/writer", { key: "short" })).status, 401);
    await t.call("PATCH", "/api/admin/writer-accounts/" + body.account.id, { active: false });
    assert.deepEqual(t.revoked, ["writer:" + body.account.id], "止めたら、いまのログインも切る");
    assert.equal((await t.call("POST", "/api/auth/writer", { key: body.key })).status, 401);
    await t.call("PATCH", "/api/admin/writer-accounts/" + body.account.id, { active: true });
    assert.equal((await t.call("POST", "/api/auth/writer", { key: body.key })).status, 200);
  } finally { t.close(); }
});

test("キーを作り直すと、前のキーは使えない。名前を変えると、アカウントの表示名も変わる", async () => {
  const t = await setup();
  try {
    const { body } = await t.call("POST", "/api/admin/writer-accounts", { name: "書き手A" });
    const again = await t.call("POST", "/api/admin/writer-accounts/" + body.account.id + "/key");
    assert.notEqual(again.body.key, body.key);
    assert.equal((await t.call("POST", "/api/auth/writer", { key: body.key })).status, 401);
    assert.equal((await t.call("POST", "/api/auth/writer", { key: again.body.key })).status, 200);
    await t.call("PATCH", "/api/admin/writer-accounts/" + body.account.id, { name: "書き手B" });
    assert.equal((await t.db.collection("ches_accounts").doc("writer:" + body.account.id).get()).data().displayName, "書き手B");
    assert.equal((await t.call("PATCH", "/api/admin/writer-accounts/" + body.account.id, { name: "" })).status, 400);
  } finally { t.close(); }
});

test("運営でなければ、作る・一覧・止める・キーの作り直しはできない", async () => {
  const t = await setup();
  try {
    t.setOwner(false);
    assert.equal((await t.call("GET", "/api/admin/writer-accounts")).status, 403);
    assert.equal((await t.call("POST", "/api/admin/writer-accounts", { name: "x" })).status, 403);
    assert.equal((await t.call("PATCH", "/api/admin/writer-accounts/aaaaaaaaaaaa", { active: false })).status, 403);
    assert.equal((await t.call("POST", "/api/admin/writer-accounts/aaaaaaaaaaaa/key")).status, 403);
  } finally { t.close(); }
});

test("書き手でログインすると、書き手の名前・自分のアドレスでアカウントができる。止めた書き手は入れない", async () => {
  const t = await setup();
  try {
    const { body } = await t.call("POST", "/api/admin/writer-accounts", { name: "みどり先生" });
    const uid = "writer:" + body.account.id;
    const account = await ensureVerifiedAccount(t.db, { uid, provider: "writer", name: "みどり先生", firebase: { sign_in_provider: "custom" } });
    assert.equal(account.provider, "writer");
    assert.equal(account.displayName, "みどり先生");
    assert.equal(account.walletAddress.toLowerCase(), body.account.address);
    assert.ok(!("operatorWriter" in account), "「運営の書き手」の印は付けない（11/18 オーナー）");
    await t.call("PATCH", "/api/admin/writer-accounts/" + body.account.id, { active: false });
    await assert.rejects(ensureVerifiedAccount(t.db, { uid, provider: "writer", firebase: { sign_in_provider: "custom" } }), /WRITER_DISABLED/);
  } finally { t.close(); }
});

test("書き手は公開できる段（pro）になる。止めると見学に戻り、戻すとまた公開できる。前に作った書き手もログインで付く", async () => {
  const t = await setup();
  const { createEntitlement } = require("./entitlement");
  const ent = createEntitlement({ db: t.db });
  try {
    const { body } = await t.call("POST", "/api/admin/writer-accounts", { name: "店長" });
    const uid = "writer:" + body.account.id;
    const grant = (await t.db.collection("entitlements").doc(uid).get()).data();
    assert.equal(grant.plan, "pro");
    assert.equal(grant.source, "writer");
    assert.equal(grant.expiresAt, undefined, "生きているあいだは期限の欄を持たない");
    assert.equal((await ent.getEntitlement(uid)).plan, "pro");

    await t.call("PATCH", "/api/admin/writer-accounts/" + body.account.id, { active: false });
    ent.forget(uid);
    assert.equal((await ent.getEntitlement(uid)).plan, "guest");
    await t.call("PATCH", "/api/admin/writer-accounts/" + body.account.id, { active: true });
    ent.forget(uid);
    assert.equal((await ent.getEntitlement(uid)).plan, "pro");

    // 段を付ける前に作った書き手（付与の記録が無い）
    const key = "emw_" + "A".repeat(32);
    await t.db.collection("writer_accounts").doc("0123456789ab").set({ name: "手帖", active: true, uid: "writer:0123456789ab", keyHash: hashKey(key), createdAt: 1 });
    assert.equal((await t.db.collection("entitlements").doc("writer:0123456789ab").get()).exists, false);
    const login = await t.call("POST", "/api/auth/writer", { key });
    assert.equal(login.status, 200);
    ent.forget("writer:0123456789ab");
    assert.equal((await ent.getEntitlement("writer:0123456789ab")).plan, "pro");
  } finally { t.close(); }
});

/* 11/23 オーナー「使えるになってるのに、入れるときと入れないときがある」。
   前は同じ回線から10分に10回までで、Muse・ChatGPT の書き手10人が同じ回線から入り直すと、正しいキーでも断られた。
   回数はキーごとに数える。1つのキーで入り直しすぎたときだけ断り、ほかの書き手は入れる。 */
test("ログインの回数はキーごとに数える。1つのキーが上限に当たっても、ほかの書き手は入れる", async () => {
  const t = await setup();
  try {
    const a = (await t.call("POST", "/api/admin/writer-accounts", { name: "Muse 1" })).body.key;
    const b = (await t.call("POST", "/api/admin/writer-accounts", { name: "ChatGPT 1" })).body.key;
    for (let i = 0; i < 20; i++) assert.equal((await t.call("POST", "/api/auth/writer", { key: a })).status, 200, `${i + 1}回目`);
    const over = await t.call("POST", "/api/auth/writer", { key: a });
    assert.equal(over.status, 429);
    assert.equal(over.body.error, "RATE_LIMITED");
    assert.ok(over.body.retryAfterMs > 0);
    assert.equal((await t.call("POST", "/api/auth/writer", { key: b })).status, 200, "ほかの書き手は入れる");
  } finally { t.close(); }
});

test("回線ごとの上限は、10人の書き手が入り直せる広さにしてある（総当たりを止めるためだけ）", () => {
  const src = require("fs").readFileSync(require("path").join(__dirname, "writer-accounts.js"), "utf8");
  const m = src.match(/auth\.post\("\/writer", rateLimit\(\{ windowMs: ([^,]+), max: (\d+)/);
  assert.ok(m, "ログインの道に回線ごとの上限がある");
  assert.ok(Number(m[2]) >= 100, "10人×何回かの入り直しで当たらない");
});
