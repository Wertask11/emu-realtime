// Keep only a short-lived navigation intent; never tokens or draft content.
(() => {
  const params = new URLSearchParams(location.search);
  if (params.get("membership") !== "plan") return;
  const value = params.get("membershipPlan");
  try { sessionStorage.setItem("emu-membership-entry", JSON.stringify({ at: Date.now(), plan: ["light","plus","pro"].includes(value) ? value : null })); } catch (_) {}
})();
