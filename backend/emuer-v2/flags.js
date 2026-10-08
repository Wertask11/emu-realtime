"use strict";

const policy = require("./policy");

/*
 * EMUER v2 is opt-in. An unset, malformed, or explicitly false enable flag
 * keeps all v2 issuance and EMUER exchange routes closed. The emergency hold
 * always wins over the enable flag. A missing hold preserves the documented
 * normal configuration; any non-empty value other than the literal "false"
 * is treated as held.
 */
function enabled(env = {}, now = Date.now()) {
  if (!env || env.EMUER_V2_ENABLED !== "true") return false;

  const hold = env.EMUER_V2_LAUNCH_HOLD;
  if (hold === "true") return false;
  if (hold !== undefined && hold !== "" && hold !== "false") return false;

  return policy.isActive(now);
}

module.exports = { enabled };
