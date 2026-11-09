"use strict";
// Operator-only pure review builder. No network, user consent mutation or data writes.
const fs = require("node:fs"),
  path = require("node:path");
const { hash } = require("../../backend/economy/config"),
  { PURPOSE } = require("../../backend/economy/search/profile"),
  { VERSION, TASKS } = require("../../backend/economy/tasks"),
  { publicRow } = require("../../backend/economy/search/contracts");
const ROOT = path.resolve(__dirname, "../.."),
  catalog = require("../../backend/official-shop-products.json").products;
const seeds = fs
  .readdirSync(path.join(ROOT, "tools/quest-seeds"))
  .flatMap((file) => {
    const value = JSON.parse(
      fs.readFileSync(path.join(ROOT, "tools/quest-seeds", file), "utf8"),
    );
    return (Array.isArray(value) ? value : [value]).map((row) => ({
      row,
      file: "tools/quest-seeds/" + file,
    }));
  });
function provenance(source, raw, operatorVerified) {
  if (
    !source ||
    !raw ||
    !publicRow(raw) ||
    operatorVerified !== true ||
    raw.aiUseConsent?.allowed === false
  )
    throw Error("OFFICIAL_RIGHTS_UNCONFIRMED");
  if (source.kind === "quest") {
    if (
      source.id === "founder-quest-000" ||
      !["OPEN", "RUNNING"].includes(raw.status)
    )
      throw Error("NOT_ACTIONABLE_QUEST");
    const seed = seeds.find(
      ({ row: s }) =>
        s.series === raw.series &&
        s.questNumber === raw.questNumber &&
        (s.branch || 0) === (raw.branch || 0) &&
        (s.stage || "") === (raw.stage || ""),
    );
    if (
      !seed ||
      !["title", "brief", "given", "conditions"].every(
        (k) => String(seed.row[k] || "") === String(raw[k] || ""),
      )
    )
      throw Error("QUEST_ORIGINAL_NOT_MATCHED");
    return {
      file: seed.file,
      sourceHash: hash([
        seed.row.title,
        seed.row.brief || null,
        seed.row.given || null,
        seed.row.conditions || null,
      ]),
      type: "operator-original-quest-text",
    };
  }
  if (source.kind === "city_product") {
    const s = catalog.find((p) => p.id === source.id);
    if (
      raw.shopId !== "schoolpark-official" ||
      raw.status !== "live" ||
      !s ||
      !["name", "description", "fulfillment", "cancelPolicy"].every(
        (k) => String(s[k] || "") === String(raw[k] || ""),
      )
    )
      throw Error("CITY_ORIGINAL_NOT_MATCHED");
    return {
      file: "backend/official-shop-products.json",
      sourceHash: hash([
        s.id,
        s.name,
        s.description,
        s.fulfillment,
        s.cancelPolicy,
      ]),
      type: "operator-original-city-text",
    };
  }
  throw Error("UNSUPPORTED_OFFICIAL_SOURCE");
}
function approval(
  source,
  raw,
  review,
  { now, validUntilMs, operatorVerified } = {},
) {
  const basis = provenance(source, raw, operatorVerified);
  if (
    !Number.isSafeInteger(now) ||
    !Number.isSafeInteger(validUntilMs) ||
    validUntilMs <= now ||
    !source.originHash ||
    !review ||
    review.authorizationRef !== "founder-official-quest-city-phase3-20261109" ||
    review.category !== "A" ||
    review.sourceKey !== source.key ||
    review.contentHash !== hash([source.title, source.summary]) ||
    review.originHash !== source.originHash ||
    review.originalFile !== basis.file ||
    review.originalHash !== basis.sourceHash ||
    review.piiReviewed !== true
  )
    throw Error("OFFICIAL_REVIEW_NOT_CONFIRMED");
  const until = Math.min(validUntilMs, source.facts.deadlineMs || validUntilMs);
  if (until <= now) throw Error("OFFICIAL_SOURCE_EXPIRED");
  return {
    purpose: PURPOSE,
    piiReviewed: true,
    aiUseApproved: true,
    rightsVerified: true,
    authorPermissionConfirmed: true,
    reviewCategory: "A",
    reviewBasis: basis.type,
    evidenceRef: basis.file,
    originalHash: basis.sourceHash,
    authorizationRef: review.authorizationRef,
    contentHash: review.contentHash,
    originHash: review.originHash,
    validUntilMs: until,
    reviewedAtMs: now,
    artifactUseApproved: true,
    artifactPurpose: VERSION,
    artifactAllowedTasks: Object.keys(TASKS),
    artifactReviewedAtMs: now,
    artifactAuthorizationRef: review.authorizationRef,
    artifactEvidenceRef: basis.file,
  };
}
module.exports = { provenance, approval, seeds, catalog };
