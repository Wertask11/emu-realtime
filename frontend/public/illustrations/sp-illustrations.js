/* 「知識を探す」「知識を試す」の挿絵（11/10・デザインのハンドオフ illustrations/README は design_handoff を参照）。
   - カードの絵4枚とワンポイントは、CSS 変数と時間帯の小物を効かせるため、SVG をそのまま埋め込む（img では効かない）。
   - 帯は img で出し、時間帯に合わせて src を替える。
   - 時間帯（朝 5–10時・昼 10–17時・夜 17–5時）は、2つの画面の根元に data-sp-time で付ける。
   - 画面の HTML（index.html）は変えず、画面が見えたときに初めて読み込んで差し込む（見ない人には読ませない）。
   どれも飾りなので、読み上げには出さない（aria-hidden）。 */
(function () {
  'use strict';
  var BASE = '/illustrations/';
  var CARDS = [
    ['#emuRequestsPage [data-tour="emu-lab-entry"]', 'card-lab'],
    ['#emuRequestsPage [data-tour~="room1-entry"]', 'card-text'],
    ['#emuPracticePage [data-tour="guild-entry"]', 'card-guild'],
    ['#emuPracticePage [data-tour="quest-entry"]', 'card-quest']
  ];
  var ROOTS = { search: 'emuRequestsPage', practice: 'emuPracticePage' };

  function timeOfDay(d) {
    var h = (d || new Date()).getHours();
    return h >= 5 && h < 10 ? 'morning' : h >= 10 && h < 17 ? 'day' : 'night';
  }
  /* 11/19：絵本の絵柄の挿絵（WebP）に差し替えた。前の SVG は時間帯の色を CSS 変数で替えていたが、
     WebP は絵そのものなので、img で出すだけにする（帯は今までどおり時間帯で src を替える）。 */
  function visible(el) { return !!(el && el.getClientRects().length); }
  function slot(host, cls, name, before) {
    if (host.querySelector(':scope > .spi-slot[data-spi="' + name + '"]')) return;
    var box = document.createElement('div');
    box.className = 'spi-slot ' + cls; box.setAttribute('data-spi', name); box.setAttribute('aria-hidden', 'true');
    var img = document.createElement('img'); img.alt = ''; img.decoding = 'async'; img.loading = 'lazy';
    img.src = BASE + name + '.webp';
    img.onerror = function () { box.remove(); };
    box.appendChild(img);
    host.insertBefore(box, before || host.firstChild);
  }
  function band(root, kind) {
    var pair = root.querySelector('.emu-knowledge-pair');
    if (!pair) return;
    var wrap = root.querySelector(':scope > .spi-band');
    if (!wrap) {
      wrap = document.createElement('div'); wrap.className = 'spi-band'; wrap.setAttribute('aria-hidden', 'true');
      var img = document.createElement('img'); img.alt = ''; img.decoding = 'async';
      wrap.appendChild(img);
      pair.parentNode.insertBefore(wrap, pair.nextSibling);
    }
    var src = BASE + 'band-' + kind + '-' + root.getAttribute('data-sp-time') + '.webp';
    var im = wrap.querySelector('img');
    if (im.getAttribute('src') !== src) im.setAttribute('src', src);
  }
  function paint() {
    var t = timeOfDay();
    Object.keys(ROOTS).forEach(function (kind) {
      var root = document.getElementById(ROOTS[kind]);
      if (!root) return;
      if (root.getAttribute('data-sp-time') !== t) root.setAttribute('data-sp-time', t);
      if (!visible(root)) return;
      CARDS.forEach(function (c) {
        var card = document.querySelector(c[0]);
        if (card && root.contains(card)) slot(card, 'spi-card-art', c[1], card.querySelector('h3'));
      });
      if (kind === 'search') {
        var entry = root.querySelector('.emu-practice-entry');
        if (entry) slot(entry, 'spi-onepoint', 'onepoint-try', entry.firstChild);
      }
      band(root, kind);
    });
  }
  function start() {
    paint();
    if (typeof MutationObserver === 'function') {
      new MutationObserver(paint).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }
    setInterval(paint, 5 * 60 * 1000);   // 時間帯が変わったら替える
  }
  window.SpIllustrations = { timeOfDay: timeOfDay, paint: paint };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
