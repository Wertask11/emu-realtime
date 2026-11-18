/* Claude Design から受け取った本の演出（11/18）。Emu で変えたのは data-bfx-manual の1か所だけ。
   いまのページへのつなぎは book-shelf.js。
   book-fx.js — Knowledge Text : bookshelf dressing + book-opening effect (no deps)
   Markup:  <button class="bfx-book" data-theme="money|net|life|blue" data-title="タイトル" data-target="#content-id"></button>
   Event:   'bookfx:open' (bubbles) fires when the text should appear — detail {book, target, title, theme}
   API:     BookFX.init(root?) / BookFX.open(book, {mount, onOpen}) / BookFX.renderFrame(el, {theme, title, t}) */
(function () {
  'use strict';
  var DURATION = 2600, REVEAL_AT = 2250;
  var THEMES = {
    money: { label: 'MONEY LITERACY', fx: ['💰', '🪙', '📈', '🏦', '💴', '🐷'], conf: ['#ef7d00', '#ffb23f', '#ffd98a', '#e8c46a'] },
    net:   { label: 'NET LITERACY',   fx: ['📱', '💬', '🔒', '🌐', '🛡️', '📷'], conf: ['#3b82d6', '#8cc2ff', '#dbeaff', '#e8c46a'] },
    life:  { label: 'LIFE LITERACY',  fx: ['🌱', '💗', '🧘', '🍳', '🤝', '☀️'], conf: ['#3f9d5f', '#9bd77a', '#f7c6d4', '#ffe08a'] },
    blue:  { label: 'BLUE FILE',      fx: ['📘', '🏆', '🎯', '🧭', '🚀', '🔥'], conf: ['#2b4a8f', '#e8c46a', '#f4dc96', '#9fb6e6'] }
  };

  function hash(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) { return function () { seed = (seed + 0x6D2B79F5) | 0; var t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function reduced() { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  function f(n) { return Math.round(n * 1000) / 1000; }

  function info(book) {
    var theme = THEMES[book.dataset.theme] ? book.dataset.theme : 'money';
    return { theme: theme, title: book.dataset.title || book.textContent.trim(), label: book.dataset.label || THEMES[theme].label };
  }
  function cover(o) {
    return '<span class="bfx-cov" data-theme="' + o.theme + '"><span class="bfx-cov__frame">' +
      '<span class="bfx-cov__label">' + esc(o.label) + '</span>' +
      '<span class="bfx-cov__title">' + esc(o.title) + '</span>' +
      '<span class="bfx-cov__band"><i></i></span></span></span>';
  }

  /* shelf: build the book body, give each book its own height / thickness / tone */
  function dress(book, i) {
    if (book.__bfx) return;
    book.__bfx = true;
    var o = info(book), r = rng(hash(o.title)), s = book.style;
    book.dataset.title = o.title;
    if (!book.hasAttribute('aria-label')) book.setAttribute('aria-label', o.title);
    if (book.tagName === 'BUTTON' && !book.hasAttribute('type')) book.type = 'button';
    s.setProperty('--h', Math.round(178 + r() * 22) + 'px');
    s.setProperty('--t', (5 + r() * 4.5).toFixed(1) + 'px');
    s.setProperty('--dk', Math.round(r() * 14) + '%');
    s.setProperty('--i', i);
    book.innerHTML = '<span class="bfx-b">' + cover(o) + '<span class="bfx-b__er"></span><span class="bfx-b__eb"></span></span>';
    /* Emu：押したときの動きをページ側（book-shelf.js）で決める本は、ここで演出を付けない */
    if (!book.hasAttribute('data-bfx-manual')) book.addEventListener('click', function (e) { e.preventDefault(); open(book); });
  }

  function build(o) {
    var r = rng(hash(o.title) + 7), t = THEMES[o.theme], i, leaves = '', rays = '', parts = '';
    for (i = 0; i < 3; i++) {
      leaves += '<div class="bfx-fx__leaf" style="--d:' + f(0.98 + i * 0.17) + 's;--end:' + (-176 + i * 3) + 'deg;--z0:' + (5 - i) + 'px;--z1:' + (2 + i) + 'px">' +
        '<div class="bfx-fx__lf"><i class="bfx-fx__curl"></i></div><div class="bfx-fx__lf bfx-fx__lf--back"></div></div>';
    }
    for (i = 0; i < 9; i++) {
      rays += '<i class="bfx-fx__ray" style="--a:' + f(-64 + i * 16 + (r() - 0.5) * 8) + 'deg;--len:' + f(1 + r() * 0.7) + '"></i>';
    }
    var list = t.fx.map(function (e) { return ['e', e]; });
    for (i = 0; i < 8; i++) list.push(['c', t.conf[i % t.conf.length]]);
    for (i = 0; i < 7; i++) list.push(['s']);
    for (i = 0; i < 5; i++) list.push(['p']);
    list.forEach(function (k, j) {
      var emoji = k[0] === 'e';
      var ang = (-90 + (r() - 0.5) * (emoji ? 150 : 210)) * Math.PI / 180;
      var dist = emoji ? 0.8 + r() * 0.4 : 0.6 + r() * 1.0;
      var s = emoji ? 1.25 + r() * 0.85 : k[0] === 's' ? 0.8 + r() * 1.4 : 1 + r() * 1.1;   /* bigger = closer to the viewer */
      var d = 1.3 + (emoji ? j * 0.055 : r() * 0.35);
      var dur = Math.min(1.12, 2.58 - d) - r() * 0.12;
      var st = '--x:calc(var(--bw) * ' + f(Math.cos(ang) * dist * 1.15) + ');--y:calc(var(--bw) * ' + f(Math.sin(ang) * dist) + ');' +
        '--s:' + f(s) + ';--r:' + Math.round(emoji ? (r() - 0.5) * 50 : (r() - 0.5) * 720) + 'deg;--d:' + f(d) + 's;--dur:' + f(dur) + 's';
      if (k[0] === 'c') st += ';background:' + k[1];
      parts += '<i class="bfx-p bfx-p--' + k[0] + '" style="' + st + '">' + (emoji ? k[1] : '') + '</i>';
    });
    var el = document.createElement('div');
    el.className = 'bfx-fx';
    el.dataset.theme = o.theme;
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '<div class="bfx-fx__bg"></div><div class="bfx-fx__stage">' +
      '<div class="bfx-fx__drop"><div class="bfx-fx__zoom"><div class="bfx-fx__shift"><div class="bfx-fx__book">' +
        '<div class="bfx-fx__back"></div><div class="bfx-fx__edge-r"></div><div class="bfx-fx__edge-b"></div>' +
        '<div class="bfx-fx__page"></div><div class="bfx-fx__seam"></div>' + leaves +
        '<div class="bfx-fx__cover"><div class="bfx-fx__cf">' + cover(o) + '</div><div class="bfx-fx__cb"></div><div class="bfx-fx__cedge"></div></div>' +
      '</div></div></div></div>' +
      '<div class="bfx-fx__rays"><i class="bfx-fx__glow"></i>' + rays + '</div>' +
      '<div class="bfx-fx__burst">' + parts + '</div></div>';
    return el;
  }

  var active = null;
  function open(book, opts) {
    opts = opts || {};
    if (active) active();
    var o = info(book), revealed = false, ended = false, fx = null, timers = [];
    function reveal() {
      if (revealed) return;
      revealed = true;
      var sel = book.getAttribute('data-target') || book.getAttribute('href'), target = null;
      if (sel && sel.charAt(0) === '#') { try { target = document.querySelector(sel); } catch (e) {} }
      if (target) {
        target.hidden = false;
        target.classList.add('bfx-reader');
        if (!reduced()) { target.classList.remove('bfx-in'); void target.offsetWidth; target.classList.add('bfx-in'); }
      }
      book.dispatchEvent(new CustomEvent('bookfx:open', { bubbles: true, detail: { book: book, target: target, title: o.title, theme: o.theme } }));
      if (opts.onOpen) opts.onOpen(target);
    }
    function finish() {
      if (ended) return;
      ended = true;
      timers.forEach(clearTimeout);
      reveal();
      if (fx && fx.parentNode) fx.parentNode.removeChild(fx);
      document.removeEventListener('keydown', onKey);
      active = null;
    }
    function onKey(e) { if (e.key === 'Escape' || e.key === 'Esc') finish(); }

    if (reduced()) { reveal(); return; }
    fx = build(o);
    fx.style.setProperty('--dk', book.style.getPropertyValue('--dk') || '0%');
    var mount = opts.mount || book.closest('[data-bfx-mount]');
    if (mount) fx.classList.add('bfx-fx--contained'); else mount = document.body;
    mount.appendChild(fx);
    fx.addEventListener('pointerdown', function (e) { e.preventDefault(); finish(); });
    document.addEventListener('keydown', onKey);
    timers.push(setTimeout(reveal, REVEAL_AT), setTimeout(finish, DURATION));
    active = finish;
  }

  /* static frame of the effect at time t (s) — for previews / docs */
  function renderFrame(container, o) {
    var theme = THEMES[o.theme] ? o.theme : 'money';
    var fx = build({ theme: theme, title: o.title || '', label: o.label || THEMES[theme].label });
    fx.classList.add('bfx-fx--contained', 'is-frozen');
    fx.style.setProperty('--seek', (o.t || 0) + 's');
    container.appendChild(fx);
    return fx;
  }

  function init(root) {
    root = root || document;
    var shelves = Array.prototype.slice.call(root.querySelectorAll('.bfx-shelf'));
    if (root.classList && root.classList.contains('bfx-shelf')) shelves.unshift(root);
    shelves.forEach(function (sh) { sh.querySelectorAll('.bfx-book').forEach(dress); });
    root.querySelectorAll('.bfx-book').forEach(dress);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { init(); });
  else init();
  window.BookFX = { init: init, open: open, renderFrame: renderFrame, themes: THEMES };
})();
