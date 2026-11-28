/* 運営だけ：たまり場の通報と、協賛・応援の合計（11/28 管理画面といまのアプリの突き合わせ）。
   membership-admin.html の「知識を試す・City」タブに出す。
   - たまり場の通報 … ちがう3人から通報されると自動で隠れる。ここで本文を見て「隠したままにする／戻す」を決める。
                        サーバー：backend/tamariba.js の /admin/reports・/admin/hide（運営だけ）。通報した人はここにも出さない。
   - 協賛・応援     … クエストの協賛の袋（積まれた額・残り・受け取った人数）と、投稿への応援の合計。読むだけ。
                        サーバー：backend/emuer-gifts.js の /admin/summary（運営だけ）。だれが贈ったかは出さない。 */
(function () {
  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  const when = (ms) => ms ? new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(ms) : "—";
  const api = (p, o) => window.emuAdminApi(p, o);
  const ROOMS = { today: "今日なにしてた？", hobby: "好きなことを語る", together: "なにか一緒にやりたい", learnwork: "学び・仕事の相談", tech: "開発・Web3 雑談" };
  const REASONS = { spam: "宣伝・スパム", harass: "いやがらせ", personal: "個人情報", other: "その他" };

  function panel() {
    const tab = document.getElementById("tab-schoolpark");
    if (!tab || document.getElementById("tamaReportsAdmin")) return;
    tab.insertAdjacentHTML("beforeend",
      '<div id="tamaReportsAdmin" class="card"><h3>たまり場の通報</h3>'
      + '<p class="empty" style="text-align:left;margin:0 0 10px">ちがう3人から通報された書き込みは、自動で隠れます（書いた本人には見えます）。本文を見て、隠したままにするか戻すかを決めてください。通報した人はここにも出ません。</p>'
      + '<div class="actions"><button class="act neutral" id="tamaLoad">読み込む</button></div><div id="tamaReports"></div></div>'
      + '<div id="giftsSummaryAdmin" class="card"><h3>協賛と応援（アプリ内EMUER）</h3>'
      + '<p class="empty" style="text-align:left;margin:0 0 10px">クエストに積まれた協賛の袋と、投稿への応援の合計です。読むだけで、だれが贈ったかは出しません。</p>'
      + '<div class="actions"><button class="act neutral" id="giftsSumLoad">読み込む</button></div><div id="giftsSummary"></div></div>');
    document.getElementById("tamaLoad").onclick = loadReports;
    document.getElementById("giftsSumLoad").onclick = loadSummary;
  }

  function why(e) { return e && e.code === "OWNER_ONLY" ? "運営のアカウントでのみ見られます。" : "読み込めませんでした（" + esc((e && (e.code || e.message)) || "") + "）"; }

  async function loadReports() {
    const box = document.getElementById("tamaReports");
    box.innerHTML = '<p class="empty">読み込んでいます…</p>';
    let d;
    try { d = await api("/api/schoolpark/tamariba/admin/reports"); } catch (e) { box.innerHTML = '<p class="empty">' + why(e) + '</p>'; return; }
    const rows = (d.targets || []).filter((t) => t.exists !== false && !t.deleted).sort((a, b) => b.lastAtMs - a.lastAtMs);
    if (!rows.length) { box.innerHTML = '<p class="empty">いま見る必要のある通報はありません。</p>'; return; }
    box.innerHTML = rows.map((t) => {
      const state = t.hidden ? '<span class="pill" style="background:#fde2e2;color:#9b1c1c">隠れています</span>' : '<span class="pill">表示中</span>';
      const seen = t.reviewedAtMs ? ' · 運営が確認 ' + when(t.reviewedAtMs) : ' · <b style="color:#b45309">まだ確認していません</b>';
      const reasons = Object.keys(t.reasons || {}).map((k) => (REASONS[k] || k) + " " + t.reasons[k]).join("・");
      return '<div style="border-top:1px solid var(--line);padding-top:12px;margin-top:12px" data-tama-row="' + esc(t.target) + '">'
        + '<div class="meta">' + esc(ROOMS[t.room] || t.room) + (t.replyId ? '（返信）' : '') + ' · ' + esc(t.authorName || "—") + ' · 最後の通報 ' + when(t.lastAtMs) + '</div>'
        + '<p style="margin:6px 0">' + state + ' 通報 ' + esc(t.reportCount) + ' 件（' + esc(reasons) + '）' + seen + '</p>'
        + '<p style="white-space:pre-wrap;font-size:14px;margin:6px 0;padding:8px;background:#faf7f0;border-radius:8px">' + esc(t.body || "（本文なし）") + '</p>'
        + '<div class="actions">'
        + '<button class="act no" data-tama-hide="1" data-room="' + esc(t.room) + '" data-post="' + esc(t.postId) + '" data-reply="' + esc(t.replyId || "") + '">隠したままにする</button>'
        + '<button class="act ok" data-tama-hide="0" data-room="' + esc(t.room) + '" data-post="' + esc(t.postId) + '" data-reply="' + esc(t.replyId || "") + '">問題なし（表示に戻す）</button>'
        + '</div></div>';
    }).join("");
    box.querySelectorAll("[data-tama-hide]").forEach((b) => {
      b.onclick = async () => {
        const hidden = b.dataset.tamaHide === "1";
        if (!confirm(hidden ? "この書き込みを隠したままにします。" : "この書き込みを、みんなに見えるように戻します。")) return;
        b.disabled = true;
        try { await api("/api/schoolpark/tamariba/admin/hide", { method: "POST", body: Object.assign({ room: b.dataset.room, postId: b.dataset.post, hidden }, b.dataset.reply ? { replyId: b.dataset.reply } : {}) }); }
        catch (e) { alert(why(e)); b.disabled = false; return; }
        loadReports();
      };
    });
  }

  async function loadSummary() {
    const box = document.getElementById("giftsSummary");
    box.innerHTML = '<p class="empty">読み込んでいます…</p>';
    let d;
    try { d = await api("/api/emu/gifts/admin/summary"); } catch (e) { box.innerHTML = '<p class="empty">' + why(e) + '</p>'; return; }
    const s = d.sponsor || { pots: [] }, c = d.cheer || { top: [] };
    box.innerHTML = '<div class="row"><span>協賛：積まれた合計</span><span>' + esc(s.total) + ' EMUER</span></div>'
      + '<div class="row"><span>協賛：完走した人が受け取った合計</span><span>' + esc(s.paidOut) + ' EMUER</span></div>'
      + '<div class="row"><span>応援：応援された投稿</span><span>' + esc(c.posts) + ' 件・合計 ' + esc(c.total) + ' EMUER</span></div>'
      + '<h3 style="margin-top:14px">クエストごとの協賛の袋</h3>'
      + (s.pots.length ? s.pots.map((p) => '<div class="row"><span>' + esc(p.title || p.questId) + '<br><small>協賛 ' + esc(p.sponsors) + ' 人・受け取り ' + esc(p.bonusCount) + ' 人</small></span>'
          + '<span>残り ' + esc(p.pot) + ' / 合計 ' + esc(p.total) + ' EMUER</span></div>').join("")
        : '<p class="empty">まだ協賛はありません。</p>')
      + '<h3 style="margin-top:14px">応援が多い投稿</h3>'
      + (c.top.length ? c.top.map((t) => '<div class="row"><span>' + esc(t.title || t.postId) + '</span><span>' + esc(t.people) + ' 人・' + esc(t.total) + ' EMUER</span></div>').join("")
        : '<p class="empty">まだ応援はありません。</p>');
  }

  /* 「知識を試す・City」タブは開くたびに描き直されるので、消えたら付け直す */
  function watch() {
    panel();
    const tab = document.getElementById("tab-schoolpark");
    if (tab && !tab.dataset.communityWatch) { tab.dataset.communityWatch = "1"; new MutationObserver(panel).observe(tab, { childList: true }); }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", watch); else watch();
  setTimeout(watch, 1500);
})();
