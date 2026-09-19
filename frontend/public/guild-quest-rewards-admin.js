/* Owner-only EMUER v2 Guild/Quest budget panel.  It is intentionally separate
   from the existing SchoolPark controls: publishing a budget never changes a
   Quest, and approving a contribution never changes its legacy completion. */
(function () {
  function esc(value) { return String(value == null ? "" : value).replace(/[&<>\"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c])); }
  function panel() {
    if (document.getElementById("emuerV2BudgetPanel")) return;
    const tab = document.getElementById("tab-schoolpark");
    if (!tab) return;
    tab.insertAdjacentHTML("afterbegin", '<div id="emuerV2BudgetPanel" class="card">'
      + '<h3>EMUER v2：ギルド・クエストの個別予算</h3>'
      + '<p class="empty" style="text-align:left;margin:0 0 10px">公開した予算と条件の範囲でのみ、実際の貢献を確認して配分します。Quest #000と公園には報酬を付けません。</p>'
      + '<label>対象</label><select id="ev2ScopeType"><option value="quest">クエスト</option><option value="guild">ギルド</option></select>'
      + '<label>対象ID</label><input id="ev2ScopeId" placeholder="例：Questの文書ID または learn">'
      + '<label>公開する題名</label><input id="ev2Title" placeholder="例：Quest #001 実施協力">'
      + '<label>条件（実際に何を確認するか）</label><textarea id="ev2Conditions" rows="3" placeholder="例：途中報告と成果物を確認し、貢献量に応じて運営が配分する"></textarea>'
      + '<label>予算（EMUER・整数）</label><input id="ev2Total" inputmode="numeric" value="1">'
      + '<div class="actions"><button class="act ok" id="ev2Publish">予算と条件を公開する</button><button class="act neutral" id="ev2Refresh">候補を読み直す</button></div>'
      + '<div id="ev2Pending" class="empty">読み込み中…</div></div>');
    document.getElementById("ev2Publish").onclick = publish;
    document.getElementById("ev2Refresh").onclick = refresh;
    refresh();
  }
  function value(id) { const el = document.getElementById(id); return el ? el.value.trim() : ""; }
  async function publish() {
    try {
      await window.emuerV2AdminApi("/guild-quest/budgets", { method:"POST", body:{ scopeType:value("ev2ScopeType"), scopeId:value("ev2ScopeId"), title:value("ev2Title"), conditions:value("ev2Conditions"), totalEmuer:Number(value("ev2Total")) } });
      alert("予算と条件を公開しました。実際の貢献候補を承認できるようになりました。");
      refresh();
    } catch (error) { alert(error.message || "公開できませんでした"); }
  }
  async function refresh() {
    const box = document.getElementById("ev2Pending"); if (!box || typeof window.emuerV2AdminApi !== "function") return;
    box.textContent = "候補を読み込んでいます…";
    try {
      const [budgetData, contributionData] = await Promise.all([
        window.emuerV2AdminApi("/guild-quest/budgets"), window.emuerV2AdminApi("/guild-quest/contributions")
      ]);
      const budgets = budgetData.budgets || [], pending = contributionData.contributions || [];
      const budgetList = budgets.length ? budgets.map(row => '<div class="row"><span><b>' + esc(row.title) + '</b><br><small>' + esc(row.scopeType + ": " + row.scopeId) + '／' + esc(row.conditions) + '</small></span><span>' + row.allocatedEmuer + ' / ' + row.totalEmuer + ' EMUER</span></div>').join("") : '<p class="empty">公開中の個別予算はありません。</p>';
      const candidateList = pending.length ? pending.map(row => '<div class="row" style="align-items:center"><span><b>' + esc(row.scopeType + ": " + row.scopeId) + '</b><br><small>' + esc(row.recipient) + (row.evidenceLogId ? '／報告 ' + esc(row.evidenceLogId) : '') + '</small></span><span><input data-ev2-amount="' + esc(row.id) + '" inputmode="numeric" value="1" style="width:70px;margin:0"> <button class="act ok" data-ev2-approve="' + esc(row.id) + '">承認</button></span></div>').join("") : '<p class="empty">承認待ちの貢献はありません。</p>';
      box.innerHTML = '<h3 style="margin-top:18px">公開中の予算</h3>' + budgetList + '<h3 style="margin-top:18px">実際の貢献（承認待ち）</h3>' + candidateList;
      box.querySelectorAll("[data-ev2-approve]").forEach(button => { button.onclick = async function () {
        const id = button.dataset.ev2Approve, input = box.querySelector('[data-ev2-amount="' + id + '"]');
        if (!confirm("実際の貢献を確認済みとして、この金額をトレジャリー報酬にしますか？")) return;
        try { await window.emuerV2AdminApi("/guild-quest/contributions/" + encodeURIComponent(id) + "/approve", { method:"POST", body:{ amountEmuer:Number(input.value) } }); refresh(); }
        catch (error) { alert(error.message || "承認できませんでした"); }
      }; });
    } catch (error) { box.textContent = error.message === "OPERATOR_REQUIRED" ? "このパネルはEMUER v2運営ウォレットでのみ使えます。" : "読み込めませんでした：" + (error.message || ""); }
  }
  window.addEventListener("load", function () {
    const tab = document.getElementById("tab-schoolpark");
    if (!tab) return;
    new MutationObserver(function () { panel(); }).observe(tab, { childList:true });
    setTimeout(panel, 800);
  });
})();
