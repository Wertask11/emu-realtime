/* 冷蔵庫くんの切り替え（11/10・オーナー）。ChatGPT や Claude のモデル切り替えのように、左上の名前から選ぶ。
   - 冷蔵庫くんを開くと、まず「聞く」（会話の窓 #spReizoPanel）が出る。前は「ガイド・聞く・頼む」を選ぶ窓が先に出ていた。
   - 左上の「冷蔵庫くん ▾」を押すと、💬 聞く／📋 頼む／📖 この画面のガイド を選べる。
   - 頼む窓（#reizoRequestWin）の左上にも同じ切り替えを付ける（聞くに戻れる）。
   聞く・頼む・ガイドそれぞれの中身は変えない（頼むは economy/entry.js の openReizoRequest、ガイドは ReizoTour.navigate をそのまま呼ぶ）。
   前の選ぶ窓は window.ReizoTourChooser に残してある。 */
(function (window, document) {
  'use strict';
  var MODES = [
    { id: 'ask', icon: '💬', label: '聞く', desc: '使い方や質問に答えてくれるよ！' },
    { id: 'request', icon: '📋', label: '頼む', desc: '冷蔵庫くんにタスクをふろう。あなたの代わりに動いてくれるよ！' },
    { id: 'guide', icon: '📖', label: 'この画面のガイド', desc: '開いている画面の見方を説明してくれるよ！' }
  ];

  function css() {
    if (document.getElementById('spReizoModeStyle')) return;
    var st = document.createElement('style'); st.id = 'spReizoModeStyle';
    st.textContent = [
      '.sp-reizo-mode{display:flex;align-items:center;gap:9px;flex:0 1 auto;min-width:0;margin-right:auto;background:none;border:0;padding:4px 6px;margin:-4px -6px;border-radius:10px;cursor:pointer;color:inherit;font:inherit;text-align:left}',
      '.sp-reizo-mode:hover,.sp-reizo-mode[aria-expanded="true"]{background:rgba(212,168,67,.12)}',
      '.sp-reizo-mode:focus-visible{outline:2px solid #D4A843;outline-offset:2px}',
      '.sp-reizo-mode-now{display:inline-flex;align-items:center;gap:4px;margin-left:6px;padding:1px 8px;border-radius:999px;background:rgba(212,168,67,.18);color:#e8c46a;font-size:12px;font-weight:700;white-space:nowrap}',
      '.sp-reizo-mode-now::after{content:"▾";font-size:10px;opacity:.85}',
      '.sp-reizo-mode-menu{position:absolute;z-index:5;min-width:260px;max-width:calc(100% - 20px);background:#24190c;border:1px solid rgba(212,168,67,.35);border-radius:12px;box-shadow:0 14px 36px rgba(0,0,0,.55);padding:6px}',
      '.sp-reizo-mode-menu[hidden]{display:none}',
      '.sp-reizo-mode-item{display:flex;gap:10px;align-items:flex-start;width:100%;background:none;border:0;border-radius:9px;padding:9px 10px;cursor:pointer;color:#f2e6cf;font:inherit;text-align:left}',
      '.sp-reizo-mode-item:hover,.sp-reizo-mode-item:focus-visible{background:rgba(212,168,67,.14);outline:none}',
      '.sp-reizo-mode-item[aria-disabled="true"]{opacity:.5;cursor:default}',
      '.sp-reizo-mode-item b{display:block;font-size:14px;color:#f4d27a}',
      '.sp-reizo-mode-item small{display:block;margin-top:2px;font-size:12px;line-height:1.5;color:#c8b48a}',
      '.sp-reizo-mode-item .ic{font-size:18px;line-height:1.2}',
      '.sp-reizo-mode-item .ok{margin-left:auto;color:#D4A843;font-weight:800}',
      '.rrw-mode{background:none;border:0;padding:2px 6px;margin:-2px -6px;border-radius:8px;color:inherit;font:inherit;cursor:pointer;display:inline-flex;align-items:center;gap:6px}',
      '.rrw-mode:hover,.rrw-mode[aria-expanded="true"]{background:rgba(212,168,67,.15)}'
    ].join('\n');
    document.head.appendChild(st);
  }

  /* ── 3つの動き ── */
  function screenId() {
    try { if (typeof window.ReizoTourScreen === 'function') return window.ReizoTourScreen(); } catch (_) {}
    try { return window.ReizoTour && window.ReizoTour.current ? window.ReizoTour.current() : ''; } catch (_) { return ''; }
  }
  function guideInfo() {
    var id = screenId(), T = window.ReizoTour;
    if (!id || !T || typeof T.list !== 'function') return { id: id, ok: false };
    var ok = T.list().some(function (x) { return x.id === id; });
    var p = ok && typeof T.progress === 'function' ? T.progress(id) : null;
    return { id: id, ok: ok, progress: p };
  }
  function closeRequestWin() { try { if (window.EmuReizoFloat && window.EmuReizoFloat.requestActive && window.EmuReizoFloat.requestActive()) window.EmuReizoFloat.closeRequest(); } catch (_) {} }
  function go(mode, invoker) {
    closeMenus();
    if (mode === 'ask') {
      closeRequestWin();
      if (typeof window.spReizoOpen === 'function') window.spReizoOpen();
      var input = document.getElementById('spReizoInput'); if (input) setTimeout(function () { input.focus(); }, 0);
      return;
    }
    if (mode === 'request') {
      if (typeof window.spReizoClose === 'function') window.spReizoClose();
      if (typeof window.openReizoRequest === 'function') window.openReizoRequest(invoker);
      else if (window.ReizoTour && window.ReizoTour.announce) window.ReizoTour.announce('依頼画面を開けませんでした。再読み込みしてからお試しください。');
      return;
    }
    if (mode === 'guide') {
      var g = guideInfo();
      if (!g.ok) return;
      if (typeof window.spReizoClose === 'function') window.spReizoClose();
      closeRequestWin();
      window.ReizoTour.navigate(g.id, false, invoker);
    }
  }

  /* ── メニュー ── */
  function menuHtml(current) {
    var g = guideInfo();
    return MODES.map(function (m) {
      var desc = m.desc, disabled = false;
      if (m.id === 'guide') {
        if (!g.ok) { desc = 'この画面のガイドは準備中だよ'; disabled = true; }
        else if (g.progress && g.progress.state === 'in_progress') desc = '前回の続きから見られるよ（' + (g.progress.index + 1) + '/' + g.progress.total + '）';
      }
      return '<button type="button" role="menuitemradio" class="sp-reizo-mode-item" data-mode="' + m.id + '" aria-checked="' + (m.id === current) + '"'
        + (disabled ? ' aria-disabled="true"' : '') + '><span class="ic" aria-hidden="true">' + m.icon + '</span><span><b>' + m.label + '</b><small>' + desc + '</small></span>'
        + (m.id === current ? '<span class="ok" aria-hidden="true">✓</span>' : '') + '</button>';
    }).join('');
  }
  function closeMenus() {
    document.querySelectorAll('.sp-reizo-mode-menu').forEach(function (m) { m.hidden = true; });
    document.querySelectorAll('[data-reizo-mode-btn]').forEach(function (b) { b.setAttribute('aria-expanded', 'false'); });
  }
  function attach(host, button, current, anchorTop) {
    var menu = document.createElement('div');
    menu.className = 'sp-reizo-mode-menu'; menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', '冷蔵庫くんの使い方を選ぶ'); menu.hidden = true;
    host.appendChild(menu);
    button.setAttribute('data-reizo-mode-btn', ''); button.setAttribute('aria-haspopup', 'menu'); button.setAttribute('aria-expanded', 'false');
    button.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = menu.hidden;
      closeMenus();
      if (!open) return;
      menu.innerHTML = menuHtml(current);
      menu.style.top = anchorTop() + 'px'; menu.style.left = '10px';
      menu.hidden = false; button.setAttribute('aria-expanded', 'true');
      var first = menu.querySelector('[aria-checked="true"]') || menu.querySelector('[data-mode]'); if (first) first.focus();
    });
    menu.addEventListener('click', function (e) {
      var item = e.target.closest && e.target.closest('[data-mode]'); if (!item) return;
      e.stopPropagation();
      if (item.getAttribute('aria-disabled') === 'true') return;
      var mode = item.getAttribute('data-mode');
      if (mode === current) { closeMenus(); button.focus(); return; }
      go(mode, button);
    });
    menu.addEventListener('keydown', function (e) {
      var items = Array.prototype.slice.call(menu.querySelectorAll('[data-mode]')), i = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
      if (e.key === 'Escape') { e.preventDefault(); closeMenus(); button.focus(); }
    });
  }

  /* 聞く窓の左上（顔・名前）を、切り替えのボタンにする。 */
  function mountChat() {
    var panel = document.getElementById('spReizoPanel');
    var header = panel && panel.querySelector('.sp-reizo-header');
    if (!header || header.querySelector('.sp-reizo-mode')) return;
    var img = header.querySelector('img'), title = header.querySelector('.sp-reizo-header-title');
    var names = title ? title.parentElement : null;
    if (!img || !names) return;
    var btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'sp-reizo-mode'; btn.setAttribute('aria-label', '冷蔵庫くんの使い方を切り替える（いまは聞く）');
    header.insertBefore(btn, img);
    btn.appendChild(img); btn.appendChild(names);
    var now = document.createElement('span'); now.className = 'sp-reizo-mode-now'; now.textContent = '💬 聞く';
    title.appendChild(now);
    attach(panel, btn, 'ask', function () { return header.offsetTop + header.offsetHeight - 2; });
  }
  /* 頼む窓の左上にも同じ切り替え。頼む窓は開くときに作られるので、見張って付ける。 */
  function mountRequest() {
    var win = document.getElementById('reizoRequestWin');
    var bar = win && win.querySelector('.rrw-bar');
    if (!bar || bar.querySelector('.rrw-mode')) return;
    var img = bar.querySelector('img'), label = bar.querySelector('span');
    if (!label) return;
    var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'rrw-mode';
    btn.setAttribute('aria-label', '冷蔵庫くんの使い方を切り替える（いまは頼む）');
    bar.insertBefore(btn, img || label);
    if (img) btn.appendChild(img);
    btn.appendChild(label);
    var now = document.createElement('span'); now.className = 'sp-reizo-mode-now'; now.textContent = '📋 頼む'; btn.appendChild(now);
    /* つかんで動かす処理（reizo-float.js）が、この帯の押し下げを使っているので、ボタンの上では止める */
    btn.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
    attach(win, btn, 'request', function () { return bar.offsetTop + bar.offsetHeight - 2; });
  }

  function start() {
    css();
    mountChat();
    /* 開いたら、まず「聞く」。前の選ぶ窓は ReizoTourChooser に残す。 */
    if (typeof window.ReizoTourAsk === 'function' && !window.ReizoTourChooser) window.ReizoTourChooser = window.ReizoTourAsk;
    window.ReizoTourAsk = function (source) { go('ask', source); };
    if (typeof MutationObserver === 'function') {
      new MutationObserver(function () { mountChat(); mountRequest(); }).observe(document.body, { childList: true });
    }
    document.addEventListener('click', function (e) { if (!(e.target.closest && e.target.closest('.sp-reizo-mode-menu,[data-reizo-mode-btn]'))) closeMenus(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMenus(); });
  }
  window.ReizoMode = { go: go, open: function (source) { go('ask', source); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})(window, document);
