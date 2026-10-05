"use strict";

const express = require("express");

function createCamelliaAdminIdentityRouter({ db, requireOwner }) {
  const router = express.Router();
  router.get("/", requireOwner, async (_req, res) => {
    try {
      const snapshot = await db.collection("camellia_auth_users").limit(500).get();
      const identities = {};
      snapshot.docs.forEach((doc) => {
        const data = doc.data() || {};
        const providers = data.identities || {};
        identities[doc.id] = {
          line: providers.line === true,
          schoolpark: providers.schoolpark === true,
          updatedAt: data.updatedAt || null
        };
      });
      return res.json({ ok: true, identities });
    } catch (error) {
      console.error("Camellia identity list failed:", error.message);
      return res.status(500).json({ error: "CAMELLIA_IDENTITIES_FAILED" });
    }
  });
  return router;
}

module.exports = { createCamelliaAdminIdentityRouter };
