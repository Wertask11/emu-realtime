/* 冷蔵庫くんと話して書く（11/10）。knowledge.html の投稿画面で読み込む。

   書くのが苦手な人のために、投稿画面の中で冷蔵庫くんと短く話すと、冷蔵庫くんが投稿の形にまとめる。
   - 話した中身は、親（index.html）が中継してサーバー（backend/reizo-interview.js）へ送る。ログインの鍵は親が持つ。
   - まとめた案は見せるだけ。「この案を使う」を押したときだけ入れる。入れるのは空の欄だけ
     （本文が書いてあるときは、置きかえてよいか聞く）。本人が選んだ「詳しく整理する」も上書きしない。
   - 冷蔵庫くんに聞くの会話からまとめた下書き（emu-knowledge-prefill-draft）も、ここで投稿画面に入れる。
   会話は画面の中にだけ持つ（保存しない）。投稿画面を閉じたら消す。 */
(function () {
  'use strict';
  var turns = [], pending = null, draft = null, ready = false;
  var BTN = 'width:auto;max-width:max-content;display:inline-block;border:0;border-radius:999px;padding:8px 16px;font:inherit;font-size:13px;font-weight:700;cursor:pointer';

  function q(sel, root) { return (root || document).querySelector(sel); }
  function el(tag, css, text) { var e = document.createElement(tag); if (css) e.style.cssText = css; if (text != null) e.textContent = text; return e; }

  /* ── 画面 ── */
  function mount() {
    if (q('[data-talk]')) return q('[data-talk]');
    var anchor = q('[data-proofread-panel]');
    var host = anchor && anchor.parentElement;
    if (!host) return null;
    /* 11/10：「整えてもらう」と同じ行（data-reizo-tools）にボタンを並べる。行が無い古い形では、ボタンと説明を下に出す。 */
    var row = q('[data-reizo-tools]');
    var box = el('div', row ? 'margin-top:0' : 'margin-top:12px'); box.setAttribute('data-talk', '');
    var openBtn = '<button type="button" data-talk-open class="reizo-tool talk" style="' + (row ? '' : BTN + ';background:#0b5cab;color:#fff') + '">🗣️ 冷蔵庫くんと話して書く</button>';
    if (row) row.insertAdjacentHTML('beforeend', openBtn);
    box.innerHTML = (row ? '' : openBtn + '<small style="display:block;margin-top:4px;color:#8a8070;font-size:12px">書くのが苦手でも大丈夫。話しかけるだけで、冷蔵庫くんが投稿の形にまとめるよ。</small>')
      + '<div data-talk-panel hidden style="margin-top:10px;border:1px solid #c9dcf2;background:#f3f8fe;border-radius:12px;padding:12px">'
      + '<div data-talk-log role="log" aria-live="polite" style="display:grid;gap:8px;max-height:280px;overflow:auto;padding-right:2px"></div>'
      + '<div style="display:flex;gap:6px;margin-top:10px;align-items:flex-end"><textarea data-talk-input rows="2" maxlength="800" aria-label="冷蔵庫くんに話す" placeholder="あったこと・気づいたことを話してね" style="flex:1;min-width:0;min-height:0;height:68px;resize:vertical;border:1px solid #c9dcf2;border-radius:10px;padding:8px 10px;font:inherit;font-size:14px;background:#fff"></textarea>'
      + '<button type="button" data-talk-send style="' + BTN + ';background:#0b5cab;color:#fff">送る</button></div>'
      + '<div style="margin-top:8px"><button type="button" data-talk-draft style="' + BTN + ';background:#1f6f5c;color:#fff;margin-right:6px">📝 投稿用にまとめて</button>'
      + '<button type="button" data-talk-close style="' + BTN + ';background:#fff;color:#0b5cab;border:1px solid #c9dcf2">閉じる</button></div>'
      + '<small data-talk-note style="display:block;margin-top:4px;color:#8a8070;font-size:12px">まとめるのは1日3回まで。話した中身は保存しないよ。</small>'
      + '<div data-talk-preview hidden style="margin-top:10px;border:1px solid #cfe3da;background:#f3faf6;border-radius:12px;padding:12px">'
      + '<div data-talk-preview-msg style="font-size:13px;font-weight:700;color:#1f6f5c;white-space:pre-wrap"></div>'
      + '<div data-talk-preview-title style="margin-top:8px;font-weight:700;white-space:pre-wrap;overflow-wrap:anywhere"></div>'
      + '<div data-talk-preview-lab style="margin-top:6px;font-size:12px;color:#1f6f5c;white-space:pre-wrap;overflow-wrap:anywhere"></div>'
      + '<div data-talk-preview-body style="margin-top:6px;font-size:14px;line-height:1.8;white-space:pre-wrap;overflow-wrap:anywhere;max-height:260px;overflow:auto;background:#fff;border-radius:8px;padding:10px"></div>'
      + '<div style="margin-top:10px"><button type="button" data-talk-use style="' + BTN + ';background:#1f6f5c;color:#fff;margin-right:6px">この案を使う</button>'
      + '<button type="button" data-talk-cancel style="' + BTN + ';background:#fff;color:#1f6f5c;border:1px solid #cfe3da">やめる（話をつづける）</button></div></div>'
      + '</div>';
    host.insertAdjacentElement('afterend', box);
    return box;
  }
  function line(role, text) {
    var log = q('[data-talk-log]'); if (!log) return null;
    var me = role === 'me';
    var row = el('div', 'display:flex;gap:6px;align-items:flex-start;' + (me ? 'justify-content:flex-end' : ''));
    if (!me) { var img = el('img', 'width:28px;height:28px;border-radius:50%;object-fit:cover;flex:none'); img.src = '/assets/mascot.jpg'; img.alt = ''; row.appendChild(img); }
    var bubble = el('div', 'max-width:85%;padding:8px 12px;border-radius:14px;font-size:14px;line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere;'
      + (me ? 'background:#0b5cab;color:#fff;border-top-right-radius:4px' : 'background:#fff;color:#222;border-top-left-radius:4px'), text);
    row.appendChild(bubble); log.appendChild(row); log.scrollTop = log.scrollHeight;
    return bubble;
  }
  function busy(on, label) {
    var send = q('[data-talk-send]'), d = q('[data-talk-draft]');
    if (send) send.disabled = on;
    if (d) { d.disabled = on; d.textContent = on && label ? label : ready ? '📝 投稿用にまとめて（準備OK！）' : '📝 投稿用にまとめて'; }
  }
  function openPanel() {
    var box = mount(); if (!box) return;
    var panel = q('[data-talk-panel]', box); panel.hidden = false;
    if (!q('[data-talk-log]', box).children.length) {
      line('reizo', 'いっしょに書こう！🧊 最近あったことや、やってみて気づいたことを、話しかけるみたいに送ってね。短くても大丈夫だよ。');
    }
    var input = q('[data-talk-input]', box); if (input) input.focus();
  }
  function reset() {
    turns = []; pending = null; draft = null; ready = false;
    var box = q('[data-talk]'); if (!box) return;
    q('[data-talk-log]', box).innerHTML = ''; q('[data-talk-panel]', box).hidden = true; q('[data-talk-preview]', box).hidden = true;
    var input = q('[data-talk-input]', box); if (input) input.value = '';
    busy(false);
  }

  /* ── 親へ頼む ── */
  function ask(mode, terms) {
    var id = 't' + Date.now() + Math.random().toString(36).slice(2, 8);
    pending = { id: id, mode: mode };
    busy(true, mode === 'draft' ? '🧊 まとめています…' : '');
    try { window.parent.postMessage({ type: 'emu-knowledge-interview', requestId: id, mode: mode, turns: turns.slice(-16), terms: terms }, location.origin); }
    catch (_) { pending = null; busy(false); line('reizo', 'うまくつながらなかったみたい🧊 もう一度ためしてね。'); return; }
    var typing = mode === 'ask' ? line('reizo', '…') : null;
    if (typing) typing.setAttribute('data-talk-typing', '');
    setTimeout(function () {
      if (pending && pending.id === id) { pending = null; busy(false); removeTyping(); line('reizo', 'うまくつながらなかったみたい🧊 もう一度ためしてね。'); }
    }, 60000);
  }
  function removeTyping() { var t = q('[data-talk-typing]'); if (t && t.parentElement) t.parentElement.remove(); }
  function send() {
    var input = q('[data-talk-input]'); if (!input || pending) return;
    var text = input.value.trim(); if (!text) return;
    input.value = '';
    turns.push({ role: 'me', text: text.slice(0, 800) });
    line('me', text);
    ask('ask');
  }
  /* 「詳しく整理する」の分類の候補（knowledge.html の LAB_AXES・state.labTerms と同じ形）。読めなければ分類なし。 */
  async function labTerms() {
    try {
      if (!state.labTerms) { var r = await fetch('/api/knowledge-lab/taxonomy'); var j = await r.json(); if (r.ok) state.labTerms = Array.isArray(j) ? j : (j.items || []); }
    } catch (_) {}
    var out = {};
    (state.labTerms || []).forEach(function (t) {
      if (!t || typeof LAB_AXES === 'undefined' || !LAB_AXES[t.axis] || t.active === false || t.mergedInto) return;
      (out[t.axis] = out[t.axis] || []).push([t.id, t.label]);
    });
    return out;
  }
  async function makeDraft() {
    if (pending) return;
    if (!turns.some(function (t) { return t.role === 'me'; })) { line('reizo', 'まずは、あったことや気づいたことを話してみてね🧊'); return; }
    var terms = await labTerms();
    if (pending) return;
    ask('draft', terms);
  }

  /* ── 案を見せる・入れる ── */
  function labSummary(lab) {
    if (!lab) return '';
    var byId = {}; (state.labTerms || []).forEach(function (t) { byId[t.id] = t.label; });
    var parts = [];
    Object.keys(lab.facets || {}).forEach(function (a) {
      var names = (lab.facets[a] || []).map(function (id) { return byId[id] || id; });
      if (names.length) parts.push(((typeof LAB_AXES !== 'undefined' && LAB_AXES[a]) || a) + '：' + names.join('・'));
    });
    if (lab.period) parts.push('経験した時期：' + lab.period);
    var filled = [lab.happened ? '何が起きたか' : '', lab.learned ? '学んだこと' : '', lab.advice ? '助言・注意点' : ''].filter(Boolean);
    if (filled.length) parts.push(filled.join('・') + 'も下書きします');
    return parts.length ? '📚 詳しく整理する（Knowledge Lab）も入れます\n' + parts.join('\n') : '';
  }
  function showPreview(d, msg) {
    var box = mount(); if (!box) return;
    q('[data-talk-panel]', box).hidden = false;
    var p = q('[data-talk-preview]', box); p.hidden = false;
    q('[data-talk-preview-msg]', box).textContent = msg;
    q('[data-talk-preview-title]', box).textContent = (d.title ? 'タイトル案：' + d.title : '') + (d.tags && d.tags.length ? (d.title ? '\n' : '') + 'タグ案：' + d.tags.join(', ') : '');
    q('[data-talk-preview-lab]', box).textContent = labSummary(d.lab);
    q('[data-talk-preview-body]', box).textContent = d.body;
    p.scrollIntoView && p.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  /* 本人が入れたものは上書きしない。空の欄と、まだ選んでいない軸だけに入れる。 */
  function applyLab(lab) {
    if (!lab || typeof fillLab !== 'function' || typeof labPayload !== 'function') return;
    var cur = labPayload() || { facets: typeof labFacetValue === 'function' ? labFacetValue() : {}, period: '', happened: '', learned: '', advice: '', sources: '', verification: 'self-reported', aiUseConsent: true };
    var merged = Object.assign({}, cur, { facets: Object.assign({}, cur.facets || {}) });
    Object.keys(lab.facets || {}).forEach(function (a) { if (!(merged.facets[a] || []).length) merged.facets[a] = lab.facets[a].slice(); });
    ['period', 'happened', 'learned', 'advice'].forEach(function (k) { if (!String(merged[k] || '').trim() && lab[k]) merged[k] = lab[k]; });
    fillLab(merged);
    var more = document.getElementById('labMore'); if (more) more.open = true;
  }
  function setField(id, value) {
    var f = document.getElementById(id);
    if (!f || f.readOnly || !value) return false;
    f.value = value; f.dispatchEvent(new Event('input', { bubbles: true })); return true;
  }
  function isEmpty(id) { var f = document.getElementById(id); return !!f && !f.value.trim(); }
  function useDraft(d, askReplace) {
    var b = document.getElementById('body');
    if (b && b.value.trim() && b.value.trim() !== d.body.trim()) {
      if (!askReplace || !window.confirm('いま書いてある本文を、まとめた案に置きかえますか？')) return false;
    }
    setField('body', d.body);
    if (isEmpty('title')) setField('title', d.title);
    if (isEmpty('tags') && d.tags && d.tags.length) setField('tags', d.tags.join(', '));
    applyLab(d.lab);
    return true;
  }

  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target : null; if (!t) return;
    if (t.closest('[data-talk-open]')) { openPanel(); return; }
    if (t.closest('[data-talk-send]')) { send(); return; }
    if (t.closest('[data-talk-draft]')) { makeDraft(); return; }
    if (t.closest('[data-talk-close]')) { var p = q('[data-talk-panel]'); if (p) p.hidden = true; return; }
    if (t.closest('[data-talk-use]') && draft) {
      if (useDraft(draft, true)) { q('[data-talk-preview]').hidden = true; q('[data-talk-panel]').hidden = true; draft = null;
        if (typeof notify === 'function') notify('冷蔵庫くんのまとめを入れたよ🧊 読み直して、直したいところは直してね。'); }
      return;
    }
    if (t.closest('[data-talk-cancel]')) { q('[data-talk-preview]').hidden = true; draft = null; var i = q('[data-talk-input]'); if (i) i.focus(); }
  });
  document.addEventListener('keydown', function (e) {
    if (e.target && e.target.matches && e.target.matches('[data-talk-input]') && e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing) { e.preventDefault(); send(); }
  });

  window.addEventListener('message', function (e) {
    if (e.origin !== location.origin || e.source !== window.parent) return;
    var m = e.data || {};
    if (m.type === 'emu-knowledge-interview-result') {
      if (!pending || m.requestId !== pending.id) return;
      var mode = pending.mode; pending = null; removeTyping();
      if (!m.ok) { busy(false); line('reizo', m.error || 'うまくいかなかったみたい🧊 もう一度ためしてね。'); return; }
      if (mode === 'ask') {
        turns.push({ role: 'reizo', text: String(m.reply || '').slice(0, 800) });
        ready = ready || m.ready === true;
        line('reizo', String(m.reply || ''));
        busy(false);
        return;
      }
      busy(false);
      if (m.empty) { line('reizo', (m.note || 'まだ知識にできる体験が見つからなかったよ') + '🧊 やってみたことや、うまくいったこと・失敗したことを話してみてね。'); return; }
      draft = { title: String(m.title || ''), body: String(m.body || ''), tags: Array.isArray(m.tags) ? m.tags.map(String).slice(0, 5) : [], lab: m.lab && typeof m.lab === 'object' ? m.lab : null };
      var left = typeof m.remaining === 'number' ? '（今日あと' + m.remaining + '回）' : '';
      var missing = Array.isArray(m.missing) ? m.missing.map(String).slice(0, 4) : [];
      showPreview(draft, '🧊 こうまとめてみたよ' + (m.note ? '：' + m.note : '') + left
        + (missing.length ? '\n' + missing.join('') + 'は、まだ話に出てこなかったので空けてあるよ。冷蔵庫くんにもう少し話すか、使ってから書き足してね。' : ''));
      return;
    }
    /* 冷蔵庫くんに聞くの会話からまとめた下書き。投稿画面を開いて入れる。 */
    if (m.type === 'emu-knowledge-prefill-draft' && m.draft && typeof m.draft === 'object') {
      var d = { title: String(m.draft.title || '').slice(0, 160), body: String(m.draft.body || '').slice(0, 5000),
        tags: Array.isArray(m.draft.tags) ? m.draft.tags.map(String).slice(0, 5) : [], lab: m.draft.lab && typeof m.draft.lab === 'object' ? m.draft.lab : null };
      if (!d.body.trim()) return;
      var composer = document.getElementById('composer');
      if (composer && !composer.classList.contains('open')) { if (typeof resetComposer === 'function') resetComposer(); if (typeof openComposer === 'function') openComposer(); }
      if (useDraft(d, false)) { if (typeof notify === 'function') notify('冷蔵庫くんとの話をまとめて入れたよ🧊 読み直して、直したいところは直してね。'); }
      else { draft = d; showPreview(d, '🧊 冷蔵庫くんとの話をまとめたよ。本文が書いてあるので、使うか選んでね。'); }
    }
  });

  /* 投稿画面を閉じたら、話した中身は消す。 */
  function watch() {
    var composer = document.getElementById('composer'); if (!composer || typeof MutationObserver !== 'function') return;
    var wasOpen = composer.classList.contains('open');
    new MutationObserver(function () {
      var open = composer.classList.contains('open');
      if (wasOpen && !open) reset();
      wasOpen = open;
    }).observe(composer, { attributes: true, attributeFilter: ['class'] });
  }
  mount();
  watch();
})();
