"use strict";

const PASS_PREVIEW_AT = Date.parse("2026-09-20T15:00:00.000Z");
const PUBLIC_AT = Date.parse("2026-09-30T15:00:00.000Z");

function decideSchoolParkAccess(now, options) {
  const at = Number(now);
  const isOwner = !!(options && options.isOwner);
  const hasOfficialPass = !!(options && options.hasOfficialPass);
  const phase = at >= PUBLIC_AT ? "public" : at >= PASS_PREVIEW_AT ? "pass-preview" : "owner-only";
  return {
    phase,
    allowed: phase === "public" || isOwner || (phase === "pass-preview" && hasOfficialPass)
  };
}

module.exports = { PASS_PREVIEW_AT, PUBLIC_AT, decideSchoolParkAccess };
