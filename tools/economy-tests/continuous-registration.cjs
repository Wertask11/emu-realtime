"use strict";
// Pure operator review builder. No network, credentials, DB writes or blanket consent.
const { hash, SERVICE } = require("../../backend/economy/config"),
  auth = require("../../backend/economy/continuous-authorization");
const { publicRow } = require("../../backend/economy/search/contracts"),
  official = require("./official-material-review.cjs");
function decision(d) {
  if (
    d?.founderApproved !== true ||
    d.mode !== "continuous" ||
    !/^[A-Za-z0-9_-]{8,100}$/.test(d.approvalRef || "") ||
    !Number.isSafeInteger(d.startedAtMs) ||
    !Number.isSafeInteger(d.historicalTrialEndMs) ||
    d.price !== 5 ||
    d.personDaily !== 3 ||
    d.globalDaily !== 20 ||
    d.concurrency !== 2 ||
    d.dailyTokens !== 100000 ||
    d.requestTokens !== 5000 ||
    d.paymentSource !== "ledger" ||
    d.polygonEnabled !== false
  )
    throw Error("CONTINUOUS_DECISION_UNCONFIRMED");
  return d;
}
function product(p, d) {
  decision(d);
  if (
    p?.status !== "live" ||
    p.prices?.EMUER !== 5 ||
    p.termsVersion !== SERVICE.termsVersion
  )
    throw Error("EXISTING_PRODUCT_CHANGED");
  return {
    version: 1,
    mode: "continuous",
    approvalRef: d.approvalRef,
    startedAtMs: d.startedAtMs,
    intakeEnabled: false,
  };
}
function source(s, r, raw, d, now) {
  decision(d);
  if (
    !s ||
    !r ||
    r.piiReviewed !== true ||
    r.aiUseApproved !== true ||
    r.validUntilMs !== d.historicalTrialEndMs ||
    r.contentHash !== hash([s.title, s.summary]) ||
    (r.originHash || null) !== (s.originHash || null) ||
    r.revokedAtMs ||
    (s.facts?.deadlineMs && s.facts.deadlineMs <= now)
  )
    throw Error("EXISTING_REVIEW_NOT_CONTINUABLE");
  let proof;
  if (s.kind === "guild") {
    const g =
      require("../../frontend/public/schoolpark/guild-store").OFFICIAL.find(
        (g) => g.id === s.id,
      );
    if (
      !g ||
      s.title !== g.name ||
      s.summary !== g.concept ||
      (raw && (!publicRow(raw) || raw.aiUseConsent?.allowed === false))
    )
      throw Error("GUILD_ORIGINAL_NOT_MATCHED");
    proof = {
      type: "operator-original-guild-text",
      file: "frontend/public/schoolpark/guild-store.js",
      sourceHash: hash([g.name, g.concept]),
    };
  } else if (["quest", "city_product"].includes(s.kind)) {
    if (r.reviewCategory !== "A" || r.rightsVerified !== true)
      throw Error("OFFICIAL_REVIEW_UNCONFIRMED");
    proof = official.provenance(s, raw, true);
    if (r.originalHash !== proof.sourceHash || r.evidenceRef !== proof.file)
      throw Error("OFFICIAL_PROVENANCE_CHANGED");
  } else if (
    [
      "service_guide",
      "emuer_guide",
      "passport_guide",
      "activity_guide",
    ].includes(s.kind)
  ) {
    const g = require("../../backend/economy/search/guides")
      .guides(now)
      .find((g) => g.key === s.key);
    if (
      r.reviewCategory !== "A" ||
      r.rightsVerified !== true ||
      !g ||
      g.title !== s.title ||
      g.summary !== s.summary ||
      g.originHash !== s.originHash
    )
      throw Error("SYSTEM_ORIGINAL_NOT_MATCHED");
    proof = {
      type: "operator-original-system-guide",
      file: "backend/economy/search/guides.js",
      sourceHash: s.originHash,
    };
  } else throw Error("THIRD_PARTY_CONTINUATION_NOT_AUTHORIZED");
  return {
    version: 1,
    approved: true,
    category: "A",
    approvalRef: d.approvalRef,
    authorizedAtMs: d.startedAtMs,
    sourceKey: s.key,
    contentHash: r.contentHash,
    originHash: s.originHash || null,
    sourceGrantHash: auth.sourceGrantHash(r),
    proofKind: proof.type,
    proofFile: proof.file,
    proofHash: proof.sourceHash,
  };
}
function eligibility(e, spid, plan, d) {
  decision(d);
  if (
    !["plus", "pro"].includes(plan) ||
    e?.adultVerified !== true ||
    e.providerAllowed !== true ||
    e.validUntilMs !== d.historicalTrialEndMs ||
    !(e.verifiedAtMs > 0 && e.verifiedAtMs < d.historicalTrialEndMs) ||
    e.revokedAtMs
  )
    throw Error("EXISTING_ELIGIBILITY_UNCONFIRMED");
  return {
    version: 1,
    approved: true,
    approvalRef: d.approvalRef,
    authorizedAtMs: d.startedAtMs,
    subjectHash: hash(spid),
    sourceGrantHash: auth.eligibilityGrantHash(e),
  };
}
module.exports = { decision, product, source, eligibility };
