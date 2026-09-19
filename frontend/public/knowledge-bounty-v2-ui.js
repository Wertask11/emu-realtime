/* EMUER v2 knowledge-answer flow: treasury-funded, 1 EMUER, no requester debit. */
(function () {
  const api = "https://emu-realtime.onrender.com/api/emuer/v2";
  const addr = () => String(window._emuAddress ? window._emuAddress() : "").toLowerCase();
  async function enabled() {
    try { const r = await fetch(api + "/config"); const c = await r.json(); return !!c.enabled; } catch (_) { return false; }
  }
  async function headers() {
    if (typeof window.emuAuthHeaders !== "function") throw new Error("AUTH_REQUIRED");
    return { ...(await window.emuAuthHeaders(false)), "Content-Type": "application/json" };
  }
  async function record(requestId, answerId) {
    try {
      const c = await (await fetch(api + "/config")).json();
      if (!c.enabled || Date.now() < Date.parse(c.startsAt)) return;
      await fetch(api + "/activity/knowledge-answer", { method: "POST", headers: await headers(), body: JSON.stringify({ requestId, answerId }) });
    } catch (_) { /* Opening the accepted answer again retries the idempotent verification. */ }
  }
  function replaceRequestSubmit() {
    const old = document.getElementById("emuRequestSubmit");
    if (!old || old.dataset.emuerV2) return;
    const button = old.cloneNode(true); old.replaceWith(button); button.dataset.emuerV2 = "true";
    button.addEventListener("click", async function () {
      const question = document.getElementById("emuRequestQuestion").value.trim();
      const context = document.getElementById("emuRequestContext").value.trim();
      const deadline = document.getElementById("emuRequestDeadline").value;
      if (question.length < 8 || context.length < 10 || !deadline) return alert("探している知識、状況、回答期限を入力してください。");
      if (!window.db || !window.fbLib || !addr()) return alert("ログインとウォレット接続を確認してください。");
      button.disabled = true; button.textContent = "公開しています…";
      try {
        const batch = window.fbLib.writeBatch(window.db);
        batch.set(window.fbLib.doc(window.fbLib.collection(window.db, "knowledge_requests")), {
          question, context, bounty: 1, author: addr(), status: "open", answerCount: 0,
          rewardPolicy: "emuer-v2-treasury-1", settlementStatus: "treasury_review", deadline: new Date(deadline + "T23:59:59"), createdAt: new Date()
        });
        if (typeof window._emuAddUsage === "function") await window._emuAddUsage(batch, "request");
        await batch.commit(); window.closeEmuSheet("emuRequestSheet"); await window.loadKnowledgeRequests();
      } catch (e) { console.error("v2 request creation failed", e); alert("募集を公開できませんでした。"); }
      finally { button.disabled = false; button.textContent = "募集を公開する"; }
    });
  }
  async function decorateAnswers(request) {
    if (!request || addr() !== String(request.author || "").toLowerCase() || !window.db || !window.fbLib) return;
    const snap = await window.fbLib.getDocs(window.fbLib.query(window.fbLib.collection(window.db, "knowledge_answers"), window.fbLib.where("requestId", "==", request.id)));
    const rows = []; snap.forEach(d => rows.push({ id: d.id, ...d.data() }));
    rows.sort((a,b) => (window._emuTimestampMs ? window._emuTimestampMs(b.createdAt)-window._emuTimestampMs(a.createdAt) : 0));
    const cards = document.querySelectorAll("#emuHistoryList .emu-history-item");
    rows.forEach((answer, index) => {
      const card = cards[index]; if (!card || card.dataset.v2BountyReady) return; card.dataset.v2BountyReady = "true";
      if (answer.status === "accepted") { record(request.id, answer.id); return; }
      if (request.status !== "open" || String(answer.answerAuthor || "").toLowerCase() === addr()) return;
      const legacy = Array.from(card.querySelectorAll("button")).find(b => /採用する/.test(b.textContent));
      if (legacy) legacy.remove();
      const button = document.createElement("button"); button.type = "button"; button.className = "eth-btn primary"; button.style.marginTop = "10px"; button.textContent = "回答を採用し、確認へ送る";
      button.addEventListener("click", async () => {
        if (!confirm("この回答を採用しますか？\n募集者の残高は減りません。基準確認後、運営トレジャリーから回答者へ1 EMUERを付与します。")) return;
        button.disabled = true;
        try {
          const batch = window.fbLib.writeBatch(window.db);
          batch.update(window.fbLib.doc(window.db, "knowledge_answers", answer.id), { status: "accepted", acceptedAt: new Date() });
          batch.update(window.fbLib.doc(window.db, "knowledge_requests", request.id), {
            status: "awarded", acceptedAnswerId: answer.id, acceptedAnswerAuthor: answer.answerAuthor, awardedAt: new Date(),
            rewardPolicy: "emuer-v2-treasury-1", settlementStatus: "treasury_review"
          });
          await batch.commit(); await record(request.id, answer.id); window.closeEmuSheet("emuHistorySheet"); await window.loadKnowledgeRequests();
        } catch (e) { console.error("v2 answer adoption failed", e); alert("採用を保存できませんでした。"); button.disabled = false; }
      });
      card.appendChild(button);
    });
  }
  function install() {
    if (!window.openKnowledgeAnswers || window.openKnowledgeAnswers.__emuerV2Bounty) return false;
    const original = window.openKnowledgeAnswers;
    async function wrapped(request) { const result = await original.apply(this, arguments); try { await decorateAnswers(request); } catch (e) { console.error("v2 answer decoration failed", e); } return result; }
    wrapped.__emuerV2Bounty = true; window.openKnowledgeAnswers = wrapped;
    const caption = document.querySelector("#emuRequestSheet .emu-field div"); if (caption) caption.textContent = "確認済みの回答に 1 EMUER";
    const note = document.querySelector("#emuRequestSheet p"); if (note) note.textContent = "募集者の残高は減りません。採用後、基準を満たす回答は運営トレジャリーから回答者へ1 EMUERが付与されます。";
    replaceRequestSubmit(); return true;
  }
  const timer = setInterval(async () => { if (await enabled() && install()) clearInterval(timer); }, 500);
})();