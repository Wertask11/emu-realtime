/* クエストの協賛（11/10）。schoolpark/dao.html のクエストの詳しい画面に「🎁 協賛の袋」を足す。
   - みんなで EMUER（未変換）を出し合い、完走した人へのご褒美の袋に積む。完走した人は1人10 EMUERずつ受け取れる。
   - 完走した人には「🎉 協賛のご褒美を受け取る」を出す。受け取ったら紙吹雪。
   動かすのは親（index.html の emu-gifts.js・window.parent.EmuGifts）。画面の作り（dao.html の型）は変えず、描かれたあとに足す。 */
(function () {
  'use strict';
  var G = null;
  try { G = window.parent && window.parent !== window ? window.parent.EmuGifts : null; } catch (_) { G = null; }
  if (!G) return;
  var AMOUNTS = [5, 10, 30, 50];
  var state = { questId: '', pot: null, mine: null, loading: false };
  var timer = null;

  function questId() {
    try { var a = window.app; return a && a.state && a.state.screen === 'detail' ? String(a.state.expId || '') : ''; } catch (_) { return ''; }
  }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var BTN = 'border:1px solid rgba(20,19,16,.18);background:#fff;color:#141310;border-radius:999px;padding:8px 14px;font:inherit;font-size:13px;font-weight:700;cursor:pointer';

  function html() {
    var p = state.pot, m = state.mine;
    if (!p) return '<div style="font-size:13px;color:#6E695C">協賛の袋を読み込んでいます…</div>';
    var canClaim = m && m.completed && !m.claimed && p.pot > 0;
    return '<div style="font-family:Inter,sans-serif;font-size:10px;letter-spacing:.2em;color:#C2703D">SPONSOR</div>'
      + '<div style="display:flex;align-items:baseline;gap:8px;margin-top:6px"><span style="font-size:22px">🎁</span><b style="font-size:28px">' + p.pot + '</b><span style="font-size:13px;color:#6E695C">EMUER（協賛の袋）</span></div>'
      + '<div style="font-size:13px;line-height:1.8;color:#3B382F;margin-top:4px">完走した人に、1人 ' + p.bonus + ' EMUER ずつ届きます' + (p.pot > 0 ? '（あと ' + p.peopleLeft + '人分）' : '') + '。</div>'
      + '<div style="height:6px;background:rgba(20,19,16,.08);border-radius:3px;overflow:hidden;margin-top:8px" aria-hidden="true"><div style="height:100%;background:#C2703D;width:' + (p.total ? Math.round(p.paidOut / p.total * 100) : 0) + '%"></div></div>'
      + '<div style="font-size:12px;color:#6E695C;margin-top:6px">協賛 ' + p.sponsors + '人・これまでに ' + p.bonusCount + '人が受け取りました</div>'
      + (canClaim ? '<button type="button" data-sponsor-claim style="' + BTN + ';margin-top:12px;width:100%;background:#C2703D;color:#fff;border-color:#C2703D">🎉 完走おめでとう！協賛のご褒美を受け取る（' + Math.min(p.bonus, p.pot) + ' EMUER）</button>' : '')
      + (m && m.claimed ? '<div style="margin-top:10px;font-size:13px;font-weight:700;color:#0F5C3F">🎉 協賛のご褒美 ' + m.amount + ' EMUER を受け取りました</div>' : '')
      + '<div style="margin-top:12px;font-size:13px;font-weight:700">このクエストに協賛する</div>'
      + '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">' + AMOUNTS.map(function (n) { return '<button type="button" data-sponsor-amount="' + n + '" style="' + BTN + '">' + n + ' EMUER</button>'; }).join('') + '</div>'
      + '<div style="font-size:11px;line-height:1.7;color:#6E695C;margin-top:6px">未変換のEMUER（残高の（ ）の中）から出します。出したEMUERは袋に入り、完走した人へ届きます（返りません）。応援と合わせて1日100 EMUERまで。</div>';
  }
  function card() {
    var side = document.querySelector('.sp-quest-side');
    if (!side) return null;
    var el = side.querySelector('[data-quest-sponsor]');
    if (!el) {
      el = document.createElement('section');
      el.setAttribute('data-quest-sponsor', '');
      el.setAttribute('aria-label', 'クエストの協賛');
      el.style.cssText = 'background:#fff;border:1px solid rgba(20,19,16,.12);border-radius:12px;padding:20px;min-width:0;box-sizing:border-box;overflow-wrap:anywhere;color:#141310';
      var first = side.firstElementChild;
      side.insertBefore(el, first ? first.nextSibling : null);
    }
    return el;
  }
  function paint() {
    var el = card(); if (!el) return;
    var h = html();
    if (el.getAttribute('data-for') !== state.questId || el.innerHTML !== h) { el.innerHTML = h; el.setAttribute('data-for', state.questId); }
  }
  async function load(id) {
    state = { questId: id, pot: null, mine: null, loading: true };
    paint();
    var res = await Promise.all([G.pot(id), G.signedIn() ? G.mine(id) : Promise.resolve(null)]);
    if (state.questId !== id) return;
    state.pot = res[0] && res[0].ok ? res[0] : { pot: 0, total: 0, sponsors: 0, paidOut: 0, bonusCount: 0, bonus: 10, peopleLeft: 0 };
    state.mine = res[1] && res[1].ok ? res[1] : null;
    state.loading = false;
    paint();
  }
  function check() {
    var id = questId();
    if (!id || id === 'founder-quest-000') return;
    if (id !== state.questId) { load(id); return; }
    if (!document.querySelector('[data-quest-sponsor]')) paint();
  }

  document.addEventListener('click', async function (e) {
    var t = e.target && e.target.closest ? e.target : null; if (!t) return;
    var a = t.closest('[data-sponsor-amount]');
    if (a) {
      if (!G.signedIn()) { window.alert('協賛するには、ログインしてね🧊'); return; }
      var n = Number(a.getAttribute('data-sponsor-amount'));
      if (!window.confirm('このクエストに ' + n + ' EMUER 協賛します。\n未変換のEMUERから出し、完走した人へのご褒美になります（返りません）。よろしいですか？')) return;
      a.disabled = true;
      var d = await G.sponsor(state.questId, n);
      if (!d.ok) { a.disabled = false; window.alert(d.error); return; }
      state.pot = Object.assign({}, state.pot || {}, d);
      paint();
      G.petals(document.querySelector('[data-quest-sponsor]'));
      return;
    }
    if (t.closest('[data-sponsor-claim]')) {
      var b = t.closest('[data-sponsor-claim]'); b.disabled = true;
      var r = await G.claimBonus(state.questId);
      if (!r.ok) { b.disabled = false; window.alert(r.error); return; }
      state.mine = { completed: true, claimed: true, amount: r.amount };
      if (!r.already) state.pot = Object.assign({}, state.pot || {}, r);
      paint();
      G.petals(document.querySelector('[data-quest-sponsor]'), 'confetti');
    }
  });

  if (typeof MutationObserver === 'function') {
    new MutationObserver(function () { clearTimeout(timer); timer = setTimeout(check, 80); }).observe(document.documentElement, { childList: true, subtree: true });
  }
  setInterval(check, 1500);
  check();
})();
