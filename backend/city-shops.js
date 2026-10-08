"use strict";

// Reviewed server-side configuration, never shopper-supplied destinations/prices.
// External checkout owns payment, stock, shipping and receipts. Opening a link
// is NOT a paid order and must never award EMUER, stars or purchase records.
const DEFAULT_CATALOG = require("./city-shops.json");
// A City partner checkout is a real merchant payment destination. EMUER is
// reserved for the SchoolPark virtual shop and can never be routed here.
const METHODS = new Set(["JPY", "JPYC"]);
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const text = (value, max = 300) => typeof value === "string" ? value.slice(0, max) : "";

function checkoutFor(shop, product) {
  const c = product?.checkout, m = shop?.merchant;
  if (shop?.status !== "live" || !c || c.enabled !== true || !m
      || !text(m.name) || !text(m.fulfillment) || !text(m.refundPolicy)
      || !text(m.contact) || !Array.isArray(c.methods) || !c.methods.length
      || c.methods.some(method => !METHODS.has(method))) return null;
  try {
    const url = new URL(c.url);
    // No URL from a request; HTTPS and an explicit merchant host allowlist only.
    if (url.protocol !== "https:" || url.username || url.password || url.port
        || !Array.isArray(shop.checkoutHosts) || !shop.checkoutHosts.includes(url.hostname)
        || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(url.hostname)
        || /(^|\.)(localhost|local|internal|example|invalid|test)$/.test(url.hostname)
        || /(^|\.)(example\.com|example\.org|example\.net)$/.test(url.hostname)) return null;
    return { url:url.href, host:url.hostname, methods:[...c.methods] };
  } catch (_) { return null; }
}

function publicCatalog(catalog = DEFAULT_CATALOG) {
  return {
    ok:true, schema:"schoolpark-city-shops-v1", goal:text(catalog.goal),
    partnerSlots:(catalog.partnerSlots || []).slice(0, 2).map(s => ({id:text(s.id,64),name:text(s.name,80),status:s.status === "live" ? "live" : "recruiting"})),
    shops:(catalog.shops || []).slice(0, 10).filter(s => ID.test(s.id)).map(s => ({
      id:s.id, name:text(s.name,80), subtitle:text(s.subtitle,120), description:text(s.description),
      status:s.status === "live" ? "live" : "demo", checkinSpotId:text(s.checkinSpotId,64),
      products:(s.products || []).slice(0, 40).filter(p => ID.test(p.id)).map(p => {
        const checkout = checkoutFor(s,p);
        return { id:p.id, name:text(p.name,80), description:text(p.description),
          kind:["notebook","mug","tote","coffee"].includes(p.kind) ? p.kind : "notebook",
          color:/^#[0-9a-f]{6}$/i.test(p.color) ? p.color : "#355a48",
          priceJPY:Number.isSafeInteger(p.priceJPY) && p.priceJPY >= 0 ? p.priceJPY : null,
          priceLabel:text(p.priceLabel,80), checkoutEnabled:!!checkout,
          paymentMethods:checkout?.methods || [] };
      })
    }))
  };
}

function attachShopRoutes(router, { limited, catalog = DEFAULT_CATALOG }) {
  router.get("/shops", (req,res) => {
    if (Object.keys(req.query || {}).length) return res.status(400).json({error:"UNEXPECTED_FIELDS"});
    return res.json(publicCatalog(catalog));
  });
  router.post("/shops/checkout", limited("schoolpark-city-checkout",5), (req,res) => {
    const b = req.body;
    if (!b || Array.isArray(b) || typeof b !== "object" || Object.keys(b).length !== 2
        || Object.keys(b).some(k => !["shopId","productId"].includes(k))
        || typeof b.shopId !== "string" || typeof b.productId !== "string"
        || !ID.test(b.shopId) || !ID.test(b.productId) || Object.keys(req.query || {}).length) {
      return res.status(400).json({error:"UNEXPECTED_FIELDS"});
    }
    const shop = (catalog.shops || []).find(s => s.id === b.shopId);
    const product = shop?.products?.find(p => p.id === b.productId);
    if (!product) return res.status(404).json({error:"PRODUCT_NOT_FOUND"});
    const checkout = checkoutFor(shop,product);
    if (!checkout) return res.status(409).json({error:"SHOP_CHECKOUT_NOT_READY"});
    return res.json({ok:true, status:"external_checkout", ...checkout,
      shopId:shop.id, productId:product.id, productName:text(product.name,80),
      merchant:{name:text(shop.merchant.name,100),fulfillment:text(shop.merchant.fulfillment),
        refundPolicy:text(shop.merchant.refundPolicy),contact:text(shop.merchant.contact)},
      notice:"店舗の決済ページで数量・最終金額・受取方法を確認してください。Cityでは支払い完了を確定しません。"});
  });
}

module.exports = { attachShopRoutes, publicCatalog, checkoutFor, DEFAULT_CATALOG };
