/* 知識を読む（knowledge.html）の、応援と「みんなで決める」（11/10）。
   - 投稿カードに「💐 応援」を足す。押すと 1・3・5・10 EMUER を選んで贈る。贈ったら花びらが舞う。
     カードに「💐 応援 3人・12 EMUER」と出す（誰が贈ったかは出さない）。
   - 一覧の上に「🗳️ みんなで決める」（運営が作った投票）を出す。1人1票。
   動かすのは親（index.html の emu-gifts.js・window.parent.EmuGifts）。使うのは未変換の EMUER だけ。
   カードの中身（knowledge.html の card()）は変えず、描かれたあとに足す。 */
(function () {
  'use strict';
  var G = null;
  try { G = window.parent && window.parent !== window ? window.parent.EmuGifts : null; } catch (_) { G = null; }
  if (!G) return;
  var AMOUNTS = [1, 3, 5, 10];
  var counts = {}, asked = {}, timer = null;

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function say(text) { if (typeof notify === 'function') notify(text); }

  /* ── 応援 ── */
  function postIdOf(card) { var b = card.querySelector('[data-share][data-id]'); return b ? b.getAttribute('data-id') : ''; }
  function isMine(card) { return !!card.querySelector('[data-delete-post]:not([data-as-owner])'); }
  function line(card, id) {
    var c = counts[id];
    var el = card.querySelector('[data-cheer-line]');
    if (!c || !c.people) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('div'); el.setAttribute('data-cheer-line', id);
      el.style.cssText = 'margin:8px 0 0;padding:8px 12px;border-radius:10px;background:#fdf2f8;color:#9d174d;font-size:13px;font-weight:700;line-height:1.6';
      var actions = card.querySelector('.actions');
      card.insertBefore(el, actions || null);
    }
    var text = '💐 応援 ' + c.people + '人・' + c.total + ' EMUER';
    if (el.textContent !== text) el.textContent = text;   // 同じなら書かない（書くと見張りがまた動く）
  }
  function decorate() {
    var cards = document.querySelectorAll('#posts article.card');
    var need = [];
    cards.forEach(function (card) {
      var id = postIdOf(card);
      if (!id) return;
      if (!card.hasAttribute('data-cheer-ready')) {
        card.setAttribute('data-cheer-ready', '');
        var actions = card.querySelector('.actions');
        if (actions && !isMine(card)) {
          var b = document.createElement('button');
          b.type = 'button'; b.className = 'cheer-btn'; b.setAttribute('data-cheer', id); b.setAttribute('data-emoji', '💐');
          b.title = 'EMUERで応援する'; b.setAttribute('aria-label', 'EMUERで応援する'); b.textContent = '💐 応援';
          b.style.order = '3';
          var share = actions.querySelector('.share-btn');
          actions.insertBefore(b, share || null);
        }
      }
      if (counts[id] !== undefined) line(card, id); else if (!asked[id]) need.push(id);
    });
    if (need.length) {
      need.forEach(function (id) { asked[id] = true; });
      G.cheerCounts(need).then(function (d) {
        need.forEach(function (id) { counts[id] = (d && d.ok && d.counts && d.counts[id]) || null; });
        document.querySelectorAll('#posts article.card').forEach(function (card) { var id = postIdOf(card); if (need.indexOf(id) >= 0) line(card, id); });
      });
    }
  }
  function closePicker() { var p = document.querySelector('[data-cheer-picker]'); if (p) p.remove(); }
  function openPicker(btn) {
    closePicker();
    var card = btn.closest('article.card'); var id = btn.getAttribute('data-cheer');
    if (!G.signedIn()) { say('応援するには、ログインしてね🧊'); return; }
    var box = document.createElement('div'); box.setAttribute('data-cheer-picker', id); box.setAttribute('role', 'group'); box.setAttribute('aria-label', '応援するEMUERを選ぶ');
    box.style.cssText = 'margin-top:10px;padding:12px;border:1px solid #f9c6dc;background:#fff7fb;border-radius:12px';
    box.innerHTML = '<div style="font-size:13px;font-weight:700;color:#9d174d">💐 いくら応援する？</div>'
      + '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">'
      + AMOUNTS.map(function (n) { return '<button type="button" data-cheer-amount="' + n + '" style="border:1px solid #f0a6c6;background:#fff;color:#9d174d;border-radius:999px;padding:8px 14px;font:inherit;font-weight:700;cursor:pointer">' + n + ' EMUER</button>'; }).join('')
      + '<button type="button" data-cheer-cancel style="border:0;background:none;color:#8a8070;font:inherit;cursor:pointer;padding:8px">やめる</button></div>'
      + '<small style="display:block;margin-top:6px;color:#8a8070;font-size:12px">未変換のEMUER（残高の（ ）の中）から贈ります。贈ったEMUERは、書いた人に届きます。1日100 EMUERまで。</small>';
    card.appendChild(box);
  }
  async function send(btn) {
    var box = btn.closest('[data-cheer-picker]'); var id = box.getAttribute('data-cheer-picker'); var amount = Number(btn.getAttribute('data-cheer-amount'));
    var card = box.closest('article.card');
    box.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
    var d = await G.cheer(id, amount);
    if (!d.ok) { box.querySelectorAll('button').forEach(function (b) { b.disabled = false; }); say(d.error); return; }
    closePicker();
    counts[id] = { people: d.people, total: d.total };
    line(card, id);
    G.petals(card.querySelector('[data-cheer]') || card);
    say('💐 ' + amount + ' EMUER で応援したよ！' + (typeof d.balance === 'number' ? '（のこり ' + d.balance + ' EMUER）' : ''));
  }

  /* ── みんなで決める（投票） ── */
  var polls = [];
  function pollHtml(p) {
    var voted = p.myVote != null && p.myVote !== '';
    var show = voted || !p.open;
    var max = Math.max.apply(null, [1].concat(p.options.map(function (o) { return o.votes; })));
    return '<div data-poll="' + esc(p.id) + '" style="margin-top:10px">'
      + '<div style="font-weight:700;line-height:1.6">' + esc(p.question) + '</div>'
      + '<div style="display:grid;gap:6px;margin-top:8px">' + p.options.map(function (o) {
        var mine = voted && p.myVote === o.id;
        if (show) {
          return '<div style="position:relative;border:1px solid ' + (mine ? '#c2185b' : '#eadfce') + ';border-radius:10px;padding:8px 12px;overflow:hidden">'
            + '<div aria-hidden="true" style="position:absolute;inset:0;width:' + Math.round(o.votes / max * 100) + '%;background:' + (mine ? '#fde4ef' : '#f7f1e6') + '"></div>'
            + '<div style="position:relative;display:flex;justify-content:space-between;gap:8px;font-size:14px"><span>' + (mine ? '✓ ' : '') + esc(o.label) + '</span><b>' + o.votes + '票</b></div></div>';
        }
        return '<button type="button" data-poll-vote="' + esc(o.id) + '" style="text-align:left;border:1px solid #eadfce;background:#fff;border-radius:10px;padding:10px 12px;font:inherit;font-size:14px;cursor:pointer">' + esc(o.label) + '</button>';
      }).join('') + '</div>'
      + '<small style="display:block;margin-top:6px;color:#8a8070;font-size:12px">'
      + (p.open ? (voted ? '入れたよ！ありがとう。' : (p.cost ? '1票 ' + p.cost + ' EMUER（未変換）を使います。' : '1人1票。')) + (p.closesAt ? ' 締め切り ' + new Date(p.closesAt).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' }) : '') : '締め切りました。') + ' いま ' + p.votes + '票</small></div>';
  }
  function renderPolls() {
    var host = document.getElementById('emuPolls');
    var list = polls.filter(function (p) { return p.open; }).concat(polls.filter(function (p) { return !p.open; }).slice(0, 1)).slice(0, 2);
    if (!list.length) { if (host) host.remove(); return; }
    if (!host) {
      var posts = document.getElementById('posts'); if (!posts || !posts.parentElement) return;
      host = document.createElement('section'); host.id = 'emuPolls'; host.className = 'card';
      host.setAttribute('aria-label', 'みんなで決める');
      host.style.cssText = 'margin-bottom:16px';
      posts.parentElement.insertBefore(host, posts);
    }
    host.innerHTML = '<div style="font-size:13px;font-weight:800;letter-spacing:.04em;color:#8a4b00">🗳️ みんなで決める</div>' + list.map(pollHtml).join('');
  }
  async function loadPolls() {
    var d = await G.polls(G.signedIn());
    if (!d.ok && G.signedIn()) d = await G.polls(false);
    polls = d.ok && Array.isArray(d.polls) ? d.polls : [];
    renderPolls();
  }
  async function vote(btn) {
    var box = btn.closest('[data-poll]'); var pollId = box.getAttribute('data-poll'); var option = btn.getAttribute('data-poll-vote');
    if (!G.signedIn()) { say('投票するには、ログインしてね🧊'); return; }
    var p = polls.filter(function (x) { return x.id === pollId; })[0];
    if (p && p.cost && !window.confirm('「' + (btn.textContent || '') + '」に入れます。未変換のEMUERを ' + p.cost + ' 使います。よろしいですか？')) return;
    box.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
    var d = await G.vote(pollId, option);
    if (!d.ok) { box.querySelectorAll('button').forEach(function (b) { b.disabled = false; }); say(d.error); if (d.code === 'ALREADY_VOTED') loadPolls(); return; }
    polls = polls.map(function (x) { return x.id === pollId ? d.poll : x; });
    renderPolls();
    G.petals(document.querySelector('[data-poll="' + pollId + '"]'), 'confetti');
    say('🗳️ 入れたよ！');
  }

  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target : null; if (!t) return;
    var b = t.closest('[data-cheer]'); if (b) { e.preventDefault(); openPicker(b); return; }
    var a = t.closest('[data-cheer-amount]'); if (a) { send(a); return; }
    if (t.closest('[data-cheer-cancel]')) { closePicker(); return; }
    var v = t.closest('[data-poll-vote]'); if (v) { vote(v); }
  });

  function watch() {
    var posts = document.getElementById('posts'); if (!posts || typeof MutationObserver !== 'function') return;
    new MutationObserver(function () { clearTimeout(timer); timer = setTimeout(decorate, 50); }).observe(posts, { childList: true, subtree: true });
    decorate();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { watch(); loadPolls(); });
  else { watch(); loadPolls(); }
})();
