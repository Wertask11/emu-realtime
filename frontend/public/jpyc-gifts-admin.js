/* 運営だけ：12月の挑戦納めカレンダーの JPYC を、まとめて送るための一覧（11/28 オーナー決定）。
   特別な日（12/5・15 は 10、12/25 は 30、12/31 は 50 JPYC）にログインボーナスを受け取った人が「送る予定」に並ぶ。
   12月の合計は 10,000 JPYC まで。サーバーは送らない（鍵を置かない）。運営がウォレットから送り、取引ID（0x…64桁）を入れて「送り済み」にする。
   LINE・Google の人は、本人が受け取るアドレスを登録するまで「アドレス待ち」（ここには出ない）。 */
(function () {
  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  function panel() {
    if (document.getElementById("jpycGiftsPanel")) return;
    const tab = document.getElementById("tab-schoolpark");
    if (!tab) return;
    tab.insertAdjacentHTML("afterbegin", '<div id="jpycGiftsPanel" class="card">'
      + '<h3>12月の挑戦納めカレンダー（ログインボーナス・JPYC）</h3>'
      + '<div class="row"><span>12月の通常日</span><span>ログインボーナス 2 EMUER</span></div>'
      + '<div class="row"><span>12/5（土）週末のクエストDay・12/15（火）知識シェアDay</span><span>5 EMUER ＋ 10 JPYC</span></div>'
      + '<div class="row"><span>12/22（火）冬至（City にひとこと）</span><span>2 EMUER</span></div>'
      + '<div class="row"><span>12/25（金）クリスマス（City に雪とツリー）</span><span>10 EMUER ＋ 30 JPYC</span></div>'
      + '<div class="row"><span>12/31（木）挑戦納め（年越しの願い・除夜の鐘）</span><span>20 EMUER ＋ 50 JPYC</span></div>'
      + '<p class="empty" style="text-align:left;margin:6px 0 10px">EMUER は「報酬を受け取る」でその場で受け取れます（1日1回）。1/1 からはふだんの 1 EMUER に戻ります。額を変えるときは backend/emuer-v2/calendar.js と jpyc-gifts.js を書き換えます。</p>'
      + '<h3 style="margin-top:14px">JPYC：まとめて送る一覧</h3>'
      + '<p class="empty" style="text-align:left;margin:0 0 10px">特別な日にログインボーナスを受け取った人へ送る JPYC です（12/5・15 は 10、12/25 は 30、12/31 は 50。12月の合計は 10,000 JPYC まで）。'
      + '<b>送るのは 1月中旬</b>（利用者にはそう伝えています）。ウォレットから送ったら、その取引ID（0x から始まる66文字）を入れて「送り済み」にしてください。同じ人への分は「送る先ごとの合計」で1回にまとめて送れます。</p>'
      + '<div class="actions"><button class="act neutral" id="jpycLoad">読み込む</button><button class="act neutral" id="jpycCopy" disabled>送る先ごとの合計をコピー</button></div>'
      + '<div id="jpycResult" class="empty" style="text-align:left"></div></div>');
    document.getElementById("jpycLoad").onclick = load;
    document.getElementById("jpycCopy").onclick = copy;
  }
  let last = null;
  function byAddress(rows) {
    const m = new Map();
    rows.forEach((r) => m.set(r.address, (m.get(r.address) || 0) + Number(r.amountJpyc || 0)));
    return [...m.entries()];
  }
  async function load() {
    const box = document.getElementById("jpycResult");
    box.textContent = "読み込んでいます…";
    try {
      const d = await window.emuerV2AdminApi("/admin/jpyc-gifts");
      last = d;
      document.getElementById("jpycCopy").disabled = !d.pending.length;
      const budget = (d.budgets || []).find((b) => b.month === "2026-12") || { totalJpyc: 0, limitJpyc: 10000 };
      box.innerHTML = '<p><b>送る予定 ' + esc(d.totals.pending) + ' JPYC</b>・アドレス待ち ' + esc(d.totals.needsAddress) + ' JPYC・送り済み ' + esc(d.totals.sent) + ' JPYC'
        + '<br>12月の記録 ' + esc(budget.totalJpyc) + ' / ' + esc(budget.limitJpyc || 10000) + ' JPYC</p>'
        + (d.pending.length ? '<h3 style="margin-top:12px">送る先ごとの合計</h3>' + byAddress(d.pending).map(([a, n]) => '<div class="row"><span><code>' + esc(a) + '</code></span><span>' + esc(n) + ' JPYC</span></div>').join("")
          + '<h3 style="margin-top:12px">1件ずつ（送ったら取引IDを入れる）</h3>'
          + d.pending.map((r) => '<div class="row"><span>' + esc(r.day) + '<br><small><code>' + esc(r.address) + '</code></small></span><span>' + esc(r.amountJpyc) + ' JPYC '
            + '<input data-jpyc-tx="' + esc(r.id) + '" placeholder="0x…（取引ID）" style="width:200px"> <button class="act ok" data-jpyc-sent="' + esc(r.id) + '">送り済み</button></span></div>').join("")
          : '<p>送る予定のものはありません。</p>');
      box.querySelectorAll("[data-jpyc-sent]").forEach((b) => { b.onclick = () => sent(b.getAttribute("data-jpyc-sent")); });
    } catch (error) { box.textContent = error.message === "OPERATOR_REQUIRED" ? "このパネルはEMUER v2運営ウォレットでのみ使えます。" : "読み込めませんでした：" + (error.message || ""); }
  }
  async function sent(id) {
    const input = document.querySelector('[data-jpyc-tx="' + CSS.escape(id) + '"]');
    const tx = String(input && input.value || "").trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(tx)) { alert("取引ID（0x から始まる66文字）を入れてください。"); return; }
    try { await window.emuerV2AdminApi("/admin/jpyc-gifts/" + encodeURIComponent(id) + "/sent", { method: "POST", body: { txHash: tx } }); await load(); }
    catch (error) { alert(error.message === "NOT_PENDING" ? "もう送り済みになっています。" : "記録できませんでした：" + (error.message || "")); }
  }
  async function copy() {
    if (!last) return;
    const text = byAddress(last.pending).map(([a, n]) => a + "," + n).join("\n");
    try { await navigator.clipboard.writeText(text); alert("コピーしました（アドレス,JPYC の形）"); } catch (_) { prompt("コピーしてください", text); }
  }
  /* 「知識を試す・City」タブは開くたびに描き直されるので、消えたら付け直す（11/28 点検：開くと消えていた） */
  function watch() {
    panel();
    const tab = document.getElementById("tab-schoolpark");
    if (tab && !tab.dataset.jpycWatch) { tab.dataset.jpycWatch = "1"; new MutationObserver(panel).observe(tab, { childList: true }); }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", watch); else watch();
  setTimeout(watch, 1500);
})();
