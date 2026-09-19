/* Guild/Quest v2 rewards deliberately begin as records, not payments.
   Existing quest logging stays unchanged; when a published EMUER budget exists,
   a real quest log is recorded as a contribution for an operator to review. */
(function () {
  const API = "https://emu-realtime.onrender.com/api/emuer/v2";
  async function headers() {
    if (typeof window.emuAuthHeaders !== "function") throw new Error("LOGIN_REQUIRED");
    return window.emuAuthHeaders(false);
  }
  async function enabled() {
    try {
      const response = await fetch(API + "/config");
      const config = await response.json();
      return response.ok && config.enabled && Date.now() >= Date.parse(config.startsAt);
    } catch (_) { return false; }
  }
  function questIdFromPath(path) {
    const match = String(path || "").match(/^sp_quests\/([^/]+)\/logs$/);
    return match ? match[1] : "";
  }
  window.addEventListener("load", async function () {
    if (!(await enabled()) || !window.fbLib || typeof window.fbLib.addDoc !== "function") return;
    const originalAddDoc = window.fbLib.addDoc.bind(window.fbLib);
    window.fbLib.addDoc = async function () {
      const args = Array.prototype.slice.call(arguments);
      const result = await originalAddDoc.apply(null, args);
      const questId = questIdFromPath(args[0] && args[0].path);
      if (!questId || questId === "founder-quest-000") return result;
      try {
        await fetch(API + "/guild-quest/contributions", {
          method: "POST", headers: await headers(),
          body: JSON.stringify({ scopeType: "quest", scopeId: questId, evidenceLogId: result.id,
            address: String(window.connectedAccount || "") })
        });
      } catch (_) { /* A missing budget never blocks an existing quest log. */ }
      return result;
    };
  });
})();