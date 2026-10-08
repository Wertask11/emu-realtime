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
  PASSPORT_LINK_REQUIRED:'Passport IDを連携してから交換してください。',
  PASSPORT_INACTIVE:'このPassportではCityを利用できません。',
  RATE_LIMITED:'操作が続いています。少し時間をおいて、もう一度お試しください。',
  QUEST_UNAVAILABLE:'このQuestを確認できませんでした。既存のQuest一覧からお探しください。',
  INSUFFICIENT_EMUER:'利用可能なEMUERが不足しています。',
  PERIOD_LIMIT_REACHED:'現在のプランの交換回数上限に達しています。',
  SOLD_OUT:'在庫がなくなりました。',
  EMUER_NOT_ACTIVE:'EMUER交換機能は停止中です。',
  METHOD_NOT_AVAILABLE:'この店舗ではこの決済方法を利用できません。',
  NOT_FOR_SALE:'この商品は現在交換できません。'
};

export function createCity(host, app, bridge = createBridge(window.parent, app)) {
  let page = 'home', selected = '', productShopId = '', spots = null, history = null, achievements = null;
  let commerceShops = null, commerceProducts = null, commerceMe = null, commerceOrders = null;
  let commerceBusy = false, opsOrders = null, opsCode = '', opsQr = null, opsLoading = false;
  let message = '', error = '', loading = false, recording = false, myLoading = false;
  let catalogAt = 0, myAt = 0, epoch = 0, myGeneration = 0, share = null, loadJob = null, myJob = null;
  const recorded = new Map();
  let immersive = null, immersiveOpening = false;
  host.className = 'sp-city';
  host.setAttribute('aria-label', 'SchoolPark City');

  const badges = spot => `<div class="city-badges"><span class="city-badge ${spot.locationType === 'REAL' ? 'real' : 'virtual'}">${escape(spot.locationType)}</span><span class="city-badge">DEMO</span>${spot.category.map(c => `<span class="city-badge">${escape(c)}</span>`).join('')}</div>`;
  const card = spot => `<article class="city-card">${badges(spot)}<h3>${escape(spot.name)}</h3><p>${escape(spot.description)}</p>${button('spot','Spotをひらく',spot.spotId,true)}</article>`;
  const empty = (title, note) => `<div class="city-empty"><strong>${escape(title)}</strong>${escape(note)}</div>`;
  const unavailable = label => `<p class="city-note">${escape(label)}を読み込めませんでした。0件という意味ではありません。時間をおいて更新してください。</p>`;
  function go(next, id = '') {
    if (next === 'products') productShopId = id;
    page = next; selected = id; share = null; message = ''; error = '';
    render(); app.toTop();
    host.querySelector('[data-city-heading]')?.focus({ preventScroll: true });
    if (page === 'my') loadMy();
    if (page === 'commerce') loadCommerce();
    if (page === 'products') loadProducts(id);
    if (page === 'orders') loadCommerceOrders();
    if (page === 'event-ops') loadEventOps();
    if (page === 'product') { if (!commerceProducts) loadProducts(productShopId); }
  }
  function selectedShop() { return productShopId; }
  const storeTypeLabel = s => s.storeType === 'schoolpark_virtual' ? 'SchoolPark公式仮想店舗 · EMUER専用'
    : s.storeType === 'real_partner' ? 'リアル提携店舗 · 円 / JPYC案内' : '既存店舗';
  const priceLabel = p => p?.prices?.EMUER != null ? `${escape(p.prices.EMUER)} EMUER` : '価格未設定';
  function storeList() {
    if (!commerceShops) return '<p role="status">店舗を読み込んでいます…</p>';
    return `<section class="city-section"><h2 data-city-heading tabindex="-1">店舗一覧</h2><p class="city-muted">3D空間を使わずに店舗・商品を探せます。</p>
      <div class="city-grid">${commerceShops.map(s => `<article class="city-card">${s.imageUrl ? `<img src="${escape(s.imageUrl)}" alt="${escape(s.name)}" loading="lazy">` : ''}<span class="city-badge ${s.storeType === 'schoolpark_virtual' ? 'virtual' : 'real'}">${escape(storeTypeLabel(s))}</span>
      <h3>${escape(s.emoji || '🏬')} ${escape(s.name)}</h3><p>${escape(s.description || '')}</p>${s.address ? `<p>${escape(s.address)}</p>` : ''}
      ${s.storeType === 'schoolpark_virtual' ? button('products','商品を見る',s.id) : `<p class="city-note">${escape(s.paymentGuide || '円・JPYCは各店舗へご確認ください。Rejiの自動決済連携は準備中です。EMUERは利用できません。')}</p>${s.storeType === 'real_partner' ? button('products','商品・サービスを見る',s.id) : ''}`}
      </article>`).join('')}</div></section>`;
  }
  function productList() {
    const shop = commerceShops?.find(s => s.id === selected);
    const products = (commerceProducts || []).filter(p => p.shopId === selected);
    const isVirtual = shop?.storeType === 'schoolpark_virtual';
    return `<button type="button" class="city-link" data-action="page" data-value="commerce">← 店舗一覧</button>
      <section class="city-section"><h2 data-city-heading tabindex="-1">${escape(shop?.name || '商品一覧')}</h2><p class="city-muted">${escape(storeTypeLabel(shop || {}))}。商品・価格・在庫は既存みてみるデータを表示しています。</p>
      ${commerceProducts === null ? '<p role="status">商品を読み込んでいます…</p>' : products.length ? `<div class="city-grid">${products.map(p => `<article class="city-card">${p.imageUrl ? `<img src="${escape(p.imageUrl)}" alt="" loading="lazy">` : ''}<span class="city-badge ${isVirtual?'virtual':'real'}">${isVirtual?'EMUER交換':'リアル店舗商品'}</span><h3>${escape(p.emoji || '🎁')} ${escape(p.name)}</h3><p>${escape(p.description || '')}</p><p><b>${isVirtual ? priceLabel(p) : `円 ${p.prices?.JPY == null ? '店頭確認' : '¥'+escape(p.prices.JPY)} / JPYC ${p.prices?.JPYC == null ? '店頭確認' : escape(p.prices.JPYC)}`}</b></p><p>在庫: ${p.remaining == null ? '店舗確認' : escape(p.remaining)}</p>${button('product','商品詳細・案内',p.id)}</article>`).join('')}</div>` : empty('販売中の商品はありません','登録済みの商品・サービスだけが表示されます。')}
      </section>`;
  }
  function productDetail() {
    const p = commerceProducts?.find(x => x.id === selected);
    if (!p) return unavailable('商品');
    const isVirtual = p.storeType === 'schoolpark_virtual';
    const ok = isVirtual && commerceMe?.emuer?.ok === true && p.methods?.includes('emuer_ledger') && p.remaining !== 0;
    const reason = !isVirtual ? '実店舗の販売・在庫・最終価格は店舗へご確認ください。円・JPYCのみ案内対象で、Cityでは決済完了を記録しません。Reji連携は仕様確認中です。'
      : p.remaining === 0 ? '在庫なし' : !commerceMe ? 'EMUER残高と利用条件を確認中です。' : !commerceMe.emuer?.ok
      ? (commerceMe.emuer?.error === 'PERIOD_LIMIT_REACHED' ? '交換回数上限に達しています。' : 'このアカウントでは交換できません。プラン条件またはPassport連携を確認してください。')
      : !p.methods?.includes('emuer_ledger') ? '交換機能停止中、または未変換EMUER交換を利用できません。' : '';
    return `<button type="button" class="city-link" data-action="products" data-value="${escape(p.shopId)}">← 商品一覧</button>
      <article class="city-card city-commerce-detail">${p.imageUrl ? `<img src="${escape(p.imageUrl)}" alt="${escape(p.name)}">` : ''}<span class="city-badge ${isVirtual?'virtual':'real'}">${isVirtual?'SchoolPark公式仮想店舗 · EMUER専用':'リアル提携店舗 · EMUER利用不可'}</span><h2 data-city-heading tabindex="-1">${escape(p.emoji || '🎁')} ${escape(p.name)}</h2>
      <p>${escape(p.description || '')}</p><p><b>${isVirtual ? `交換価格: ${priceLabel(p)}` : `円価格: ${p.prices?.JPY == null ? '店舗確認' : '¥'+escape(p.prices.JPY)} · JPYC価格: ${p.prices?.JPYC == null ? '店舗確認' : escape(p.prices.JPYC)}`}</b></p><p>在庫: ${p.remaining == null ? (isVirtual?'制限なし':'店舗確認') : escape(p.remaining)}</p>
      ${isVirtual ? `<p>未変換EMUER残高: ${commerceMe ? escape(commerceMe.emuer.unconverted) : '確認中'} / 利用可能: ${commerceMe?.emuer?.ok ? 'はい' : '確認中'}</p>` : ''}
      <p>引渡し: ${escape(p.fulfillment || '')}</p><p>取消条件: ${escape(p.cancelPolicy || '')}</p>
      ${reason ? `<p class="city-note">${escape(reason)}</p>` : ''}${isVirtual ? button('exchange',commerceBusy ? '交換中…' : 'EMUERで交換する',p.id,false,commerceBusy || !ok) : ''}
      ${isVirtual ? '<p class="city-muted">交換確定後に既存のEMUER注文処理が実行されます。QR表示だけではEMUERを消費しません。</p>' : ''}</article>`;
  }
  function ordersPage() {
    if (!commerceOrders) return `<section class="city-section"><h2 data-city-heading tabindex="-1">交換履歴</h2><p role="status">履歴を読み込んでいます…</p></section>`;
    return `<section class="city-section"><h2 data-city-heading tabindex="-1">交換履歴</h2><p class="city-muted">本人のPassport IDで既存みてみる注文を表示します。旧注文のIDはサーバーで解決して表示し、履歴文書への一括書込みはしません。Camelliaの記録は利用しません。</p>
      ${commerceOrders.length ? `<ul class="city-list">${commerceOrders.map(o => `<li>${escape(o.productName)} · ${escape(o.amount)} ${escape(o.currency)} · ${escape(o.status)}${o.storeType==='schoolpark_virtual'?' · City / 公式イベント':' · 既存みてみる注文'}<small>${escape(date(o.createdAt))} · Passport ${escape(o.passportId||'未連携')} · ${o.pickupCode ? `引換コード: ${escape(o.pickupCode)}` : '引換コードは支払い確認後に表示'}</small>${o.digitalStickerAvailable ? button('download-sticker','冷蔵庫くんステッカーをダウンロード',o.id) : ''}</li>`).join('')}</ul>` : empty('交換履歴はありません','Cityや公式イベントで交換すると、ここに表示されます.')}
      ${button('refresh-orders','履歴を更新','',true)}</section>`;
  }
  function eventOpsPage() {
    if (!commerceMe?.isOwner) return `<section class="city-section"><h2 data-city-heading tabindex="-1">イベント運営</h2><p class="city-note">SchoolPark運営者権限が必要です。</p></section>`;
    const products = (commerceProducts || []).filter(p => p.storeType === 'schoolpark_virtual');
    const stickerProduct = products.find(p => p.id === 'reizo-kun-sticker-v1');
    return `<section class="city-section"><h2 data-city-heading tabindex="-1">公式イベント運営</h2>
      <p class="city-muted">商品QRはCityの商品詳細を開きます。QRを読むだけでは注文もEMUER消費も起きません。注文確定・引渡しは既存みてみる注文APIを使います。</p>
      <article class="city-card"><h3>冷蔵庫くんデジタルステッカー</h3><p>所有者専用の準備操作です。商品を1 EMUERの下書きとして作成し、内容を確認してから販売開始できます。</p>${commerceMe.emuer?.ok ? '' : '<p class="city-note">EMUER交換機能は停止中です。商品は下書きで作成できますが、交換受付は有効化できません。</p>'}${stickerProduct?.imageUrl ? `<img src="${escape(stickerProduct.imageUrl)}" alt="冷蔵庫くんステッカーの商品プレビュー" loading="lazy">` : ''}${!stickerProduct ? button('seed-sticker','下書きを作成') : `<p>状態: ${escape(stickerProduct.status)} · 価格: ${priceLabel(stickerProduct)}</p>${stickerProduct.status === 'draft' ? button('publish-sticker','確認して販売開始',stickerProduct.id,true,!commerceMe.emuer?.ok) : '<p class="city-status">商品は販売中です。</p>'}`}</article>
      ${opsLoading ? '<p role="status">商品・注文情報を確認しています…</p>' : ''}
      <div class="city-grid">${products.filter(p => p.status === 'live').map(p => `<article class="city-card"><h3>${escape(p.name)}</h3><p>${priceLabel(p)} · 在庫 ${p.remaining == null ? '制限なし' : escape(p.remaining)}</p>${button('event-qr','商品QRを表示・印刷',p.id)}</article>`).join('')}</div>
      ${opsQr ? `<article class="city-card city-qr"><h3>${escape(opsQr.productName)} · イベント商品QR</h3><img src="${escape(opsQr.image)}" alt="${escape(opsQr.productName)} City商品QR"><p class="city-muted">${escape(opsQr.url)}</p><div class="city-row">${button('print-qr','QRを印刷')}${button('close-qr','閉じる','',true)}</div></article>` : ''}
      <form class="city-ops-form" data-ops-form><label for="city-pickup-code">引換コード照合</label><input id="city-pickup-code" name="code" autocomplete="off" maxlength="12" value="${escape(opsCode)}" placeholder="6文字の引換コード"><button type="submit" class="city-button">注文を検索</button></form>
      ${opsOrders ? opsOrders.length ? `<ul class="city-list">${opsOrders.map(o => `<li>${escape(o.productName)} · ${escape(o.amount)} ${escape(o.currency)} · ${escape(o.status)}<small>${escape(o.pickupCode)} · Passport ${escape(o.passportId || '旧注文')}</small>${o.status === 'paid' ? button('fulfill','引渡しを記録',o.id) : o.status === 'fulfilled' ? '<small>引渡し済み · 二重引渡しは記録されません</small>' : '<small>支払確定後に引き渡してください。</small>'}</li>`).join('')}</ul>` : empty('注文がありません','コードを確認してもう一度検索してください。') : ''}
    </section>`;
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
        : 'VIRTUAL / DEMO：3Dショールームを歩いて探索できます。チェックインは明示操作で記録し、現地訪問の証明にはなりません。'}</div>
      ${spot.locationType === 'VIRTUAL' ? button('walk','3D店舗に入る') : ''}
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
      <p class="city-muted">店舗での購入履歴・City Item・Agentへの権限委任は準備中です。</p></section>`;
  }
  function render() {
    const focus = host.contains(document.activeElement) ? document.activeElement : null;
    const focusAction = focus?.dataset.action, focusValue = focus?.dataset.value;
    host.innerHTML = `<div class="city-toolbar"><button type="button" class="city-link" data-action="home">← SchoolParkの広場へ</button><span class="city-eyebrow">08 CITY / 3D EXPLORER</span></div>
      ${page === 'home' ? `<section class="city-hero city-hero-3d"><img src="/schoolpark/city-showroom-preview.webp" alt="SchoolPark Cityの3Dショールーム。木の棚、商品、カウンターのある店内。" width="1200" height="675"><div class="city-hero-copy"><p class="city-eyebrow">REALITY × IDENTITY / 3D SHOWROOM</p><h2 data-city-heading tabindex="-1">SchoolPark City</h2><p>入って、歩いて、見つけよう。</p><p class="city-subtitle">Decentralized Mixed Reality · 分散型複合現実</p>${button('walk','3Dの街へ入る ↗','',false,loading || !spots)}</div></section>` : ''}
      <nav class="city-nav" aria-label="Cityの入口">${[['commerce','店舗一覧','商品を直接探す'],['orders','交換履歴','注文・引換コード'],...(commerceMe?.isOwner?[['event-ops','イベント運営','商品QR・引渡し']]:[]),['real','REAL','現実の体験例'],['virtual','VIRTUAL','仮想の入口'],['quest','QUEST','既存Questへ'],['my','MY CITY','自分の活動記録']].map(([id,label,note]) => `<button type="button" data-action="${id === 'quest' ? 'quest' : 'page'}" data-value="${id === 'quest' ? '' : id}"${page === id ? ' aria-current="page"' : ''}><b>${label}</b><span>${note}</span></button>`).join('')}</nav>
      ${page !== 'home' ? '<button type="button" class="city-link" data-action="page" data-value="home">← City HOME</button>' : ''}
      ${error ? `<div role="alert" class="city-status city-error">${escape(error)}</div>` : ''}
      ${message ? `<div role="status" class="city-status">${escape(message)}</div>` : ''}
      ${['commerce','products','product','orders','event-ops'].includes(page) ? (page === 'commerce' ? storeList() : page === 'products' ? productList() : page === 'product' ? productDetail() : page === 'orders' ? ordersPage() : eventOpsPage())
        : loading ? '<p role="status" class="city-note">Cityの入口を確認しています…</p>' : !spots ? `${unavailable('City')}${button('retry','もう一度読み込む','',true)}`
        : page === 'spot' ? detail() : page === 'my' ? myCity() : catalog()}
      ${page === 'home' ? '<p class="city-note">年内目標：リアル現場連携1〜2拠点。現在は店内を探索できる3Dショールームです。展示品の購入はできません。出店店舗の商品・提供条件・正式な決済先が整ったものから販売を開始します。</p>' : ''}`;
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
  async function loadCommerce() {
    if (commerceShops) return;
    commerceBusy = false; render();
    try {
      const [catalog, me] = await Promise.all([bridge.getCommerceShops(), bridge.getCommerceMe()]);
      commerceShops = (catalog.shops || []).filter(s => ['schoolpark_virtual','real_partner'].includes(s.storeType));
      commerceMe = me;
      const official = commerceShops.find(s => s.storeType === 'schoolpark_virtual');
      if (official) await loadProducts(official.id);
    } catch (e) { fail(e); }
    render();
  }
  async function loadProducts(shopId) {
    if (!shopId) return;
    if (commerceProducts && commerceProducts.some(p => p.shopId === shopId)) return;
    commerceProducts = null; render();
    try {
      const [result, me] = await Promise.all([bridge.getCommerceProducts(shopId), bridge.getCommerceMe()]);
      commerceProducts = result.products || [];
      commerceMe = me;
    } catch (e) { commerceProducts = []; fail(e); }
    render();
  }
  async function loadCommerceOrders() {
    try {
      const [result, me] = await Promise.all([bridge.getCommerceOrders(), bridge.getCommerceMe()]);
      commerceOrders = result.orders || [];
      commerceMe = me;
    } catch (e) { fail(e); }
    render();
  }
  async function loadEventOps() {
    opsLoading = true; render();
    try {
      commerceMe = await bridge.getCommerceMe();
      if (!commerceMe.isOwner) return;
      const catalog = await bridge.getCommerceShops();
      commerceShops = (catalog.shops || []).filter(s => ['schoolpark_virtual','real_partner'].includes(s.storeType));
      const official = commerceShops.find(s => s.storeType === 'schoolpark_virtual');
      if (official) {
        const result = await bridge.getCommerceAdminProducts();
        commerceProducts = result.products || [];
      }
    } catch (e) { fail(e); }
    finally { opsLoading = false; render(); }
  }
  function printQr() {
    if (!opsQr) return;
    const win = window.open('', '_blank', 'width=720,height=820');
    if (!win) { message = '印刷ウィンドウがブロックされました。ブラウザーのポップアップ許可後に再試行してください。'; return; }
    win.opener = null;
    win.document.write(`<!doctype html><meta charset="utf-8"><title>${escape(opsQr.productName)} City QR</title><style>body{font-family:sans-serif;text-align:center;padding:24px}img{width:min(80vw,640px)}p{overflow-wrap:anywhere}</style><h1>${escape(opsQr.productName)}</h1><img src="${escape(opsQr.image)}" alt="商品QR"><p>${escape(opsQr.url)}</p><script>window.onload=()=>window.print()<\/script>`);
    win.document.close();
  }
  async function act(action, value) {
    const version = epoch;
    try {
      if (action === 'walk') {
        if(immersive || immersiveOpening) return;
        immersiveOpening = true;
        try {
          const mod = await import('./city-shop.js');
          if(version !== epoch) return;
          immersive = mod.openShopWorld({bridge,spots:spots || [],wantedShop:'schoolpark-official',onClose:()=>{immersive=null;},onMyCity:()=>go('my'),
            onRecord:(spot,result)=>{recorded.set(spot.spotId,result.checkin);myGeneration++;myJob=null;myLoading=false;myAt=0;}});
        } finally { immersiveOpening=false; }
        return;
      }
      if (action === 'home') return bridge.goHome();
      if (action === 'page') return go(value);
      if (action === 'products') return go('products', value);
      if (action === 'product') {
        const product = commerceProducts?.find(p => p.id === value);
        if (!product) return;
        productShopId = product.shopId;
        return go('product', value);
      }
      if (action === 'exchange') {
        if (commerceBusy) return;
        commerceBusy = true; error = ''; message = ''; render();
        const requestId = (crypto.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, '').slice(0,80);
        try {
          const result = await bridge.placeCommerceOrder(value, requestId);
          message = result.already ? 'この交換注文はすでに受け付け済みです。' : 'EMUER交換を受け付けました。注文履歴で引換情報を確認してください。';
          await Promise.all([loadCommerceOrders(), loadProducts(productShopId)]);
          page = 'orders';
        } finally { commerceBusy = false; }
        return;
      }
      if (action === 'refresh-orders') return loadCommerceOrders();
      if (action === 'download-sticker') return await bridge.downloadReizoSticker(value);
      if (action === 'seed-sticker') {
        const result = await bridge.seedReizoSticker();
        message = result.created ? '冷蔵庫くんステッカーの下書きを作成しました。内容を確認してください。' : '既存の冷蔵庫くんステッカー下書きを読み込みました。';
        return await loadEventOps();
      }
      if (action === 'publish-sticker') {
        if (!commerceMe?.emuer?.ok) { error = 'EMUER交換機能が停止中のため、販売を開始できません。'; return; }
        await bridge.publishCommerceProduct(value);
        message = '冷蔵庫くんステッカーを販売開始しました。';
        return await loadEventOps();
      }
      if (action === 'event-qr') {
        opsLoading = true; render();
        try { opsQr = await bridge.getEventQR(value); }
        finally { opsLoading = false; render(); }
        return;
      }
      if (action === 'close-qr') { opsQr = null; return; }
      if (action === 'print-qr') { printQr(); return; }
      if (action === 'fulfill') {
        const result = await bridge.fulfillOpsOrder(value);
        message = result.already ? 'この注文はすでに引渡し済みです。' : '引渡しを記録しました。';
        if (opsCode) { const found = await bridge.getOpsOrders(opsCode); opsOrders = found.orders || []; }
        return;
      }
      if (action === 'lookup') {
        const code = String(host.querySelector('[name="code"]')?.value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (!code) { error = '引換コードを入力してください。'; return; }
        opsCode = code;
        const found = await bridge.getOpsOrders(code);
        opsOrders = found.orders || [];
        return;
      }
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
  host.addEventListener('submit', event => {
    if (!event.target.matches('[data-ops-form]')) return;
    event.preventDefault(); act('lookup','');
  });
  bridge.onSessionChange(() => {
    immersive?.destroy(); immersive=null; immersiveOpening=false;
    epoch++; myGeneration++; spots = null; history = null; achievements = null; share = null;
    recorded.clear(); catalogAt = 0; myAt = 0; loadJob = null; myJob = null;
    commerceShops = null; commerceProducts = null; commerceMe = null; commerceOrders = null;
    loading = false; recording = false; myLoading = false; page = 'home';
    message = ''; error = errors.SESSION_CHANGED; render();
  });
  render(); load();
  const cityParams = new URLSearchParams(window.location.search);
  const eventProductId = cityParams.get('productId');
  if (eventProductId) {
    page = 'commerce'; selected = ''; render();
    loadCommerce().then(async () => {
      const shop = commerceShops?.find(s => s.storeType === 'schoolpark_virtual');
      if (!shop) return;
      productShopId = shop.id;
      await loadProducts(shop.id);
      if (commerceProducts?.some(p => p.id === eventProductId)) go('product', eventProductId);
      else { error = 'このイベント商品は現在公開されていません。'; render(); }
    });
  } else if (cityParams.get('cityView') === 'orders') go('orders');
  else if (cityParams.get('cityView') === 'commerce') go('commerce');
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
