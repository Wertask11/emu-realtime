/* 運営だけ：画面のエラー（11/3 点検 15）。
   利用者のブラウザで起きたエラーを、この7日分、多い順に出す（backend/client-errors.js）。
   人を特定する情報は集めていない。同じエラーは1日1件にまとめて数えている。 */
(function () {
  function esc(value) { return String(value == null ? "" : value).replace(/[&<>\"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c])); }
  const jst = ms => ms ? new Intl.DateTimeFormat("ja-JP", { timeZone:"Asia/Tokyo", month:"numeric", day:"numeric", hour:"2-digit", minute:"2-digit" }).format(ms) : "—";
  function panel() {
    if (document.getElementById("clientErrorsPanel")) return;
    const tab = document.getElementById("tab-emu");
    if (!tab) return;
    const after = document.getElementById("postAuditPanel");
    const html = '<div id="clientErrorsPanel" class="card">'
      + '<h3>画面のエラー（運営だけ）</h3>'
      + '<p class="empty" style="text-align:left;margin:0 0 10px">利用者のブラウザで起きたエラーを、この7日分、多い順に出します。人を特定する情報は集めていません。</p>'
      + '<div class="actions"><button class="act neutral" id="clientErrorsRun">読み直す</button></div>'
      + '<div id="clientErrorsResult" class="empty" style="text-align:left">ログインすると読み込みます。</div></div>';
    if (after) after.insertAdjacentHTML("afterend", html); else tab.insertAdjacentHTML("afterbegin", html);
    document.getElementById("clientErrorsRun").onclick = run;
  }
  async function run() {
    const box = document.getElementById("clientErrorsResult");
    if (!box || typeof window.emuAdminApi !== "function") return;
    box.textContent = "読んでいます…";
    try {
      const d = await window.emuAdminApi("/api/client-errors/admin");
      const rows = d.errors || [];
      if (!rows.length) { box.textContent = "この7日、画面のエラーは届いていません。"; return; }
      box.innerHTML = rows.map(r => '<div class="row" style="display:block;padding:8px 0;border-bottom:1px solid #eee">'
        + '<b>' + esc(r.count) + '回</b>　' + esc(r.message) + '<br>'
        + '<small>' + esc(r.page || "") + '　' + esc((r.source || "（ファイル不明）") + (r.line ? ":" + r.line + ":" + r.col : ""))
        + '　' + (r.kind === "rejection" ? "（約束の失敗）" : "") + '最後 ' + esc(jst(r.lastAtMs)) + '　日 ' + esc((r.days || []).join("・")) + '</small></div>').join("");
    } catch (error) {
      box.textContent = error.code === "LOGIN_REQUIRED" ? "ログインすると読み込みます。"
        : error.code === "OWNER_ONLY" ? "このパネルはオーナーだけが使えます。" : "読めませんでした：" + (error.code || error.message || "");
    }
  }
  window.addEventListener("load", function () {
    const tab = document.getElementById("tab-emu");
    if (!tab) return;
    new MutationObserver(function () { panel(); }).observe(tab, { childList:true });
    setTimeout(panel, 900);
  });
  window.addEventListener("emu-admin-ready", function () { panel(); run(); });
})();
