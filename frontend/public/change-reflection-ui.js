/* EMUER v2: post authors record an actual Change reflection, separately from acceptance. */
(function () {
  const api = "https://emu-realtime.onrender.com/api/emuer/v2";
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const addr = () => String(window._emuAddress ? window._emuAddress() : "").toLowerCase();
  const active = async () => {
    try { const r = await fetch(api + "/config"); const c = await r.json(); return !!c.enabled && Date.now() >= Date.parse(c.startsAt); }
    catch (_) { return false; }
  };
  const authHeaders = async () => {
    if (typeof window.emuAuthHeaders !== "function") throw new Error("AUTH_REQUIRED");
    const headers = await window.emuAuthHeaders(false);
    return { ...headers, "Content-Type": "application/json" };
  };

  async function recordReward(postId, changeId) {
    if (!await active()) return;
    try {
      await fetch(api + "/activity/change-reflection", {
        method: "POST", headers: await authHeaders(), body: JSON.stringify({ postId, changeId })
      });
    } catch (_) { /* Reopening the history retries the idempotent record. */ }
  }

  async function decorate(post) {
    if (!post || !window.db || !window.fbLib || addr() !== String(post.address || "").toLowerCase()) return;
    const snap = await window.fbLib.getDocs(window.fbLib.query(
      window.fbLib.collection(window.db, "post_changes"), window.fbLib.where("postId", "==", post.id)
    ));
    const changes = [];
    snap.forEach(d => changes.push({ id: d.id, ...d.data() }));
    changes.sort((a, b) => {
      const am = window._emuTimestampMs ? window._emuTimestampMs(a.createdAt) : 0;
      const bm = window._emuTimestampMs ? window._emuTimestampMs(b.createdAt) : 0;
      return bm - am;
    });
    const cards = document.querySelectorAll("#emuHistoryList .emu-history-item");
    changes.forEach((change, index) => {
      if (change.status !== "accepted" || !cards[index] || cards[index].dataset.reflectionReady) return;
      cards[index].dataset.reflectionReady = "true";
      if (change.reflectedAt) {
        const note = document.createElement("p");
        note.textContent = "反映を記録済み" + (change.reflectionNote ? "：" + change.reflectionNote : "");
        cards[index].appendChild(note);
        recordReward(post.id, change.id);
        return;
      }
      const button = document.createElement("button");
      button.type = "button"; button.className = "eth-btn primary"; button.style.marginTop = "10px";
      button.textContent = "反映を記録する";
      button.addEventListener("click", async () => {
        const note = prompt("この提案を投稿へどう反映したかを記録してください。", "");
        if (note === null) return;
        button.disabled = true;
        try {
          await window.fbLib.updateDoc(window.fbLib.doc(window.db, "post_changes", change.id), {
            reflectedAt: new Date(), reflectedBy: addr(), reflectionNote: String(note).slice(0, 1000)
          });
          await window.fbLib.updateDoc(window.fbLib.doc(window.db, "posts", post.id), {
            reflectedChangeCount: window.fbLib.increment(1), lastChangedAt: new Date()
          });
          await recordReward(post.id, change.id);
          if (window.openPostChangeHistory) await window.openPostChangeHistory(post);
        } catch (error) { console.error("Change reflection record failed:", error); alert("反映記録を保存できませんでした。"); button.disabled = false; }
      });
      cards[index].appendChild(button);
    });
  }

  function install() {
    const original = window.openPostChangeHistory;
    if (typeof original !== "function" || original.__emuerReflection) return false;
    async function wrapped(post) { const result = await original.apply(this, arguments); await wait(0); try { await decorate(post); } catch (e) { console.error("Change reflection UI failed:", e); } return result; }
    wrapped.__emuerReflection = true;
    window.openPostChangeHistory = wrapped;
    return true;
  }
  const timer = setInterval(() => { if (install()) clearInterval(timer); }, 300);
})();