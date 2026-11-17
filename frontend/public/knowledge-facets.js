/* 知識を読む：検索バーの「分類で絞る」（11/18 オーナー）。
   Knowledge Lab の「知識図書館」をやめたので、分類（分野・業種・職業など）で絞って探す機能はここへ移した。
   ・同じ分類の中は「どれか」、違う分類どうしは「すべて」で絞る（Knowledge Lab と同じ考え方）
   ・分類が付いているのは Knowledge Lab で整理した知識だけ。絞り込み中は、分類の無い知識は出ない
   ・本体（knowledge.html）の visible()・countText() を包むだけ。並べ替え・テーマ・言葉の検索はそのまま効く
   ・分類の名前は Knowledge Lab と同じ一覧（/api/knowledge-lab/taxonomy）を読む。書き込みはしない */
(function () {
  'use strict';
  if (typeof state === 'undefined' || typeof visible !== 'function' || typeof render !== 'function') return;
  var AXES = { field: '分野', industry: '業種', occupation: '職業', experience: '経験の種類', purpose: '目的' };
  var sel = {};
  var termsRead = null;

  function picked() { return Object.keys(sel).reduce(function (n, a) { return n + sel[a].length; }, 0); }
  function matches(p) {
    var f = (p && p.facets) || {};
    return Object.keys(sel).every(function (axis) {
      if (!sel[axis].length) return true;
      return (f[axis] || []).some(function (id) { return sel[axis].indexOf(id) >= 0; });
    });
  }
  var baseVisible = visible;
  visible = function () {
    var list = baseVisible.apply(this, arguments);
    return picked() ? list.filter(matches) : list;
  };
  if (typeof countText === 'function') {
    var baseCount = countText;
    countText = function (list) {
      if (picked() && typeof emuT === 'function') return emuT('k.countMatch', { n: list.length, loaded: state.posts.length });
      return baseCount.apply(this, arguments);
    };
  }

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function terms() {
    if (Array.isArray(state.labTerms) && state.labTerms.length) return Promise.resolve(state.labTerms);
    if (!termsRead) termsRead = fetch('/api/knowledge-lab/taxonomy').then(function (r) { return r.ok ? r.json() : []; })
      .then(function (j) { var list = Array.isArray(j) ? j : (j && j.items) || []; if (list.length && !state.labTerms) state.labTerms = list; return list; })
      .catch(function () { termsRead = null; return []; });
    return termsRead;
  }

  var style = document.createElement('style');
  style.textContent = '.kf-btn{flex:none;border:1px solid var(--line);background:#fff;border-radius:999px;padding:6px 12px;font-weight:700;font-size:13px;color:#555;white-space:nowrap}'
    + '.kf-btn[aria-expanded="true"],.kf-btn.on{border-color:#f2ad62;background:#fff8ee;color:#b75c00}'
    + '.kf-panel{background:#fff;border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin:-8px 0 16px}'
    + '.kf-axis{margin:6px 0 10px}.kf-axis b{display:block;font-size:12px;color:#85817a;margin-bottom:6px}'
    + '.kf-chips{display:flex;flex-wrap:wrap;gap:6px}.kf-chip{border:1px solid var(--line);background:#fff;border-radius:999px;padding:6px 12px;font-size:13px;color:#555}'
    + '.kf-chip[aria-pressed="true"]{border-color:#f2ad62;background:#fff8ee;color:#b75c00;font-weight:700}'
    + '.kf-foot{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-top:6px}.kf-foot small{color:#85817a;font-size:12px}'
    + '.kf-clear{border:0;background:transparent;color:#b75c00;font-weight:700;font-size:13px;padding:6px}';
  document.head.appendChild(style);

  var bar = document.querySelector('.search');
  if (!bar) return;
  var btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'kf-btn'; btn.id = 'facetFilter';
  btn.setAttribute('aria-expanded', 'false'); btn.setAttribute('aria-controls', 'facetPanel');
  btn.textContent = '分類で絞る';
  bar.appendChild(btn);
  var panel = document.createElement('div');
  panel.className = 'kf-panel'; panel.id = 'facetPanel'; panel.hidden = true;
  bar.insertAdjacentElement('afterend', panel);

  function label() {
    var n = picked();
    btn.textContent = n ? '分類で絞る（' + n + '）' : '分類で絞る';
    btn.classList.toggle('on', n > 0);
  }
  function draw(list) {
    var html = Object.keys(AXES).map(function (axis) {
      var t = list.filter(function (x) { return x && x.axis === axis && x.active !== false && !x.mergedInto; });
      if (!t.length) return '';
      return '<div class="kf-axis"><b>' + esc(AXES[axis]) + '</b><div class="kf-chips">' + t.map(function (x) {
        var on = (sel[axis] || []).indexOf(x.id) >= 0;
        return '<button type="button" class="kf-chip" data-axis="' + esc(axis) + '" data-term="' + esc(x.id) + '" aria-pressed="' + on + '">' + esc(x.label) + '</button>';
      }).join('') + '</div></div>';
    }).join('');
    panel.innerHTML = (html || '<p class="kf-axis">分類を読み込めませんでした。少し待って、もう一度開いてください。</p>')
      + '<div class="kf-foot"><small>分類が付いているのは、Knowledge Lab で整理した知識です。</small><button type="button" class="kf-clear" data-kf-clear>絞り込みを外す</button></div>';
  }
  btn.addEventListener('click', function () {
    var open = panel.hidden;
    panel.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    if (open) { panel.innerHTML = '<p class="kf-axis">分類を読み込んでいます…</p>'; terms().then(draw); }
  });
  panel.addEventListener('click', function (e) {
    var chip = e.target.closest && e.target.closest('[data-term]');
    if (chip) {
      var axis = chip.getAttribute('data-axis'), id = chip.getAttribute('data-term');
      var list = sel[axis] || (sel[axis] = []);
      var i = list.indexOf(id);
      if (i >= 0) list.splice(i, 1); else list.push(id);
      chip.setAttribute('aria-pressed', String(i < 0));
    } else if (e.target.closest && e.target.closest('[data-kf-clear]')) {
      sel = {};
      panel.querySelectorAll('[data-term]').forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
    } else return;
    label();
    render();
  });
  window.EmuKnowledgeFacets = { selected: function () { return JSON.parse(JSON.stringify(sel)); } };
})();
