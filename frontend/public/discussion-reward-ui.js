/* EMUER v2: create a pending reward after a discussion conclusion is saved. */
(function () {
  const api = "https://emu-realtime.onrender.com/api/emuer/v2";
  let installed = false;
  async function report(conclusionId) {
    try {
      const configRes = await fetch(api + "/config");
      const config = await configRes.json();
      if (!config.enabled || Date.now() < Date.parse(config.startsAt) || typeof window.emuAuthHeaders !== "function") return;
      const headers = await window.emuAuthHeaders(false);
      await fetch(api + "/activity/discussion-conclusion", {
        method: "POST", headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ conclusionId })
      });
    } catch (_) { /* The conclusion remains saved even if reward recording is unavailable. */ }
  }
  function install() {
    if (installed || !window.fbLib || typeof window.fbLib.addDoc !== "function") return false;
    const original = window.fbLib.addDoc;
    window.fbLib.addDoc = async function (ref, data) {
      const saved = await original.apply(this, arguments);
      if (ref && ref.path === "discussion_conclusions") report(saved.id);
      return saved;
    };
    installed = true;
    return true;
  }
  const timer = setInterval(() => { if (install()) clearInterval(timer); }, 300);
})();