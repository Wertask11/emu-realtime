import { exact, fail } from "./crypto.mjs";
// No production connector, document upload, personal number or government VC issuance.
export function governmentReadiness() {
  return {
    connected: false,
    approvalVerified: false,
    apiTermsReviewed: false,
    issuanceEnabled: false,
  };
}
export function evaluateMock(input) {
  exact(input, ["scenario"]);
  if (!["success", "denied", "timeout"].includes(input.scenario))
    fail("INVALID_FIELDS");
  return {
    mode: "mock",
    scenario: input.scenario,
    governmentVerified: false,
    credential: null,
  };
}
