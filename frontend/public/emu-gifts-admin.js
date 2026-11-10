/* 運営だけ：みんなで決める（投票）と、体験チケットのお店の暗証番号（11/10）。membership-admin.html の「Emu」タブに出す。
   投票   … 問い・選択肢（2〜6）・1票に使う EMUER（0〜10・未変換）・日数で作る。締める・隠す。backend/emuer-gifts.js
   チケット … お店ごとに暗証番号（4〜8けた）を決める。お店の人が QR を読んで「使用済み」にするときに使う。
              保存するのはハッシュだけで、番号はあとから見られない。backend/shop-tickets.js */
(function () {
  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  const day = ms => ms ? new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(ms) : "—";
  const api = (p, o) => window.emuAdminApi(p, o);
  const input = 'style="padding:8px;border:1px solid #ddd;border-radius:8px;font:inherit"';

  function panel() {
    if (document.getElementById("emuGiftsAdmin")) return;
    const tab = document.getElementById("tab-emu");
    if (!tab) return;
    tab.insertAdjacentHTML("beforeend", '<div id="emuGiftsAdmin" class="card">'
      + '<h3>みんなで決める（投票）</h3>'
      + '<p class="empty" style="text-align:left;margin:0 0 10px">知識を読むの一覧の上に出ます。1人1票。1票に使う EMUER は、未変換の EMUER から引きます（0 なら無料）。</p>'
      + '<div style="display:grid;gap:8px">'
      + '<input id="pollQuestion" maxlength="120" placeholder="問い（例：次のグッズは？）" ' + input + '>'
      + '<textarea id="pollOptions" rows="4" placeholder="選択肢を1行に1つ（2〜6）" ' + input + '></textarea>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><label>1票 <input id="pollCost" type="number" min="0" max="10" value="1" style="width:70px;padding:8px;border:1px solid #ddd;border-radius:8px"> EMUER</label>'
      + '<label>締め切り <input id="pollDays" type="number" min="1" max="60" value="14" style="width:70px;padding:8px;border:1px solid #ddd;border-radius:8px"> 日後</label>'
      + '<button class="act" id="pollCreate">投票を作る</button></div></div>'
      + '<div id="pollList" style="margin-top:12px"></div>'
      + '<h3 style="margin-top:22px">体験チケット：お店の暗証番号</h3>'
      + '<p class="empty" style="text-align:left;margin:0 0 10px">交換した人が「🎫 チケットを出す」で QR を見せ、お店の人がそれを読んで、この暗証番号で「使用済み」にします。'
      + '体験チケットの品は、ショップの商品を「受け取り方：会場で受け取る（pickup）」か「オンライン」で登録してください。番号はあとから見られないので、お店へ直接伝えてください。</p>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><select id="ticketShop" ' + input + '><option value="schoolpark-official">SchoolPark公式ショップ</option></select>'
      + '<input id="ticketPin" inputmode="numeric" maxlength="8" placeholder="4〜8けたの数字" ' + input + '>'
      + '<button class="act" id="ticketPinSave">暗証番号を決める</button></div>'
      + '<div id="ticketPinState" class="empty" style="text-align:left;margin-top:8px"></div></div>');
    document.getElementById("pollCreate").onclick = create;
    document.getElementById("ticketPinSave").onclick = savePin;
    loadPolls(); loadShops();
  }

  async function loadPolls() {
    const box = document.getElementById("pollList");
    try {
      const d = await api("/api/emu/gifts/admin/polls");
      const rows = d.polls || [];
      if (!rows.length) { box.innerHTML = '<p class="empty">まだ投票はありません。</p>'; return; }
      box.innerHTML = rows.map(p => '<div class="row" style="display:block;padding:8px 0;border-bottom:1px solid #eee">'
        + '<b>' + esc(p.question) + '</b>　' + (p.open ? '<span style="color:#1b5e20">受付中</span>' : '締切') + (p.visible ? '' : '（非表示）')
        + '<br><small>' + p.options.map(o => esc(o.label) + ' ' + o.votes + '票').join('　') + '　計 ' + p.votes + '票　1票 ' + p.cost + ' EMUER　締め切り ' + esc(day(p.closesAt)) + '</small><br>'
        + (p.open ? '<button class="act no" data-poll-close="' + esc(p.id) + '">締める</button>' : '')
        + (p.visible ? '<button class="act neutral" data-poll-hide="' + esc(p.id) + '">締めて隠す</button>' : '') + '</div>').join("");
      box.querySelectorAll("[data-poll-close],[data-poll-hide]").forEach(b => {
        b.onclick = async () => {
          const id = b.dataset.pollClose || b.dataset.pollHide;
          if (!confirm(b.dataset.pollHide ? "この投票を締めて、画面から隠します。よろしいですか？" : "この投票を締めます。よろしいですか？")) return;
          try { await api("/api/emu/gifts/admin/polls/" + encodeURIComponent(id) + "/close", { method: "POST", body: { hide: !!b.dataset.pollHide } }); }
          catch (e) { alert("できませんでした（" + (e.code || e.message) + "）"); }
          loadPolls();
        };
      });
    } catch (e) { box.textContent = "読めませんでした（" + (e.code || e.message) + "）"; }
  }
  async function create() {
    const question = document.getElementById("pollQuestion").value.trim();
    const options = document.getElementById("pollOptions").value.split("\n").map(s => s.trim()).filter(Boolean);
    const cost = Number(document.getElementById("pollCost").value);
    const days = Number(document.getElementById("pollDays").value);
    if (!question || options.length < 2 || options.length > 6) { alert("問いと、2〜6個の選択肢を書いてください。"); return; }
    if (!confirm("「" + question + "」の投票を作ります。すぐに知識を読むに出ます。よろしいですか？")) return;
    try {
      await api("/api/emu/gifts/admin/polls", { method: "POST", body: { question, options, cost, days } });
      document.getElementById("pollQuestion").value = ""; document.getElementById("pollOptions").value = "";
    } catch (e) { alert("作れませんでした（" + (e.code || e.message) + "）"); }
    loadPolls();
  }
  async function loadShops() {
    const sel = document.getElementById("ticketShop"), state = document.getElementById("ticketPinState");
    try {
      const [shops, staff] = await Promise.all([api("/api/mitemiru/admin/shops").catch(() => ({ shops: [] })), api("/api/emu/tickets/admin/staff").catch(() => ({ shops: [] }))]);
      (shops.shops || []).filter(s => s.id !== "schoolpark-official" && s.status !== "ended").forEach(s => {
        const o = document.createElement("option"); o.value = s.id; o.textContent = s.name + (s.storeType === "real_partner" ? "（提携店）" : ""); sel.appendChild(o);
      });
      const set = (staff.shops || []);
      state.textContent = set.length ? "暗証番号を決めてあるお店：" + set.map(s => s.shopId + "（" + day(s.updatedAt) + "）").join("、") : "まだどのお店も暗証番号を決めていません。";
    } catch (e) { state.textContent = "読めませんでした（" + (e.code || e.message) + "）"; }
  }
  async function savePin() {
    const shopId = document.getElementById("ticketShop").value, pin = document.getElementById("ticketPin").value.trim();
    if (!/^\d{4,8}$/.test(pin)) { alert("4〜8けたの数字にしてください。"); return; }
    if (!confirm("このお店の暗証番号を決めます（前の番号は使えなくなります）。よろしいですか？")) return;
    try { await api("/api/emu/tickets/admin/staff/" + encodeURIComponent(shopId), { method: "POST", body: { pin } }); document.getElementById("ticketPin").value = ""; alert("決めました。お店の方へ番号を直接伝えてください。"); }
    catch (e) { alert("決められませんでした（" + (e.code || e.message) + "）"); }
    const sel = document.getElementById("ticketShop"); while (sel.options.length > 1) sel.remove(1); loadShops();
  }

  window.addEventListener("load", function () {
    const tab = document.getElementById("tab-emu");
    if (!tab) return;
    new MutationObserver(function () { panel(); }).observe(tab, { childList: true });
    setTimeout(panel, 900);
  });
})();
