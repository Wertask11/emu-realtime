/* 冷蔵庫くんの窓を、画面を見ながら使えるように浮かせる（11/7）。
   対象：ガイド・質問・依頼を選ぶ窓（#rk-tour の rk-choice）、「冷蔵庫くんに聞く」（#spReizoPanel）、
   「冷蔵庫くんに頼む」（/economy/。小部屋ではなく、別の浮かぶ窓 #reizoRequestWin で開く）。
   ・はじめは本文の真ん中あたり（左のメニューより右・見出しの下）に出す。右上の隅ではなく、読んでいる画面の近くに。
   ・上の帯をつかんで、好きな場所へ動かせる（マウスでも指でも。Pointer Events）。置いた場所は覚えて、次も同じ場所に出す。
   ・画面の外へは出さない。画面の大きさが変わったら、内側へ戻す。
   中身（ガイド・会話・依頼と支払いの処理）には触れない。置き場所だけを決める。 */
(function () {
  'use strict';
  if (window.EmuReizoFloat) return;
  var KEY = 'emu.reizo.float.v1';
  var MARGIN = 8;
  function read() {
    try { var v = JSON.parse(localStorage.getItem(KEY) || 'null'); return v && Number.isFinite(v.x) && Number.isFinite(v.y) ? v : null; } catch (_) { return null; }
  }
  function write(v) { try { localStorage.setItem(KEY, JSON.stringify({ x: Math.round(v.x), y: Math.round(v.y) })); } catch (_) {} }
  function viewport() { return { w: document.documentElement.clientWidth || window.innerWidth, h: window.innerHeight }; }
  function clamp(el, x, y) {
    var vp = viewport(), r = el.getBoundingClientRect();
    var w = r.width || 320, h = r.height || 200;
    return {
      x: Math.min(Math.max(MARGIN, x), Math.max(MARGIN, vp.w - w - MARGIN)),
      // 窓がまるごと入るなら、まるごと画面の中へ。入らないときも、上の帯（つかむところ）は必ず画面に残す
      y: Math.min(Math.max(MARGIN, y), Math.max(MARGIN, h + 2 * MARGIN <= vp.h ? vp.h - h - MARGIN : vp.h - 56))
    };
  }
  /* はじめの場所：本文の真ん中あたり。左のメニュー（パソコン）より右、上の見出しの帯より下。 */
  function home(el) {
    var vp = viewport(), r = el.getBoundingClientRect(), w = r.width || 360;
    var side = document.getElementById('emuSideNav');
    var left = side && getComputedStyle(side).display !== 'none' ? side.getBoundingClientRect().right : 0;
    // 上の帯（Emu for SchoolPark の見出しの帯）の下から。見つからなければ画面の上から
    var head = document.getElementById('emuHeaderProfile');
    head = head && head.closest('header');
    var top = head && head.getBoundingClientRect().height ? Math.min(head.getBoundingClientRect().bottom, 120) : 0;
    if (vp.w <= 700) return { x: MARGIN, y: Math.max(MARGIN, top + MARGIN) };
    return { x: left + (vp.w - left - w) / 2, y: Math.max(MARGIN, top + Math.min(140, vp.h * 0.15)) };
  }
  function put(el, p) {
    var c = clamp(el, p.x, p.y);
    el.style.setProperty('left', c.x + 'px', 'important');
    el.style.setProperty('top', c.y + 'px', 'important');
    el.style.setProperty('right', 'auto', 'important');
    el.style.setProperty('bottom', 'auto', 'important');
    return c;
  }
  function place(el) { if (!el) return; if (el._emuSize) applySize(el, sizeOf(el)); put(el, read() || home(el)); if (el._emuSize) el._emuSize.sync(); }

  /* 大きさを変える（11/7）。右下の角をつかんで引く（マウスでも指でも）。角にフォーカスして矢印キーでも変えられる。
     窓ごとに大きさを覚える（この端末の localStorage に、幅と高さの数字だけ）。
     角は窓の外（body の直下）に置いて窓の右下に重ねる。窓の中身（ガイド・会話・依頼の画面）には触れない。 */
  var SIZE_KEY = 'emu.reizo.size.v1';
  function sizes() { try { var v = JSON.parse(localStorage.getItem(SIZE_KEY) || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch (_) { return {}; } }
  function sizeOf(el) {
    var v = sizes()[el._emuSize.name];
    return v && Number.isFinite(v.w) && Number.isFinite(v.h) ? v : el._emuSize.base;
  }
  function saveSize(el) {
    var all = sizes(), r = el.getBoundingClientRect();
    all[el._emuSize.name] = { w: Math.round(r.width), h: Math.round(r.height) };
    try { localStorage.setItem(SIZE_KEY, JSON.stringify(all)); } catch (_) {}
  }
  function applySize(el, v) {
    if (!v) return;
    var vp = viewport(), min = el._emuSize.min;
    if (v.w) el.style.setProperty('width', Math.round(Math.max(min.w, Math.min(v.w, vp.w - 2 * MARGIN))) + 'px', 'important');
    if (v.h) {
      el.style.setProperty('height', Math.round(Math.max(min.h, Math.min(v.h, vp.h - 2 * MARGIN))) + 'px', 'important');
      el.style.setProperty('max-height', 'none', 'important');
    }
  }
  function gripStyle() {
    if (document.getElementById('emuFloatResizeStyle')) return;
    var st = document.createElement('style');
    st.id = 'emuFloatResizeStyle';
    // 窓より上（ガイドの窓 10060 より上）。右下の角に、斜めの線を2本
    st.textContent = '.emu-float-resize{position:fixed;z-index:10070;width:22px;height:22px;cursor:nwse-resize;touch-action:none;user-select:none;-webkit-user-select:none;border-radius:0 0 12px 0;'
      + 'background:linear-gradient(135deg,transparent 0 45%,rgba(160,110,40,.75) 45% 52%,transparent 52% 64%,rgba(160,110,40,.75) 64% 71%,transparent 71%)}'
      + '.emu-float-resize[hidden]{display:none}.emu-float-resize:focus-visible{outline:2px solid #f08300;outline-offset:1px}'
      + 'html.emu-float-resizing,html.emu-float-resizing *{cursor:nwse-resize!important}';
    document.head.appendChild(st);
  }
  function resizable(el, name, base, min, canResize) {
    if (!el || el._emuSize) return;
    gripStyle();
    var grip = document.createElement('div');
    grip.className = 'emu-float-resize';
    grip.setAttribute('role', 'separator');
    grip.setAttribute('tabindex', '0');
    grip.setAttribute('aria-label', '窓の大きさを変える（矢印キーでも変えられます）');
    grip.hidden = true;
    document.body.appendChild(grip);
    function on() { return visible(el) && (!canResize || canResize()); }
    function sync() {
      var show = on();
      grip.hidden = !show;
      if (!show) return;
      var r = el.getBoundingClientRect();
      grip.style.left = Math.round(r.right - 22) + 'px';
      grip.style.top = Math.round(r.bottom - 22) + 'px';
    }
    el._emuSize = { name: name, base: base, min: min, sync: sync };
    var start = null;
    grip.addEventListener('pointerdown', function (e) {
      if (e.button !== undefined && e.button !== 0) return;
      var r = el.getBoundingClientRect();
      start = { id: e.pointerId, x: e.clientX, y: e.clientY, w: r.width, h: r.height, left: r.left, top: r.top };
      try { grip.setPointerCapture(e.pointerId); } catch (_) {}
      document.documentElement.classList.add('emu-float-dragging', 'emu-float-resizing');
      e.preventDefault();
    });
    grip.addEventListener('pointermove', function (e) {
      if (!start || e.pointerId !== start.id) return;
      var vp = viewport();
      applySize(el, {
        w: Math.min(start.w + e.clientX - start.x, vp.w - start.left - MARGIN),
        h: Math.min(start.h + e.clientY - start.y, vp.h - start.top - MARGIN)
      });
      sync();
    });
    function end(e) {
      if (!start || (e && e.pointerId !== start.id)) return;
      start = null;
      document.documentElement.classList.remove('emu-float-dragging', 'emu-float-resizing');
      saveSize(el); sync();
    }
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
    grip.addEventListener('lostpointercapture', end);
    grip.addEventListener('keydown', function (e) {
      var step = e.shiftKey ? 40 : 10, d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (!d) return;
      e.preventDefault();
      var r = el.getBoundingClientRect(), vp = viewport();
      applySize(el, { w: Math.min(r.width + d[0], vp.w - r.left - MARGIN), h: Math.min(r.height + d[1], vp.h - r.top - MARGIN) });
      saveSize(el); sync();
    });
    new MutationObserver(sync).observe(el, { attributes: true, attributeFilter: ['class', 'hidden', 'style'] });
    if (window.ResizeObserver) new ResizeObserver(sync).observe(el);
    window.addEventListener('resize', sync);
    sync();
  }
  /* つかんで動かす。ボタン・入力欄・リンクを押したときは動かさない。 */
  function draggable(el, handle, canDrag) {
    if (!el || !handle || handle._emuFloat) return;
    handle._emuFloat = true;
    handle.classList.add('emu-float-handle');
    var start = null;
    handle.addEventListener('pointerdown', function (e) {
      if (e.button !== undefined && e.button !== 0) return;
      if (e.target.closest && e.target.closest('button,input,textarea,select,a,[role="button"]')) return;
      if (canDrag && !canDrag()) return;
      var r = el.getBoundingClientRect();
      start = { id: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top };
      try { handle.setPointerCapture(e.pointerId); } catch (_) {}
      document.documentElement.classList.add('emu-float-dragging');
      e.preventDefault();
    });
    handle.addEventListener('pointermove', function (e) {
      if (!start || e.pointerId !== start.id) return;
      put(el, { x: e.clientX - start.dx, y: e.clientY - start.dy });
    });
    function end(e) {
      if (!start || (e && e.pointerId !== start.id)) return;
      start = null;
      document.documentElement.classList.remove('emu-float-dragging');
      var r = el.getBoundingClientRect();
      write({ x: r.left, y: r.top });
    }
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
    handle.addEventListener('lostpointercapture', end);
    // キーボードでも動かせる（帯にフォーカスして矢印キー。Shift で大きく）
    if (!handle.hasAttribute('tabindex')) handle.setAttribute('tabindex', '0');
    handle.setAttribute('aria-label', (handle.getAttribute('aria-label') || '') + '（矢印キーで移動できます）');
    handle.addEventListener('keydown', function (e) {
      var step = e.shiftKey ? 40 : 10, d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (!d || e.target !== handle || (canDrag && !canDrag())) return;
      e.preventDefault();
      var r = el.getBoundingClientRect();
      write(put(el, { x: r.left + d[0], y: r.top + d[1] }));
    });
  }
  function visible(el) { return !!el && el.getClientRects().length > 0 && getComputedStyle(el).display !== 'none'; }

  /* ① ガイド・質問・依頼を選ぶ窓（冷蔵庫くんの画面ガイド）。ガイドの途中（説明する場所の近くに出る）には手を出さない。 */
  function watchTour() {
    var root = document.getElementById('rk-tour'), panel = root && root.querySelector('.rk-panel');
    if (!panel || panel._emuFloatWatch) return !!panel;
    panel._emuFloatWatch = true;
    var choice = function () { return panel.classList.contains('rk-choice') && !panel.hidden; };
    draggable(panel, panel.querySelector('.rk-header'), choice);
    // はじめは前（330px）より広く。高さは中身に合わせる（引いて変えたときだけ高さも覚える）
    resizable(panel, 'choice', { w: 420, h: 0 }, { w: 280, h: 220 }, choice);
    var was = false;
    new MutationObserver(function () {
      var now = choice();
      if (now && !was) place(panel);
      // ガイドの途中に移るときは、選ぶ窓で付けた高さを外す（ガイドは説明する場所に合わせて大きさを決める）
      if (!now && was) { panel.style.removeProperty('height'); panel.style.removeProperty('max-height'); }
      was = now;
    }).observe(panel, { attributes: true, attributeFilter: ['class', 'hidden'] });
    if (choice()) { was = true; place(panel); }
    return true;
  }
  /* ② 冷蔵庫くんに聞く（会話の窓） */
  function watchChat() {
    var panel = document.getElementById('spReizoPanel');
    if (!panel || panel._emuFloatWatch) return;
    panel._emuFloatWatch = true;
    draggable(panel, panel.querySelector('.sp-reizo-header'));
    resizable(panel, 'chat', { w: 520, h: 680 }, { w: 300, h: 320 });
    var was = false;
    new MutationObserver(function () {
      var now = panel.classList.contains('open');
      if (now && !was) place(panel);
      was = now;
    }).observe(panel, { attributes: true, attributeFilter: ['class'] });
  }
  /* ③ 冷蔵庫くんに頼む（/economy/）。小部屋とは別の、浮かぶ窓（#reizoRequestWin）で開く。
     Knowledge Lab などの画面を開いたまま、見ながら頼めるように（11/7）。中の画面（economy）には触れない。 */
  var req = null;
  function requestWin() {
    if (req) return req;
    var win = document.createElement('div');
    win.id = 'reizoRequestWin';
    win.setAttribute('role', 'dialog');
    win.setAttribute('aria-label', '冷蔵庫くんに頼む');
    win.innerHTML = '<div class="rrw-bar"><img src="/assets/mascot.jpg" alt=""><span>冷蔵庫くんに頼む</span><button type="button" class="rrw-close" aria-label="閉じる">✕</button></div><iframe title="冷蔵庫くんに頼む" src="about:blank"></iframe>';
    document.body.appendChild(win);
    win.querySelector('.rrw-close').onclick = closeRequest;
    draggable(win, win.querySelector('.rrw-bar'));
    resizable(win, 'request', { w: 560, h: 780 }, { w: 320, h: 360 });
    req = win;
    return win;
  }
  function openRequest(url, title) {
    var win = requestWin(), frame = win.querySelector('iframe');
    // economy/entry.js は開いたあと小部屋の題を「冷蔵庫くんに頼む」に書き換える。開いている小部屋の題は元に戻す
    var room = document.getElementById('spRoomFrame'), roomTitle = room && room.title;
    if (room) Promise.resolve().then(function () { room.title = roomTitle; });
    if (frame.getAttribute('src') !== url) frame.src = url;
    if (title) frame.title = title;
    var was = win.classList.contains('open');
    win.classList.add('open');
    if (!was) place(win);
    try { frame.focus(); } catch (_) {}
    return true;
  }
  function closeRequest() {
    if (!req) return;
    req.classList.remove('open');
    req.querySelector('iframe').src = 'about:blank';   // 音や読み込みを止める
  }
  /* 「← 戻る」（economy/app.js）は親の closeSpRoom を呼ぶ。いま頼む窓を操作しているかどうか */
  function requestActive() {
    if (!req || !req.classList.contains('open')) return false;
    var frame = req.querySelector('iframe');
    try { if (frame.contentWindow && frame.contentWindow.event) return true; } catch (_) {}   // 窓の中のボタンを押した、その最中
    return document.activeElement === frame;
  }
  function keepInside() {
    ['spReizoPanel'].map(function (id) { return document.getElementById(id); })
      .concat([document.querySelector('#rk-tour .rk-panel.rk-choice'), req && req.classList.contains('open') ? req : null])
      .forEach(function (el) {
        if (!visible(el)) return;
        if (el._emuSize && (el.style.getPropertyValue('width') || el.style.getPropertyValue('height'))) { var b = el.getBoundingClientRect(); applySize(el, { w: b.width, h: el.style.getPropertyValue('height') ? b.height : 0 }); }
        var r = el.getBoundingClientRect(); put(el, { x: r.left, y: r.top });
      });
  }
  function init() {
    watchChat();
    if (!watchTour()) {
      var mo = new MutationObserver(function () { if (watchTour()) mo.disconnect(); });
      mo.observe(document.body, { childList: true });
    }
    window.addEventListener('resize', keepInside);
  }
  window.EmuReizoFloat = { place: place, home: home, openRequest: openRequest, closeRequest: closeRequest, requestActive: requestActive, reset: function () { try { localStorage.removeItem(KEY); localStorage.removeItem(SIZE_KEY); } catch (_) {} } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})();
