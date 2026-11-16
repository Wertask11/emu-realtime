/* スマホの「上から下へ引っぱる」を、ブラウザの再読み込みではなく Emu の中の読み直しにする（11/16 オーナー）。

   ブラウザの再読み込みは、ログインの確かめ直し・画面の作り直し・Firestore の読み直しを全部やり直すので遅く、
   開いていた画面（知識を読む・クエストなど）も最初に戻る。ここでは、いま見ている画面のデータだけを読み直す。

   使い方：Emu（index.html）と、その中の枠（knowledge.html・schoolpark/dao.html）でこのファイルを読む。
     ・Emu 本体 … window.emuInAppRefresh(source) を index.html が用意する。これが無いページでは何もしない
       （SchoolPark を単独で開いたときなどは、今までどおりブラウザの再読み込み）。
     ・中の枠 … 引っぱりを見つけたら、親（Emu）へ「読み直して」と頼み、終わりの返事を待つ。
   スマホの幅（760px 以下）でタッチのある端末だけ。パソコンは何も変えない。
   引っぱるのは、画面がいちばん上にあるときだけ。モーダル（position:fixed の中）・入力欄・City の3D（canvas）では反応しない。 */
(function () {
  'use strict';
  if (window.__emuPullRefresh) return;
  window.__emuPullRefresh = true;

  var THRESHOLD = 64;      // これだけ下げて離すと読み直す（表示上の距離）
  var MAX = 110;
  var TIMEOUT_MS = 15000;
  var inFrame = false;
  try { inFrame = window.parent && window.parent !== window; } catch (_) { inFrame = false; }

  function parentRefresh() {
    try { return inFrame && window.parent.location.origin === location.origin && typeof window.parent.emuInAppRefresh === 'function'; }
    catch (_) { return false; }
  }
  function enabled() {
    var phone = window.matchMedia && window.matchMedia('(max-width: 760px)').matches;
    var touch = ('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0;
    if (!phone || !touch) return false;
    return inFrame ? parentRefresh() : typeof window.emuInAppRefresh === 'function';
  }

  /* ブラウザ自身の「引っぱって再読み込み」を止める（Chrome・Safari 16 以降）。使える画面のときだけ。 */
  var style = document.createElement('style');
  style.textContent = 'html.emu-ptr,html.emu-ptr body{overscroll-behavior-y:none}'
    + '#emuPtr{position:fixed;left:50%;top:calc(env(safe-area-inset-top,0px) + 6px);z-index:2147483000;pointer-events:none;'
    + 'transform:translate(-50%,-70px);opacity:0;display:flex;align-items:center;gap:8px;padding:8px 14px;border-radius:999px;'
    + 'background:#fff;color:#35322e;font:700 13px/1.3 "Noto Sans JP","Yu Gothic",sans-serif;box-shadow:0 6px 20px #0002;white-space:nowrap}'
    + '#emuPtr i{font-style:normal;display:inline-block;transition:transform .15s}'
    + '#emuPtr.armed i{transform:rotate(180deg)}'
    + '#emuPtr.busy i{animation:emuPtrSpin .8s linear infinite}'
    + '#emuPtr.done{transition:transform .25s,opacity .25s}'
    + '@keyframes emuPtrSpin{to{transform:rotate(360deg)}}';
  (document.head || document.documentElement).appendChild(style);
  function mark() { document.documentElement.classList.toggle('emu-ptr', enabled()); }
  mark();
  window.addEventListener('resize', mark);
  window.addEventListener('load', mark);

  var pill = null;
  function ui() {
    if (pill && pill.isConnected) return pill;
    pill = document.createElement('div');
    pill.id = 'emuPtr';
    pill.setAttribute('role', 'status');
    pill.setAttribute('aria-live', 'polite');
    pill.innerHTML = '<i aria-hidden="true">↓</i><span></span>';
    document.body.appendChild(pill);
    return pill;
  }
  function show(text, y, cls) {
    var p = ui();
    p.className = cls || '';
    p.querySelector('i').textContent = cls === 'busy' ? '↻' : cls === 'done' ? '✓' : cls === 'fail' ? '!' : '↓';
    p.querySelector('span').textContent = text;
    p.style.transform = 'translate(-50%,' + Math.round(y - 70) + 'px)';
    p.style.opacity = String(Math.min(1, Math.max(0, (y - 10) / 40)));
  }
  function hide(delay) {
    setTimeout(function () {
      if (!pill || busy) return;
      pill.className = 'done';
      pill.style.transform = 'translate(-50%,-70px)';
      pill.style.opacity = '0';
    }, delay || 0);
  }

  /* 触ったところから上へたどって、引っぱってよい場所か確かめる。 */
  function canPull(target) {
    for (var n = target && target.nodeType === 1 ? target : target && target.parentElement; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      var tag = n.tagName;
      if (tag === 'CANVAS' || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'VIDEO' || n.isContentEditable) return false;
      if (n.hasAttribute && n.hasAttribute('data-no-pull-refresh')) return false;
      var cs = window.getComputedStyle(n);
      if (cs.position === 'fixed') return false;                      // モーダル・上の帯・下のナビ
      if (cs.touchAction === 'none' || cs.touchAction === 'pan-x') return false;   // 指の動きを自分で使う部品（City の操作など）
      if (/(auto|scroll)/.test(cs.overflowY) && n.scrollHeight > n.clientHeight + 1 && n.scrollTop > 0) return false;
    }
    var se = document.scrollingElement || document.documentElement;
    return (window.scrollY || se.scrollTop || 0) <= 0;
  }

  var startX = 0, startY = 0, candidate = false, pulling = false, dist = 0, busy = false;
  document.addEventListener('touchstart', function (e) {
    candidate = pulling = false; dist = 0;
    if (busy || e.touches.length !== 1 || !enabled()) return;
    if (!canPull(e.target)) return;
    candidate = true;
    startX = e.touches[0].clientX; startY = e.touches[0].clientY;
  }, { passive: true });
  document.addEventListener('touchmove', function (e) {
    if (!candidate) return;
    if (e.touches.length !== 1) { candidate = pulling = false; hide(); return; }
    var dx = e.touches[0].clientX - startX, dy = e.touches[0].clientY - startY;
    if (!pulling) {
      if (dy > 8 && dy > Math.abs(dx) * 1.2) pulling = true;
      else { if (dy < -4 || Math.abs(dx) > 10) candidate = false; return; }
    }
    if (e.cancelable) e.preventDefault();                            // ブラウザの再読み込みにしない
    dist = Math.min(MAX, Math.max(0, dy * 0.5));
    if (dist >= THRESHOLD) show('離すと読み直します', dist, 'armed');
    else show('引っぱって読み直す', dist, '');
  }, { passive: false });
  function end() {
    if (!candidate) return;
    candidate = false;
    if (!pulling) return;
    pulling = false;
    if (dist >= THRESHOLD) run(); else hide();
  }
  document.addEventListener('touchend', end, { passive: true });
  document.addEventListener('touchcancel', function () { candidate = pulling = false; hide(); }, { passive: true });

  var seq = 0, waiting = {};
  function ask() {
    if (!inFrame) return Promise.resolve(window.emuInAppRefresh(null));
    return new Promise(function (resolve, reject) {
      var id = 'ptr-' + Date.now() + '-' + (++seq);
      waiting[id] = { resolve: resolve, reject: reject };
      window.parent.postMessage({ type: 'emu-pull-refresh', id: id }, location.origin);
    });
  }
  window.addEventListener('message', function (e) {
    if (e.origin !== location.origin || !e.data) return;
    if (e.data.type === 'emu-pull-refresh-done' && waiting[e.data.id]) {
      var w = waiting[e.data.id]; delete waiting[e.data.id];
      if (e.data.ok === false) w.reject(new Error('REFRESH_FAILED')); else w.resolve(e.data.result);
    }
    /* Emu 本体：中の枠からの「読み直して」を受けて、読み直したら返事をする */
    if (e.data.type === 'emu-pull-refresh' && !inFrame && typeof window.emuInAppRefresh === 'function' && e.source) {
      var src = e.source, id = e.data.id;
      Promise.resolve().then(function () { return window.emuInAppRefresh(src); })
        .then(function (r) { src.postMessage({ type: 'emu-pull-refresh-done', id: id, ok: true, result: r || null }, location.origin); },
              function () { src.postMessage({ type: 'emu-pull-refresh-done', id: id, ok: false }, location.origin); });
    }
  });

  function run() {
    busy = true;
    show('読み直しています…', THRESHOLD, 'busy');
    var timer;
    var limit = new Promise(function (_, reject) { timer = setTimeout(function () { reject(new Error('TIMEOUT')); }, TIMEOUT_MS); });
    Promise.race([ask(), limit]).then(function () {
      busy = false; clearTimeout(timer);
      show('読み直しました', THRESHOLD, 'done'); hide(900);
    }, function () {
      busy = false; clearTimeout(timer);
      show('読み直せませんでした。少し待って、もう一度引っぱってね', THRESHOLD, 'fail'); hide(2600);
    });
  }
  window.emuPullRefresh = { enabled: enabled, run: run };
})();
