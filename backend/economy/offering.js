"use strict";
const REF = /^[A-Za-z0-9_-]{8,100}$/;
function lifecycle(env, now) {
  const mode = env.ECONOMY_SERVICE_MODE || "trial";
  const start = Date.parse(env.ECONOMY_CONTINUOUS_START || "");
  const approvalRef = env.ECONOMY_CONTINUOUS_APPROVAL_REF || "";
  const blockers = [];
  if (!["trial", "continuous"].includes(mode))
    blockers.push("OFFERING_MODE_INVALID");
  if (mode === "continuous") {
    if (!REF.test(approvalRef) || !Number.isFinite(start))
      blockers.push("CONTINUOUS_OFFERING_UNCONFIGURED");
    else if (now < start) blockers.push("CONTINUOUS_OFFERING_NOT_STARTED");
  }
  const intakeEnabled =
    mode === "continuous"
      ? env.ECONOMY_INTAKE_ENABLED === "true"
      : env.ECONOMY_INTAKE_ENABLED !== "false";
  if (!intakeEnabled) blockers.push("INTAKE_PAUSED");
  return {
    serviceMode: mode,
    intakeEnabled,
    continuousApprovalRef: approvalRef,
    offering: {
      mode,
      startedAtMs: Number.isFinite(start) ? start : null,
      endsAtMs: null,
    },
    offeringBlockers: blockers,
  };
}
function productBlockers(c, product, reserved = false) {
  if (c.serviceMode !== "continuous") return [];
  const o = product?.offering;
  if (
    o?.version !== 1 ||
    o.mode !== "continuous" ||
    o.approvalRef !== c.continuousApprovalRef ||
    o.startedAtMs !== c.offering.startedAtMs
  )
    return ["CONTINUOUS_PRODUCT_UNVERIFIED"];
  return !reserved && o.intakeEnabled !== true ? ["INTAKE_PAUSED"] : [];
}
module.exports = { lifecycle, productBlockers };
