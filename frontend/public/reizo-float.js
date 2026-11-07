/* 冷蔵庫くんの窓を、画面を見ながら使えるように浮かせる（11/7）。
   対象：ガイド・質問・依頼を選ぶ窓（#rk-tour の rk-choice）、「冷蔵庫くんに聞く」（#spReizoPanel）、
   「冷蔵庫くんに頼む」（小部屋 #spRoomPage で /economy/ を開いたとき）。
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
  function place(el) { if (!el) return; put(el, read() || home(el)); }
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
    var was = false;
    new MutationObserver(function () {
      var now = choice();
      if (now && !was) place(panel);
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
    var was = false;
    new MutationObserver(function () {
      var now = panel.classList.contains('open');
      if (now && !was) place(panel);
      was = now;
    }).observe(panel, { attributes: true, attributeFilter: ['class'] });
  }
  /* ③ 冷蔵庫くんに頼む（小部屋で /economy/ を開いたとき）。窓にして、ほかの画面を見ながら使えるようにする。 */
  function watchRequest() {
    var page = document.getElementById('spRoomPage'), frame = document.getElementById('spRoomFrame');
    if (!page || !frame || page._emuFloatWatch) return;
    page._emuFloatWatch = true;
    var bar = document.createElement('div');
    bar.className = 'sp-room-float-bar';
    bar.innerHTML = '<img src="/assets/mascot.jpg" alt=""><span>冷蔵庫くんに頼む</span><button type="button" class="sp-room-float-close" aria-label="閉じる">✕</button>';
    bar.querySelector('button').onclick = function () { if (typeof window.closeSpRoom === 'function') window.closeSpRoom(); };
    page.insertBefore(bar, frame);
    draggable(page, bar, function () { return document.body.classList.contains('sp-room-float'); });
    function sync() {
      var src = frame.getAttribute('src') || '';
      var on = document.body.classList.contains('sp-room-open') && /^\/economy\//.test(src);
      var was = document.body.classList.contains('sp-room-float');
      document.body.classList.toggle('sp-room-float', on);
      if (on && !was) requestAnimationFrame(function () { place(page); });
      if (!on) ['left', 'top', 'right', 'bottom'].forEach(function (p) { page.style.removeProperty(p); });
    }
    new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    new MutationObserver(sync).observe(frame, { attributes: true, attributeFilter: ['src'] });
    sync();
  }
  function keepInside() {
    ['spReizoPanel'].map(function (id) { return document.getElementById(id); })
      .concat([document.querySelector('#rk-tour .rk-panel.rk-choice'), document.body.classList.contains('sp-room-float') ? document.getElementById('spRoomPage') : null])
      .forEach(function (el) { if (visible(el)) { var r = el.getBoundingClientRect(); put(el, { x: r.left, y: r.top }); } });
  }
  function init() {
    watchChat(); watchRequest();
    if (!watchTour()) {
      var mo = new MutationObserver(function () { if (watchTour()) mo.disconnect(); });
      mo.observe(document.body, { childList: true });
    }
    window.addEventListener('resize', keepInside);
  }
  window.EmuReizoFloat = { place: place, home: home, reset: function () { try { localStorage.removeItem(KEY); } catch (_) {} } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})();
