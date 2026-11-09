"use strict";
// Pure builder: no network, no DB writes and no new author consent.
const { hash, SERVICE } = require("../../backend/economy/config"),
  { VERSION } = require("../../backend/economy/tasks");
const { PURPOSE } = require("../../backend/economy/search/profile");
function artifactApproval(source, existing, review, now = Date.now()) {
  const officialGuild =
    source?.kind === "guild" &&
    ["learn", "work", "play", "connect", "web3"].includes(source.id);
  const ownedGuide =
    source?.kind === "service_guide" &&
    ["posting", "research", "navigation", "plans"].includes(source.id);
  if (!officialGuild && !ownedGuide)
    throw Error("ARTIFACT_OWNERSHIP_UNVERIFIED");
  if (
    !existing ||
    (ownedGuide &&
      (existing.purpose !== PURPOSE || existing.rightsVerified !== true)) ||
    (officialGuild &&
      ![PURPOSE, SERVICE.termsVersion].includes(existing.purpose)) ||
    existing.aiUseApproved !== true ||
    existing.piiReviewed !== true ||
    !(existing.validUntilMs > now) ||
    existing.contentHash !== hash([source.title, source.summary]) ||
    (source.originHash && source.originHash !== existing.originHash)
  )
    throw Error("ARTIFACT_BASE_REVIEW_INVALID");
  if (
    !review ||
    review.sourceKey !== source.key ||
    review.contentHash !== existing.contentHash ||
    review.originHash !== (source.originHash || null) ||
    review.category !== "A" ||
    review.authorizationRef !== "founder-phase3-instruction-20261109" ||
    review.evidenceRef !==
      (officialGuild
        ? "founder-official-five-guild-rights-20261107"
        : "PR297-original-system-facts-20261107")
  )
    throw Error("ARTIFACT_REVIEW_UNCONFIRMED");
  return {
    artifactUseApproved: true,
    artifactPurpose: VERSION,
    artifactAllowedTasks: ["knowledge_draft", "guild_plan", "wil_plan"],
    artifactReviewedAtMs: now,
    artifactAuthorizationRef: review.authorizationRef,
    artifactEvidenceRef: review.evidenceRef,
  };
}
module.exports = { artifactApproval };
