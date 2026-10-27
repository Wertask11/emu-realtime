/* 運営からのギフト（2026-10-27から）。サーバーは backend/emu-gift.js。

   見学（無料）の人は、画面上の「🎁 ギフト」から Emu for SchoolPark light を1週間ためせる。
   そのあと SchoolPark パスポートID を運営に送ると、運営が確かめて、さらに1か月使える。
   ボタンは、受け取れる人と、受け取ったあとの人にだけ出す（払っている人には出さない）。

   渡すかどうかはサーバーだけが決める。ここは様子を見せて、押されたら頼むだけ。 */
(function () {
  'use strict';
  var API = 'https://emu-realtime.onrender.com/api/emu-gift';
  /* サーバーの GIFT_STARTS_AT と必ず同じにすること。 */
  var EMU_GIFT_FROM = Date.parse('2026-10-27T00:00:00+09:00');
  var state = null, loadedAt = 0, loading = null;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function day(t) {
    var d = new Date(t);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  async function headers(json) {
    if (typeof window.emuAuthHeaders !== 'function') throw new Error('ログイン情報を確認できません。');
    return window.emuAuthHeaders(json, { interactive: false });
  }
  async function call(method, path) {
    var res = await fetch(API + path, { method: method, headers: await headers(method !== 'GET'), body: method === 'GET' ? undefined : '{}' });
    var body = await res.json().catch(function () { return {}; });
    if (!res.ok) throw Object.assign(new Error(body.error || 'GIFT_UNAVAILABLE'), { code: body.error || 'GIFT_UNAVAILABLE' });
    return body;
  }

  function button() { return document.getElementById('emuGiftButton'); }
  /* 受け取れる人・受け取ったあとの人にだけ出す。 */
  function shouldShow(s) { return !!s && s.open && (s.canClaim || !!s.trialClaimedAt); }
  function paint() {
    var b = button();
    if (!b) return;
    b.hidden = !shouldShow(state);
    b.classList.toggle('emu-gift-button--new', !!(state && state.canClaim));
  }

  async function refresh(force) {
    if (Date.now() < EMU_GIFT_FROM) { state = null; paint(); return null; }
    if (!force && state && Date.now() - loadedAt < 5 * 60 * 1000) return state;
    if (loading) return loading;
    loading = (async function () {
      try { state = await call('GET', '/status'); loadedAt = Date.now(); }
      catch (e) { if (force) throw e; }
      finally { loading = null; paint(); }
      return state;
    })();
    return loading;
  }

  function sheet() {
    var el = document.getElementById('emuGiftSheet');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'emuGiftSheet';
    el.className = 'emu-gift-sheet';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'emuGiftTitle');
    el.hidden = true;
    el.addEventListener('click', function (e) { if (e.target === el) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !el.hidden) close(); });
    document.body.appendChild(el);
    return el;
  }
  function close() { var el = document.getElementById('emuGiftSheet'); if (el) el.hidden = true; var b = button(); if (b) b.focus(); }

  function view(s, message) {
    var light = 'Emu for SchoolPark light';
    var can = '投稿・知識の募集・回答・一日シェアができます（light の月の回数まで）。';
    var head = '<button type="button" class="emu-gift-close" aria-label="閉じる" data-gift="close">×</button>'
      + '<p class="emu-gift-eyebrow">🎁 運営からのギフト</p>';
    var body;
    var now = Date.now();
    if (s.canClaim) {
      body = '<h2 id="emuGiftTitle">' + light + ' を1週間、ためしてみませんか</h2>'
        + '<p>' + can + '</p>'
        + '<p class="emu-gift-note">受け取れるのは1人1回です。お支払いの登録はいりません。1週間たつと自動で見学（無料）に戻り、書いた投稿はそのまま残ります。</p>'
        + '<button type="button" class="emu-gift-primary" data-gift="claim">ギフトを受け取る</button>';
    } else {
      var trialLive = s.trialExpiresAt && now < s.trialExpiresAt;
      var lines = '<h2 id="emuGiftTitle">' + (trialLive ? light + ' を体験中です' : '1週間の体験は終わりました') + '</h2>'
        + (s.trialExpiresAt ? '<p>体験は <b>' + esc(day(s.trialExpiresAt)) + '</b> まで' + (trialLive ? 'です。' : 'でした。') + '</p>' : '');
      if (s.extensionStatus === 'approved') {
        body = lines + '<p class="emu-gift-ok">延長しました。' + (s.extensionExpiresAt ? '<b>' + esc(day(s.extensionExpiresAt)) + '</b> まで使えます。' : 'いまのプランのまま使えます。') + '</p>';
      } else if (s.extensionStatus === 'pending') {
        body = lines + '<p class="emu-gift-ok">パスポートIDを運営に送りました。運営が確かめたら、さらに1か月使えるようになります。</p>'
          + '<p class="emu-gift-note">送った番号：' + esc(s.schoolParkId || '') + '</p>';
      } else if (s.extensionStatus === 'rejected') {
        body = lines + '<p>今回は延長できませんでした。くわしくは、メニューの「ひとこと」から運営に聞いてください。</p>';
      } else if (!s.schoolParkId) {
        body = lines + '<p><b>もっと使いたい方へ：</b>SchoolPark パスポートID を運営に送ると、運営が確かめたあと、さらに1か月使えます。</p>'
          + '<p class="emu-gift-note">まだパスポートがありません。先にパスポートを作ってから、ここに戻ってきてください。</p>'
          + '<button type="button" class="emu-gift-primary" data-gift="passport">SchoolParkパスポートを作る</button>';
      } else {
        body = lines + '<p><b>もっと使いたい方へ：</b>SchoolPark パスポートID を運営に送ると、運営が確かめたあと、さらに1か月使えます。</p>'
          + '<p class="emu-gift-note">送る番号：<b>' + esc(s.schoolParkId) + '</b>（あなたのパスポートの番号です）</p>'
          + '<button type="button" class="emu-gift-primary" data-gift="extension">パスポートIDを運営に送る</button>';
      }
    }
    return head + body + (message ? '<p class="emu-gift-message" role="alert">' + esc(message) + '</p>' : '');
  }
  var ERRORS = {
    NOT_STARTED: 'ギフトはまだ受け取れません。始まるまで少し待ってください。',
    ALREADY_CLAIMED: 'ギフトはもう受け取っています（1人1回です）。',
    ALREADY_MEMBER: 'いまのプランで、もう投稿できます。ギフトは見学（無料）の方向けです。',
    SIGN_IN_REQUIRED: 'LINE・Google・メール・ウォレットのどれかでログインしてから受け取ってください。',
    PASSPORT_REQUIRED: '先に SchoolPark パスポートを作ってください。',
    TRIAL_REQUIRED: '先に1週間の体験を受け取ってください。',
    ALREADY_REQUESTED: 'もう運営に送っています。確かめるまで少し待ってください。',
  };
  function render(message) {
    var el = sheet();
    el.innerHTML = '<div class="emu-gift-card">' + view(state || {}, message) + '</div>';
    el.querySelectorAll('[data-gift]').forEach(function (b) { b.addEventListener('click', function () { act(b.dataset.gift, b); }); });
  }
  async function act(what, b) {
    if (what === 'close') { close(); return; }
    if (what === 'passport') { close(); if (typeof window.openSpPassport === 'function') window.openSpPassport(); return; }
    b.disabled = true;
    try {
      if (what === 'claim') {
        await call('POST', '/claim');
        // 投稿できるように、いま使えるものを読み直す。
        if (typeof window.emuEnsureEntitlement === 'function') await window.emuEnsureEntitlement(true);
      }
      if (what === 'extension') await call('POST', '/extension');
      await refresh(true);
      render(what === 'claim' ? 'ギフトを受け取りました。今日から投稿できます。' : '');
    } catch (e) {
      await refresh(true).catch(function () {});
      render(ERRORS[e.code] || 'うまくいきませんでした。少し時間をおいて、もう一度ためしてください。');
    }
  }

  window.emuGiftOpen = async function () {
    var el = sheet();
    el.innerHTML = '<div class="emu-gift-card"><p>読み込んでいます…</p></div>';
    el.hidden = false;
    try { await refresh(true); render(); }
    catch (e) { render('ギフトの様子を読めませんでした。ログインしてから、もう一度開いてください。'); }
    var first = el.querySelector('.emu-gift-primary') || el.querySelector('.emu-gift-close');
    if (first) first.focus();
  };

  var css = document.createElement('style');
  css.textContent = ''
    + '.emu-gift-button{display:inline-flex;align-items:center;gap:4px;padding:6px 10px;border:1px solid #f0c27a;border-radius:999px;background:#fff6e6;color:#8a4b00;font:inherit;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap}'
    + '.emu-gift-button[hidden]{display:none!important}'
    + '.emu-gift-button--new{box-shadow:0 0 0 3px #ffe3b3}'
    + '.emu-gift-button:focus-visible,.emu-gift-sheet button:focus-visible{outline:3px solid #ef7d00;outline-offset:2px}'
    + '@media(max-width:480px){.emu-gift-button .emu-gift-label{display:none}}'
    + '.emu-gift-sheet{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(33,31,28,.45)}'
    + '.emu-gift-sheet[hidden]{display:none}'
    + '.emu-gift-card{position:relative;width:100%;max-width:440px;max-height:90dvh;overflow:auto;padding:22px 20px 20px;border-radius:18px;background:#fff;color:#211f1c;box-shadow:0 18px 40px rgba(0,0,0,.2);font-size:15px;line-height:1.7}'
    + '.emu-gift-card h2{font-size:19px;line-height:1.45;margin:4px 0 10px}'
    + '.emu-gift-eyebrow{margin:0;color:#b25d00;font-size:13px;font-weight:700}'
    + '.emu-gift-note{color:#6b6459;font-size:13px}'
    + '.emu-gift-ok{padding:10px 12px;border-radius:12px;background:#f2f8ec;color:#2f5d1f}'
    + '.emu-gift-message{padding:10px 12px;border-radius:12px;background:#fff1dc;color:#8a4b00;font-size:14px}'
    + '.emu-gift-primary{width:100%;min-height:48px;margin-top:6px;border:0;border-radius:12px;background:#ef7d00;color:#fff;font:inherit;font-weight:700;cursor:pointer}'
    + '.emu-gift-primary:disabled{opacity:.6}'
    + '.emu-gift-close{position:absolute;top:8px;right:8px;width:44px;height:44px;border:0;background:transparent;font-size:24px;color:#6b6459;cursor:pointer}';
  document.head.appendChild(css);

  // いま使えるもの（entitlement）が読めた＝ログインが分かったときに、ギフトの様子も見る。
  window.addEventListener('emu-entitlement', function () { refresh(false); });
  if (window.emuEntitlement) refresh(false);
  // 始まる時刻をまたいで開いている画面でも、時刻が来たら出す。
  if (Date.now() < EMU_GIFT_FROM && EMU_GIFT_FROM - Date.now() < 24 * 60 * 60 * 1000)
    setTimeout(function () { refresh(true).catch(function () {}); }, EMU_GIFT_FROM - Date.now() + 1000);
  window.emuGiftRefresh = refresh;
})();
