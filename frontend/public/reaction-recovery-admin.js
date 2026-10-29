/* 運営だけ：取りこぼした Good・Change の報酬（10/1 以降）を数えて、作り直す。

   画面が JSON の印を付けずに送っていたので、Good・Change を受け取った投稿者への報酬が
   記録されていなかった（10/29 に分かった）。サーバーが投稿に残っている「押した人」の一覧から
   まだ無い報酬だけを数え、運営が数を確かめてから作る。作った報酬は、投稿した人の
   「報酬を受け取る」に未請求の報酬として出る（公式ショップでは、そのまま使える）。

   数えるのは押したときだけ（全部の投稿を読むので、開くたびには読まない）。 */
(function () {
  function esc(value) { return String(value == null ? "" : value).replace(/[&<>\"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c])); }
  let lastMissing = null;
  function panel() {
    if (document.getElementById("emuerV2RecoveryPanel")) return;
    const tab = document.getElementById("tab-schoolpark");
    if (!tab) return;
    const html = '<div id="emuerV2RecoveryPanel" class="card">'
      + '<h3>EMUER：取りこぼした Good・Change の報酬（10/1以降）</h3>'
      + '<p class="empty" style="text-align:left;margin:0 0 10px">Good・Change を受け取った投稿者への報酬（1件 1 EMUER）が、送り方の不具合で記録されていませんでした。'
      + '「数える」で、まだ無い報酬の件数を出します。数を確かめてから「作り直す」を押すと、投稿した人の「報酬を受け取る」に出ます。'
      + '10/1 より前の分（移行のときに記録し直したもの）とは二重になりません。何度押しても、まだ無いものだけを作ります。</p>'
      + '<div class="actions"><button class="act neutral" id="ev2RecScan">数える</button><button class="act ok" id="ev2RecRun" disabled>作り直す</button></div>'
      + '<div id="ev2RecResult" class="empty" style="text-align:left"></div></div>';
    const budget = document.getElementById("emuerV2BudgetPanel");
    if (budget) budget.insertAdjacentHTML("afterend", html); else tab.insertAdjacentHTML("afterbegin", html);
    document.getElementById("ev2RecScan").onclick = scan;
    document.getElementById("ev2RecRun").onclick = run;
  }
  const kind = action => action === "change" ? "Change" : "Good";
  function show(d) {
    const box = document.getElementById("ev2RecResult"), runBtn = document.getElementById("ev2RecRun");
    lastMissing = d.missingEmuer;
    runBtn.disabled = !(d.missingEmuer > 0);
    const review = d.reviewCount ? '<h3 style="margin-top:14px">要確認（作りません）：' + esc(d.reviewCount) + '件</h3>'
      + d.review.map(r => '<div class="row"><span><b>' + esc(r.title || r.postId) + '</b><br><small>' + esc(r.reason) + '</small></span></div>').join("") : "";
    const sample = d.sample && d.sample.length ? '<h3 style="margin-top:14px">作るもの（はじめの' + esc(d.sample.length) + '件）</h3>'
      + d.sample.map(s => '<div class="row"><span><b>' + esc(s.title || s.postId) + '</b><br><small>' + esc(kind(s.action)) + ' · 投稿した人 ' + esc(String(s.author).slice(0, 6) + "…" + String(s.author).slice(-4)) + '</small></span><span>1 EMUER</span></div>').join("") : "";
    box.innerHTML = '<p>投稿 ' + esc(d.scannedPosts) + '件を調べました。<br>'
      + '<b>取りこぼし：Good ' + esc(d.missingGood) + '件・Change ' + esc(d.missingChange) + '件、合計 ' + esc(d.missingEmuer) + ' EMUER</b>（受け取る人 ' + esc(d.authors) + '人）</p>'
      + (d.missingEmuer ? '' : '<p>作り直すものはありません。</p>') + sample + review;
  }
  async function scan() {
    const box = document.getElementById("ev2RecResult");
    box.textContent = "数えています（投稿を全部読むので、少しかかります）…";
    document.getElementById("ev2RecRun").disabled = true;
    try { show(await window.emuerV2AdminApi("/admin/reaction-recovery")); }
    catch (error) { box.textContent = error.message === "OPERATOR_REQUIRED" ? "このパネルはEMUER v2運営ウォレットでのみ使えます。" : "数えられませんでした：" + (error.message || ""); }
  }
  async function run() {
    if (!(lastMissing > 0)) return;
    if (!confirm("取りこぼした報酬 " + lastMissing + " EMUER を作り直しますか？\n投稿した人の「報酬を受け取る」に、未請求の報酬として出ます。")) return;
    const box = document.getElementById("ev2RecResult"), runBtn = document.getElementById("ev2RecRun");
    runBtn.disabled = true;
    box.textContent = "作り直しています…";
    try {
      const d = await window.emuerV2AdminApi("/admin/reaction-recovery", { method:"POST", body:{ expectedMissing:lastMissing } });
      lastMissing = 0;
      box.innerHTML = '<p><b>' + esc(d.created) + ' EMUER ぶんの報酬を作り直しました</b>（受け取る人 ' + esc(d.authors) + '人）。<br>投稿した人の「報酬を受け取る」に、未請求の報酬として出ます。</p>';
    } catch (error) {
      if (error.code === "RECOVERY_CHANGED") { box.textContent = "数えたあとに数が変わりました。もう一度「数える」を押してください。"; return; }
      box.textContent = "作り直せませんでした：" + (error.message || "");
    }
  }
  window.addEventListener("load", function () {
    const tab = document.getElementById("tab-schoolpark");
    if (!tab) return;
    new MutationObserver(function () { panel(); }).observe(tab, { childList:true });
    setTimeout(panel, 900);
  });
})();
