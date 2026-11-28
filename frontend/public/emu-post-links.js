/* 知識を読む（knowledge.html）の、投稿の引用（11/27）。
   オーナー：「Xみたいに投稿の引用出来るようにしたい。知識を読むで投稿されたやつを引用して、新しく投稿する」。
   11/28 オーナー：「コメントはいらない。改善案とか届いた声でコメント送れたり確認できたりできるから」。返信・スレッドは外し、引用だけにした。

   - 投稿カードに「🔁 引用」を足す。押すと、いつもの投稿画面が、引用元を付けた状態で開く（「外す」で外せる）。
   - 引用した投稿には、引用元の札（書いた人・題名・本文の頭）を出す。押すと全文が開く。

   投稿の記録には、引用した投稿の ID（quotePostId）だけを残す。本当にある投稿かは、公開するときに
   親（index.html の postForm の submit）が確かめる。あとから変えられない。
   読むのは親の window.EmuPostLinks.get。カードの中身（knowledge.html の card()）は変えず、描かれたあとに足す。
   引用も、ふだんの投稿と同じく1回の投稿に数える（決まり＝firestore.rules は変えていない）。 */
(function () {
  'use strict';
  var L = null;
  try { L = window.parent && window.parent !== window ? window.parent.EmuPostLinks : null; } catch (_) { L = null; }
  if (!L || typeof state === 'undefined') return;

  var link = null;            // いま投稿画面に付いている引用元 { id, title, name }
  var cache = {};             // 一覧に無い投稿：'loading' | false（無い）| row
  var timer = null;

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function say(text) { if (typeof notify === 'function') notify(text); }
  function postIdOf(card) { var b = card.querySelector('[data-share][data-id]'); return b ? b.getAttribute('data-id') : ''; }
  function inList(id) { var list = state.posts || []; for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
  function byId(id) { var p = inList(id); if (p) return p; var c = cache[id]; return c && typeof c === 'object' ? c : null; }
  function nameOf(p) { try { return author(p).name; } catch (_) { return p.displayName || ''; } }
  function mergeAuthors(a) { if (a && state.authors) Object.keys(a).forEach(function (k) { state.authors[k] = a[k]; }); }
  function want(id) {
    if (!id || inList(id) || cache[id] !== undefined) return;
    cache[id] = 'loading';
    L.get(id).then(function (d) {
      cache[id] = d && d.rows && d.rows[0] ? d.rows[0] : false;
      if (d) mergeAuthors(d.authors);
      soon();
    }, function () { delete cache[id]; });
  }
  function snippet(text, n) { var t = String(text || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t; }
  /* 11/28 オーナー：「引用の時はタイトルいらない」。題名の欄は出さない。一覧・検索のために、本文の1行目（40字まで）を題名として残し、
     カードでは出さない（題名が本文の1行目と同じなら隠す） */
  function autoTitle(body) { var first = String(body || '').split('\n').map(function (l) { return l.trim(); }).filter(Boolean)[0] || ''; return first.length > 40 ? first.slice(0, 40) + '…' : first; }

  /* ── カードに足す ── */
  function quoteBox(id) {
    var q = byId(id);
    if (!q) {
      want(id);
      return '<div class="lk-quote lk-quote-empty">' + (cache[id] === false ? '引用元の投稿は見つかりませんでした（消されたかもしれません）。' : '引用元の投稿を読み込んでいます…') + '</div>';
    }
    return '<button type="button" class="lk-quote" data-link-expand aria-expanded="false" title="押すと全文">'
      + '<span class="lk-quote-who">🔁 ' + esc(nameOf(q)) + ' さんの投稿</span>'
      + '<b class="lk-quote-title">' + esc(q.title) + '</b>'
      + '<span class="lk-quote-body">' + esc(snippet(q.body, 90)) + '</span>'
      + '<span class="lk-quote-full" hidden>' + esc(q.body) + (q.imageUrl && /^(https:|data:image\/)/.test(q.imageUrl) ? '<img class="lk-quote-img" alt="" loading="lazy" src="' + esc(q.imageUrl) + '">' : '') + '</span></button>';
  }
  function decorate() {
    document.querySelectorAll('#posts article.card').forEach(function (card) {
      var id = postIdOf(card);
      if (!id) return;
      var p = inList(id) || {};
      if (p.quotePostId && p.title && p.title === autoTitle(p.body)) { var h = card.querySelector('h3'); if (h && !h.hidden) h.hidden = true; }
      if (!card.hasAttribute('data-links-ready')) {
        card.setAttribute('data-links-ready', '');
        var actions = card.querySelector('.actions');
        if (actions) {
          var el = document.createElement('button');
          el.type = 'button'; el.className = 'lk-act'; el.setAttribute('data-link-quote', id); el.setAttribute('data-emoji', '🔁');
          el.title = '引用して投稿する'; el.setAttribute('aria-label', '引用して投稿する'); el.textContent = '🔁 引用';
          el.style.order = '3';
          actions.insertBefore(el, actions.querySelector('.share-btn') || null);
        }
      }
      /* 引用元の札（本文のあと） */
      var qb = card.querySelector('[data-link-quotebox]');
      if (p.quotePostId) {
        var html = quoteBox(p.quotePostId);
        if (!qb) {
          qb = document.createElement('div'); qb.setAttribute('data-link-quotebox', '');
          card.insertBefore(qb, card.querySelector('.tags') || card.querySelector('.impact'));
        }
        if (qb.getAttribute('data-html') !== html) { qb.innerHTML = html; qb.setAttribute('data-html', html); }
      } else if (qb) qb.remove();
    });
  }
  function soon() { clearTimeout(timer); timer = setTimeout(decorate, 30); }

  /* ── 投稿画面に、引用元を付ける ── */
  function preview() {
    var form = document.getElementById('composeForm');
    if (!form) return;
    var box = form.querySelector('[data-link-preview]');
    var title = document.getElementById('title'), field = title && title.closest ? title.closest('.field') : null;
    if (title) title.required = !link;
    if (field) field.hidden = !!link;
    /* 11/28 オーナー：「引用の時はテーマもいらない」。テーマの欄も出さず、投稿にもテーマを付けない */
    var theme = document.getElementById('composeThemeFold');
    if (theme) { theme.hidden = !!link; theme.style.display = link ? 'none' : ''; }
    if (!link) { if (box) box.remove(); return; }
    if (!box) {
      box = document.createElement('div'); box.setAttribute('data-link-preview', ''); box.className = 'lk-preview';
      var after = form.querySelector('#composerTitle');
      form.insertBefore(box, after ? after.nextSibling : form.firstChild);
    }
    var q = byId(link.id) || {};
    box.innerHTML = '<div class="lk-preview-k">🔁 この投稿を引用します</div>'
      + '<button type="button" class="lk-preview-t" data-link-expand aria-expanded="false" title="押すと全文">'
      + '<b>' + esc(link.name) + '</b> さん「' + esc(snippet(link.title, 60)) + '」'
      + '<span class="lk-quote-body">' + esc(snippet(q.body, 60)) + '</span>'
      + '<span class="lk-quote-full" hidden>' + esc(q.body || '') + '</span></button>'
      + '<small>ふだんの投稿と同じく、1回の投稿に数えます。</small>'
      + '<button type="button" class="lk-preview-x" data-link-clear aria-label="引用を外す">外す</button>';
  }
  function startQuote(id) {
    if (!state.account) { say('引用して投稿するには、ログインしてね🧊'); return; }
    var p = byId(id);
    if (!p) { say('その投稿を読み込めませんでした。少し待って、もう一度押してね。'); return; }
    var composer = document.getElementById('composer');
    if (!composer || !composer.classList.contains('open')) { if (typeof resetComposer === 'function') resetComposer(); openComposer(); }
    link = { id: p.id, title: p.title || '', name: nameOf(p) };
    preview();
    var focus = document.getElementById('body');
    if (focus) setTimeout(function () { try { focus.focus(); } catch (_) {} }, 60);
  }
  function clearLink() { link = null; preview(); }

  /* 送る中身に、引用元を足す（knowledge.html の payload を包む） */
  if (typeof window.payload === 'function') {
    var basePayload = window.payload;
    window.payload = function () {
      var d = basePayload.apply(this, arguments);
      if (link && d) {
        d.quotePostId = link.id;
        if (!d.title) d.title = autoTitle(d.body);
        var tagInput = document.getElementById('tags');
        d.tags = tagInput ? String(tagInput.value || '').trim() : '';
      }
      return d;
    };
  }
  if (typeof window.resetComposer === 'function') {
    var baseReset = window.resetComposer;
    window.resetComposer = function () { var r = baseReset.apply(this, arguments); clearLink(); return r; };
  }
  /* 投稿画面を閉じたら外す（次に書くときに、前の引用が残らないように） */
  function watchComposer() {
    var c = document.getElementById('composer');
    if (!c || typeof MutationObserver !== 'function') return;
    new MutationObserver(function () { if (link && !c.classList.contains('open')) clearLink(); }).observe(c, { attributes: true, attributeFilter: ['class'] });
  }

  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target : null; if (!t) return;
    var b = t.closest('[data-link-quote]'); if (b) { e.preventDefault(); startQuote(b.getAttribute('data-link-quote')); return; }
    if (t.closest('[data-link-clear]')) { e.preventDefault(); clearLink(); return; }
    b = t.closest('[data-link-expand]');
    if (b) {
      var full = b.querySelector('.lk-quote-full'), short = b.querySelector('.lk-quote-body');
      var opening = full.hidden; full.hidden = !opening; short.hidden = opening; b.setAttribute('aria-expanded', String(opening));
    }
  });

  var css = document.createElement('style');
  css.textContent = [
    '.lk-quote{display:block;width:100%;text-align:left;margin:10px 0 4px;padding:10px 12px;border:1px solid #e3d9c9;border-radius:12px;background:#fbf8f2;font:inherit;color:inherit;cursor:pointer}',
    '.lk-quote-empty{cursor:default;color:#8a8070;font-size:13px}',
    '.lk-quote-who{display:block;font-size:12px;color:#8a6a3a;font-weight:700}',
    '.lk-quote-title{display:block;margin-top:2px;font-size:14px}',
    '.lk-quote-body,.lk-quote-full{display:block;margin-top:4px;font-size:13px;line-height:1.7;color:#5c554c;white-space:pre-wrap;overflow-wrap:anywhere}',
    '.lk-quote-full[hidden],.lk-quote-body[hidden]{display:none}',
    '.lk-quote-img{display:block;max-width:100%;max-height:320px;margin-top:8px;border-radius:10px}',
    '.lk-preview{position:relative;margin:0 0 12px;padding:10px 64px 10px 12px;border:1px solid #f0c98a;border-radius:12px;background:#fff8ea}',
    '.lk-preview-k{font-size:12px;font-weight:800;color:#a15c00}',
    '.lk-preview-t{display:block;width:100%;margin-top:2px;padding:0;border:0;background:none;font:inherit;font-size:14px;color:inherit;text-align:left;cursor:pointer;overflow-wrap:anywhere}',
    '.lk-preview small{display:block;margin-top:2px;color:#8a8070;font-size:12px}',
    '.lk-preview-x{position:absolute;top:8px;right:8px;padding:4px 10px;border:1px solid #d8cdbb;border-radius:999px;background:#fff;font:inherit;font-size:12px;cursor:pointer}'
  ].join('\n');
  document.head.appendChild(css);

  function watch() {
    var posts = document.getElementById('posts'); if (!posts || typeof MutationObserver !== 'function') return;
    new MutationObserver(function (list) {
      /* 自分で足した札の変化では動かない（足す → 見張りが動く → また足す、を繰り返さない） */
      var ours = list.every(function (m) { var n = m.target; return n.closest && n.closest('[data-link-quotebox]'); });
      if (!ours) soon();
    }).observe(posts, { childList: true, subtree: true });
    decorate();
    watchComposer();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch);
  else watch();
})();
