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
        if (o?.storeType === "agent_service")
          return res.status(409).json({ error: "SERVICE_ORDER_MANAGED" });
        next();
      } catch (_) {
        res.status(503).json({ error: "ORDER_UNAVAILABLE" });
      }
    });
  };
}
module.exports = { serviceOrderGuard };
