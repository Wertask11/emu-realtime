"use strict";
const SERVICE = Object.freeze({
  id: "schoolpark-explorer-v1",
  name: "SchoolPark Explorer",
  version: 3,
  price: 5,
  currency: "EMUER",
  globalDaily: 20,
  personDaily: 3,
  concurrency: 2,
  dailyTokens: 100000,
  requestTokens: 5000,
  trialDays: 7,
  termsVersion: "explorer-20261107-v3",
  refund:
    "処理失敗時は全額を元の未受取EMUERへ返却します。未確定の場合は返却待ちと表示します。",
  scope:
    "公開情報の検索・比較・提案と既存画面への案内。購入・送金・契約・連絡は行いません。探索が正常に完了した場合、候補が見つからない場合も料金対象です。",
});
function configuration(env = process.env, now = Date.now()) {
  const plans = String(env.ECONOMY_EXPLORER_PLANS || "")
    .split(",")
    .filter((v) => ["guest", "light", "plus", "pro"].includes(v));
  const budget = Number(
    env.ECONOMY_EXPLORER_DAILY_TOKEN_BUDGET || SERVICE.dailyTokens,
  );
  const model = env.ECONOMY_EXPLORER_MODEL || "gemini-3.5-flash-lite";
  const blockers = [];
  for (const [key, reason] of Object.entries({
    ECONOMY_EXPLORER_ENABLED: "SERVICE_DISABLED",
    ECONOMY_WORKER_ENABLED: "WORKER_NOT_ENABLED",
    ECONOMY_AI_TERMS_ATTESTED: "PROVIDER_TERMS_UNVERIFIED",
    ECONOMY_AI_AUDIENCE_ATTESTED: "AUDIENCE_UNVERIFIED",
    ECONOMY_AI_SOURCE_USE_ATTESTED: "SOURCE_USE_UNVERIFIED",
    ECONOMY_AI_BUDGET_ATTESTED: "SHARED_PROVIDER_BUDGET_UNVERIFIED",
    ECONOMY_AI_BILLING_ATTESTED: "BILLING_UNVERIFIED",
    ECONOMY_AI_PROJECT_ATTESTED: "PROJECT_UNVERIFIED",
  }))
    if (env[key] !== "true") blockers.push(reason);
  if (!env.GEMINI_API_KEY) blockers.push("PROVIDER_NOT_CONFIGURED");
  if (env.ECONOMY_GEMINI_BILLING_TIER !== "free")
    blockers.push("FREE_TIER_UNVERIFIED");
  if (
    !/^[a-z][a-z0-9.-]{1,99}$/.test(model) ||
    !model.includes("flash") ||
    /pro|image|audio|video|tts/i.test(model) ||
    model !== "gemini-3.5-flash-lite"
  )
    blockers.push("MODEL_NOT_ALLOWED");
  if (!/^[a-z][a-z0-9-]{4,62}$/.test(env.ECONOMY_GEMINI_PROJECT_ID || ""))
    blockers.push("PROJECT_UNVERIFIED");
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(env.ECONOMY_BUDGET_APPROVAL_REF || ""))
    blockers.push("MONETARY_CAP_UNVERIFIED");
  const trialStartMs = Date.parse(env.ECONOMY_EXPLORER_TRIAL_START || ""),
    trialEndMs = trialStartMs + SERVICE.trialDays * 86400000;
  if (!Number.isFinite(trialStartMs)) blockers.push("TRIAL_NOT_CONFIGURED");
  else if (now < trialStartMs || now >= trialEndMs)
    blockers.push("TRIAL_NOT_ACTIVE");
  if (!plans.length) blockers.push("ELIGIBILITY_UNCONFIGURED");
  if (
    !Number.isSafeInteger(budget) ||
    budget < SERVICE.requestTokens ||
    budget > SERVICE.dailyTokens
  )
    blockers.push("BUDGET_UNCONFIGURED");
  return {
    ...SERVICE,
    enabled: !blockers.length,
    blockers: [...new Set(blockers)],
    plans,
    model,
    tokenBudget: budget,
    reserveTokens: SERVICE.requestTokens,
    trialStartMs: Number.isFinite(trialStartMs) ? trialStartMs : null,
    trialEndMs: Number.isFinite(trialEndMs) ? trialEndMs : null,
    chainPaymentEnabled: false,
    billingMode: "free-only",
  };
}
const hash = (v) =>
  require("node:crypto")
    .createHash("sha256")
    .update(JSON.stringify(v))
    .digest("hex");
const fail = (code, status = 409) => {
  throw Object.assign(new Error(code), { status });
};
const day = (now) => new Date(now + 9 * 3600000).toISOString().slice(0, 10);
module.exports = { SERVICE, configuration, hash, fail, day };
