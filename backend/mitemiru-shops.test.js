"use strict";

/**
 * みてみるのショップ。
 *
 * みてみるの画面は「ショップを選ぶ → 中の商品を見る」という並びになっている。
 * 商品だけだと、その階層が作れない。
 *
 * 2026-10-04、画面をいちど作り直したときにこの階層ごと消してしまい、
 * 元のデザインに戻すためにサーバー側へ足した。
 * 商品そのもの・注文・支払いには触っていないことも、ここで確かめる。
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { makeFirestore } = require("./fake-firestore");
const { createMitemiruRouter } = require("./mitemiru");

const OWNER = "0x" + "0".repeat(39) + "1";
const ALICE = "0x" + "a".repeat(40);

function setup() {
  const db = makeFirestore({});
  let clock = Date.parse("2026-11-14T13:00:00+09:00");
  const users = { alice: ALICE, owner: OWNER };
  const requireFirebaseUser = (req, res, next) => {
    const uid = req.headers["x-test-user"];
    if (!uid) return res.status(401).json({ error: "AUTH_REQUIRED" });
    req.identity = { uid, walletAddress: users[uid], account: {} };
    next();
  };
  const requireOwner = (req, res, next) => requireFirebaseUser(req, res, () =>
    req.identity.uid === "owner" ? next() : res.status(403).json({ error: "OWNER_ONLY" }));
  const m = createMitemiruRouter({
    db, chain: null, stripe: null, env: {}, now: () => clock, emuerEnabled: () => true,
    requireFirebaseUser, requireOwner, isOwner: (i) => i.uid === "owner",
    entitlement: { getEntitlement: async () => ({ plan: "pro" }) }
  });
  const app = express();
  app.use(express.json());
  app.use("/api/mitemiru", m.router);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/mitemiru`;
  async function call(user, method, path, body) {
    const r = await fetch(base + path, {
      method,
      headers: Object.assign({ "content-type": "application/json" }, user ? { "x-test-user": user } : {}),
      body: body ? JSON.stringify(body) : undefined
    });
    return { status: r.status, body: await r.json() };
  }
  return { db, call, close: () => server.close() };
}

const SHOP = { name: "フラワーショップ", emoji: "🌸", category: "zakka", description: "花と雑貨", status: "live" };
const ITEM = {
  name: "ステッカー引換券", fulfillment: "会場で手渡し", cancelPolicy: "お渡し前なら取り消せます",
  prices: { EMUER: 50, JPY: 300 }, cashAtVenue: true, status: "live"
};

test("運営だけがショップを出せる", async () => {
  const t = setup();
  try {
    assert.equal((await t.call("alice", "POST", "/admin/shops", SHOP)).status, 403);
    assert.equal((await t.call(null, "POST", "/admin/shops", SHOP)).status, 401);
    const ok = await t.call("owner", "POST", "/admin/shops", SHOP);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.shop.name, "フラワーショップ");
  } finally { t.close(); }
});

test("名前のないショップ・知らない種類は断る", async () => {
  const t = setup();
  try {
    assert.equal((await t.call("owner", "POST", "/admin/shops", { ...SHOP, name: "" })).body.error, "NAME_REQUIRED");
    assert.equal((await t.call("owner", "POST", "/admin/shops", { ...SHOP, category: "xxx" })).body.error, "INVALID_CATEGORY");
    assert.equal((await t.call("owner", "POST", "/admin/shops", { ...SHOP, status: "xxx" })).body.error, "INVALID_STATUS");
  } finally { t.close(); }
});

test("販売中のショップだけ、誰でも見られる", async () => {
  const t = setup();
  try {
    await t.call("owner", "POST", "/admin/shops", { ...SHOP, id: "flower" });
    await t.call("owner", "POST", "/admin/shops", { ...SHOP, id: "draft-shop", name: "下書き", status: "draft" });
    const r = await t.call(null, "GET", "/shops");
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.shops.map(s => s.id), ["flower"], "下書きが出ています");
    /* 運営は下書きも見える */
    const all = await t.call("owner", "GET", "/admin/shops");
    assert.equal(all.body.shops.length, 2);
  } finally { t.close(); }
});

test("商品は、ショップにぶら下がる", async () => {
  const t = setup();
  try {
    await t.call("owner", "POST", "/admin/shops", { ...SHOP, id: "flower" });
    const p = await t.call("owner", "POST", "/admin/products", { ...ITEM, shopId: "flower", emoji: "🎟" });
    assert.equal(p.status, 200, JSON.stringify(p.body));
    const list = await t.call(null, "GET", "/products");
    assert.equal(list.body.products[0].shopId, "flower");
    assert.equal(list.body.products[0].emoji, "🎟");
  } finally { t.close(); }
});

test("ショップに入れない商品も置ける", async () => {
  /* ショップを作らずに商品だけ置いても、売り場には出す。 */
  const t = setup();
  try {
    await t.call("owner", "POST", "/admin/products", ITEM);
    const list = await t.call(null, "GET", "/products");
    assert.equal(list.body.products.length, 1);
    assert.equal(list.body.products[0].shopId, "");
  } finally { t.close(); }
});

test("同じ id のショップは作り直さず、別の id になる", async () => {
  const t = setup();
  try {
    const a = await t.call("owner", "POST", "/admin/shops", { ...SHOP, id: "flower" });
    const b = await t.call("owner", "POST", "/admin/shops", { ...SHOP, id: "flower" });
    assert.equal(a.body.shop.id, "flower");
    assert.notEqual(b.body.shop.id, "flower", "先に居たショップを上書きしています");
  } finally { t.close(); }
});

test("ショップは消さずに閉じる（商品と注文の記録を残すため）", async () => {
  const t = setup();
  try {
    await t.call("owner", "POST", "/admin/shops", { ...SHOP, id: "flower" });
    await t.call("owner", "POST", "/admin/products", { ...ITEM, shopId: "flower" });
    const d = await t.call("owner", "DELETE", "/admin/shops/flower");
    assert.equal(d.status, 200);
    assert.equal(d.body.status, "ended");
    /* 記録そのものは残っている */
    const all = await t.call("owner", "GET", "/admin/shops");
    assert.equal(all.body.shops.length, 1);
    /* 売り場からは消える */
    assert.equal((await t.call(null, "GET", "/shops")).body.shops.length, 0);
    /* 商品は消えない */
    assert.equal((await t.call(null, "GET", "/products")).body.products.length, 1);
  } finally { t.close(); }
});

test("運営以外は、ショップを閉じたり書き換えたりできない", async () => {
  const t = setup();
  try {
    await t.call("owner", "POST", "/admin/shops", { ...SHOP, id: "flower" });
    assert.equal((await t.call("alice", "PUT", "/admin/shops/flower", { status: "ended" })).status, 403);
    assert.equal((await t.call("alice", "DELETE", "/admin/shops/flower")).status, 403);
    assert.equal((await t.call(null, "GET", "/admin/shops")).status, 401);
  } finally { t.close(); }
});

test("無いショップは、書き換えも閉じもできない", async () => {
  const t = setup();
  try {
    assert.equal((await t.call("owner", "PUT", "/admin/shops/nope", SHOP)).body.error, "SHOP_NOT_FOUND");
    assert.equal((await t.call("owner", "DELETE", "/admin/shops/nope")).body.error, "SHOP_NOT_FOUND");
  } finally { t.close(); }
});

test("ショップを足しても、商品の払い方は変わっていない", async () => {
  /* ここが変わると、既存の注文・支払いの筋道に影響が出る。 */
  const t = setup();
  try {
    await t.call("owner", "POST", "/admin/products", {
      ...ITEM, prices: { EMUER: 50, JPYC: 300, JPY: 300 }, cashAtVenue: true
    });
    const p = (await t.call(null, "GET", "/products")).body.products[0];
    /* この試験ではカードの口（Stripe）を繋いでいないので jpy_card は出ない。
       出る・出ないの条件は mitemiru.test.js が見ている。 */
    assert.deepEqual(p.methods, ["emuer_ledger", "emuer_chain", "jpyc", "jpy_cash"]);
    assert.equal(p.fulfillment, "会場で手渡し");
    assert.equal(p.cancelPolicy, "お渡し前なら取り消せます");
  } finally { t.close(); }
});
