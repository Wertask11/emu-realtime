"use strict";
/* 公式ショップの商品（10/28 オーナー決定）。
     - デジタルの品は、交換したらその場でダウンロード。品は catalog.json の一覧で増やす
     - 物は配送が基本で、会場での手渡しも選べる品がある。住所は注文とは別に置き、運営だけが見る
     - 住所は、配送してから1年で消す。渡さないと決まったら、すぐ消す
     - 受注生産は締切を過ぎたら注文できない
     - 物は、渡す前で締切の前なら取り消せる（未変換のEMUERならその場で全額返す）
     - 公式ショップの見られ方は、日ごとの回数だけを数える */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const express = require("express");
const { makeFirestore } = require("./fake-firestore");
const { createMitemiruRouter, cleanProduct } = require("./mitemiru");
const CATALOG = require("./official-shop-products.json");

const UNIT = 10n ** 18n;
const W = (n) => (BigInt(n) * UNIT).toString();
const ALICE = "0x" + "a".repeat(40);
const DAY = 24 * 60 * 60 * 1000;

function setup(opts = {}) {
  const db = makeFirestore({});
  let clock = Date.parse("2026-11-14T13:00:00+09:00");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shop-assets-"));
  fs.writeFileSync(path.join(dir, "wallpaper.zip"), "PK-test-zip");
  const digitalAssets = { "reizo-wallpaper-v1": { file: "wallpaper.zip", type: "application/zip", downloadName: "reizo-wallpaper-v1.zip", path: path.join(dir, "wallpaper.zip") } };
  const chain = {
    id: (v) => "0x" + require("node:crypto").createHash("sha256").update(v).digest("hex"),
    async signerReady() { return true; }, async claimPaid() { return 0n; },
    async exchangeOrder() { return { buyer: "0x" + "0".repeat(40), productId: "0x", paid: 0n, refunded: false }; },
    async signOrder(v) { return "sig:" + v.orderId; }
  };
  const users = { alice: ALICE, owner: "0x" + "f".repeat(40), bob: "0x" + "b".repeat(40) };
  const requireFirebaseUser = (req, res, next) => {
    const uid = req.headers["x-test-user"];
    if (!uid) return res.status(401).json({ error: "AUTH_REQUIRED" });
    req.identity = { uid, walletAddress: users[uid], account: {} };
    next();
  };
  const requireOwner = (req, res, next) => requireFirebaseUser(req, res, () =>
    req.identity.uid === "owner" ? next() : res.status(403).json({ error: "OWNER_ONLY" }));
  const m = createMitemiruRouter({
    db, chain, stripe: null, env: {}, now: () => clock, emuerEnabled: () => true,
    ...(opts.realAssets ? {} : { digitalAssets }),
    identity: { findByUid: async uid => uid === "alice" ? "SP-AAAA-AAAA-AAAA-AAAA" : null,
      readIdentity: async spid => spid === "SP-AAAA-AAAA-AAAA-AAAA" ? { status: "active" } : null },
    requireFirebaseUser, requireOwner, isOwner: (i) => i.uid === "owner",
    entitlement: { getEntitlement: async (uid) => ({ plan: uid === "alice" ? "pro" : "guest" }) }
  });
  const app = express();
  app.use(express.json());
  app.use("/api/mitemiru", m.router);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/mitemiru`;
  async function call(user, method, p, body) {
    const r = await fetch(base + p, { method, headers: Object.assign({ "content-type": "application/json" }, user ? { "x-test-user": user } : {}), body: body ? JSON.stringify(body) : undefined });
    const type = r.headers.get("content-type") || "";
    return { status: r.status, headers: r.headers, body: type.includes("application/json") ? await r.json() : null,
      text: type.includes("application/json") ? null : await r.text() };
  }
  for (let i = 0; i < 5; i += 1) db.collection("emuer_v2_rewards").doc("0xr" + i).set({
    claimId: "0xr" + i, recipient: ALICE, uid: "alice", amountWei: W(100), amount: "100", status: "pending",
    createdAt: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString() });
  return { db, call, close: () => server.close(), advance: (ms) => { clock += ms; }, now: () => clock };
}
const official = (extra) => Object.assign({ name: "テストの品", fulfillment: "配送します", cancelPolicy: "締切まで取消できます",
  prices: { EMUER: 30 }, shopId: "schoolpark-official", status: "live" }, extra);
async function product(t, extra) {
  const r = await t.call("owner", "POST", "/admin/products", official(extra));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.product.id;
}
let seq = 0;
const order = (t, productId, more) => t.call("alice", "POST", "/orders", Object.assign({
  productId, method: "emuer_ledger", requestId: "req-official-" + String(++seq).padStart(6, "0") }, more || {}));
const SHIP = { name: "山田 太郎", postalCode: "819-0001", address: "福岡県福岡市西区小戸1-2-3", phone: "090-1234-5678" };

test("デジタルの品：交換したら本人だけがダウンロードできる。一覧に無い品は登録できない", async () => {
  const t = setup();
  try {
    const bad = await t.call("owner", "POST", "/admin/products", official({ digitalAssetId: "not-in-catalog" }));
    assert.equal(bad.status, 400); assert.equal(bad.body.error, "INVALID_DIGITAL_ASSET");
    const id = await product(t, { digitalAssetId: "reizo-wallpaper-v1", fulfillment: "交換したらその場でダウンロード", cancelPolicy: "デジタルの品のため取り消しはできません" });
    const r = await order(t, id);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const mine = (await t.call("alice", "GET", "/orders")).body.orders[0];
    assert.equal(mine.delivery, "digital"); assert.equal(mine.digitalAvailable, true);
    assert.equal(mine.digitalFileName, "reizo-wallpaper-v1.zip"); assert.equal(mine.cancellable, false, "デジタルは取り消せない");
    const file = await t.call("alice", "GET", `/orders/${mine.id}/digital`);
    assert.equal(file.status, 200); assert.equal(file.text, "PK-test-zip");
    assert.match(file.headers.get("content-disposition") || "", /reizo-wallpaper-v1\.zip/);
    assert.equal((await t.call("bob", "GET", `/orders/${mine.id}/digital`)).status, 404, "ほかの人は受け取れない");
    assert.equal((await t.call("alice", "POST", `/orders/${mine.id}/cancel`)).body.error, "NOT_CANCELLABLE");
  } finally { t.close(); }
});

test("配送：住所が無いと注文できない。住所は注文とは別に置き、本人と運営だけが見る", async () => {
  const t = setup();
  try {
    const id = await product(t, { fulfillmentMode: "ship" });
    assert.equal((await order(t, id)).body.error, "INVALID_SHIPPING");
    assert.equal((await order(t, id, { shipping: { ...SHIP, postalCode: "12" } })).body.error, "INVALID_SHIPPING");
    const r = await order(t, id, { shipping: { ...SHIP, extra: "捨てる" } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const oid = r.body.order.id;
    const orderDoc = t.db._dump("mitemiru_orders")[oid];
    assert.equal(orderDoc.delivery, "ship"); assert.equal(orderDoc.physical, true);
    assert.equal(JSON.stringify(orderDoc).includes("西区"), false, "注文の記録に住所を入れない");
    const saved = t.db._dump("mitemiru_shipping")[oid];
    assert.deepEqual({ name: saved.name, postalCode: saved.postalCode, address: saved.address, phone: saved.phone },
      { name: "山田 太郎", postalCode: "819-0001", address: "福岡県福岡市西区小戸1-2-3", phone: "09012345678" });
    assert.equal(saved.extra, undefined, "余計な欄は捨てる");
    const mine = (await t.call("alice", "GET", "/orders")).body.orders[0];
    assert.deepEqual(mine.shipTo, { name: "山田 太郎", postalCode: "819-0001", address: "福岡県福岡市西区小戸1-2-3" });
    assert.equal((await t.call("alice", "GET", "/admin/shipping")).status, 403, "運営だけ");
    const list = (await t.call("owner", "GET", "/admin/shipping")).body.orders;
    assert.equal(list.length, 1); assert.equal(list[0].shipTo.phone, "09012345678");
  } finally { t.close(); }
});

test("配送か会場での手渡しを選べる品：手渡しなら住所は取らない", async () => {
  const t = setup();
  try {
    const id = await product(t, { fulfillmentMode: "ship_or_pickup" });
    assert.equal((await order(t, id, { delivery: "drone" })).body.error, "INVALID_DELIVERY");
    const r = await order(t, id, { delivery: "pickup" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(t.db._dump("mitemiru_orders")[r.body.order.id].delivery, "pickup");
    assert.equal(Object.keys(t.db._dump("mitemiru_shipping")).length, 0);
  } finally { t.close(); }
});

test("発送したら住所は1年で消える", async () => {
  const t = setup();
  try {
    const id = await product(t, { fulfillmentMode: "ship" });
    const oid = (await order(t, id, { shipping: SHIP })).body.order.id;
    const shipped = await t.call("owner", "POST", `/admin/orders/${oid}/ship`);
    assert.equal(shipped.status, 200, JSON.stringify(shipped.body));
    assert.equal(t.db._dump("mitemiru_orders")[oid].status, "fulfilled");
    assert.equal((await t.call("owner", "GET", "/admin/shipping?status=shipped")).body.orders.length, 1);
    t.advance(364 * DAY);
    await t.call("owner", "GET", "/admin/shipping");
    assert.ok(t.db._dump("mitemiru_shipping")[oid], "1年たつまでは残す");
    t.advance(2 * DAY);
    await t.call("owner", "GET", "/admin/shipping");
    assert.equal(t.db._dump("mitemiru_shipping")[oid], undefined, "1年を過ぎたら消す");
  } finally { t.close(); }
});

test("受注生産：締切の前なら取り消せて、その場で全額返り、住所も消える。締切を過ぎたら注文も取消もできない", async () => {
  const t = setup();
  try {
    const deadline = t.now() + 3 * DAY;
    const id = await product(t, { fulfillmentMode: "ship", orderDeadlineMs: deadline });
    const before = (await t.call("alice", "GET", "/products?shopId=schoolpark-official")).body.products.find(p => p.id === id);
    assert.equal(before.orderDeadline, deadline); assert.equal(before.orderClosed, false); assert.equal(before.fulfillmentMode, "ship");
    const a = (await order(t, id, { shipping: SHIP })).body.order.id;
    const b = (await order(t, id, { shipping: SHIP })).body.order.id;
    const mine = (await t.call("alice", "GET", "/orders")).body.orders.find(o => o.id === a);
    assert.equal(mine.cancellable, true);
    const c = await t.call("alice", "POST", `/orders/${a}/cancel`);
    assert.equal(c.status, 200, JSON.stringify(c.body)); assert.equal(c.body.refunded, true);
    const orders = t.db._dump("mitemiru_orders");
    assert.equal(orders[a].status, "refunded");
    const refund = Object.values(t.db._dump("emuer_v2_rewards")).find(x => x.kind === "mitemiru-refund" && x.orderId === a);
    assert.equal(refund.amount, "30", "全額をEMUERで返す");
    assert.equal(t.db._dump("mitemiru_shipping")[a], undefined, "取り消したら住所はすぐ消す");
    assert.equal(t.db._dump("mitemiru_products")[id].sold, 1, "在庫の数も戻す");
    t.advance(4 * DAY);
    assert.equal((await t.call("alice", "POST", `/orders/${b}/cancel`)).body.error, "NOT_CANCELLABLE", "締切後は取り消せない");
    assert.equal((await order(t, id, { shipping: SHIP })).body.error, "ORDER_CLOSED");
  } finally { t.close(); }
});

test("ウォレットのEMUERで払った物の取消は、申し出として残す（返金は運営が鎖の上で行う）", async () => {
  const t = setup();
  try {
    await t.db.collection("mitemiru_orders").doc("c".repeat(40)).set({ uid: "alice", status: "paid", method: "emuer_chain",
      physical: true, delivery: "ship", productId: "p_x", amount: 30, currency: "EMUER", createdAtMs: t.now() });
    const r = await t.call("alice", "POST", `/orders/${"c".repeat(40)}/cancel`);
    assert.equal(r.status, 200); assert.equal(r.body.requested, true);
    const o = t.db._dump("mitemiru_orders")["c".repeat(40)];
    assert.equal(o.status, "paid", "まだ返していない"); assert.ok(o.cancelRequestedAtMs);
    const mine = (await t.call("alice", "GET", "/orders")).body.orders[0];
    assert.equal(mine.cancelRequested, true); assert.equal(mine.cancellable, false, "二度は申し出ない");
  } finally { t.close(); }
});

test("イベントの席・オンラインは、買った人からは取り消せない（運営都合の返金だけ）", async () => {
  const t = setup();
  try {
    const id = await product(t, { fulfillmentMode: "pickup" });
    const oid = (await order(t, id)).body.order.id;
    assert.equal((await t.call("alice", "POST", `/orders/${oid}/cancel`)).body.error, "NOT_CANCELLABLE");
    assert.equal(Object.keys(t.db._dump("mitemiru_shipping")).length, 0);
  } finally { t.close(); }
});

test("見られ方の回数は日ごとに数え、交換の数と並べて運営に返す。誰が見たかは残さない", async () => {
  const t = setup();
  try {
    const id = await product(t, { digitalAssetId: "reizo-wallpaper-v1" });
    assert.equal((await t.call(null, "POST", "/metrics", { event: "shop_view" })).status, 401);
    assert.equal((await t.call("alice", "POST", "/metrics", { event: "secret" })).status, 400);
    await t.call("alice", "POST", "/metrics", { event: "shop_view" });
    await t.call("alice", "POST", "/metrics", { event: "shop_view" });
    await t.call("alice", "POST", "/metrics", { event: "product_view", productId: id });
    await order(t, id);
    const day = Object.values(t.db._dump("mitemiru_metrics"))[0];
    assert.equal(day.shop_view, 2); assert.equal(day.product_view, 1); assert.equal(day.productViews[id], 1);
    assert.equal(JSON.stringify(day).includes("alice"), false, "誰が見たかは残さない");
    assert.equal((await t.call("alice", "GET", "/admin/metrics")).status, 403);
    const m = (await t.call("owner", "GET", "/admin/metrics?days=7")).body;
    assert.deepEqual(m.total, { shopViews: 2, productViews: 1, exchanges: 1 });
  } finally { t.close(); }
});

test("商品の受け取り方と締切は、決まった形だけを受け付ける", () => {
  assert.throws(() => cleanProduct(official({ fulfillmentMode: "teleport" }), null, {}), /INVALID_FULFILLMENT_MODE/);
  assert.throws(() => cleanProduct(official({ fulfillmentMode: "digital" }), null, {}), /INVALID_FULFILLMENT_MODE/);
  assert.throws(() => cleanProduct(official({ orderDeadlineMs: -1 }), null, {}), /INVALID_ORDER_DEADLINE/);
  const old = cleanProduct(official({}), null, {});
  assert.equal(old.fulfillmentMode, ""); assert.equal(old.orderDeadlineMs, null, "前からある商品はそのまま");
});

/* 11品（10/29 オーナー決定：おすすめの値段・優先席5席・企画会議3名・物の品は各10個）。 */
test("11品を下書きでまとめて登録できる。何度押しても同じで、販売中の品には触らない", async () => {
  const t = setup({ realAssets: true });
  try {
    assert.equal((await t.call("alice", "POST", "/admin/city/official-catalog")).status, 403, "運営だけ");
    // 前に作った「1 EMUER の下書き」は、決まった中身に入れ直す
    await t.call("owner", "POST", "/admin/city/reizo-sticker", {});
    const first = await t.call("owner", "POST", "/admin/city/official-catalog");
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.results.length, 11);
    assert.deepEqual(first.body.results.map(r => r.result), ["updated", ...Array(10).fill("created")]);
    const rows = t.db._dump("mitemiru_products");
    const price = id => rows[id].prices.EMUER;
    assert.deepEqual(CATALOG.products.map(p => price(p.id)), [5, 15, 25, 30, 30, 80, 150, 150, 100, 100, 300]);
    for (const p of CATALOG.products) {
      const row = rows[p.id];
      assert.equal(row.status, "draft", p.id);
      assert.equal(row.shopId, "schoolpark-official"); assert.equal(row.storeType, "schoolpark_virtual");
      assert.deepEqual({ JPY: row.prices.JPY, JPYC: row.prices.JPYC }, { JPY: null, JPYC: null }, "EMUERだけ");
      for (const url of [row.imageUrl, ...row.gallery]) {
        assert.match(url, /^https:\/\/schoolpark-emu\.vercel\.app\/schoolpark\/shop\/official\//);
        assert.ok(fs.existsSync(path.join(__dirname, "../frontend/public", new URL(url).pathname)), url);
      }
    }
    assert.equal(rows["reizo-kun-sticker-v1"].digitalAssetId, "reizo-kun-digital-sticker-v2");
    assert.equal(rows["official-event-seat-v1"].stock, 5); assert.equal(rows["official-planning-meeting-v1"].stock, 3);
    for (const id of ["official-sticker-set-v1", "official-acrylic-keyholder-v1", "official-can-badge-v1", "official-guild-badge-v1"]) {
      assert.equal(rows[id].stock, 10, id); assert.equal(rows[id].fulfillmentMode, "ship_or_pickup", id);
      assert.equal(rows[id].orderDeadlineMs, Date.parse("2026-11-30T23:59:59+09:00"), id);
    }
    assert.deepEqual(rows["official-guild-badge-v1"].choices, ["LEARN", "WORK", "PLAY", "CONNECT", "WEB3"]);
    assert.deepEqual(["official-goods-vote-1", "official-event-seat-v1", "official-planning-meeting-v1"].map(id => rows[id].onePerPerson), [true, true, true]);
    assert.equal((await t.call("alice", "GET", "/products?shopId=schoolpark-official")).body.products.length, 0, "下書きは並ばない");

    await t.call("owner", "PUT", "/admin/products/official-can-badge-v1", { status: "live", prices: { EMUER: 120 } });
    const again = await t.call("owner", "POST", "/admin/city/official-catalog");
    assert.equal(again.body.results.find(r => r.id === "official-can-badge-v1").result, "kept");
    assert.equal(again.body.results.filter(r => r.result === "updated").length, 10);
    assert.equal(t.db._dump("mitemiru_products")["official-can-badge-v1"].prices.EMUER, 120, "販売中の品はそのまま");
    const shown = (await t.call("alice", "GET", "/products?shopId=schoolpark-official")).body.products;
    assert.deepEqual(shown.map(p => p.id), ["official-can-badge-v1"]);
    assert.equal(shown[0].gallery.length, 1);
  } finally { t.close(); }
});

test("11品の配布ファイル：一覧のファイルがそろっていて、本人がダウンロードできる", async () => {
  const t = setup({ realAssets: true });
  try {
    await t.call("owner", "POST", "/admin/city/official-catalog");
    const want = { "reizo-kun-sticker-v1": "reizo-kun-sticker.png", "official-wallpaper-icons-v1": "reizo-kun-wallpaper-icons.zip",
      "official-wisdom-cards-v1": "wisdom-cards-hajime.zip", "official-tankyu-note-v1": "tankyu-note-hajime.pdf" };
    for (const [id, name] of Object.entries(want)) {
      await t.call("owner", "PUT", `/admin/products/${id}`, { status: "live" });
      const r = await order(t, id);
      assert.equal(r.status, 200, id + " " + JSON.stringify(r.body));
      const mine = (await t.call("alice", "GET", "/orders")).body.orders.find(o => o.id === r.body.order.id);
      assert.equal(mine.digitalFileName, name);
      const file = await t.call("alice", "GET", `/orders/${mine.id}/digital`);
      assert.equal(file.status, 200, id);
      assert.ok((file.text || "").length > 1000, id + " は中身がある");
    }
  } finally { t.close(); }
});

test("1人1つまでの品：持っていれば交換できない。返金・取り消し・期限切れで、また交換できる", async () => {
  const t = setup();
  try {
    const id = await product(t, { fulfillmentMode: "pickup", onePerPerson: true });
    const first = await order(t, id);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const second = await order(t, id);
    assert.equal(second.status, 409); assert.equal(second.body.error, "ALREADY_OWNED");
    assert.equal(t.db._dump("mitemiru_products")[id].sold, 1, "2つ目は数えない");
    const refunded = await t.call("owner", "POST", `/admin/orders/${first.body.order.id}/refund`, { note: "運営都合" });
    assert.equal(refunded.status, 200, JSON.stringify(refunded.body));
    assert.equal((await order(t, id)).status, 200, "返金したら、また交換できる");

    // ウォレット払いの取り置きも1つと数える。取り消し・期限切れで外れる
    const chainId = await product(t, { fulfillmentMode: "online", onePerPerson: true });
    const pending = await order(t, chainId, { method: "emuer_chain" });
    assert.equal(pending.status, 200, JSON.stringify(pending.body));
    assert.equal((await order(t, chainId, { method: "emuer_chain" })).body.error, "ALREADY_OWNED");
    assert.equal((await t.call("alice", "POST", `/orders/${pending.body.order.id}/cancel`)).status, 200);
    const again = await order(t, chainId, { method: "emuer_chain" });
    assert.equal(again.status, 200, "取り消したら、また交換できる");
    t.advance(31 * 60 * 1000);
    assert.equal((await order(t, chainId, { method: "emuer_chain" })).status, 200, "期限が切れたら、また交換できる");
  } finally { t.close(); }
});

test("選ぶものがある品：選ばないと交換できない。選んだものは注文・履歴・配送の一覧に出る", async () => {
  const t = setup();
  try {
    const id = await product(t, { fulfillmentMode: "ship_or_pickup", choices: ["LEARN", "WORK"] });
    assert.equal((await order(t, id, { shipping: SHIP })).body.error, "INVALID_CHOICE");
    assert.equal((await order(t, id, { shipping: SHIP, choice: "PLAY" })).body.error, "INVALID_CHOICE");
    const r = await order(t, id, { shipping: SHIP, choice: "WORK" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(t.db._dump("mitemiru_orders")[r.body.order.id].choice, "WORK");
    assert.equal((await t.call("alice", "GET", "/orders")).body.orders[0].choice, "WORK");
    assert.equal((await t.call("owner", "GET", "/admin/shipping")).body.orders[0].choice, "WORK");
    const plain = await product(t, {});
    const o = await order(t, plain, { choice: "WORK" });
    assert.equal(o.status, 200);
    assert.equal(t.db._dump("mitemiru_orders")[o.body.order.id].choice, undefined, "選ぶものが無い品には残さない");
  } finally { t.close(); }
});

test("商品ページの画像と選ぶものは、決まった形だけを受け付ける", () => {
  assert.throws(() => cleanProduct(official({ gallery: ["http://example.com/a.png"] }), null, {}), /INVALID_GALLERY/);
  assert.throws(() => cleanProduct(official({ gallery: Array(7).fill("https://example.com/a.png") }), null, {}), /INVALID_GALLERY/);
  assert.throws(() => cleanProduct(official({ gallery: "https://example.com/a.png" }), null, {}), /INVALID_GALLERY/);
  assert.throws(() => cleanProduct(official({ choices: ["A", "A"] }), null, {}), /INVALID_CHOICES/);
  assert.throws(() => cleanProduct(official({ choices: ["A", ""] }), null, {}), /INVALID_CHOICES/);
  const old = cleanProduct(official({}), null, {});
  assert.deepEqual([old.gallery, old.choices, old.onePerPerson], [[], [], false], "前からある商品はそのまま");
});
