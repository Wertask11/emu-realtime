"use strict";
/* 体験チケット（11/10）。公式ショップ・提携店で交換した「その場で受け取る」品（pickup・online）を、
   QR のチケットとして見せて、お店の人が「使用済み」にできるようにする。

   流れ
   1. 交換した人が、交換履歴の「🎫 チケットを出す」で QR を出す。
      QR の中身は /ticket.html?o=注文ID&c=引換コード（どちらも交換した本人にしか見えない）。
   2. お店の人がカメラで読むと、チケットのページが開く（商品名・店名・未使用／使用済みだけを出す。個人の情報は出さない）。
   3. お店の人がお店の暗証番号を入れて「使用済みにする」を押す。注文は「受け取り済み」（fulfilled）になる。
      運営画面の「渡した」と同じ動き（mitemiru.js の fulfill と同じ形で書く）。二度は使えない。

   暗証番号は、運営がお店ごとに決める（運営画面）。保存するのはハッシュだけ（mitemiru_ticket_staff・サーバー専用）。
   間違いが続いたら、その注文はしばらく受け付けない。 */
const crypto = require("node:crypto");
const express = require("express");

const ORDERS = "mitemiru_orders";
const PRODUCTS = "mitemiru_products";
const SHOPS = "mitemiru_shops";
const STAFF = "mitemiru_ticket_staff";
const OFFICIAL_SHOP_ID = "schoolpark-official";
const ID = /^[A-Za-z0-9_-]{1,120}$/;
const CODE = /^[A-Z0-9]{4,12}$/;
const PIN = /^\d{4,8}$/;
const TICKET_MODES = ["pickup", "online"];

function err(code, status = 400) { return Object.assign(new Error(code), { code, status }); }
function hashPin(pin, salt) { return crypto.scryptSync(String(pin), salt, 32).toString("hex"); }
function same(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function createTicketRouter({ db, requireOwner, now = () => Date.now() }) {
  const router = express.Router();
  router.use(express.json({ limit: "4kb" }));
  router.use((req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
  const misses = new Map();   // 注文ID → { count, until }

  function fail(res, e) {
    if (e && e.code && e.status) return res.status(e.status).json({ error: e.code });
    console.warn("shop-tickets:", e && e.message);
    return res.status(500).json({ error: "TICKET_FAILED" });
  }
  function delivery(o) { return o.delivery || (o.digitalAssetId ? "digital" : "pickup"); }

  async function load(orderId, code) {
    if (!ID.test(orderId) || !CODE.test(code)) throw err("TICKET_NOT_FOUND", 404);
    const s = await db.collection(ORDERS).doc(orderId).get();
    const o = s.exists ? s.data() || {} : null;
    if (!o || !o.pickupCode || !same(o.pickupCode, code) || !["paid", "fulfilled"].includes(o.status)
        || !TICKET_MODES.includes(delivery(o))) throw err("TICKET_NOT_FOUND", 404);
    return o;
  }
  async function view(o) {
    const shopId = String(o.shopId || OFFICIAL_SHOP_ID);
    const shop = await db.collection(SHOPS).doc(shopId).get();
    const shopName = shop.exists ? String((shop.data() || {}).name || "") : shopId === OFFICIAL_SHOP_ID ? "SchoolPark公式ショップ" : "";
    return {
      productName: String(o.productName || ""), choice: String(o.choice || ""), shopName,
      status: o.status === "fulfilled" ? "used" : "unused", usedAt: o.fulfilledAtMs || null,
      delivery: delivery(o), code: String(o.pickupCode || "")
    };
  }

  /* チケットを見る。注文IDと引換コードの両方が合ったときだけ。 */
  router.get("/:orderId", async (req, res) => {
    try {
      const o = await load(String(req.params.orderId || ""), String(req.query.c || "").toUpperCase());
      return res.json({ ok: true, ticket: await view(o) });
    } catch (e) { return fail(res, e); }
  });

  /* お店の人が「使用済み」にする。お店の暗証番号が要る。 */
  router.post("/:orderId/use", async (req, res) => {
    const orderId = String(req.params.orderId || "");
    try {
      const block = misses.get(orderId);
      if (block && block.until > now()) throw err("TOO_MANY_TRIES", 429);
      const b = req.body || {};
      const o = await load(orderId, String(b.code || "").toUpperCase());
      const shopId = String(o.shopId || OFFICIAL_SHOP_ID);
      const staff = await db.collection(STAFF).doc(shopId).get();
      const st = staff.exists ? staff.data() || {} : null;
      if (!st || !st.pinHash || !st.salt) throw err("STAFF_PIN_NOT_SET", 409);
      if (!PIN.test(String(b.pin || "")) || !same(hashPin(b.pin, st.salt), st.pinHash)) {
        const m = misses.get(orderId) || { count: 0, until: 0 };
        m.count += 1;
        if (m.count >= 5) { m.until = now() + 10 * 60 * 1000; m.count = 0; }
        misses.set(orderId, m);
        throw err("WRONG_PIN", 403);
      }
      misses.delete(orderId);
      const ref = db.collection(ORDERS).doc(orderId);
      const result = await db.runTransaction(async (tx) => {
        const s = await tx.get(ref);
        const cur = s.exists ? s.data() || {} : null;
        if (!cur) throw err("TICKET_NOT_FOUND", 404);
        if (cur.status === "fulfilled") return { already: true, order: cur };
        if (cur.status !== "paid") throw err("NOT_PAID", 409);
        const patch = { status: "fulfilled", fulfilledAtMs: now(), fulfilledBy: "ticket-staff:" + shopId };
        tx.set(ref, patch, { merge: true });
        return { already: false, order: { ...cur, ...patch } };
      });
      if (result.already) return res.status(409).json({ error: "ALREADY_USED", ticket: await view(result.order) });
      return res.json({ ok: true, ticket: await view(result.order) });
    } catch (e) { return fail(res, e); }
  });

  /* 運営：お店の暗証番号を決める・確かめる（番号そのものは返さない）。 */
  router.get("/admin/staff", requireOwner, async (req, res) => {
    try {
      const snap = await db.collection(STAFF).limit(100).get();
      return res.json({ ok: true, shops: snap.docs.map((d) => ({ shopId: d.id, updatedAt: (d.data() || {}).updatedAtMs || null })) });
    } catch (e) { return fail(res, e); }
  });
  router.post("/admin/staff/:shopId", requireOwner, async (req, res) => {
    try {
      const shopId = String(req.params.shopId || "");
      if (!ID.test(shopId)) throw err("SHOP_NOT_FOUND", 404);
      const pin = String((req.body || {}).pin || "");
      if (!PIN.test(pin)) throw err("PIN_4_TO_8_DIGITS");
      if (shopId !== OFFICIAL_SHOP_ID && !(await db.collection(SHOPS).doc(shopId).get()).exists) throw err("SHOP_NOT_FOUND", 404);
      const salt = crypto.randomBytes(16).toString("hex");
      await db.collection(STAFF).doc(shopId).set({ salt, pinHash: hashPin(pin, salt), updatedAtMs: now(), updatedBy: req.identity.uid });
      return res.json({ ok: true, shopId });
    } catch (e) { return fail(res, e); }
  });

  return router;
}

module.exports = { createTicketRouter };
