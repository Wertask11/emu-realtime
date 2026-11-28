/* 知識を読む（knowledge.html）の、引用とスレッド（11/27）。
   オーナー：「Xみたいに投稿の引用出来るようにしたい。知識を読むで投稿されたやつを引用して、新しく投稿する。スレッド機能とか」。

   - 投稿カードに「🔁 引用」「💬 返信」を足す。押すと、いつもの投稿画面が、引用（返信先）を付けた状態で開く。
     返信は題名なしでも出せる（無ければ「Re: 元の題名」にする）。
   - 引用した投稿には、引用元の札（書いた人・題名・本文の頭）を出す。押すと全文が開く。
   - 返信には「↪ ○○さんの「題名」への返信」を出し、「💬 スレッド」で、最初の投稿と返信を古い順に並べて開く。

   投稿の記録には、引用した投稿（quotePostId）・返信先（replyToPostId）・スレッドの最初の投稿（threadRootId）の ID だけを残す。
   本当にある投稿かは、公開するときに親（index.html の postForm の submit）が確かめる。どれもあとから変えられない。
   読むのは親の window.EmuPostLinks（get・thread）。カードの中身（knowledge.html の card()）は変えず、描かれたあとに足す。
   引用・返信も、ふだんの投稿と同じく1回の投稿に数える（決まり＝firestore.rules は変えていない）。 */
(function () {
  'use strict';
  var L = null;
  try { L = window.parent && window.parent !== window ? window.parent.EmuPostLinks : null; } catch (_) { L = null; }
  if (!L || typeof state === 'undefined') return;

  var link = null;            // いま投稿画面に付いている引用・返信 { kind:'quote'|'reply', id, title, name }
  var cache = {};             // 一覧に無い投稿：'loading' | false（無い）| row
  var openThreads = {};       // 開いているスレッド（カードの描き直しで閉じないように）
  var threads = {};           // スレッドの中身 rootId -> { rows } | 'loading' | 'error'
  var timer = null;

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function say(text) { if (typeof notify === 'function') notify(text); }
  function postIdOf(card) { var b = card.querySelector('[data-share][data-id]'); return b ? b.getAttribute('data-id') : ''; }
  function inList(id) { var list = state.posts || []; for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
  function byId(id) { var p = inList(id); if (p) return p; var c = cache[id]; return c && typeof c === 'object' ? c : null; }
  function nameOf(p) { try { return author(p).name; } catch (_) { return p.displayName || ''; } }
  function dateOf(p) {
    if (!p.createdAt) return '';
    try { return new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(p.createdAt)); } catch (_) { return ''; }
  }
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
      + '<span class="lk-quote-body" data-short="' + esc(snippet(q.body, 90)) + '">' + esc(snippet(q.body, 90)) + '</span>'
      + '<span class="lk-quote-full" hidden>' + esc(q.body) + '</span></button>';
  }
  function replyLine(p) {
    var parent = byId(p.replyToPostId);
    if (!parent) want(p.replyToPostId);
    var text = parent ? '↪ ' + nameOf(parent) + ' さんの「' + snippet(parent.title, 30) + '」への返信'
      : cache[p.replyToPostId] === false ? '↪ 返信（元の投稿は見つかりませんでした）' : '↪ 返信';
    return '<button type="button" class="lk-replyto" data-link-thread="' + esc(p.threadRootId || p.replyToPostId) + '">' + esc(text) + '</button>';
  }
  function replyCount(root) {
    var n = 0; (state.posts || []).forEach(function (x) { if (x.threadRootId === root) n++; });
    return n;
  }
  function decorate() {
    document.querySelectorAll('#posts article.card').forEach(function (card) {
      var id = postIdOf(card);
      if (!id) return;
      var p = inList(id) || {};
      if (!card.hasAttribute('data-links-ready')) {
        card.setAttribute('data-links-ready', '');
        var actions = card.querySelector('.actions');
        if (actions) {
          var share = actions.querySelector('.share-btn');
          [['quote', '🔁', '引用', '引用して投稿する'], ['reply', '💬', '返信', 'この投稿に返信する（スレッドになります）']].forEach(function (b) {
            var el = document.createElement('button');
            el.type = 'button'; el.className = 'lk-act'; el.setAttribute('data-link-' + b[0], id); el.setAttribute('data-emoji', b[1]);
            el.title = b[3]; el.setAttribute('aria-label', b[3]); el.textContent = b[1] + ' ' + b[2];
            el.style.order = '3';
            actions.insertBefore(el, share || null);
          });
        }
      }
      /* 返信先（カードの頭） */
      var head = card.querySelector('[data-link-head]');
      var headHtml = p.replyToPostId ? replyLine(p) : '';
      if (headHtml) {
        if (!head) { head = document.createElement('div'); head.setAttribute('data-link-head', ''); card.insertBefore(head, card.querySelector('h3')); }
        if (head.innerHTML !== headHtml) head.innerHTML = headHtml;
      } else if (head) head.remove();
      /* 引用元の札（本文のあと） */
      var qb = card.querySelector('[data-link-quotebox]');
      if (p.quotePostId) {
        var html = quoteBox(p.quotePostId);
        if (!qb) {
          qb = document.createElement('div'); qb.setAttribute('data-link-quotebox', '');
          var tags = card.querySelector('.tags'); card.insertBefore(qb, tags || card.querySelector('.impact'));
        }
        if (qb.getAttribute('data-html') !== html) { qb.innerHTML = html; qb.setAttribute('data-html', html); }
      } else if (qb) qb.remove();
      /* スレッド（操作の上） */
      var root = p.threadRootId || id, n = replyCount(root);
      var tl = card.querySelector('[data-link-threadline]');
      var showLine = !!p.threadRootId || n > 0;
      if (showLine) {
        var open = !!openThreads[id];
        var label = (open ? '▲ スレッドを閉じる' : '💬 スレッドを見る') + (n ? '（返信 ' + n + '件）' : '');
        if (!tl) {
          tl = document.createElement('div'); tl.setAttribute('data-link-threadline', '');
          card.insertBefore(tl, card.querySelector('.try-btn') || card.querySelector('.actions'));
        }
        var lineHtml = '<button type="button" class="lk-thread-btn" data-link-toggle="' + esc(id) + '" data-root="' + esc(root) + '" aria-expanded="' + open + '">' + esc(label) + '</button>'
          + (open ? '<div class="lk-thread">' + threadHtml(root, id) + '</div>' : '');
        if (tl.getAttribute('data-html') !== lineHtml) { tl.innerHTML = lineHtml; tl.setAttribute('data-html', lineHtml); }
      } else if (tl) tl.remove();
    });
  }
  function soon() { clearTimeout(timer); timer = setTimeout(decorate, 30); }

  /* ── スレッド ── */
  function itemHtml(x, here) {
    return '<div class="lk-item' + (here ? ' lk-here' : '') + '">'
      + '<div class="lk-item-head"><b>' + esc(nameOf(x)) + '</b><small>' + esc(dateOf(x)) + '</small></div>'
      + (x.title && !/^Re: /.test(x.title) ? '<div class="lk-item-title">' + esc(x.title) + '</div>' : '')
      + '<div class="lk-item-body">' + esc(x.body) + '</div>'
      + (x.quotePostId ? '<div class="lk-item-note">🔁 引用あり</div>' : '')
      + '<button type="button" class="lk-item-reply" data-link-reply="' + esc(x.id) + '">💬 返信</button></div>';
  }
  function threadHtml(root, here) {
    var t = threads[root];
    if (!t || t === 'loading') { loadThread(root); return '<p class="lk-thread-msg">スレッドを読み込んでいます…</p>'; }
    if (t === 'error') return '<p class="lk-thread-msg">読み込めませんでした。少し待って、もう一度開いてね。</p>';
    var top = byId(root);
    if (!top) want(root);
    var rows = t.rows.slice();
    /* いま書いたばかりの返信（一覧には入ったが、読み直しにまだ無い）も並べる */
    (state.posts || []).forEach(function (x) { if (x.threadRootId === root && !rows.some(function (r) { return r.id === x.id; })) rows.push(x); });
    rows.sort(function (a, b) { return new Date(a.createdAt) - new Date(b.createdAt); });
    return (top ? itemHtml(top, top.id === here) : '<p class="lk-thread-msg">' + (cache[root] === false ? '最初の投稿は見つかりませんでした。' : '最初の投稿を読み込んでいます…') + '</p>')
      + (rows.length ? rows.map(function (x) { return itemHtml(x, x.id === here); }).join('') : '<p class="lk-thread-msg">まだ返信はありません。</p>');
  }
  function loadThread(root) {
    if (threads[root] === 'loading') return;
    threads[root] = 'loading';
    L.thread(root).then(function (d) {
      threads[root] = { rows: (d && d.rows) || [] };
      mergeAuthors(d && d.authors);
      soon();
    }, function () { threads[root] = 'error'; soon(); });
  }

  /* ── 投稿画面に、引用・返信を付ける ── */
  function preview() {
    var form = document.getElementById('composeForm');
    if (!form) return;
    var box = form.querySelector('[data-link-preview]');
    var title = document.getElementById('title');
    if (!link) {
      if (box) box.remove();
      if (title) { title.required = true; if (title.dataset.lkPlaceholder) { title.placeholder = title.dataset.lkPlaceholder; delete title.dataset.lkPlaceholder; } }
      return;
    }
    if (!box) {
      box = document.createElement('div'); box.setAttribute('data-link-preview', ''); box.className = 'lk-preview';
      var after = form.querySelector('#composerTitle');
      form.insertBefore(box, after ? after.nextSibling : form.firstChild);
    }
    box.innerHTML = '<div class="lk-preview-k">' + (link.kind === 'quote' ? '🔁 この投稿を引用します' : '💬 この投稿に返信します') + '</div>'
      + '<div class="lk-preview-t"><b>' + esc(link.name) + '</b> さん「' + esc(snippet(link.title, 60)) + '」</div>'
      + '<small>' + (link.kind === 'reply' ? '題名は無くても大丈夫です。' : '') + 'ふだんの投稿と同じく、1回の投稿に数えます。</small>'
      + '<button type="button" class="lk-preview-x" data-link-clear aria-label="引用・返信を外す">外す</button>';
    if (title) {
      title.required = link.kind !== 'reply';
      if (link.kind === 'reply') { if (!title.dataset.lkPlaceholder) title.dataset.lkPlaceholder = title.placeholder; title.placeholder = '題名（なくてもOK）'; }
    }
  }
  function startLink(kind, id) {
    if (!state.account) { say(kind === 'quote' ? '引用して投稿するには、ログインしてね🧊' : '返信するには、ログインしてね🧊'); return; }
    var p = byId(id);
    if (!p) { say('その投稿を読み込めませんでした。少し待って、もう一度押してね。'); return; }
    var composer = document.getElementById('composer');
    if (!composer || !composer.classList.contains('open')) { if (typeof resetComposer === 'function') resetComposer(); openComposer(); }
    link = { kind: kind, id: p.id, title: p.title || '', name: nameOf(p) };
    preview();
    var focus = document.getElementById(kind === 'reply' ? 'body' : 'title');
    if (focus) setTimeout(function () { try { focus.focus(); } catch (_) {} }, 60);
  }
  function clearLink() { link = null; preview(); }

  /* 送る中身に、引用・返信を足す（knowledge.html の payload を包む）。公開のときだけ付く */
  if (typeof window.payload === 'function') {
    var basePayload = window.payload;
    window.payload = function () {
      var d = basePayload.apply(this, arguments);
      if (link && d) {
        if (link.kind === 'quote') d.quotePostId = link.id;
        else {
          d.replyToPostId = link.id;
          if (!d.title) d.title = ('Re: ' + link.title).slice(0, 160);
        }
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
    var b = t.closest('[data-link-quote]'); if (b) { e.preventDefault(); startLink('quote', b.getAttribute('data-link-quote')); return; }
    b = t.closest('[data-link-reply]'); if (b) { e.preventDefault(); startLink('reply', b.getAttribute('data-link-reply')); return; }
    if (t.closest('[data-link-clear]')) { e.preventDefault(); clearLink(); return; }
    b = t.closest('[data-link-toggle]');
    if (b) {
      var id = b.getAttribute('data-link-toggle');
      openThreads[id] = !openThreads[id];
      if (openThreads[id]) delete threads[b.getAttribute('data-root')];   // 開くたびに読み直す
      decorate(); return;
    }
    b = t.closest('[data-link-thread]');
    if (b) {
      var card = b.closest('article.card'), cid = card && postIdOf(card);
      if (cid) { openThreads[cid] = true; delete threads[b.getAttribute('data-link-thread')]; decorate(); }
      return;
    }
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
    '.lk-replyto{display:block;margin:0 0 4px;padding:0;border:0;background:none;font:inherit;font-size:12px;font-weight:700;color:#8a6a3a;cursor:pointer;text-align:left}',
    '.lk-thread-btn{margin:8px 0 0;padding:6px 12px;border:1px solid #d8cdbb;border-radius:999px;background:#fff;font:inherit;font-size:13px;font-weight:700;color:#6b4f2a;cursor:pointer}',
    '.lk-thread{margin-top:8px;border-left:3px solid #e8d9bf;padding-left:10px}',
    '.lk-item{padding:8px 0;border-bottom:1px dashed #eadfcd}',
    '.lk-item:last-child{border-bottom:0}',
    '.lk-here{background:#fff8ea;border-radius:8px;padding:8px}',
    '.lk-item-head{display:flex;gap:8px;align-items:baseline;font-size:13px}',
    '.lk-item-head small{color:#8a8070}',
    '.lk-item-title{margin-top:2px;font-weight:700;font-size:14px}',
    '.lk-item-body{margin-top:2px;font-size:14px;line-height:1.75;white-space:pre-wrap;overflow-wrap:anywhere}',
    '.lk-item-note{margin-top:2px;font-size:12px;color:#8a8070}',
    '.lk-item-reply{margin-top:4px;padding:4px 10px;border:1px solid #d8cdbb;border-radius:999px;background:#fff;font:inherit;font-size:12px;cursor:pointer}',
    '.lk-thread-msg{margin:6px 0;font-size:13px;color:#8a8070}',
    '.lk-preview{position:relative;margin:0 0 12px;padding:10px 64px 10px 12px;border:1px solid #f0c98a;border-radius:12px;background:#fff8ea}',
    '.lk-preview-k{font-size:12px;font-weight:800;color:#a15c00}',
    '.lk-preview-t{margin-top:2px;font-size:14px;overflow-wrap:anywhere}',
    '.lk-preview small{display:block;margin-top:2px;color:#8a8070;font-size:12px}',
    '.lk-preview-x{position:absolute;top:8px;right:8px;padding:4px 10px;border:1px solid #d8cdbb;border-radius:999px;background:#fff;font:inherit;font-size:12px;cursor:pointer}'
  ].join('\n');
  document.head.appendChild(css);

  function watch() {
    var posts = document.getElementById('posts'); if (!posts || typeof MutationObserver !== 'function') return;
    new MutationObserver(function (list) {
      /* 自分で足した分の変化では動かない（足す → 見張りが動く → また足す、を繰り返さない） */
      var ours = list.every(function (m) { var n = m.target; return n.closest && n.closest('[data-link-head],[data-link-quotebox],[data-link-threadline]'); });
      if (!ours) soon();
    }).observe(posts, { childList: true, subtree: true });
    decorate();
    watchComposer();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch);
  else watch();
})();
