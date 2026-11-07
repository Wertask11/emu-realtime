/* 運営だけ：取りこぼした初投稿キャンペーンの報酬（100 EMUER）を、さかのぼって作る（11/7 創業者承認）。

   11/7 まで、Knowledge Lab で公開した投稿は「初めて公開した」の知らせを出していなかった。
   そのため Lab で最初に公開した人は申し込みが届かず、そのあとの通常の投稿も「初めてではない」と断られていた。
   サーバーが、ふだんの申し込みと同じ決まり（パスポートの最初の投稿が期間内・今も公開中）で数え、
   運営が数を確かめてから作る。作った報酬は、本人の「報酬を受け取る」に未請求の報酬として出る。
   鍵はふだんの申し込みと同じなので、もう受け取っている人に二重には作らない。

   数えるのは押したときだけ（全部の投稿を読むので、開くたびには読まない）。 */
(function () {
  function esc(value) { return String(value == null ? "" : value).replace(/[&<>\"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c])); }
  const short = a => String(a || "").slice(0, 6) + "…" + String(a || "").slice(-4);
  let lastMissing = null;
  function panel() {
    if (document.getElementById("emuerV2FirstPostPanel")) return;
    const tab = document.getElementById("tab-schoolpark");
    if (!tab) return;
    const html = '<div id="emuerV2FirstPostPanel" class="card">'
      + '<h3>EMUER：取りこぼした初投稿キャンペーンの報酬（100 EMUER）</h3>'
      + '<p class="empty" style="text-align:left;margin:0 0 10px">Knowledge Lab で最初に公開した人などに、初投稿の報酬が届いていませんでした。'
      + '「数える」で、パスポートの最初の投稿が期間内（10/29〜11/28）で、まだ報酬が無い人を数えます。数を確かめてから「作る」を押すと、本人の「報酬を受け取る」に出ます。'
      + 'もう受け取っている人には二重に作りません。最初の投稿を取り下げた人・パスポートが決められない人は「要確認」として出し、作りません。</p>'
      + '<div class="actions"><button class="act neutral" id="ev2FpScan">数える</button><button class="act ok" id="ev2FpRun" disabled>作る</button></div>'
      + '<div id="ev2FpResult" class="empty" style="text-align:left"></div></div>';
    const after = document.getElementById("emuerV2RecoveryPanel") || document.getElementById("emuerV2BudgetPanel");
    if (after) after.insertAdjacentHTML("afterend", html); else tab.insertAdjacentHTML("afterbegin", html);
    document.getElementById("ev2FpScan").onclick = scan;
    document.getElementById("ev2FpRun").onclick = run;
  }
  function show(d) {
    const box = document.getElementById("ev2FpResult"), runBtn = document.getElementById("ev2FpRun");
    lastMissing = d.missing;
    runBtn.disabled = !(d.missing > 0);
    const review = d.reviewCount ? '<h3 style="margin-top:14px">要確認（作りません）：' + esc(d.reviewCount) + '件</h3>'
      + d.review.map(r => '<div class="row"><span><b>' + esc(r.postId) + '</b><br><small>' + esc(r.reason) + ' · ' + esc(short(r.address)) + '</small></span></div>').join("") : "";
    const sample = d.sample && d.sample.length ? '<h3 style="margin-top:14px">作るもの（はじめの' + esc(d.sample.length) + '件）</h3>'
      + d.sample.map(s => '<div class="row"><span><b>' + esc(s.title || s.postId) + '</b><br><small>受け取る人 ' + esc(short(s.recipient)) + '</small></span><span>100 EMUER</span></div>').join("") : "";
    box.innerHTML = '<p>投稿 ' + esc(d.scannedPosts) + '件・パスポート ' + esc(d.passports) + '人を調べました。<br>'
      + '<b>取りこぼし：' + esc(d.missing) + '人、合計 ' + esc(d.missingEmuer) + ' EMUER</b></p>'
      + (d.missing ? '' : '<p>作るものはありません。</p>') + sample + review;
  }
  async function scan() {
    const box = document.getElementById("ev2FpResult");
    box.textContent = "数えています（投稿を全部読むので、少しかかります）…";
    document.getElementById("ev2FpRun").disabled = true;
    try { show(await window.emuerV2AdminApi("/admin/first-post-recovery")); }
    catch (error) { box.textContent = error.message === "OPERATOR_REQUIRED" ? "このパネルはEMUER v2運営ウォレットでのみ使えます。" : "数えられませんでした：" + (error.message || ""); }
  }
  async function run() {
    if (!(lastMissing > 0)) return;
    if (!confirm("初投稿の報酬を " + lastMissing + "人ぶん（" + lastMissing * 100 + " EMUER）作りますか？\n本人の「報酬を受け取る」に、未請求の報酬として出ます。")) return;
    const box = document.getElementById("ev2FpResult"), runBtn = document.getElementById("ev2FpRun");
    runBtn.disabled = true;
    box.textContent = "作っています…";
    try {
      const d = await window.emuerV2AdminApi("/admin/first-post-recovery", { method:"POST", body:{ expectedMissing:lastMissing } });
      lastMissing = 0;
      box.innerHTML = '<p><b>' + esc(d.created) + '人ぶん（' + esc(d.emuer) + ' EMUER）の初投稿の報酬を作りました。</b><br>本人の「報酬を受け取る」に、未請求の報酬として出ます。</p>';
    } catch (error) {
      if (error.code === "RECOVERY_CHANGED") { box.textContent = "数えたあとに数が変わりました。もう一度「数える」を押してください。"; return; }
      box.textContent = "作れませんでした：" + (error.message || "");
    }
  }
  window.addEventListener("load", function () {
    const tab = document.getElementById("tab-schoolpark");
    if (!tab) return;
    new MutationObserver(function () { panel(); }).observe(tab, { childList:true });
    setTimeout(panel, 1000);
  });
})();
