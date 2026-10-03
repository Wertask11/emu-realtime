"use strict";

const express = require("express");
const { isSchoolParkId } = require("./identity");
const { decideSchoolParkAccess } = require("./schoolpark-access");

/* Versioned, operator-owned catalogue. Partner shops and their reviewed
 * external checkout destinations are managed separately in city-shops.js. */
const SPOTS = Object.freeze([
  {
    spotId: "demo-book", name: "BOOK SPOT", type: "experience",
    description: "知らない分野の本をひらく、現実の学びの入口。提携施設ではない体験例です。",
    category: ["LEARN"], locationType: "REAL", image: null,
    questId: null, guildId: "learn", checkInType: "demo", status: "demo",
    experience: "知らない分野の本を1冊開こう", destination: null
  },
  {
    spotId: "demo-cafe", name: "CAFE SPOT", type: "experience",
    description: "問いと向き合う時間を、いつもの街で。実在する提携店舗の案内ではありません。",
    category: ["LEARN", "CONNECT"], locationType: "REAL", image: null,
    questId: null, guildId: "connect", checkInType: "demo", status: "demo",
    experience: "30分、自分の問いを探究しよう", destination: null
  },
  {
    spotId: "schoolpark-lab", name: "SchoolPark Lab", type: "lab",
    description: "Cityを探索し、気づきを次の体験につなぐ小さなVirtual Spot。",
    category: ["CREATE", "EXPERIENCE"], locationType: "VIRTUAL", image: null,
    questId: null, guildId: "web3", checkInType: "virtual-entry", status: "demo",
    experience: "SchoolPark Cityを探索してみよう", destination: { kind: "city-showroom" }
  }
].map(s => Object.freeze({ ...s, category: Object.freeze(s.category) })));

const PAGE_SIZE = 50;
const jstDay = ms => new Date(ms + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
const checkinPath = spid => "sp_identities/" + spid + "/city_checkins";

// Explicit projection: never return uid, auth links, addresses or arbitrary DB fields.
function checkinView(id, data) {
  return {
    id, spotId: data.spotId, locationType: data.locationType,
    checkInType: data.checkInType, isDemo: data.isDemo === true,
    day: data.day, occurredAt: data.occurredAt,
    verification: data.verification, actorKind: "human"
  };
}

function createCityRouter({ db, identity, entitlement, requireFirebaseUser,
  rateLimit, ownerAddresses = [], now = Date.now, shopCatalog }) {
  const router = express.Router();
  const limited = (key, max) => rateLimit({ key, max, windowMs: 60000 });

  router.use((_req, res, next) => {
    res.set("Cache-Control", "private, no-store");
    // Verify the backend rollout without requesting a user's token or private data.
    res.set("X-SchoolPark-City-Release", "3d-shops-v1");
    next();
  });
  router.use(requireFirebaseUser);
  router.use(limited("schoolpark-city", 60));
  router.use(async (req, res, next) => {
    if (!db || !identity || !entitlement) return res.status(503).json({ error: "CITY_UNAVAILABLE" });
    try {
      // Fresh account, not a client-supplied spid or the auth middleware's old cache.
      const accountSnap = await db.collection("ches_accounts").doc(req.identity.uid).get();
      if (!accountSnap.exists) return res.status(403).json({ error: "ACCOUNT_NOT_FOUND" });
      const account = accountSnap.data() || {};
      const isOwner = [account.walletAddress, account.chesAddress]
        .some(a => ownerAddresses.includes(String(a || "").toLowerCase()));
      const hasOfficialPass = await entitlement.holdsOfficialPass(req.identity.uid, account);
      const access = decideSchoolParkAccess(now(), { isOwner, hasOfficialPass });
      if (!access.allowed) return res.status(403).json({ error: "SCHOOLPARK_ACCESS_DENIED" });
      const spid = await identity.findByUid(req.identity.uid);
      if (!isSchoolParkId(spid)) return res.status(409).json({ error: "PASSPORT_LINK_REQUIRED" });
      const person = await identity.readIdentity(spid);
      if (!person || person.status !== "active") return res.status(403).json({ error: "PASSPORT_INACTIVE" });
      req.city = { spid };
      next();
    } catch (_) {
      // Fail closed. A failed read must never become permission or an empty MyCity.
      return res.status(503).json({ error: "CITY_UNAVAILABLE" });
    }
  });

  require("./city-shops").attachShopRoutes(router, { limited, catalog:shopCatalog });
  router.get("/spots", (_req, res) => res.json({ ok: true, schema: "schoolpark-city-v1", spots: SPOTS }));

  router.get("/me", async (req, res) => {
    if (Object.keys(req.query || {}).length) return res.status(400).json({ error: "UNEXPECTED_FIELDS" });
    try {
      const snap = await db.collection(checkinPath(req.city.spid))
        .orderBy("occurredAt", "desc").limit(PAGE_SIZE + 1).get();
      return res.json({ ok: true, passportId: req.city.spid,
        checkins: snap.docs.slice(0, PAGE_SIZE).map(d => checkinView(d.id, d.data() || {})),
        hasMore: snap.docs.length > PAGE_SIZE, limit: PAGE_SIZE });
    } catch (_) {
      return res.status(503).json({ error: "CITY_HISTORY_UNAVAILABLE" });
    }
  });

  router.post("/checkins", limited("schoolpark-city-checkin", 10), async (req, res) => {
    const body = req.body;
    if (!body || Array.isArray(body) || typeof body !== "object"
        || Object.keys(body).some(k => !["spotId", "checkInType"].includes(k))
        || Object.keys(req.query || {}).length) {
      return res.status(400).json({ error: "UNEXPECTED_FIELDS" });
    }
    const spot = SPOTS.find(s => s.spotId === body.spotId);
    if (!spot) return res.status(404).json({ error: "SPOT_NOT_FOUND" });
    if (body.checkInType !== spot.checkInType) return res.status(400).json({ error: "INVALID_CHECKIN_TYPE" });
    try {
      const at = now(), day = jstDay(at), id = day + "__" + spot.spotId;
      const ref = db.collection(checkinPath(req.city.spid)).doc(id);
      const result = await db.runTransaction(async tx => {
        const prior = await tx.get(ref);
        if (prior.exists) return { alreadyRecorded: true, checkin: checkinView(id, prior.data()) };
        const row = {
          schema: "schoolpark-city-checkin-v1", kind: "city.checkin",
          passportId: req.city.spid, actorKind: "human", agentId: null,
          spotId: spot.spotId, locationType: spot.locationType,
          checkInType: spot.checkInType, isDemo: spot.status === "demo",
          verification: spot.locationType === "REAL" ? "demo-only" : "explicit-entry",
          questId: spot.questId, guildId: spot.guildId, day, occurredAt: at
        };
        tx.create(ref, row);
        return { alreadyRecorded: false, checkin: checkinView(id, row) };
      });
      // No Quest, EMUER, certificate or star mutation occurs here.
      return res.json({ ok: true, passportId: req.city.spid, ...result });
    } catch (_) {
      return res.status(503).json({ error: "CITY_CHECKIN_UNAVAILABLE" });
    }
  });
  return router;
}

module.exports = { createCityRouter, SPOTS, checkinPath, jstDay, PAGE_SIZE };
