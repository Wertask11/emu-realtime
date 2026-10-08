"use strict";

/*
 * みてみる（SchoolPark内の交換所）
 *
 * 運営が置いた商品を、EMUER・JPYC・円のどれかで手に入れる場所。
 * 例: イベントのステッカー引換券を EMUER で払い、画面の引換コードを見せて
 *     その場でステッカーを受け取る。
 *
 * 支払いの方法は5つ。どれも「支払いが確かめられた」ときにだけ paid にする。
 *   emuer_ledger : まだ受け取っていない EMUER（未変換の報酬）から引く。鎖を通らない
 *   emuer_chain  : 受け取り済みの EMUER を EMUERv2.exchange で支払う（本人のウォレット）
 *   jpyc         : JPYC を受取先へ送る。送金の記録を鎖で確かめる
 *   jpy_card     : Stripe の単発決済（カード）
 *   jpy_cash     : イベント会場で現金。運営が受け取ったと記録する
 *
 * 決めごと（2026-10-04 オーナー決定・contracts-v2/DECISIONS.md）
 *   - プランの回数枠（Light 月1・Plus 週1・Pro 無制限、無料は不可）は EMUER の支払いだけにかける。
 *     枠は v2 の「みてみるの交換」枠（emuer_v2_access_usage の exchange）と同じもの。
 *   - 枠は支払いが成功したときに消費する。閲覧・失敗・取消は数えない。
 *   - 運営都合の返金は、元の支払い額を全額返し、回数の消費も取り消す。
 *   - 商品は、価格・数量・提供方法・取消条件を決めてから出す。架空の商品は売らない。
 *   - 金額はいつもサーバーの商品から決める。画面から来た金額は使わない。
 */

const crypto = require("node:crypto");
const express = require("express");
const path = require("node:path");

const PRODUCTS = "mitemiru_products";
/* ショップ。みてみるの画面は「ショップを選ぶ → 中の商品を見る」という
   並びになっている。商品だけだと、その階層が作れない。
   商品は shopId でここへぶら下がる。 */
const SHOPS = "mitemiru_shops";
const CITY_OFFICIAL_SHOP_ID = "schoolpark-official";
const REIZO_STICKER_PRODUCT_ID = "reizo-kun-sticker-v1";
const REIZO_STICKER_ASSET_ID = "reizo-kun-digital-sticker-v1";
const ORDERS = "mitemiru_orders";
const CHAIN_PAYMENTS = "mitemiru_chain_payments";
const REWARDS = "emuer_v2_rewards";
const USAGE = "emuer_v2_access_usage";

const UNIT = 10n ** 18n;
const CHAIN_ID = 137;
const EMUER_V2 = "0x9c102cC3016C70767082b60196565878D9314864";
const TREASURY = "0x1c156b6a8caa6772430eda2cbb0d20cf41b9cfe4";
// JPYC株式会社が発行している現行の JPYC（Polygon）。旧JPYC(0x431D…)は受け付けない。
const JPYC = "0xe7c3d8c9a439fede00d2600032d5db0be71c3c29";

const ONLINE_HOLD_MS = 30 * 60 * 1000;      // オンライン決済の取り置き
const CASH_HOLD_MS = 6 * 60 * 60 * 1000;    // 会場での現金払いの取り置き
const AUTH_GRACE_MS = 60 * 1000;            // 署名の期限ぎわを避ける余白
const JPYC_CONFIRMATIONS = 2;

const METHODS = {
  emuer_ledger: { currency: "EMUER", label: "EMUER（未変換）" },
  emuer_chain:  { currency: "EMUER", label: "EMUER（ウォレット）" },
  jpyc:         { currency: "JPYC",  label: "JPYC" },
  jpy_card:     { currency: "JPY",   label: "円（カード）" },
  jpy_cash:     { currency: "JPY",   label: "円（会場で現金）" }
};
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const STATUS = ["pending_payment", "paid", "fulfilled", "refunded", "cancelled", "expired"];

const text = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");
function tsMs(v) {
  if (!v) return 0;
  if (typeof v.toMillis === "function") return v.toMillis();
  if (v instanceof Date) return v.getTime();
  const n = Date.parse(String(v));
  return Number.isFinite(n) ? n : 0;
}
const wei = (whole) => (BigInt(whole) * UNIT).toString();
function emuerOf(weiValue) {
  const v = BigInt(String(weiValue || "0"));
  const whole = v / UNIT, frac = v % UNIT;
  if (frac === 0n) return whole.toString();
  return whole.toString() + "." + frac.toString().padStart(18, "0").replace(/0+$/, "");
}
function price(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1 || n > 10000000) throw new Error("INVALID_PRICE");
  return n;
}

function cleanProduct(body, previous) {
  const b = body && typeof body === "object" && !Array.isArray(body) ? body : null;
  if (!b) throw new Error("INVALID_PRODUCT");
  const base = previous || {};
  const pick = (k) => (Object.prototype.hasOwnProperty.call(b, k) ? b[k] : base[k]);
  const name = text(pick("name"), 60);
  const fulfillment = text(pick("fulfillment"), 200);
  const cancelPolicy = text(pick("cancelPolicy"), 300);
  if (!name) throw new Error("NAME_REQUIRED");
  if (!fulfillment) throw new Error("FULFILLMENT_REQUIRED");
  if (!cancelPolicy) throw new Error("CANCEL_POLICY_REQUIRED");
  const rawPrices = pick("prices") || {};
  const prices = { EMUER: price(rawPrices.EMUER), JPYC: price(rawPrices.JPYC), JPY: price(rawPrices.JPY) };
  if (prices.EMUER === null && prices.JPYC === null && prices.JPY === null) throw new Error("PRICE_REQUIRED");
  const cashAtVenue = pick("cashAtVenue") === true;
  if (cashAtVenue && prices.JPY === null) throw new Error("CASH_NEEDS_JPY_PRICE");
  const rawStock = pick("stock");
  let stock = null;
  if (rawStock !== null && rawStock !== undefined && rawStock !== "") {
    stock = Number(rawStock);
    if (!Number.isSafeInteger(stock) || stock < 0 || stock > 1000000) throw new Error("INVALID_STOCK");
  }
  const status = pick("status") || "draft";
  if (!["draft", "live", "ended"].includes(status)) throw new Error("INVALID_STATUS");
  const imageUrl = text(pick("imageUrl"), 500);
  if (imageUrl) {
    let u = null;
    try { u = new URL(imageUrl); } catch (_) { /* 下で断る */ }
    if (!u || u.protocol !== "https:") throw new Error("INVALID_IMAGE_URL");
  }
  /* どのショップの商品か。空でも置ける（どこにも属さない商品）。 */
  const shopId = slug(pick("shopId"), 40);
  // Store type is derived from the authoritative shop record below. Never let
  // a product editor choose its own payment policy.
  const storeType = shopId === CITY_OFFICIAL_SHOP_ID ? "schoolpark_virtual" : "legacy";
  if (storeType === "schoolpark_virtual" && (prices.EMUER === null || prices.JPY !== null || prices.JPYC !== null || cashAtVenue)) {
    throw new Error("VIRTUAL_STORE_EMUER_ONLY");
  }
  /* 画面に出す絵文字。1〜4文字まで（絵文字は1文字でも長さが2以上になる）。 */
  const emoji = text(pick("emoji"), 8);
  const sortOrder = Number(pick("sortOrder") || 0);
  return {
    name, description: text(pick("description"), 600), imageUrl, prices, cashAtVenue, stock, status,
    fulfillment, cancelPolicy, shopId, storeType, emoji,
    sortOrder: Number.isSafeInteger(sortOrder) ? sortOrder : 0
  };
}

/* ショップ。みてみるの画面に出るカードの中身。

   並びは「ショップを選ぶ → 中の商品を見る」。商品だけではその階層が
   作れないので、ここで持つ。商品そのもの・注文・支払いには触らない。 */
const SHOP_CATEGORIES = ["kyozai", "yugu", "zakka", "fashion", "digital", "other"];
const SHOP_BADGES = ["", "NEW", "SALE", "HOT"];

function slug(value, max) {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[a-z0-9_-]{1,120}$/.test(raw) ? raw.slice(0, max || 40) : "";
}

function cleanShop(body, previous) {
  const b = body && typeof body === "object" && !Array.isArray(body) ? body : null;
  if (!b) throw new Error("INVALID_SHOP");
  const base = previous || {};
  const pick = (k) => (Object.prototype.hasOwnProperty.call(b, k) ? b[k] : base[k]);
  const name = text(pick("name"), 40);
  if (!name) throw new Error("NAME_REQUIRED");
  const category = String(pick("category") || "other");
  if (!SHOP_CATEGORIES.includes(category)) throw new Error("INVALID_CATEGORY");
  const badge = String(pick("badge") || "");
  if (!SHOP_BADGES.includes(badge)) throw new Error("INVALID_BADGE");
  const status = pick("status") || "draft";
  if (!["draft", "live", "ended"].includes(status)) throw new Error("INVALID_STATUS");
  const storeType = pick("storeType") || "legacy";
  if (!["schoolpark_virtual", "real_partner", "legacy"].includes(storeType)) throw new Error("INVALID_STORE_TYPE");
  const address = text(pick("address"), 200);
  const paymentGuide = text(pick("paymentGuide"), 500);
  const imageUrl = text(pick("imageUrl"), 500);
  if (imageUrl) {
    let image = null;
    try { image = new URL(imageUrl); } catch (_) { /* checked below */ }
    if (!image || image.protocol !== "https:") throw new Error("INVALID_IMAGE_URL");
  }
  if (storeType === "real_partner" && status === "live" && !address) throw new Error("PARTNER_ADDRESS_REQUIRED");
  /* 星は 0.0〜5.0。飾りなので無ければ 5.0 にする。 */
  let rating = Number(pick("rating"));
  if (!Number.isFinite(rating) || rating < 0 || rating > 5) rating = 5;
  const sortOrder = Number(pick("sortOrder") || 0);
  return {
    name, category, badge, status, storeType, address, imageUrl, paymentGuide,
    emoji: text(pick("emoji"), 8) || "\u{1F3EA}",
    description: text(pick("description"), 200),
    rating: Math.round(rating * 10) / 10,
    sortOrder: Number.isSafeInteger(sortOrder) ? sortOrder : 0
  };
}

function remaining(product) {
  if (product.stock === null || product.stock === undefined) return null;
  return Math.max(0, Number(product.stock) - Number(product.sold || 0) - Number(product.reserved || 0));
}

/* 鎖とのやりとり。本番では ethers で Polygon に聞く。テストでは差し替える。 */
function createChainAdapter(env) {
  const ethers = require("ethers");
  const rpcUrl = env.POLYGON_RPC_URL || "https://polygon-bor-rpc.publicnode.com";
  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
  const key = env.EMUER_V2_AUTHORIZER_PRIVATE_KEY || "";
  const signer = key ? new ethers.Wallet(key, provider) : null;
  const emuer = new ethers.Contract(EMUER_V2, [
    "function hasRole(bytes32 role,address account) view returns (bool)",
    "function claimPaid(bytes32) view returns (uint256)",
    "function orders(bytes32) view returns (address buyer, bytes32 productId, uint256 paid, bool fulfilled, bool refunded)"
  ], provider);
  const transferTopic = ethers.utils.id("Transfer(address,address,uint256)");
  const jpyc = new ethers.Contract(JPYC, ["function decimals() view returns (uint8)"], provider);
  let jpycDecimals = null;
  return {
    /* 桁数は決め打ちせず、トークン自身に聞く（一度聞いたら覚えておく）。 */
    async jpycDecimals() {
      if (jpycDecimals === null) jpycDecimals = Number(await jpyc.decimals());
      return jpycDecimals;
    },
    id: (value) => ethers.utils.id(value),
    async signerReady() {
      if (!signer) return false;
      return emuer.hasRole(ethers.utils.id("AUTHORIZER_ROLE"), signer.address);
    },
    async claimPaid(claimId) { return BigInt((await emuer.claimPaid(claimId)).toString()); },
    async exchangeOrder(orderId) {
      const o = await emuer.orders(orderId);
      return { buyer: String(o.buyer).toLowerCase(), productId: String(o.productId).toLowerCase(),
        paid: BigInt(o.paid.toString()), fulfilled: !!o.fulfilled, refunded: !!o.refunded };
    },
    async signOrder({ orderId, productId, buyer, priceWei, deadline }) {
      return signer._signTypedData(
        { name: "Emuer", version: "2", chainId: CHAIN_ID, verifyingContract: EMUER_V2 },
        { Order: [
          { name: "orderId", type: "bytes32" }, { name: "productId", type: "bytes32" },
          { name: "buyer", type: "address" }, { name: "price", type: "uint256" }, { name: "deadline", type: "uint256" }
        ] },
        { orderId, productId, buyer: ethers.utils.getAddress(buyer), price: priceWei, deadline }
      );
    },
    async tokenTransfers(txHash, token) {
      const receipt = await provider.getTransactionReceipt(txHash);
      if (!receipt) return { found: false };
      const latest = await provider.getBlockNumber();
      const transfers = receipt.logs
        .filter(l => String(l.address).toLowerCase() === token && l.topics[0] === transferTopic && l.topics.length === 3)
        .map(l => ({
          from: ethers.utils.hexDataSlice(l.topics[1], 12).toLowerCase(),
          to: ethers.utils.hexDataSlice(l.topics[2], 12).toLowerCase(),
          value: BigInt(ethers.BigNumber.from(l.data).toString()), logIndex: l.logIndex
        }));
      return { found: true, ok: receipt.status === 1, confirmations: latest - receipt.blockNumber + 1, transfers };
    }
  };
}

function createMitemiruRouter(deps) {
  const db = deps.db;
  const env = deps.env || process.env;
  const now = deps.now || (() => Date.now());
  const chain = deps.chain === undefined ? createChainAdapter(env) : deps.chain;
  const stripe = deps.stripe === undefined
    ? (env.STRIPE_SECRET_KEY ? require("stripe")(env.STRIPE_SECRET_KEY) : null) : deps.stripe;
  const emuerEnabled = deps.emuerEnabled || (() => false);
  const isOwner = deps.isOwner || (() => false);
  const entitlement = deps.entitlement;
  const policy = require("./emuer-v2/policy");
  const siteOrigin = env.PUBLIC_SITE_ORIGIN || "https://schoolpark-emu.vercel.app";
  const jpycReceiver = String(env.MITEMIRU_JPYC_RECEIVER || TREASURY).toLowerCase();
  const limited = deps.rateLimit
    ? deps.rateLimit({ windowMs: 60_000, max: 12, key: "mitemiru-order" })
    : (req, res, next) => next();
  const router = express.Router();

  const productRef = (id) => db.collection(PRODUCTS).doc(String(id));
  const orderRef = (id) => db.collection(ORDERS).doc(String(id));
  const chainIdOf = (value) => chain.id(value).toLowerCase();

  function fail(res, error) {
    const code = String(error && error.message || "");
    const known = {
      PRODUCT_NOT_FOUND: 404, ORDER_NOT_FOUND: 404, NOT_FOR_SALE: 409, SOLD_OUT: 409, METHOD_NOT_AVAILABLE: 409,
      PASSPORT_LINK_REQUIRED: 409,
      PLAN_REQUIRED: 403, PERIOD_LIMIT_REACHED: 409, INSUFFICIENT_EMUER: 409, EMUER_NOT_ACTIVE: 409,
      WALLET_REQUIRED: 400, ORDER_NOT_PENDING: 409, ORDER_EXPIRED: 409, CHAIN_PAYMENT_NOT_FOUND: 409,
      CHAIN_PAYMENT_MISMATCH: 409, TX_NOT_FOUND: 409, TX_FAILED: 409, TX_PENDING: 409, TX_ALREADY_USED: 409,
      TRANSFER_NOT_FOUND: 409, CARD_NOT_PAID: 409, CHAIN_UNAVAILABLE: 503, AUTHORIZER_NOT_READY: 503,
      CARD_UNAVAILABLE: 503, INVALID_METHOD: 400, INVALID_TX_HASH: 400, NOT_REFUNDABLE: 409,
      CHAIN_REFUND_NOT_CONFIRMED: 409, ALREADY_DONE: 409, NOT_PAID: 409,
      NAME_REQUIRED: 400, FULFILLMENT_REQUIRED: 400, CANCEL_POLICY_REQUIRED: 400, PRICE_REQUIRED: 400,
      INVALID_PRICE: 400, CASH_NEEDS_JPY_PRICE: 400, INVALID_STOCK: 400, INVALID_STATUS: 400,
      INVALID_IMAGE_URL: 400, INVALID_PRODUCT: 400, ENTITLEMENT_UNAVAILABLE: 503,
      /* ショップ。足しておかないと、入力の間違いが 500 として返る。 */
      INVALID_SHOP: 400, INVALID_CATEGORY: 400, INVALID_BADGE: 400, SHOP_NOT_FOUND: 404,
      INVALID_STORE_TYPE: 400, RESERVED_SHOP_ID: 400,
      VIRTUAL_STORE_EMUER_ONLY: 400, PARTNER_STORE_FIAT_ONLY: 400, PARTNER_ADDRESS_REQUIRED: 400,
      PARTNER_CHECKOUT_NOT_READY: 409, IDEMPOTENCY_KEY_REQUIRED: 400,
      IDEMPOTENCY_KEY_CONFLICT: 409, EVENT_QR_PRODUCT_NOT_READY: 409,
      PRODUCT_ALREADY_EXISTS: 409,
      EVENT_QR_CONFIG_INVALID: 503
    };
    if (known[code]) return res.status(known[code]).json({ error: code, ...(error.extra || {}) });
    console.error("mitemiru error:", code);
    return res.status(500).json({ error: "MITEMIRU_FAILED" });
  }
  const err = (code, extra) => { const e = new Error(code); if (extra) e.extra = extra; return e; };

  function methodsFor(product) {
    const out = [];
    const storeType = product.shopId === CITY_OFFICIAL_SHOP_ID ? "schoolpark_virtual" : (product.storeType || "legacy");
    if (storeType === "schoolpark_virtual") {
      if (product.prices.EMUER !== null && emuerEnabled()) out.push("emuer_ledger", "emuer_chain");
      return out;
    }
    // Partner payments are intentionally not settled by SchoolPark. Reji's
    // API/webhook contract is pending, and existing JPY/JPYC methods pay the
    // SchoolPark account. The listing may show guides, but no order is allowed.
    if (storeType === "real_partner") return out;
    if (product.prices.EMUER !== null && emuerEnabled()) out.push("emuer_ledger", "emuer_chain");
    if (product.prices.JPYC !== null) out.push("jpyc");
    if (product.prices.JPY !== null && stripe) out.push("jpy_card");
    if (product.prices.JPY !== null && product.cashAtVenue) out.push("jpy_cash");
    return out;
  }
  function publicProduct(id, p) {
    const left = remaining(p);
    return {
      id, name: p.name, description: p.description || "", imageUrl: p.imageUrl || "",
      prices: p.prices, methods: methodsFor(p), remaining: left, soldOut: left === 0,
      fulfillment: p.fulfillment, cancelPolicy: p.cancelPolicy,
      shopId: p.shopId || "", storeType: p.shopId === CITY_OFFICIAL_SHOP_ID ? "schoolpark_virtual" : (p.storeType || "legacy"), emoji: p.emoji || ""
    };
  }
  function publicOrder(id, o) {
    const shown = ["paid", "fulfilled"].includes(o.status);
    return {
      id, productId: o.productId, productName: o.productName, shopId: o.shopId || "",
      storeType: o.storeType || "legacy", passportId: o.passportId || null,
      method: o.method, currency: o.currency,
      amount: o.amount, status: o.status, pickupCode: shown ? o.pickupCode : null,
      digitalStickerAvailable: o.digitalAssetId === REIZO_STICKER_ASSET_ID && shown,
      fulfillment: o.fulfillment || "", createdAt: o.createdAtMs, paidAt: o.paidAtMs || null,
      fulfilledAt: o.fulfilledAtMs || null, expiresAt: o.status === "pending_payment" ? o.expiresAtMs : null,
      stripeUrl: o.status === "pending_payment" && o.method === "jpy_card" ? (o.stripeUrl || null) : null,
      jpyc: o.method === "jpyc" ? { token: JPYC, receiver: o.receiver, amountWei: o.amountWei, chainId: CHAIN_ID } : null,
      waitingCode: o.method === "jpy_cash" && o.status === "pending_payment" ? o.pickupCode : null
    };
  }

  /* EMUER で払えるか。プランと、この期間の回数。 */
  async function emuerAccess(identity) {
    if (!entitlement) throw err("ENTITLEMENT_UNAVAILABLE");
    const current = await entitlement.getEntitlement(identity.uid, identity.account);
    const plan = current.plan;
    if (!["light", "plus", "pro"].includes(plan)) return { ok: false, code: "PLAN_REQUIRED", plan };
    const period = policy.period(plan, "exchange", now());
    if (period.limit === null) return { ok: true, plan, period, used: 0, usageId: null };
    const usageId = `${identity.uid}:exchange:${period.key}`;
    const snap = await db.collection(USAGE).doc(usageId).get();
    const used = snap.exists ? Number((snap.data() || {}).used || 0) : 0;
    return { ok: used < period.limit, code: used < period.limit ? null : "PERIOD_LIMIT_REACHED", plan, period, used, usageId };
  }
  function consumeUsage(tx, order, usageSnap) {
    if (!order.usageId) return;
    const used = usageSnap && usageSnap.exists ? Number((usageSnap.data() || {}).used || 0) : 0;
    tx.set(db.collection(USAGE).doc(order.usageId), {
      uid: order.uid, action: "exchange", period: order.usagePeriod, plan: order.plan,
      used: used + 1, updatedAt: new Date()
    }, { merge: true });
  }

  async function newPickupCode() {
    for (let i = 0; i < 8; i += 1) {
      const bytes = crypto.randomBytes(6);
      let code = "";
      for (const b of bytes) code += CODE_ALPHABET[b % CODE_ALPHABET.length];
      const taken = await db.collection(ORDERS).where("pickupCode", "==", code).limit(1).get();
      if (taken.empty) return code;
    }
    throw new Error("PICKUP_CODE_EXHAUSTED");
  }

  /* 期限を過ぎた取り置きを外す。 */
  async function sweepExpired(filter) {
    let q = db.collection(ORDERS).where("status", "==", "pending_payment");
    if (filter && filter.productId) q = q.where("productId", "==", filter.productId);
    const snap = await q.limit(200).get();
    const t = now();
    for (const d of snap.docs) {
      const o = d.data() || {};
      if (!(o.expiresAtMs < t)) continue;
      await db.runTransaction(async tx => {
        const [os, ps] = await Promise.all([tx.get(orderRef(d.id)), tx.get(productRef(o.productId))]);
        const cur = os.exists ? os.data() || {} : {};
        if (cur.status !== "pending_payment" || !(cur.expiresAtMs < now())) return;
        tx.set(orderRef(d.id), { status: "expired", expiredAtMs: now() }, { merge: true });
        if (ps.exists) tx.set(productRef(o.productId), { reserved: Math.max(0, Number(ps.data().reserved || 0) - 1) }, { merge: true });
      }).catch(() => { /* 次の機会に外す */ });
    }
  }

  /* 支払いが確かめられた。取り置きを売れたに移す。二度呼ばれても一度だけ効く。 */
  async function markPaid(orderId, patch) {
    return db.runTransaction(async tx => {
      const os = await tx.get(orderRef(orderId));
      if (!os.exists) throw err("ORDER_NOT_FOUND");
      const o = os.data() || {};
      if (["paid", "fulfilled", "refunded"].includes(o.status)) return { already: true, order: o };
      const [ps, us] = await Promise.all([
        tx.get(productRef(o.productId)),
        o.usageId ? tx.get(db.collection(USAGE).doc(o.usageId)) : Promise.resolve(null)
      ]);
      const p = ps.exists ? ps.data() || {} : {};
      const sold = Number(p.sold || 0) + 1;
      const reserved = o.status === "pending_payment" ? Math.max(0, Number(p.reserved || 0) - 1) : Number(p.reserved || 0);
      const productPatch = { sold, reserved };
      // 取り置きの期限を過ぎてから支払いが届くことがある。受け取ったお金は無かったことにしない。
      if (p.stock !== null && p.stock !== undefined && sold > Number(p.stock)) productPatch.oversold = true;
      tx.set(productRef(o.productId), productPatch, { merge: true });
      const next = { ...patch, status: "paid", paidAtMs: now(), lateAfterExpiry: o.status !== "pending_payment" };
      tx.set(orderRef(orderId), next, { merge: true });
      consumeUsage(tx, o, us);
      return { already: false, order: { ...o, ...next } };
    });
  }

  /* ───────── 利用者 ───────── */

  const shopRef = (id) => db.collection(SHOPS).doc(String(id));
  async function authoritativeStoreType(shopId) {
    if (shopId === CITY_OFFICIAL_SHOP_ID) return "schoolpark_virtual";
    if (!shopId) return "legacy";
    const snap = await shopRef(shopId).get();
    return snap.exists ? ((snap.data() || {}).storeType || "legacy") : "legacy";
  }
  function validateStoreProduct(product, storeType) {
    if (storeType === "schoolpark_virtual" && (product.prices.EMUER === null
        || product.prices.JPY !== null || product.prices.JPYC !== null || product.cashAtVenue)) throw err("VIRTUAL_STORE_EMUER_ONLY");
    if (storeType === "real_partner" && (product.prices.EMUER !== null
        || (product.prices.JPY === null && product.prices.JPYC === null))) throw err("PARTNER_STORE_FIAT_ONLY");
    return { ...product, storeType };
  }
  const publicShop = (id, x) => ({
      id, name: x.name, emoji: x.emoji || "\u{1F3EA}", category: x.category || "other",
    description: x.description || "", badge: x.badge || "", rating: Number(x.rating || 5),
    storeType: id === CITY_OFFICIAL_SHOP_ID ? "schoolpark_virtual" : (x.storeType || "legacy"),
    address: x.address || "", imageUrl: x.imageUrl || "", paymentGuide: x.paymentGuide || ""
  });

  /* 売っているショップ。誰でも読める（入る前の人にも見せる）。 */
  router.get("/shops", async (req, res) => {
    try {
      const snap = await db.collection(SHOPS).where("status", "==", "live").limit(100).get();
      const rows = snap.docs.map(d => ({ id: d.id, data: d.data() || {} }))
        .sort((a, b) => (a.data.sortOrder || 0) - (b.data.sortOrder || 0)
          || (a.data.createdAtMs || 0) - (b.data.createdAtMs || 0));
      const shops = rows.map(r => publicShop(r.id, r.data));
      if (!shops.some(s => s.id === CITY_OFFICIAL_SHOP_ID)) shops.unshift(publicShop(CITY_OFFICIAL_SHOP_ID, {
        name: "SchoolPark公式仮想店舗", emoji: "🏫", category: "other",
        description: "SchoolParkが運営するEMUER専用の商品交換店舗です。商品・価格・在庫は登録済みデータのみ表示します。",
        storeType: "schoolpark_virtual", status: "live", sortOrder: -10000
      }));
      return res.json({ ok: true, shops });
    } catch (e) { return fail(res, e); }
  });

  router.get("/products", async (req, res) => {
    try {
      const shopId = req.query.shopId ? String(req.query.shopId) : "";
      if (req.query.shopId && !/^[a-z0-9_-]{1,40}$/.test(shopId)) return res.status(400).json({ error: "INVALID_SHOP" });
      if (shopId && shopId !== CITY_OFFICIAL_SHOP_ID) {
        const shop = await shopRef(shopId).get();
        if (!shop.exists || (shop.data() || {}).status !== "live") return res.json({ ok: true, products: [], emuerActive: emuerEnabled() });
      }
      const snap = await db.collection(PRODUCTS).where("status", "==", "live").limit(100).get();
      const rows = snap.docs.map(d => ({ id: d.id, data: d.data() || {} }))
        .filter(r => !shopId || String(r.data.shopId || "") === shopId)
        .sort((a, b) => (a.data.sortOrder || 0) - (b.data.sortOrder || 0) || (a.data.createdAtMs || 0) - (b.data.createdAtMs || 0));
      const products = await Promise.all(rows.map(async r => {
        const type = await authoritativeStoreType(String(r.data.shopId || ""));
        return publicProduct(r.id, { ...r.data, storeType: type });
      }));
      return res.json({ ok: true, products, emuerActive: emuerEnabled() });
    } catch (e) { return fail(res, e); }
  });

  /* 自分が今どれだけ払えるか。EMUER の未変換残高と回数枠。 */
  async function spendableRewards(wallet) {
    const snap = await db.collection(REWARDS).where("recipient", "==", wallet).where("status", "==", "pending").limit(500).get();
    const t = now();
    return snap.docs
      .map(d => ({ id: d.id, data: d.data() || {} }))
      .filter(r => !(Number(r.data.authorizedUntilMs || 0) + AUTH_GRACE_MS > t))
      .filter(r => { try { return BigInt(String(r.data.amountWei || "0")) > 0n; } catch (_) { return false; } })
      .sort((a, b) => tsMs(a.data.createdAt) - tsMs(b.data.createdAt));
  }

  router.get("/me", deps.requireFirebaseUser, async (req, res) => {
    try {
      const wallet = String(req.identity.walletAddress || "").toLowerCase();
      let access = { ok: false, code: "EMUER_NOT_ACTIVE" };
      let unconverted = "0";
      if (emuerEnabled()) {
        access = await emuerAccess(req.identity);
        const rows = await spendableRewards(wallet);
        unconverted = emuerOf(rows.reduce((s, r) => s + BigInt(String(r.data.amountWei)), 0n));
      }
      return res.json({
        ok: true, isOwner: !!isOwner(req.identity), wallet,
        emuer: { ok: !!access.ok, error: access.code || null, plan: access.plan || null,
          used: access.used || 0, limit: access.period ? access.period.limit : null, unconverted }
      });
    } catch (e) { return fail(res, e); }
  });

  router.get("/orders", deps.requireFirebaseUser, async (req, res) => {
    try {
      const snap = await db.collection(ORDERS).where("uid", "==", req.identity.uid).limit(200).get();
      const passportId = deps.identity && await deps.identity.findByUid(req.identity.uid);
      const rows = snap.docs.map(d => ({ id: d.id, data: d.data() || {} }))
        .sort((a, b) => (b.data.createdAtMs || 0) - (a.data.createdAtMs || 0)).slice(0, 50);
      // Older Mitemiru orders predate Passport linkage. Project the current
      // server-resolved Passport ID into this authenticated user's response
      // without rewriting historical orders or accepting a client-supplied ID.
      return res.json({ ok: true, orders: rows.map(r => publicOrder(r.id,
        { ...r.data, passportId: r.data.passportId || passportId || null })) });
    } catch (e) { return fail(res, e); }
  });

  router.get("/orders/:id/digital-sticker", deps.requireFirebaseUser, async (req, res) => {
    try {
      const id = String(req.params.id || "");
      if (!/^[a-f0-9]{40}$/.test(id)) return res.status(404).json({ error: "ORDER_NOT_FOUND" });
      const snap = await orderRef(id).get();
      if (!snap.exists) return res.status(404).json({ error: "ORDER_NOT_FOUND" });
      const order = snap.data() || {};
      if (order.uid !== req.identity.uid) return res.status(404).json({ error: "ORDER_NOT_FOUND" });
      if (order.productId !== REIZO_STICKER_PRODUCT_ID || order.digitalAssetId !== REIZO_STICKER_ASSET_ID
          || order.storeType !== "schoolpark_virtual" || !["paid", "fulfilled"].includes(order.status)) {
        return res.status(409).json({ error: "DIGITAL_ASSET_NOT_AVAILABLE" });
      }
      res.set("Cache-Control", "private, no-store");
      return res.download(path.join(__dirname, "private-assets", `${REIZO_STICKER_ASSET_ID}.png`), "reizo-kun-sticker-v1.png");
    } catch (e) { return fail(res, e); }
  });

  router.post("/orders", deps.requireFirebaseUser, limited, async (req, res) => {
    const b = req.body || {};
    const method = String(b.method || "");
    const productId = String(b.productId || "");
    if (!METHODS[method]) return res.status(400).json({ error: "INVALID_METHOD" });
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(productId)) return res.status(404).json({ error: "PRODUCT_NOT_FOUND" });
    const identity = req.identity;
    const wallet = String(identity.walletAddress || "").toLowerCase();
    try {
      await sweepExpired({ productId });
      const ps = await productRef(productId).get();
      if (!ps.exists) throw err("PRODUCT_NOT_FOUND");
      const product = ps.data() || {};
      const storeType = await authoritativeStoreType(String(product.shopId || ""));
      product.storeType = storeType;
      if (storeType === "real_partner") throw err("PARTNER_CHECKOUT_NOT_READY");
      const requestId = String(b.requestId || "");
      if (storeType === "schoolpark_virtual" && !/^[A-Za-z0-9_-]{16,80}$/.test(requestId)) throw err("IDEMPOTENCY_KEY_REQUIRED");
      const id = storeType === "schoolpark_virtual"
        ? crypto.createHash("sha256").update(`${identity.uid}:${requestId}`).digest("hex").slice(0, 40)
        : crypto.randomBytes(12).toString("hex");
      let passportId = null;
      if (storeType === "schoolpark_virtual") {
        const prior = await orderRef(id).get();
        if (prior.exists) {
          const existing = prior.data() || {};
          if (existing.uid !== identity.uid || existing.productId !== productId || existing.method !== method) throw err("IDEMPOTENCY_KEY_CONFLICT");
          return res.json({ ok: true, order: publicOrder(id, existing), already: true });
        }
        passportId = deps.identity && await deps.identity.findByUid(identity.uid);
        const person = passportId && deps.identity.readIdentity ? await deps.identity.readIdentity(passportId) : null;
        if (!person || person.status !== "active") throw err("PASSPORT_LINK_REQUIRED");
      }
      if (product.status !== "live") throw err("NOT_FOR_SALE");
      if (!methodsFor(product).includes(method)) throw err("METHOD_NOT_AVAILABLE");
      if (remaining(product) === 0) throw err("SOLD_OUT");
      const currency = METHODS[method].currency;
      const amount = product.prices[currency];
      const pickupCode = await newPickupCode();
      const base = {
        uid: identity.uid, wallet, productId, productName: product.name, fulfillment: product.fulfillment,
        cancelPolicy: product.cancelPolicy, method, currency, amount, pickupCode, createdAtMs: now(),
        shopId: product.shopId || "", storeType,
        ...(product.digitalAssetId === REIZO_STICKER_ASSET_ID ? { digitalAssetId: REIZO_STICKER_ASSET_ID } : {}),
        ...(storeType === "schoolpark_virtual" ? { requestId } : {})
      };

      if (passportId) base.passportId = passportId;

      if (currency === "EMUER") {
        if (!emuerEnabled()) throw err("EMUER_NOT_ACTIVE");
        const access = await emuerAccess(identity);
        if (!access.ok) throw err(access.code, { plan: access.plan });
        base.plan = access.plan;
        base.usageId = access.usageId;
        base.usagePeriod = access.period.key;
      }

      if (method === "emuer_ledger") {
        const order = await payFromLedger(id, base, product, wallet);
        return res.json({ ok: true, order: publicOrder(id, order) });
      }

      if (method === "emuer_chain" || method === "jpyc") {
        if (!/^0x[0-9a-f]{40}$/.test(wallet)) throw err("WALLET_REQUIRED");
      }
      const hold = method === "jpy_cash" ? CASH_HOLD_MS : ONLINE_HOLD_MS;
      const order = { ...base, status: "pending_payment", expiresAtMs: now() + hold };
      let exchange = null;
      if (method === "emuer_chain") {
        if (!chain || !(await chain.signerReady())) throw err("AUTHORIZER_NOT_READY");
        order.chainOrderId = chainIdOf("mitemiru-order:" + id);
        order.chainProductId = chainIdOf("mitemiru-product:" + productId);
        order.amountWei = wei(amount);
        order.deadline = Math.floor(order.expiresAtMs / 1000);
      }
      if (method === "jpyc") {
        let decimals;
        try { decimals = await chain.jpycDecimals(); } catch (_) { throw err("CHAIN_UNAVAILABLE"); }
        if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 36) throw err("CHAIN_UNAVAILABLE");
        order.receiver = jpycReceiver;
        order.amountWei = (BigInt(amount) * 10n ** BigInt(decimals)).toString();
      }
      await reserve(id, order);
      try {
        if (method === "emuer_chain") {
          const authorization = await chain.signOrder({ orderId: order.chainOrderId, productId: order.chainProductId,
            buyer: wallet, priceWei: order.amountWei, deadline: order.deadline });
          exchange = { contract: EMUER_V2, chainId: CHAIN_ID, orderId: order.chainOrderId, productId: order.chainProductId,
            price: order.amountWei, deadline: order.deadline, authorization };
        }
        if (method === "jpy_card") {
          const session = await stripe.checkout.sessions.create({
            mode: "payment",
            payment_method_types: ["card"],
            line_items: [{ quantity: 1, price_data: { currency: "jpy", unit_amount: amount, product_data: { name: product.name } } }],
            client_reference_id: identity.uid,
            metadata: { kind: "mitemiru", orderId: id, productId },
            payment_intent_data: { metadata: { kind: "mitemiru", orderId: id } },
            expires_at: Math.floor((now() + 31 * 60 * 1000) / 1000),
            success_url: `${siteOrigin}/?billing=mitemiru`,
            cancel_url: `${siteOrigin}/?billing=mitemiru`
          });
          order.stripeSessionId = session.id;
          order.stripeUrl = session.url;
          await orderRef(id).set({ stripeSessionId: session.id, stripeUrl: session.url }, { merge: true });
        }
      } catch (e) {
        await release(id, "cancelled");
        throw (e && e.message === "AUTHORIZER_NOT_READY") ? e : err(method === "jpy_card" ? "CARD_UNAVAILABLE" : "AUTHORIZER_NOT_READY");
      }
      return res.json({ ok: true, order: publicOrder(id, order), exchange });
    } catch (e) { return fail(res, e); }
  });

  async function reserve(id, order) {
    await db.runTransaction(async tx => {
      const ps = await tx.get(productRef(order.productId));
      const p = ps.exists ? ps.data() || {} : null;
      if (!p || p.status !== "live") throw err("NOT_FOR_SALE");
      if (remaining(p) === 0) throw err("SOLD_OUT");
      tx.set(productRef(order.productId), { reserved: Number(p.reserved || 0) + 1 }, { merge: true });
      tx.create(orderRef(id), order);
    });
  }
  async function release(id, status) {
    await db.runTransaction(async tx => {
      const os = await tx.get(orderRef(id));
      const o = os.exists ? os.data() || {} : null;
      if (!o || o.status !== "pending_payment") return;
      const ps = await tx.get(productRef(o.productId));
      tx.set(orderRef(id), { status, closedAtMs: now() }, { merge: true });
      if (ps.exists) tx.set(productRef(o.productId), { reserved: Math.max(0, Number(ps.data().reserved || 0) - 1) }, { merge: true });
    });
  }

  /* 未変換の EMUER から払う。
     報酬1件ずつは、それぞれ鎖の上で受け取れる「請求権」になっている。
     払ったぶんは status を spent にして、二度と受け取りの署名を出さない。
     ただし直近に署名を出した報酬（authorizedUntilMs）はまだ使われうるので選ばない。
     多く取りすぎたぶんは、おつりとして新しい報酬にする。 */
  async function payFromLedger(id, base, product, wallet) {
    if (!/^0x[0-9a-f]{40}$/.test(wallet)) throw err("WALLET_REQUIRED");
    const priceWei = BigInt(wei(base.amount));
    const rows = await spendableRewards(wallet);
    const chosen = [];
    let total = 0n;
    for (const r of rows) {
      if (total >= priceWei) break;
      let paid;
      try { paid = chain ? await chain.claimPaid(String(r.data.claimId || r.id)) : null; } catch (_) { paid = null; }
      if (paid === null) throw err("CHAIN_UNAVAILABLE");
      if (paid > 0n) {
        // 鎖の上で（一部でも）受け取り済み。使えない
        await db.collection(REWARDS).doc(r.id).set({ status: paid >= BigInt(String(r.data.amountWei)) ? "claimed" : "pending" }, { merge: true }).catch(() => {});
        continue;
      }
      chosen.push(r.id);
      total += BigInt(String(r.data.amountWei));
    }
    if (total < priceWei) {
      const available = rows.reduce((s, r) => s + BigInt(String(r.data.amountWei)), 0n);
      throw err("INSUFFICIENT_EMUER", { available: emuerOf(available), price: String(base.amount) });
    }
    const change = total - priceWei;
    const changeKey = JSON.stringify(["emuer-v2", "mitemiru-change", id]);
    const changeId = change > 0n ? chainIdOf(changeKey) : null;
    const order = { ...base, status: "paid", paidAtMs: now(), spentRewardIds: chosen, spentWei: total.toString(),
      changeRewardId: changeId, changeWei: change.toString() };
    const result = await db.runTransaction(async tx => {
      const existingOrder = await tx.get(orderRef(id));
      if (existingOrder.exists) {
        const old = existingOrder.data() || {};
        if (old.uid !== base.uid || old.productId !== base.productId || old.method !== base.method) throw err("IDEMPOTENCY_KEY_CONFLICT");
        return { order: old, already: true };
      }
      const reads = [tx.get(productRef(base.productId))];
      if (base.usageId) reads.push(tx.get(db.collection(USAGE).doc(base.usageId)));
      const [ps, us] = await Promise.all(reads);
      const rewardSnaps = await Promise.all(chosen.map(rid => tx.get(db.collection(REWARDS).doc(rid))));
      const p = ps.exists ? ps.data() || {} : null;
      if (!p || p.status !== "live") throw err("NOT_FOR_SALE");
      if (remaining(p) === 0) throw err("SOLD_OUT");
      if (base.usageId) {
        const used = us && us.exists ? Number((us.data() || {}).used || 0) : 0;
        if (used >= 1) throw err("PERIOD_LIMIT_REACHED");
      }
      for (const s of rewardSnaps) {
        const r = s.exists ? s.data() || {} : {};
        if (!s.exists || r.status !== "pending" || String(r.recipient || "").toLowerCase() !== wallet
            || Number(r.authorizedUntilMs || 0) + AUTH_GRACE_MS > now()) throw err("INSUFFICIENT_EMUER");
      }
      chosen.forEach(rid => tx.set(db.collection(REWARDS).doc(rid),
        { status: "spent", spentOrderId: id, spentAtMs: now(), updatedAt: new Date() }, { merge: true }));
      if (changeId) {
        tx.create(db.collection(REWARDS).doc(changeId), {
          schema: "emuer-v2-reward-v1", kind: "mitemiru-change", key: changeKey, claimId: changeId,
          recipient: wallet, uid: base.uid, amountWei: change.toString(), amount: emuerOf(change),
          status: "pending", orderId: id, createdAt: new Date(), updatedAt: new Date()
        });
      }
      tx.set(productRef(base.productId), { sold: Number(p.sold || 0) + 1 }, { merge: true });
      tx.create(orderRef(id), order);
      consumeUsage(tx, order, us);
      return { order, already: false };
    });
    return result.order;
  }

  router.post("/orders/:id/confirm", deps.requireFirebaseUser, async (req, res) => {
    const id = String(req.params.id || "");
    try {
      const snap = await orderRef(id).get();
      const o = snap.exists ? snap.data() || {} : null;
      if (!o || o.uid !== req.identity.uid) throw err("ORDER_NOT_FOUND");
      if (["paid", "fulfilled"].includes(o.status)) return res.json({ ok: true, order: publicOrder(id, o) });
      if (!["pending_payment", "expired", "cancelled"].includes(o.status)) throw err("ORDER_NOT_PENDING");
      let patch;
      if (o.method === "emuer_chain") {
        if (!chain) throw err("CHAIN_UNAVAILABLE");
        let onChain;
        try { onChain = await chain.exchangeOrder(o.chainOrderId); } catch (_) { throw err("CHAIN_UNAVAILABLE"); }
        if (!onChain.buyer || /^0x0+$/.test(onChain.buyer)) throw err("CHAIN_PAYMENT_NOT_FOUND");
        if (onChain.buyer !== o.wallet || onChain.paid !== BigInt(o.amountWei)
            || onChain.productId !== String(o.chainProductId).toLowerCase()) throw err("CHAIN_PAYMENT_MISMATCH");
        patch = { chainConfirmed: true };
      } else if (o.method === "jpyc") {
        const txHash = String((req.body || {}).txHash || "").toLowerCase();
        if (!/^0x[0-9a-f]{64}$/.test(txHash)) throw err("INVALID_TX_HASH");
        const transfer = await findTransfer(txHash, o.wallet, o.receiver, BigInt(o.amountWei));
        await db.runTransaction(async tx => {
          const ref = db.collection(CHAIN_PAYMENTS).doc(`${txHash}:${transfer.logIndex}`);
          const used = await tx.get(ref);
          if (used.exists) {
            if ((used.data() || {}).orderId === id) return;
            throw err("TX_ALREADY_USED");
          }
          tx.create(ref, { orderId: id, kind: "jpyc-payment", createdAtMs: now() });
        });
        patch = { txHash };
      } else if (o.method === "jpy_card") {
        if (!stripe) throw err("CARD_UNAVAILABLE");
        const session = await stripe.checkout.sessions.retrieve(o.stripeSessionId);
        if (!session || session.payment_status !== "paid" || (session.metadata || {}).orderId !== id) throw err("CARD_NOT_PAID");
        patch = { paymentIntent: typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent || {}).id || null };
      } else {
        // 現金は運営が会場で記録する
        throw err("ORDER_NOT_PENDING");
      }
      const result = await markPaid(id, patch);
      return res.json({ ok: true, order: publicOrder(id, result.order) });
    } catch (e) { return fail(res, e); }
  });

  async function findTransfer(txHash, from, to, value) {
    if (!chain) throw err("CHAIN_UNAVAILABLE");
    let info;
    try { info = await chain.tokenTransfers(txHash, JPYC); } catch (_) { throw err("CHAIN_UNAVAILABLE"); }
    if (!info.found) throw err("TX_NOT_FOUND");
    if (!info.ok) throw err("TX_FAILED");
    if (info.confirmations < JPYC_CONFIRMATIONS) throw err("TX_PENDING");
    const hit = info.transfers.find(t => t.from === from && t.to === to && t.value === value);
    if (!hit) throw err("TRANSFER_NOT_FOUND");
    return hit;
  }

  /* 再び署名を出す（画面を閉じてしまったときなど）。 */
  router.post("/orders/:id/exchange-authorization", deps.requireFirebaseUser, async (req, res) => {
    const id = String(req.params.id || "");
    try {
      const snap = await orderRef(id).get();
      const o = snap.exists ? snap.data() || {} : null;
      if (!o || o.uid !== req.identity.uid || o.method !== "emuer_chain") throw err("ORDER_NOT_FOUND");
      if (o.status !== "pending_payment") throw err("ORDER_NOT_PENDING");
      if (o.expiresAtMs < now()) throw err("ORDER_EXPIRED");
      if (!chain || !(await chain.signerReady())) throw err("AUTHORIZER_NOT_READY");
      const authorization = await chain.signOrder({ orderId: o.chainOrderId, productId: o.chainProductId,
        buyer: o.wallet, priceWei: o.amountWei, deadline: o.deadline });
      return res.json({ ok: true, exchange: { contract: EMUER_V2, chainId: CHAIN_ID, orderId: o.chainOrderId,
        productId: o.chainProductId, price: o.amountWei, deadline: o.deadline, authorization } });
    } catch (e) { return fail(res, e); }
  });

  router.post("/orders/:id/cancel", deps.requireFirebaseUser, async (req, res) => {
    const id = String(req.params.id || "");
    try {
      const snap = await orderRef(id).get();
      const o = snap.exists ? snap.data() || {} : null;
      if (!o || o.uid !== req.identity.uid) throw err("ORDER_NOT_FOUND");
      if (o.status !== "pending_payment") throw err("ORDER_NOT_PENDING");
      // 鎖の上で払い終えているのに取り消すと、お金だけ消える。先に確かめる
      if (o.method === "emuer_chain" && chain) {
        const onChain = await chain.exchangeOrder(o.chainOrderId).catch(() => null);
        if (!onChain) throw err("CHAIN_UNAVAILABLE");
        if (onChain.buyer && !/^0x0+$/.test(onChain.buyer)) throw err("ALREADY_DONE");
      }
      if (o.method === "jpy_card" && stripe && o.stripeSessionId) {
        const session = await stripe.checkout.sessions.retrieve(o.stripeSessionId).catch(() => null);
        if (session && session.payment_status === "paid") throw err("ALREADY_DONE");
        if (session && session.status === "open") await stripe.checkout.sessions.expire(o.stripeSessionId).catch(() => {});
      }
      await release(id, "cancelled");
      return res.json({ ok: true });
    } catch (e) { return fail(res, e); }
  });

  /* Stripe の Webhook（billing.js から渡される）。扱ったら true。 */
  async function handleStripeEvent(event) {
    if (!event || event.type !== "checkout.session.completed") return false;
    const s = event.data && event.data.object;
    if (!s || !s.metadata || s.metadata.kind !== "mitemiru") return false;
    if (s.payment_status !== "paid") return true;
    const orderId = String(s.metadata.orderId || "");
    const snap = await orderRef(orderId).get();
    if (!snap.exists || (snap.data() || {}).stripeSessionId !== s.id) return true;
    await markPaid(orderId, { paymentIntent: typeof s.payment_intent === "string" ? s.payment_intent : null });
    return true;
  }

  /* ───────── 運営 ───────── */
  const owner = deps.requireOwner;

  router.get("/admin/products", owner, async (req, res) => {
    try {
      const snap = await db.collection(PRODUCTS).limit(300).get();
      const rows = snap.docs.map(d => ({ id: d.id, ...(d.data() || {}) }))
        .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || (b.createdAtMs || 0) - (a.createdAtMs || 0));
      return res.json({ ok: true, products: rows.map(p => ({ ...p, remaining: remaining(p), methods: methodsFor(p) })),
        cardReady: !!stripe, emuerActive: emuerEnabled(), jpycReceiver });
    } catch (e) { return fail(res, e); }
  });

  router.post("/admin/city/reizo-sticker", owner, async (req, res) => {
    try {
      const ref = productRef(REIZO_STICKER_PRODUCT_ID);
      const existing = await ref.get();
      if (existing.exists) {
        const row = existing.data() || {};
        if (row.digitalAssetId !== REIZO_STICKER_ASSET_ID || row.shopId !== CITY_OFFICIAL_SHOP_ID) throw err("PRODUCT_ALREADY_EXISTS");
        return res.json({ ok: true, already: true, product: { id: REIZO_STICKER_PRODUCT_ID, ...row } });
      }
      const row = {
        name: "冷蔵庫くんのデジタルステッカー",
        description: "SchoolPark公式キャラクターの透過PNGステッカー。初期交換価格は運営確認用の1 EMUERです。",
        imageUrl: "https://schoolpark.jp/assets/mascot.jpg",
        prices: { EMUER: 1, JPYC: null, JPY: null },
        cashAtVenue: false, stock: null, sold: 0, reserved: 0,
        status: "draft", fulfillment: "交換確定後、注文履歴からPNGをダウンロードできます。",
        cancelPolicy: "公開前に運営者が取消・返金条件を確認してください。",
        shopId: CITY_OFFICIAL_SHOP_ID, storeType: "schoolpark_virtual", emoji: "🧊",
        sortOrder: -100, digitalAssetId: REIZO_STICKER_ASSET_ID,
        createdAtMs: now(), updatedAtMs: now(), createdBy: req.identity.uid
      };
      await ref.create(row);
      return res.json({ ok: true, already: false, product: { id: REIZO_STICKER_PRODUCT_ID, ...row } });
    } catch (e) { return fail(res, e); }
  });

  router.get("/admin/products/:id/event-qr", owner, async (req, res) => {
    try {
      const id = String(req.params.id || "");
      const snap = await productRef(id).get();
      if (!snap.exists) throw err("PRODUCT_NOT_FOUND");
      const product = snap.data() || {};
      if (product.status !== "live" || await authoritativeStoreType(String(product.shopId || "")) !== "schoolpark_virtual") {
        throw err("EVENT_QR_PRODUCT_NOT_READY");
      }
      let target;
      try {
        if (!env.CITY_PUBLIC_URL) throw new Error("missing");
        target = new URL(env.CITY_PUBLIC_URL);
      }
      catch (_) { throw err("EVENT_QR_CONFIG_INVALID"); }
      if (target.protocol !== "https:" || target.username || target.password) throw err("EVENT_QR_CONFIG_INVALID");
      target.searchParams.set("cityProductId", id);
      const QRCode = require("qrcode");
      const dataUrl = await QRCode.toDataURL(target.href, { errorCorrectionLevel: "M", margin: 2, width: 640 });
      return res.json({ ok: true, productId: id, productName: product.name, url: target.href, image: dataUrl });
    } catch (e) { return fail(res, e); }
  });

  router.post("/admin/products", owner, async (req, res) => {
    try {
      const clean = cleanProduct(req.body, null);
      const authoritative = validateStoreProduct(clean, await authoritativeStoreType(clean.shopId));
      const id = "p_" + crypto.randomBytes(6).toString("hex");
      const row = { ...authoritative, sold: 0, reserved: 0, createdAtMs: now(), updatedAtMs: now(), createdBy: req.identity.uid };
      await productRef(id).create(row);
      return res.json({ ok: true, product: { id, ...row } });
    } catch (e) { return fail(res, e); }
  });

  router.put("/admin/products/:id", owner, async (req, res) => {
    const id = String(req.params.id || "");
    try {
      let out;
      await db.runTransaction(async tx => {
        const s = await tx.get(productRef(id));
        if (!s.exists) throw err("PRODUCT_NOT_FOUND");
        const prev = s.data() || {};
        const clean = cleanProduct(req.body, prev);
        const authoritative = validateStoreProduct(clean, await authoritativeStoreType(clean.shopId));
        // 在庫は、すでに売れた・取り置き中の数より少なくできない
        if (clean.stock !== null && clean.stock < Number(prev.sold || 0) + Number(prev.reserved || 0)) throw err("INVALID_STOCK");
        out = { ...prev, ...authoritative, updatedAtMs: now() };
        tx.set(productRef(id), { ...authoritative, updatedAtMs: now() }, { merge: true });
      });
      return res.json({ ok: true, product: { id, ...out } });
    } catch (e) { return fail(res, e); }
  });

  router.get("/admin/shops", owner, async (req, res) => {
    try {
      const snap = await db.collection(SHOPS).limit(300).get();
      const rows = snap.docs.map(d => ({ id: d.id, ...(d.data() || {}) }))
        .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || (b.createdAtMs || 0) - (a.createdAtMs || 0));
      rows.unshift({ id: CITY_OFFICIAL_SHOP_ID, name: "SchoolPark公式仮想店舗", emoji: "🏫", category: "other",
        description: "SchoolParkが運営するEMUER専用の商品交換店舗です。", status: "live",
        storeType: "schoolpark_virtual", virtual: true, address: "" });
      return res.json({ ok: true, shops: rows });
    } catch (e) { return fail(res, e); }
  });

  router.post("/admin/shops", owner, async (req, res) => {
    try {
      const clean = cleanShop(req.body, null);
      /* 名前から読める id を作る。使われていたら後ろに数を足す。
         id は商品が指す先なので、あとから変えられない。 */
      const wanted = slug(req.body && req.body.id, 40) || "s_" + crypto.randomBytes(5).toString("hex");
      if (wanted === CITY_OFFICIAL_SHOP_ID) throw err("RESERVED_SHOP_ID");
      let id = wanted;
      for (let i = 2; i <= 20; i += 1) {
        if (!(await shopRef(id).get()).exists) break;
        id = wanted + "-" + i;
      }
      const row = { ...clean, createdAtMs: now(), updatedAtMs: now(), createdBy: req.identity.uid };
      await shopRef(id).create(row);
      return res.json({ ok: true, shop: { id, ...row } });
    } catch (e) { return fail(res, e); }
  });

  router.put("/admin/shops/:id", owner, async (req, res) => {
    const id = String(req.params.id || "");
    try {
      if (id === CITY_OFFICIAL_SHOP_ID) throw err("RESERVED_SHOP_ID");
      const snap = await shopRef(id).get();
      if (!snap.exists) throw err("SHOP_NOT_FOUND");
      const clean = cleanShop(req.body, snap.data() || {});
      await shopRef(id).set({ ...clean, updatedAtMs: now() }, { merge: true });
      return res.json({ ok: true, shop: { id, ...(snap.data() || {}), ...clean } });
    } catch (e) { return fail(res, e); }
  });

  /* ショップを閉じる。消さずに ended にする。
     商品がぶら下がったまま消すと、注文の記録から店名を引けなくなる。 */
  router.delete("/admin/shops/:id", owner, async (req, res) => {
    const id = String(req.params.id || "");
    try {
      if (id === CITY_OFFICIAL_SHOP_ID) throw err("RESERVED_SHOP_ID");
      const snap = await shopRef(id).get();
      if (!snap.exists) throw err("SHOP_NOT_FOUND");
      await shopRef(id).set({ status: "ended", updatedAtMs: now() }, { merge: true });
      return res.json({ ok: true, id, status: "ended" });
    } catch (e) { return fail(res, e); }
  });

  router.get("/admin/orders", owner, async (req, res) => {
    try {
      await sweepExpired(null);
      const code = String(req.query.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      const status = String(req.query.status || "");
      let q;
      if (code) q = db.collection(ORDERS).where("pickupCode", "==", code).limit(5);
      else if (STATUS.includes(status)) q = db.collection(ORDERS).where("status", "==", status).limit(300);
      else q = db.collection(ORDERS).limit(500);
      const snap = await q.get();
      const rows = snap.docs.map(d => ({ id: d.id, ...(d.data() || {}) }))
        .sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0)).slice(0, 300)
        .map(o => ({ id: o.id, productId: o.productId, productName: o.productName, shopId: o.shopId || "",
          storeType: o.storeType || "legacy", passportId: o.passportId || null, method: o.method, currency: o.currency,
          amount: o.amount, status: o.status, pickupCode: o.pickupCode, wallet: o.wallet, uid: o.uid,
          createdAt: o.createdAtMs, paidAt: o.paidAtMs || null, fulfilledAt: o.fulfilledAtMs || null,
          refundedAt: o.refundedAtMs || null, expiresAt: o.expiresAtMs || null, txHash: o.txHash || null,
          chainOrderId: o.chainOrderId || null, lateAfterExpiry: !!o.lateAfterExpiry }));
      return res.json({ ok: true, orders: rows });
    } catch (e) { return fail(res, e); }
  });

  /* 会場で現金を受け取った。fulfill:true なら、その場で渡したことにする。 */
  router.post("/admin/orders/:id/cash-paid", owner, async (req, res) => {
    const id = String(req.params.id || "");
    try {
      const snap = await orderRef(id).get();
      const o = snap.exists ? snap.data() || {} : null;
      if (!o) throw err("ORDER_NOT_FOUND");
      if (o.method !== "jpy_cash") throw err("INVALID_METHOD");
      const result = await markPaid(id, { cashReceivedBy: req.identity.uid });
      if ((req.body || {}).fulfill === true) await fulfill(id, req.identity.uid);
      const fresh = (await orderRef(id).get()).data();
      return res.json({ ok: true, order: { id, ...fresh }, already: result.already });
    } catch (e) { return fail(res, e); }
  });

  async function fulfill(id, by) {
    return db.runTransaction(async tx => {
      const s = await tx.get(orderRef(id));
      const o = s.exists ? s.data() || {} : null;
      if (!o) throw err("ORDER_NOT_FOUND");
      if (o.status === "fulfilled") return { already: true, order: o };
      if (o.status !== "paid") throw err("NOT_PAID");
      const patch = { status: "fulfilled", fulfilledAtMs: now(), fulfilledBy: by };
      tx.set(orderRef(id), patch, { merge: true });
      return { already: false, order: { ...o, ...patch } };
    });
  }

  router.post("/admin/orders/:id/fulfill", owner, async (req, res) => {
    const id = String(req.params.id || "");
    try {
      const delivered = await fulfill(id, req.identity.uid);
      const fresh = (await orderRef(id).get()).data();
      return res.json({ ok: true, already: delivered.already, order: { id, ...fresh } });
    } catch (e) { return fail(res, e); }
  });

  /* 返金。運営都合のときに使う。元の支払い額を全額、元の方法で返す。
     EMUER の回数消費も取り消す。商品の在庫は戻す。 */
  router.post("/admin/orders/:id/refund", owner, async (req, res) => {
    const id = String(req.params.id || "");
    const b = req.body || {};
    try {
      const snap = await orderRef(id).get();
      const o = snap.exists ? snap.data() || {} : null;
      if (!o) throw err("ORDER_NOT_FOUND");
      if (o.status === "refunded") throw err("ALREADY_DONE");
      if (!["paid", "fulfilled"].includes(o.status)) throw err("NOT_REFUNDABLE");
      const patch = { refundNote: text(b.note, 300) };
      let refundReward = null;
      if (o.method === "emuer_chain") {
        const onChain = chain ? await chain.exchangeOrder(o.chainOrderId).catch(() => null) : null;
        if (!onChain) throw err("CHAIN_UNAVAILABLE");
        if (!onChain.refunded) throw err("CHAIN_REFUND_NOT_CONFIRMED", { chainOrderId: o.chainOrderId });
      } else if (o.method === "jpyc") {
        const txHash = String(b.txHash || "").toLowerCase();
        if (!/^0x[0-9a-f]{64}$/.test(txHash)) throw err("INVALID_TX_HASH");
        const transfer = await findTransfer(txHash, o.receiver, o.wallet, BigInt(o.amountWei));
        patch.refundTxHash = txHash;
        patch.refundLog = `${txHash}:${transfer.logIndex}`;
      } else if (o.method === "jpy_card") {
        if (!stripe || !o.paymentIntent) throw err("CARD_UNAVAILABLE");
        const r = await stripe.refunds.create({ payment_intent: o.paymentIntent, metadata: { kind: "mitemiru", orderId: id } },
          { idempotencyKey: `mitemiru-refund-${id}` });
        patch.stripeRefundId = r.id;
      } else if (o.method === "emuer_ledger") {
        const key = JSON.stringify(["emuer-v2", "mitemiru-refund", id]);
        refundReward = { id: chainIdOf(key), key };
      }
      // jpy_cash は手渡しで返す。記録だけ残す
      await db.runTransaction(async tx => {
        const os = await tx.get(orderRef(id));
        const ps = await tx.get(productRef(o.productId));
        const usageSnap = o.usageId ? await tx.get(db.collection(USAGE).doc(o.usageId)) : null;
        const usedLog = patch.refundLog ? await tx.get(db.collection(CHAIN_PAYMENTS).doc(patch.refundLog)) : null;
        const cur = os.exists ? os.data() || {} : {};
        if (cur.status === "refunded") throw err("ALREADY_DONE");
        if (usedLog && usedLog.exists) throw err("TX_ALREADY_USED");
        if (patch.refundLog) tx.create(db.collection(CHAIN_PAYMENTS).doc(patch.refundLog), { orderId: id, kind: "jpyc-refund", createdAtMs: now() });
        tx.set(orderRef(id), { ...patch, status: "refunded", refundedAtMs: now(), refundedBy: req.identity.uid,
          refundRewardId: refundReward ? refundReward.id : null }, { merge: true });
        if (ps.exists) tx.set(productRef(o.productId), { sold: Math.max(0, Number(ps.data().sold || 0) - 1) }, { merge: true });
        if (o.usageId && usageSnap && usageSnap.exists) {
          tx.set(db.collection(USAGE).doc(o.usageId), { used: Math.max(0, Number((usageSnap.data() || {}).used || 0) - 1), updatedAt: new Date() }, { merge: true });
        }
        if (refundReward) {
          tx.create(db.collection(REWARDS).doc(refundReward.id), {
            schema: "emuer-v2-reward-v1", kind: "mitemiru-refund", key: refundReward.key, claimId: refundReward.id,
            recipient: o.wallet, uid: o.uid, amountWei: wei(o.amount), amount: String(o.amount),
            status: "pending", orderId: id, createdAt: new Date(), updatedAt: new Date()
          });
        }
      });
      const fresh = (await orderRef(id).get()).data();
      return res.json({ ok: true, order: { id, ...fresh } });
    } catch (e) { return fail(res, e); }
  });

  return { router, handleStripeEvent, markPaid, sweepExpired };
}

module.exports = { createMitemiruRouter, createChainAdapter, cleanProduct, emuerOf, METHODS, JPYC, EMUER_V2, TREASURY };
