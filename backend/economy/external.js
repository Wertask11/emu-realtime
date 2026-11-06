"use strict";
// No executor, wallet, token approval, transaction signing or market-price client.
const capability = Object.freeze({
  chainId: 137,
  token: "EMUER",
  supported: false,
  executable: false,
  reason: "TRANSFER_RESTRICTED",
  detail:
    "EMUER v2は自由移転・approveを許可していないため、通常のDEX・Permit2・x402送金には接続できません。",
  quote: null,
});
function simulate(request = {}) {
  // Test the future adapter's request/quote shape, not a fictional EMUER market.
  if (
    request.chainId !== 137 ||
    request.token !== "EMUER" ||
    !/^[1-9][0-9]{0,7}$/.test(String(request.amount || ""))
  )
    return {
      mode: "mock",
      executable: false,
      outcome: "unsupported",
      reason: "INVALID_REQUEST",
      quote: null,
    };
  return {
    mode: "mock",
    executable: false,
    outcome: "blocked",
    reason: capability.reason,
    quote: null,
    steps: [
      "validate_request",
      "check_transfer_policy",
      "reject_before_quote_or_signature",
    ],
  };
}
module.exports = { capability, simulate };
