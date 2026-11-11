"use strict";
const CHAIN_ID = 137;
const TOKEN = "0x9c102cC3016C70767082b60196565878D9314864";
const TREASURY = "0x1C156b6a8CaA6772430edA2cBB0d20CF41B9CFE4";
const AMOUNT = "5000000000000000000";
const TERMS = "reizo-polygon-exchange-20261110-v1";
function policy(env = {}) {
  const blockers = [];
  for (const key of [
    "ENABLED",
    "CONTRACT_ATTESTED",
    "LEGAL_ATTESTED",
    "EXTERNAL_AUDIT_ATTESTED",
    "OPERATOR_ATTESTED",
    "GAS_BUDGET_ATTESTED",
  ])
    if (env["ECONOMY_POLYGON_" + key] !== "true")
      blockers.push("POLYGON_" + key + "_REQUIRED");
  if (!/^0x[a-f0-9]{64}$/i.test(env.ECONOMY_POLYGON_CODE_HASH || ""))
    blockers.push("POLYGON_CODE_UNVERIFIED");
  if (!/^0x[a-f0-9]{40}$/i.test(env.ECONOMY_POLYGON_OPERATOR_ADDRESS || ""))
    blockers.push("POLYGON_OPERATOR_UNCONFIGURED");
  for (const k of [
    "MAX_GAS_WEI",
    "DAILY_GAS_WEI",
    "MONTHLY_GAS_WEI",
    "TRIAL_GAS_WEI",
    "MAX_FEE_WEI",
    "REFUND_GAS_LIMIT",
    "FULFILL_GAS_LIMIT",
  ])
    if (!/^[1-9][0-9]{0,29}$/.test(env["ECONOMY_POLYGON_" + k] || ""))
      blockers.push("POLYGON_GAS_BUDGET_UNCONFIGURED");
  try {
    const u = new URL(env.ECONOMY_POLYGON_SIGNER_URL || "");
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      u.hash ||
      u.search ||
      u.port ||
      u.hostname !== env.ECONOMY_POLYGON_SIGNER_HOST ||
      !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(u.hostname) ||
      /^\d+\.\d+\.\d+\.\d+$/.test(u.hostname) ||
      /(?:^|\.)(?:localhost|local|internal)$/.test(u.hostname)
    )
      throw Error();
  } catch (_) {
    blockers.push("POLYGON_SIGNER_UNCONFIGURED");
  }
  if (!env.ECONOMY_POLYGON_SIGNER_TOKEN)
    blockers.push("POLYGON_SIGNER_UNCONFIGURED");
  return {
    enabled: !blockers.length,
    blockers: [...new Set(blockers)],
    chainId: CHAIN_ID,
    tokenAddress: TOKEN,
    price: 5,
    decimals: 18,
    method: "exchange",
    approvalRequired: false,
    confirmations: 64,
    finalizedRequired: true,
    paymentTermsVersion: TERMS,
    refund:
      "生成・保存失敗時は5 EMUERを元のPolygonウォレットへ返却します。確定前は返却待ちです。ネットワークに支払うガス代は返却対象外です。",
  };
}
module.exports = { CHAIN_ID, TOKEN, TREASURY, AMOUNT, TERMS, policy };
