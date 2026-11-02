/* 運営だけ：投稿の記録（11/2）。

   覚えの無い投稿を調べたとき、どの端末から書いたかが分からなかった。投稿・書き直し・削除のときに、
   サーバーが端末の種類・OS・ブラウザ・ログインの方法とその時刻を残している（backend/post-audit.js）。
   ここで、投稿ID か 名義（0x…）で引く。空のまま押すと、この2週間のものを新しい順に出す。
   IP・位置・本文は残していない。 */
(function () {
  function esc(value) { return String(value == null ? "" : value).replace(/[&<>\"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c])); }
  const jst = ms => ms ? new Intl.DateTimeFormat("ja-JP", { timeZone:"Asia/Tokyo", year:"numeric", month:"numeric", day:"numeric", hour:"2-digit", minute:"2-digit", second:"2-digit" }).format(ms) : "—";
  const short = a => a ? String(a).slice(0, 6) + "…" + String(a).slice(-4) : "";
  const KIND = { create:"投稿", edit:"書き直し", delete:"削除" };
  function panel() {
    if (document.getElementById("postAuditPanel")) return;
    const tab = document.getElementById("tab-emu");
    if (!tab) return;
    tab.insertAdjacentHTML("afterbegin", '<div id="postAuditPanel" class="card">'
      + '<h3>投稿の記録（運営だけ）</h3>'
      + '<p class="empty" style="text-align:left;margin:0 0 10px">投稿・書き直し・削除のときの、端末の種類・OS・ブラウザ・ログインの方法とその時刻です。'
      + '投稿ID か 名義（0x…）で調べます。空のまま「調べる」で、この2週間のものを出します。IP・位置・本文は残していません。</p>'
      + '<div class="actions"><input id="postAuditQuery" placeholder="投稿ID または 0x…" style="flex:1;min-width:0;padding:8px;border:1px solid #ddd;border-radius:8px">'
      + '<button class="act neutral" id="postAuditRun">調べる</button></div>'
      + '<div id="postAuditResult" class="empty" style="text-align:left"></div></div>');
    document.getElementById("postAuditRun").onclick = run;
  }
  async function run() {
    const q = String(document.getElementById("postAuditQuery").value || "").trim();
    const box = document.getElementById("postAuditResult");
    box.textContent = "読んでいます…";
    const query = !q ? "" : /^0x[0-9a-fA-F]{40}$/.test(q) ? "?address=" + encodeURIComponent(q.toLowerCase()) : "?postId=" + encodeURIComponent(q);
    try {
      const d = await window.emuAdminApi("/api/post-audit/admin" + query);
      const rows = d.records || [];
      if (!rows.length) { box.textContent = "記録はありません（記録を始める前の投稿は出ません）。"; return; }
      box.innerHTML = rows.map(r => '<div class="row" style="display:block;padding:8px 0;border-bottom:1px solid #eee">'
        + '<b>' + esc(jst(r.recordedAtMs)) + '　' + esc(KIND[r.kind] || r.kind) + (r.kind === "delete" ? "（" + (r.by === "owner" ? "運営" : "本人") + "）" : "") + '</b>　' + esc(r.title || r.postId) + '<br>'
        + '<small>名義 ' + esc(short(r.address)) + '　端末 ' + esc((r.device && r.device.type) || "不明") + ' / ' + esc((r.device && r.device.os) || "不明") + ' / ' + esc((r.device && r.device.browser) || "不明")
        + '　ログイン ' + esc(r.signIn) + '（' + esc(jst(r.authTimeMs)) + ' にログイン）'
        + (r.reason ? '　理由 ' + esc(r.reason) : '') + '<br>投稿ID ' + esc(r.postId) + '<br><span style="color:#999">' + esc(r.userAgent || "") + '</span></small></div>').join("");
    } catch (error) {
      box.textContent = error.code === "OWNER_ONLY" ? "このパネルはオーナーだけが使えます。" : "読めませんでした：" + (error.code || error.message || "");
    }
  }
  window.addEventListener("load", function () {
    const tab = document.getElementById("tab-emu");
    if (!tab) return;
    new MutationObserver(function () { panel(); }).observe(tab, { childList:true });
    setTimeout(panel, 900);
  });
})();
