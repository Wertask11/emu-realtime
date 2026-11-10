"use strict";
// Mount before the existing shop router. Public products and shop logic stay unchanged.
function serviceOrderGuard(db, authenticate) {
  return (req, res, next) => {
    const m =
      req.method === "POST" &&
      /^\/(?:admin\/)?orders\/(agent_[a-f0-9]{40})(?:\/|$)/.exec(req.path);
    if (!m) return next();
    authenticate(req, res, async () => {
      try {
        const o = (
          await db.collection("mitemiru_orders").doc(m[1]).get()
        ).data();
        // Reserved IDs cannot race order creation into the shop's weaker path.
        // Preserve existing ledger-service administration; wallet orders use only the new verifier.
        if (o?.storeType === "agent_service" && o.method === "emuer_ledger")
          return next();
        return res.status(409).json({ error: "SERVICE_ORDER_MANAGED" });
      } catch (_) {
        res.status(503).json({ error: "ORDER_UNAVAILABLE" });
      }
    });
  };
}
module.exports = { serviceOrderGuard };
