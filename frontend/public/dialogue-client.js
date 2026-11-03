/* Booked supplemental chat only. Credentials come from the current Firebase user. */
(() => {
  "use strict";
  let sessionId = null, epoch = 0, pending = null;
  const transport = () => typeof socket !== "undefined" ? socket : null;
  function status(message) {
    const el = document.getElementById("dialogueStatus");
    if (el) el.textContent = message;
  }
  function close() {
    epoch++; sessionId = null; pending = null;
    const s = transport(); s?.disconnect?.(); if (s) s.auth = {};
    document.getElementById("discussion")?.replaceChildren();
    status("");
  }
  async function connect(id) {
    close();
    const run = epoch, uid = window.auth?.currentUser?.uid, s = transport();
    if (!uid || !/^[A-Za-z0-9_-]{1,100}$/.test(id || "") || !s?.connect) {
      status("対話の予約をプロフィールから確認してください。"); return false;
    }
    status("予約とログインを確認しています…");
    try {
      const headers = await window.emuAuthHeaders(false, { interactive: false });
      if (run !== epoch || uid !== window.auth?.currentUser?.uid) return false;
      const token = String(headers.Authorization || headers.authorization || "").replace(/^Bearer /, "");
      if (!token) throw new Error("AUTH_REQUIRED");
      sessionId = id; s.auth = { token, sessionId: id };
      s.io.opts.reconnection = false;
      return await new Promise(resolve => {
        const done = ok => { clearTimeout(timer); s.off("room3 ready", ready); s.off("connect_error", failed); resolve(ok); };
        const ready = data => { if (run !== epoch || data.sessionId !== id) return done(false); status("予約した対話の補助チャットです。文字だけのやりとりはProの音声・映像対話の回数に含まれません。履歴は直近100件・最大2時間の一時表示です。必要な内容は自分用のノートなどに記録してください。"); done(true); };
        const failed = () => { if (run === epoch) status("この予約へ接続できません。ログイン状態と予約を確認して開き直してください。"); done(false); };
        const timer = setTimeout(() => { if (run === epoch) { s.disconnect(); s.auth = {}; status("接続に時間がかかっています。入力を残しているので、予約から開き直してください。"); } done(false); }, 12000);
        s.once("room3 ready", ready); s.once("connect_error", failed); s.connect();
      });
    } catch (_) { if (run === epoch) status("ログイン状態を確認し、予約から開き直してください。"); return false; }
  }
  async function send(text, replyTo) {
    const s = transport(), id = sessionId, uid = window.auth?.currentUser?.uid;
    if (!id || !uid || !s?.connected) { status("接続が切れています。入力は残しています。予約から開き直してください。"); return false; }
    if (!pending || pending.text !== text || pending.replyTo !== replyTo) pending = { text, replyTo, clientId: crypto.randomUUID() };
    const sent = pending;
    return new Promise(resolve => s.timeout(8000).emit("room3 message", sent, (err, result) => {
      if (uid !== window.auth?.currentUser?.uid || id !== sessionId) return resolve(false);
      if (err || !result?.ok) { status("送信を確認できませんでした。入力は残しています。少し待ってから再送してください。"); return resolve(false); }
      if (pending === sent) pending = null;
      resolve(true);
    }));
  }
  window.EmuDialogue = { connect, close, send, get sessionId() { return sessionId; } };
})();
