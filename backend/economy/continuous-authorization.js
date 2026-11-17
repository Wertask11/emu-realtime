"use strict";
const { hash } = require("./config");
const { lifecycle } = require("./offering");
const OFFICIAL = new Set([
  "guild",
  "quest",
  "city_product",
  "service_guide",
  "emuer_guide",
  "passport_guide",
  "activity_guide",
]);
function officialSource(s, a) {
  if (!OFFICIAL.has(s?.kind)) return false;
  if (s.kind === "guild") {
    const g =
      require("../../frontend/public/schoolpark/guild-store").OFFICIAL.find(
        (g) => g.id === s.id,
      );
    return !!(
      g &&
      s.title === g.name &&
      s.summary === g.concept &&
      a.proofKind === "operator-original-guild-text"
    );
  }
  return !!(
    s.originHash &&
    a.proofKind ===
      (s.kind === "quest"
        ? "operator-original-quest-text"
        : s.kind === "city_product"
          ? "operator-original-city-text"
          : "operator-original-system-guide")
  );
}
function activePolicy(env, now) {
  const c = lifecycle(env, now);
  return c.serviceMode === "continuous" &&
    !c.offeringBlockers.some((b) => b !== "INTAKE_PAUSED")
    ? c
    : null;
}
function trialEnd(env) {
  return Date.parse(env.ECONOMY_EXPLORER_TRIAL_START || "") + 7 * 86400000;
}
function sourceGrantHash(r) {
  return hash([
    r.purpose,
    r.contentHash,
    r.originHash || null,
    r.validUntilMs,
    r.piiReviewed,
    r.aiUseApproved,
    r.rightsVerified || null,
    r.artifactUseApproved || null,
    r.artifactPurpose || null,
    r.authorizationRef || null,
  ]);
}
function eligibilityGrantHash(r) {
  return hash([
    r.adultVerified,
    r.providerAllowed,
    r.verifiedAtMs || null,
    r.validUntilMs,
    r.evidenceRef || null,
  ]);
}
function sourceCurrent(r, s, env, now) {
  if (r?.revokedAtMs || r?.piiReviewed !== true || r?.aiUseApproved !== true)
    return false;
  if (s?.facts?.deadlineMs && s.facts.deadlineMs <= now) return false;
  if (r?.validUntilMs > now) return true;
  const c = activePolicy(env, now),
    a = r?.continuousAuthorization;
  return !!(
    c &&
    a?.version === 1 &&
    a.approved === true &&
    officialSource(s, a) &&
    a.category === "A" &&
    a.approvalRef === c.continuousApprovalRef &&
    Number.isSafeInteger(a.authorizedAtMs) &&
    a.authorizedAtMs <= now &&
    a.authorizedAtMs >= c.offering.startedAtMs &&
    r.validUntilMs === trialEnd(env) &&
    a.sourceGrantHash === sourceGrantHash(r) &&
    a.sourceKey === s.key &&
    a.contentHash === hash([s.title, s.summary]) &&
    a.originHash === (s.originHash || null) &&
    !(s.facts?.deadlineMs && s.facts.deadlineMs <= now)
  );
}
function eligibilityCurrent(r, spid, env, now) {
  if (
    r?.revokedAtMs ||
    r?.adultVerified !== true ||
    r?.providerAllowed !== true
  )
    return false;
  if (r?.validUntilMs > now) return true;
  const c = activePolicy(env, now),
    a = r?.continuousAuthorization;
  return !!(
    c &&
    a?.version === 1 &&
    a.approved === true &&
    a.approvalRef === c.continuousApprovalRef &&
    Number.isSafeInteger(a.authorizedAtMs) &&
    a.authorizedAtMs <= now &&
    a.authorizedAtMs >= c.offering.startedAtMs &&
    a.subjectHash === hash(spid) &&
    a.sourceGrantHash === eligibilityGrantHash(r) &&
    r.validUntilMs === trialEnd(env) &&
    r.verifiedAtMs > 0
  );
}
module.exports = {
  sourceCurrent,
  eligibilityCurrent,
  sourceGrantHash,
  eligibilityGrantHash,
};
