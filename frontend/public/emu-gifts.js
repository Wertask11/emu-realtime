/* EMUER の応援・協賛・投票（11/10）。index.html で読み込む。
   知識を読む（knowledge.html）と SchoolPark（schoolpark/dao.html）の画面から、window.parent.EmuGifts で呼ぶ。
   ログインの鍵は、このページ（親）が持っている。

   使うのは、まだ実EMUERに換えていない方の EMUER（未変換・残高の（ ）の中の数字）だけ。
   サーバー：backend/emuer-gifts.js。 */
(function (window, document) {
  'use strict';
  var BASE = 'https://emu-realtime.onrender.com/api/emu/gifts';
  var inboxCheckedFor = null;   // 最初の確認（台帳まで見る）を済ませた uid
  var inboxBusy = false, lastQuickAt = 0;
  var listeners = [];           // 知識の画面など：応援が届いた投稿の数を新しくするため
  var POLL_MS = 20000;

  var WORDS = {
    INSUFFICIENT_EMUER: '未変換のEMUERが足りないみたい🧊',
    DAILY_LIMIT: '応援と協賛は、1日100 EMUERまでだよ。また明日ね🧊',
    OWN_POST: '自分の投稿には応援できないよ🧊',
    POST_NOT_FOUND: 'この投稿は見つからなかったよ🧊',
    QUEST_NOT_FOUND: 'このクエストには協賛できないよ🧊',
    NOT_COMPLETED: '協賛のご褒美は、完走した人が受け取れるよ🧊',
    POT_EMPTY: '協賛の袋が空っぽみたい。また協賛が集まったら受け取れるよ🧊',
    PASSPORT_REQUIRED: 'パスポートIDがある人が受け取れるよ🧊',
    ALREADY_VOTED: 'この投票には、もう入れてあるよ🧊',
    POLL_CLOSED: 'この投票は締め切ったよ🧊',
    WALLET_REQUIRED: 'ログインしてね🧊',
    GIFTS_NOT_ACTIVE: 'いまは応援・協賛・投票を休んでいるよ🧊',
    RATE_LIMITED: '少し混んでいるみたい🧊 少し待ってね。'
  };
  function word(code, extra) {
    var w = WORDS[code] || 'うまくいかなかったみたい🧊 時間をおいて、もう一度ためしてね。';
    if (code === 'INSUFFICIENT_EMUER' && extra && typeof extra.balance === 'number') w += '（いま ' + extra.balance + ' EMUER）';
    return w;
  }
  function rid() { return 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }

  async function call(method, path, body, auth) {
    try {
      var headers = auth ? await window.emuAuthHeaders(true) : { 'Content-Type': 'application/json' };
      var r = await fetch(BASE + path, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined });
      var d = await r.json().catch(function () { return {}; });
      if (!r.ok) return Object.assign({ ok: false, code: String(d.error || ''), error: word(d.error, d) }, d, { ok: false });
      return Object.assign({ ok: true }, d);
    } catch (e) {
      return { ok: false, code: 'NETWORK', error: /ログイン/.test(String(e && e.message)) ? 'ログインしてね🧊' : 'うまくつながらなかったみたい🧊 もう一度ためしてね。' };
    }
  }
  function refreshBalance() {
    try { if (typeof window._emuSetOffchainBalance === 'function' && typeof window._emuOffchainBalance === 'function') {
      var addr = window.connectedAccount || localStorage.getItem('emuWallet') || '';
      window._emuOffchainBalance(addr, { fresh: true }).then(function () { try { window.loadEmuWalletCard && window.loadEmuWalletCard(); } catch (_) {} });
    } } catch (_) {}
  }

  /* ── 演出：花びら・紙吹雪 ──
     画面のどこからでも呼べる。target の上に舞わせる（target が無ければ画面の真ん中）。 */
  function petals(target, kind) {
    try {
      var doc = (target && target.ownerDocument) || document;
      var win = doc.defaultView || window;
      if (win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      var rect = target && target.getBoundingClientRect ? target.getBoundingClientRect() : { left: win.innerWidth / 2 - 20, top: win.innerHeight / 2, width: 40, height: 0 };
      var layer = doc.createElement('div');
      layer.setAttribute('aria-hidden', 'true');
      layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483000;overflow:hidden';
      var marks = kind === 'confetti' ? ['🎉', '✨', '🎊', '⭐', '🎁'] : ['🌸', '💐', '🌷', '✨', '💮'];
      for (var i = 0; i < 18; i++) {
        var p = doc.createElement('span');
        p.textContent = marks[i % marks.length];
        var x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
        var dx = (Math.random() - 0.5) * 260, dy = -120 - Math.random() * 160;
        p.style.cssText = 'position:absolute;left:' + x + 'px;top:' + y + 'px;font-size:' + (16 + Math.random() * 14) + 'px;transition:transform 1.4s cubic-bezier(.2,.7,.3,1),opacity 1.4s ease-in;opacity:1';
        layer.appendChild(p);
        (function (el, dx, dy) {
          win.requestAnimationFrame(function () { win.requestAnimationFrame(function () {
            el.style.transform = 'translate(' + dx + 'px,' + (dy + 260) + 'px) rotate(' + ((Math.random() - 0.5) * 540) + 'deg)';
            el.style.opacity = '0';
          }); });
        })(p, dx, dy);
      }
      doc.body.appendChild(layer);
      setTimeout(function () { layer.remove(); }, 1700);
    } catch (_) {}
  }

  /* ── 届いた応援・ご褒美のお知らせ ── */
  function showInbox(items, total, balance) {
    var names = [];
    items.forEach(function (x) { if (x.fromName && names.indexOf(x.fromName) < 0) names.push(x.fromName); });
    var who = names.length > 2 ? names.slice(0, 2).join('さん、') + 'さん ほか' + (names.length - 2) + '人' : names.join('さん、') + 'さん';
    var titles = [];
    items.forEach(function (x) { var t = x.postTitle || x.questTitle; if (t && titles.indexOf(t) < 0) titles.push(t); });
    var wrap = document.createElement('div');
    wrap.setAttribute('data-emu-gift-inbox', '');
    wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-modal', 'true'); wrap.setAttribute('aria-label', '応援が届きました');
    wrap.style.cssText = 'position:fixed;inset:0;z-index:2147482000;background:rgba(20,19,16,.45);display:flex;align-items:center;justify-content:center;padding:16px';
    var box = document.createElement('div');
    box.style.cssText = 'background:#fff;color:#141310;border-radius:18px;max-width:380px;width:100%;padding:22px;text-align:center;box-shadow:0 18px 50px rgba(0,0,0,.25);font-family:inherit';
    var big = document.createElement('div'); big.style.cssText = 'font-size:44px;line-height:1'; big.textContent = '💐';
    var h = document.createElement('p'); h.style.cssText = 'margin:10px 0 4px;font-weight:800;font-size:18px'; h.textContent = '応援が届いたよ！';
    var p = document.createElement('p'); p.style.cssText = 'margin:0;font-size:14px;line-height:1.8;color:#3b382f';
    p.textContent = who + 'から、あなたの知恵に合計 ' + total + ' EMUER の応援が届きました。';
    box.appendChild(big); box.appendChild(h); box.appendChild(p);
    if (titles.length) {
      var t = document.createElement('p'); t.style.cssText = 'margin:8px 0 0;font-size:12px;color:#6e695c;overflow-wrap:anywhere';
      t.textContent = '「' + titles.slice(0, 3).join('」「') + '」' + (titles.length > 3 ? ' ほか' : '');
      box.appendChild(t);
    }
    var note = document.createElement('p'); note.style.cssText = 'margin:10px 0 0;padding:8px 10px;border-radius:10px;background:#fdf2f8;font-size:13px;line-height:1.7;color:#9d174d';
    note.textContent = '届いたEMUERは、もう使えます。'
      + (typeof balance === 'number' ? 'いま未変換のEMUERは ' + balance + ' EMUER。' : '未変換のEMUER（残高の（ ）の中）に入っています。')
      + '応援・協賛・投票に使えます。';
    var btn = document.createElement('button'); btn.type = 'button'; btn.textContent = 'うれしい！';
    btn.style.cssText = 'margin-top:14px;border:0;border-radius:999px;padding:10px 22px;background:#c2185b;color:#fff;font:inherit;font-weight:700;cursor:pointer';
    btn.onclick = function () { wrap.remove(); };
    box.appendChild(note); box.appendChild(btn); wrap.appendChild(box);
    wrap.addEventListener('click', function (e) { if (e.target === wrap) wrap.remove(); });
    document.body.appendChild(wrap);
    btn.focus();
    petals(big);
  }
  /* 文字を打っている途中なら、お知らせはあとにする（打っている手を止めない）。 */
  function typing() {
    function editable(el) {
      if (!el) return false;
      var tag = (el.tagName || '').toLowerCase();
      return tag === 'textarea' || el.isContentEditable || (tag === 'input' && !/^(button|checkbox|radio|submit|range|file)$/i.test(el.type || ''));
    }
    try {
      var el = document.activeElement;
      if (el && el.tagName === 'IFRAME' && el.contentDocument) el = el.contentDocument.activeElement;
      return editable(el);
    } catch (_) { return false; }
  }
  function tell(event) {
    listeners = listeners.filter(function (fn) { try { fn(event); return true; } catch (_) { return false; } });
  }
  /* 届いた応援を見る。
     - 最初（ログインした人ごとに1回）は必ずサーバーの記録まで見る。
     - そのあと（画面に戻ったとき・開いている間は20秒ごと）は quick で聞く。何も届いていなければサーバーは記録を読まずに返す。
     見たしるしを付けると、サーバーが「いま使える未変換のEMUER」を返すので、それをお知らせに出す。 */
  async function checkInbox(opts) {
    var u = window.auth && window.auth.currentUser;
    if (!u || inboxBusy) return;
    if (document.visibilityState === 'hidden') return;
    if (document.querySelector('[data-emu-gift-inbox]')) return;
    var first = inboxCheckedFor !== u.uid;
    if (!first && typing()) return;
    inboxBusy = true;
    try {
      var d = await call('GET', '/inbox' + (first ? '' : '?quick=1'), null, true);
      if (!d.ok) return;
      inboxCheckedFor = u.uid;
      if (!Array.isArray(d.items) || !d.items.length) return;
      var cheers = d.items.filter(function (x) { return x.kind === 'cheer'; });
      var seen = await call('POST', '/inbox/seen', { ids: d.items.map(function (x) { return x.id; }) }, true);
      if (seen.ok && typeof seen.balance === 'number') {
        try { window._emuSetOffchainBalance && window._emuSetOffchainBalance(window.connectedAccount || localStorage.getItem('emuWallet') || '', seen.balance); } catch (_) {}
      }
      refreshBalance();
      if (cheers.length) {
        showInbox(cheers, cheers.reduce(function (s, x) { return s + (Number(x.amount) || 0); }, 0), seen.ok ? seen.balance : undefined);
        tell({ type: 'cheers', postIds: cheers.map(function (x) { return x.postId; }).filter(Boolean) });
      }
    } finally { inboxBusy = false; }
  }
  function soon() {
    var t = Date.now();
    if (t - lastQuickAt < 3000) return;
    lastQuickAt = t;
    checkInbox();
  }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') soon(); });
  window.addEventListener('focus', soon);
  window.addEventListener('online', soon);
  setInterval(function () { if (document.visibilityState === 'visible') checkInbox(); }, POLL_MS);

  window.EmuGifts = {
    config: function () { return call('GET', '/config', null, false); },
    me: function () { return call('GET', '/me', null, true); },
    cheer: async function (postId, amount) { var d = await call('POST', '/cheer', { postId: String(postId), amount: Number(amount), requestId: rid() }, true); if (d.ok) refreshBalance(); return d; },
    cheerCounts: function (ids, fresh) { return call('GET', '/cheers?ids=' + encodeURIComponent(ids.join(',')) + (fresh ? '&t=' + Date.now() : ''), null, false); },
    pot: function (questId) { return call('GET', '/sponsor/' + encodeURIComponent(questId), null, false); },
    mine: function (questId) { return call('GET', '/sponsor/' + encodeURIComponent(questId) + '/mine', null, true); },
    sponsor: async function (questId, amount) { var d = await call('POST', '/sponsor', { questId: String(questId), amount: Number(amount), requestId: rid() }, true); if (d.ok) refreshBalance(); return d; },
    claimBonus: async function (questId) { var d = await call('POST', '/sponsor/' + encodeURIComponent(questId) + '/claim', {}, true); if (d.ok) refreshBalance(); return d; },
    polls: function (signedIn) { return call('GET', signedIn ? '/polls/mine' : '/polls', null, !!signedIn); },
    vote: async function (pollId, option) { var d = await call('POST', '/polls/' + encodeURIComponent(pollId) + '/vote', { option: String(option) }, true); if (d.ok) refreshBalance(); return d; },
    signedIn: function () { return !!(window.auth && window.auth.currentUser); },
    petals: petals,
    checkInbox: checkInbox,
    /* 応援が届いたときに呼ばれる（知識の画面が、その投稿の数を新しくする）。やめるときは返った関数を呼ぶ。 */
    on: function (fn) { if (typeof fn === 'function') listeners.push(fn); return function () { listeners = listeners.filter(function (f) { return f !== fn; }); }; },
    word: word
  };
})(window, document);
