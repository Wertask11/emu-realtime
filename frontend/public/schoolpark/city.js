import { createBridge } from './city-bridge.js';

const instances = new WeakMap();
const escape = value => String(value ?? '').replace(/[&<>"']/g, c =>
  ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const button = (action, label, value = '', secondary = false, disabled = false) =>
  `<button type="button" class="city-button${secondary ? ' secondary' : ''}" data-action="${action}" data-value="${escape(value)}"${disabled ? ' disabled' : ''}>${escape(label)}</button>`;
const date = ms => Number.isFinite(ms) ? new Intl.DateTimeFormat('ja-JP',
  { timeZone:'Asia/Tokyo', year:'numeric', month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit' }).format(ms) : '日時未確認';
const errors = {
  AUTH_REQUIRED:'ログインしてからCityを開いてください。',
  SESSION_CHANGED:'ログイン情報が変わりました。Cityを開き直してください。',
  SCHOOLPARK_ACCESS_DENIED:'現在のアカウントではSchoolParkへ入場できません。',
  PASSPORT_LINK_REQUIRED:'Passport IDを確認できません。Passportを開いてから、もう一度お試しください。',
  PASSPORT_INACTIVE:'このPassportではCityを利用できません。',
  RATE_LIMITED:'操作が続いています。少し時間をおいて、もう一度お試しください。',
  QUEST_UNAVAILABLE:'このQuestを確認できませんでした。既存のQuest一覧からお探しください。'
};

export function createCity(host, app, bridge = createBridge(window.parent, app)) {
  let page = 'home', selected = '', spots = null, history = null, achievements = null;
  let message = '', error = '', loading = false, recording = false, myLoading = false;
  let catalogAt = 0, myAt = 0, epoch = 0, myGeneration = 0, share = null, loadJob = null, myJob = null;
  const recorded = new Map();
  host.className = 'sp-city';
  host.setAttribute('aria-label', 'SchoolPark City');

  const badges = spot => `<div class="city-badges"><span class="city-badge ${spot.locationType === 'REAL' ? 'real' : 'virtual'}">${escape(spot.locationType)}</span><span class="city-badge">DEMO</span>${spot.category.map(c => `<span class="city-badge">${escape(c)}</span>`).join('')}</div>`;
  const card = spot => `<article class="city-card">${badges(spot)}<h3>${escape(spot.name)}</h3><p>${escape(spot.description)}</p>${button('spot','Spotをひらく',spot.spotId,true)}</article>`;
  const empty = (title, note) => `<div class="city-empty"><strong>${escape(title)}</strong>${escape(note)}</div>`;
  const unavailable = label => `<p class="city-note">${escape(label)}を読み込めませんでした。0件という意味ではありません。時間をおいて更新してください。</p>`;
  function go(next, id = '') {
    page = next; selected = id; share = null; message = ''; error = '';
    render(); app.toTop();
    host.querySelector('[data-city-heading]')?.focus({ preventScroll: true });
    if (page === 'my') loadMy();
  }
  function catalog() {
    const list = (spots || []).filter(s => page === 'real' ? s.locationType === 'REAL' : page === 'virtual' ? s.locationType === 'VIRTUAL' : true);
    return `<section class="city-section"><div class="city-section-title"><h3>${page === 'real' ? 'REAL · 街の体験例' : page === 'virtual' ? 'VIRTUAL · 仮想の入口' : 'はじめのSpot'}</h3><span class="city-muted">v0.1 / DEMO</span></div>
      <div class="city-grid">${list.map(card).join('')}</div></section>`;
  }
  function detail() {
    const spot = spots?.find(s => s.spotId === selected);
    if (!spot) return unavailable('Spot');
    const done = recorded.get(spot.spotId);
    return `<button type="button" class="city-link" data-action="page" data-value="${spot.locationType === 'REAL' ? 'real' : 'virtual'}">← Spot一覧に戻る</button>
      <div class="city-detail"><section class="city-card">${badges(spot)}
      <h2 data-city-heading tabindex="-1">${escape(spot.name)}</h2><p>${escape(spot.description)}</p>
      <div class="city-note">${spot.locationType === 'REAL'
        ? 'REAL / DEMO：店舗との提携や現地訪問を証明するものではありません。QRチェックインは今後対応予定です。位置情報は取得しません。'
        : 'VIRTUAL / DEMO：この画面のLabに入る操作を記録します。3D空間や外部Virtual Spaceへの接続は今後対応予定です。'}</div>
      <h3>Passport Check-in</h3><p>ログイン中のPassportへ保存します。同じSpotは日本時間で1日1件。報酬・星・Quest完了は付与されません。</p>
      ${button('checkin',recording ? '記録しています…' : spot.locationType === 'REAL' ? 'DEMOチェックインを記録' : 'このVirtual Spotに入る', spot.spotId, false, recording)}
      ${done ? `<p class="city-status">記録済み · ${escape(date(done.occurredAt))}${done.isDemo ? ' · DEMO' : ''}</p>` : ''}
      </section><section class="city-card"><p class="city-eyebrow">EXPERIENCE</p><h3>${escape(spot.experience)}</h3>
      <p>体験のヒントです。正式なQuest・完了判定・報酬条件ではありません。体験したことは、既存のQuestやEmuへつなげられます。</p>
      ${button('quest',spot.questId ? '関連Questをひらく' : '既存のQuestを探す',spot.questId || '',true)}
      ${spot.guildId ? button('guild','関連Guildをひらく',spot.guildId,true) : ''}
      ${button('emu','Emuに残す','',true)}<p class="city-muted">Emuのトップへ移動します。投稿はEmuの既存画面で行います。自動投稿はしません。</p>
      ${button('page','MY CITYで記録を見る','my',true)}</section></div>`;
  }
  function myCity() {
    if (myLoading && !history) return '<p role="status" class="city-note">自分のCity記録を読み込んでいます…</p>';
    if (!history) return unavailable('MyCity') + button('refresh','もう一度読み込む','',true);
    const visits = history.checkins || [];
    const visited = (spots || []).filter(s => visits.some(v => v.spotId === s.spotId));
    const quests = achievements?.quests?.filter(q => !q.isFounder) ?? null;
    const stars = achievements?.stars, guilds = achievements?.guilds;
    return `<section class="city-section"><div class="city-section-title"><h2 data-city-heading tabindex="-1">MY CITY</h2>${button('refresh','更新','',true,myLoading)}</div>
      <p class="city-muted">このページの記録は非公開です。公開プロフィールURLはまだありません。</p>
      <div class="city-card city-section"><p class="city-eyebrow">PASSPORT ID</p><p class="city-id">${escape(history.passportId)}</p>${button('passport','Passport / 星空をひらく','',true)}</div>
      <div class="city-room"><p class="city-eyebrow">MY COLLECTION · 最近の訪問Spot</p>
      ${visited.length ? `<div class="city-grid">${visited.map(card).join('')}</div>` : empty('まだCityの記録はありません','Cityを歩いて、最初の記録を残そう。')}
      <p class="city-muted">DEMOの記録は、実店舗への訪問証明ではありません。</p></div>
      <div class="city-detail"><section class="city-card"><h3>Quest実績</h3>
      ${!achievements ? '<p>既存実績を確認しています…</p>' : quests === null ? unavailable('Quest実績') : quests?.length
        ? `<ul class="city-list">${quests.map(q => `<li>${escape(q.label)} ${escape(q.title)}<small>承認済み ${escape(q.rounds)}周</small>${button('quest','既存Questを見る',q.id,true)}</li>`).join('')}</ul>`
        : empty('まだ承認済みのQuestはありません','完了・報酬は既存Questの処理で確定します。')}
      <p class="city-muted">既存のPassport・星空と同じ完走記録を参照します。City専用の実績は作りません。</p></section>
      <section class="city-card"><h3>限定Star / 証明書</h3>
      ${!achievements ? '<p>既存の星を確認しています…</p>' : stars === null ? unavailable('限定Star') : stars?.length
        ? `<ul class="city-list">${stars.map(s => `<li>${escape(s.label)}<small>${s.minted ? 'NFT受取済み' : '星の記録あり · NFT未受取'}</small></li>`).join('')}</ul>`
        : empty('限定Starの記録はありません','チェックインだけでは星やNFTは増えません。')}
      <p class="city-muted">Quest星・証明書・その他のNFTは、Passportの既存表示で確認できます。</p>${button('passport','Passportで確認','',true)}</section></div>
      <section class="city-card"><h3>Guild</h3>${!achievements ? '<p>確認しています…</p>' : guilds === null ? unavailable('Guildの参加表示') : guilds?.length
        ? `<div class="city-row">${guilds.map(g => button('guild',g.name + ' · ' + g.label,g.id,true)).join('')}</div>`
        : '<p>既存のGuild画面で確認できる参加・応援の記録はありません。</p>'}</section>
      <section class="city-section"><h3>Cityの活動記録</h3><p class="city-muted">${history.hasMore ? '最新50件を表示しています。以前の記録も保存されています。' : '保存済みのチェックイン'} · 日本時間</p>
      <ul class="city-list">${visits.map(v => `<li>${escape(spots?.find(s => s.spotId === v.spotId)?.name || v.spotId)} · ${escape(v.locationType)}${v.isDemo ? ' / DEMO' : ''}<small>${escape(date(v.occurredAt))} · ${v.verification === 'demo-only' ? '体験例の操作記録（現地未検証）' : 'Virtual Spotへの明示入場'}</small></li>`).join('')}</ul></section>
      ${button('preview-share','MyCityをシェア','',true,visits.length === 0)}<p class="city-muted">共有前に内容を確認できます。Passport IDや非公開情報は共有しません。</p>
      ${share ? `<section class="city-share" role="region" aria-label="共有内容の確認"><h3>この内容だけを共有します</h3><pre>${escape(share.text)}\n${escape(share.url)}</pre><div class="city-row">${button('share','共有する')}${button('cancel-share','キャンセル','',true)}</div></section>` : ''}
      <div class="city-soon"><b>MY AGENTS</b><span>Explorer · Coming Soon</span></div>
      <p class="city-muted">City Item・Agentへの権限委任・決済は未実装です。</p></section>`;
  }
  function render() {
    const focus = host.contains(document.activeElement) ? document.activeElement : null;
    const focusAction = focus?.dataset.action, focusValue = focus?.dataset.value;
    host.innerHTML = `<div class="city-toolbar"><button type="button" class="city-link" data-action="home">← SchoolParkの広場へ</button><span class="city-eyebrow">08 CITY / v0.1</span></div>
      ${page === 'home' ? `<section class="city-hero"><div><p class="city-eyebrow">REALITY × IDENTITY</p><h2 data-city-heading tabindex="-1">SchoolPark City</h2><p class="city-subtitle">Decentralized Mixed Reality<br>分散型複合現実</p><p>現実も、仮想も、学びのフィールドになる。</p></div><div class="city-worlds" aria-hidden="true"><div class="city-world"><span class="city-orbit">⌂</span><b>REAL</b><small>いつもの街から</small></div><div class="city-world"><span class="city-orbit">✧</span><b>VIRTUAL</b><small>まだ知らない世界へ</small></div></div></section>` : ''}
      <nav class="city-nav" aria-label="Cityの入口">${[['real','REAL','現実の体験例'],['virtual','VIRTUAL','仮想の入口'],['quest','QUEST','既存Questへ'],['my','MY CITY','自分の活動記録']].map(([id,label,note]) => `<button type="button" data-action="${id === 'quest' ? 'quest' : 'page'}" data-value="${id === 'quest' ? '' : id}"${page === id ? ' aria-current="page"' : ''}><b>${label}</b><span>${note}</span></button>`).join('')}</nav>
      ${page !== 'home' ? '<button type="button" class="city-link" data-action="page" data-value="home">← City HOME</button>' : ''}
      ${error ? `<div role="alert" class="city-status city-error">${escape(error)}</div>` : ''}
      ${message ? `<div role="status" class="city-status">${escape(message)}</div>` : ''}
      ${loading ? '<p role="status" class="city-note">Cityの入口を確認しています…</p>' : !spots ? `${unavailable('City')}${button('retry','もう一度読み込む','',true)}`
        : page === 'spot' ? detail() : page === 'my' ? myCity() : catalog()}
      ${page === 'home' ? '<p class="city-note">ここはDEMOから始まるCityです。実在する提携店舗、決済、報酬の自動付与はありません。SHOP・EVENT・AGENTは今後拡張予定です。</p>' : ''}`;
    if (focusAction) {
      [...host.querySelectorAll('[data-action]')].find(b => b.dataset.action === focusAction && b.dataset.value === focusValue)?.focus({ preventScroll:true });
    }
  }
  function fail(e) {
    if (e?.message === 'SESSION_CHANGED') return;
    error = errors[e?.message] || '通信を確認できませんでした。記録がないとは限りません。時間をおいて、もう一度お試しください。';
  }
  async function load(force = false) {
    if (loadJob) return loadJob;
    if (!force && spots && Date.now() - catalogAt < 300000) return;
    const version = epoch;
    loading = true; error = ''; render();
    const job = (async () => {
      try {
        const result = await bridge.getSpots();
        if (version !== epoch) return;
        spots = result.spots; catalogAt = Date.now();
      } catch(e) { if (version === epoch) { spots = null; fail(e); } }
      finally { if (version === epoch) { loading = false; loadJob = null; render(); } }
    })();
    loadJob = job;
    return job;
  }
  async function loadMy(force = false) {
    if (myJob) return myJob;
    if (!force && history && Date.now() - myAt < 60000) return;
    const version = epoch, request = ++myGeneration;
    const current = () => version === epoch && request === myGeneration;
    myLoading = true; error = ''; render();
    const job = (async () => {
      try {
        const result = await bridge.getMyCity();
        if (!current()) return;
        history = result; myAt = Date.now();
        render();
        const value = await bridge.achievements(result.passportId).catch(() => ({ quests:null, stars:null, guilds:null }));
        if (current()) achievements = value;
      } catch(e) { if (current()) fail(e); }
      finally { if (current()) { myLoading = false; myJob = null; render(); } }
    })();
    myJob = job;
    return job;
  }
  async function act(action, value) {
    const version = epoch;
    try {
      if (action === 'home') return bridge.goHome();
      if (action === 'page') return go(value);
      if (action === 'spot') return go('spot',value);
      if (action === 'retry') { await load(true); if(page === 'my') await loadMy(true); return; }
      if (action === 'refresh') return loadMy(true);
      if (action === 'quest') return await bridge.openQuest(value);
      if (action === 'guild') return await bridge.openGuild(value);
      if (action === 'emu') return await bridge.openEmu();
      if (action === 'passport') return await bridge.openPassport();
      if (action === 'checkin') {
        if (recording) return;
        const spot = spots?.find(s => s.spotId === value);
        if (!spot) return;
        recording = true; error = ''; message = ''; render();
        try {
          const result = await bridge.checkIn(spot);
          if (version !== epoch) return;
          recorded.set(spot.spotId, result.checkin);
          // A MyCity read started before this write must not overwrite the new record.
          myGeneration++; myJob = null; myLoading = false;
          if (history?.passportId === result.passportId) {
            const rows = [result.checkin, ...history.checkins.filter(v => v.id !== result.checkin.id)]
              .sort((a,b) => b.occurredAt - a.occurredAt);
            history = { ...history, checkins:rows.slice(0,50), hasMore:history.hasMore || rows.length > 50 };
          }
          myAt = 0;
          message = result.alreadyRecorded ? '今日のチェックインは記録済みです。二重には増えません。' : 'PassportにCityのDEMO記録を残しました。MY CITYで確認できます。';
        } finally { if (version === epoch) recording = false; }
      }
      if (action === 'preview-share' && history?.checkins.length) {
        // Only public catalogue labels of recorded demo Spots, not raw user/DB data.
        const names = (spots || []).filter(s => history.checkins.some(v => v.spotId === s.spotId))
          .map(s => `${s.name}（${s.locationType} / DEMO）`);
        share = bridge.sharePayload(names);
      }
      if (action === 'cancel-share') share = null;
      if (action === 'share' && share) {
        try {
          if (navigator.share) await navigator.share(share);
          else if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(share.text + '\n' + share.url);
          else { message = 'この端末では共有機能を利用できません。上の文章を選択してコピーしてください。'; render(); return; }
          message = navigator.share ? '共有画面を閉じました。' : '共有文をコピーしました。'; share = null;
        } catch (e) {
          if (e.name === 'AbortError') { share = null; message = '共有をキャンセルしました。'; }
          else message = '共有できませんでした。表示中の文章を選択してコピーできます。';
        }
      }
    } catch(e) { if (version === epoch) fail(e); }
    if (version === epoch) render();
  }
  host.addEventListener('click', event => {
    const target = event.target.closest('[data-action]');
    if (target && host.contains(target) && !target.disabled) act(target.dataset.action,target.dataset.value);
  });
  bridge.onSessionChange(() => {
    epoch++; myGeneration++; spots = null; history = null; achievements = null; share = null;
    recorded.clear(); catalogAt = 0; myAt = 0; loadJob = null; myJob = null;
    loading = false; recording = false; myLoading = false; page = 'home';
    message = ''; error = errors.SESSION_CHANGED; render();
  });
  render(); load();
  return { resume() { app.cityReturn = false; load(); } };
}

export function mount(host, app) {
  if (!document.querySelector('link[data-schoolpark-city]')) {
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = '/schoolpark/city.css'; css.dataset.schoolparkCity = '';
    document.head.appendChild(css);
  }
  if (!instances.has(host)) instances.set(host, createCity(host, app));
  else instances.get(host).resume();
}
