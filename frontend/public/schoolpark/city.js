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
  NOT_FOR_SALE:'この商品は現在交換できません。',
  WALLET_NOT_FOUND:'ウォレット（MetaMask など）が見つかりません。',
  WALLET_REQUIRED:'Passportにウォレットを連携すると、ウォレットのEMUERで交換できます。',
  WALLET_MISMATCH:'注文のウォレットと、いま MetaMask で開いているアカウントが違います。MetaMask で連携済みのアカウントに切り替えてから、もう一度お試しください。',
  POLYGON_REQUIRED:'MetaMask のネットワークを Polygon に切り替えてください。',
  PLAN_REQUIRED:'EMUERでの交換は、Light・Plus・Pro プランで使えます（無料プランでは使えません）。',
  AUTHORIZER_NOT_READY:'いまはウォレットのEMUERで交換できません。時間をおいて、もう一度お試しください。',
  CHAIN_UNAVAILABLE:'ブロックチェーンに繋がりませんでした。時間をおいて、もう一度お試しください。',
  CHAIN_PAYMENT_NOT_FOUND:'支払いの記録がまだ届いていません。少し待ってから、交換履歴の「支払いを確かめる」を押してください。',
  CHAIN_PAYMENT_MISMATCH:'支払いの内容が注文と合いませんでした。運営へお問い合わせください。',
  ORDER_EXPIRED:'この注文は期限が切れました。もう一度、商品から交換してください。',
  ORDER_NOT_PENDING:'この注文は、もう支払い待ちではありません。交換履歴を更新してください。',
  ALREADY_DONE:'この注文は、もう支払いが済んでいます。交換履歴を更新してください。'
};
const newRequestId = () => (crypto.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, '').slice(0,80);
const emuerNumber = v => { const n = Number(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : 0; };
const amountText = n => Number(n).toLocaleString('ja-JP', { maximumFractionDigits: 2 });
/* MetaMask で「拒否」したとき。ethers は ACTION_REJECTED、MetaMask は 4001 を返す。 */
const rejected = e => e?.code === 4001 || e?.code === 'ACTION_REJECTED' || /user (rejected|denied)/i.test(String(e?.message || ''));

export function createCity(host, app, bridge = createBridge(window.parent, app)) {
  let page = 'home', selected = '', productShopId = '', spots = null, history = null, achievements = null;
  let commerceShops = null, commerceProducts = null, commerceMe = null, commerceOrders = null;
  let commerceBusy = false, opsOrders = null, opsCode = '', opsQr = null, opsLoading = false;
  /* トップに並べる公式ショップの商品（showcase）と、3Dの展示店（demoShops）。
     どちらも公開の読み取りだけで、EMUER残高（/me）は読まない。
     残高は自分の記録なので、公式ショップや商品を開いたときに読む。 */
  let showcase = null, showcaseState = 'idle', demoShops = null;
  /* ウォレットのEMUER（受け取り済み）。undefined はまだ読んでいない、null は読めなかった。 */
  let walletBalance;
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
    if (page === 'partners') loadPartners();
    if (page === 'products') loadProducts(id);
    if (page === 'orders') loadCommerceOrders();
    if (page === 'event-ops') loadEventOps();
    if (page === 'product') { if (!commerceProducts) loadProducts(productShopId); else if (!commerceMe) loadMe(); }
    if (page === 'home') loadShowcase();
  }
  function selectedShop() { return productShopId; }
  const storeTypeLabel = s => s.storeType === 'schoolpark_virtual' ? 'SchoolPark公式ショップ · EMUERで交換'
    : s.storeType === 'real_partner' ? '街のお店 · 円 / JPYC' : '既存店舗';
  const priceLabel = p => p?.prices?.EMUER != null ? `${escape(p.prices.EMUER)} EMUER` : '価格未設定';
  const stockLabel = p => p.remaining === 0 ? '在庫なし' : p.remaining == null ? '' : `残り ${escape(p.remaining)}`;
  const shopsOf = catalog => (catalog?.shops || []).filter(s => ['schoolpark_virtual','real_partner'].includes(s.storeType));
  const officialShop = () => commerceShops?.find(s => s.storeType === 'schoolpark_virtual');
  /* 交換できないときの理由。サーバーの符号をそのまま出さない。 */
  const emuerWhy = code => ({
    PLAN_REQUIRED:'EMUERでの交換は、Light・Plus・Pro プランで使えます（無料プランでは使えません）。',
    PERIOD_LIMIT_REACHED:'いまのプランの交換回数を使い切りました。次の期間になると、また交換できます。',
    PASSPORT_LINK_REQUIRED:'Passport IDを連携すると交換できます。',
    EMUER_NOT_ACTIVE:'EMUERの交換は、いま止まっています。',
    ENTITLEMENT_UNAVAILABLE:'プランを確かめられませんでした。時間をおいて、もう一度お試しください。'
  }[code] || 'このアカウントでは、いまは交換できません。プランとPassport連携をご確認ください。');
  /* 注文の状態。paid / fulfilled のような符号ではなく、次に何をすればよいかが分かる言葉にする。 */
  const orderStatus = o => ({
    pending_payment:'お支払い待ち',
    paid: o.digitalStickerAvailable ? '受け取れます（ダウンロード）' : '受け取り待ち · 引換コードを受付で見せてください',
    fulfilled:'受け取り済み', refunded:'返金済み', cancelled:'取り消し', expired:'期限切れ'
  }[o.status] || o.status);
  /* 使い方。はじめての人が、3つで分かるように。 */
  const howTo = () => `<ol class="city-howto" aria-label="公式ショップの使い方">
      <li><b>1</b><span><strong>EMUERをためる</strong>知識の投稿やクエストなど、SchoolParkでの活動でたまります。</span></li>
      <li><b>2</b><span><strong>商品と交換する</strong>公式ショップで商品を選び、ウォレットのEMUERか、ウォレットに移す前のEMUERで交換します。</span></li>
      <li><b>3</b><span><strong>受け取る</strong>交換履歴の引換コードを受付で見せます。デジタルの商品はその場でダウンロードできます。</span></li>
    </ol>`;
  /* 営業先にそのまま見せられる、出店の案内。 */
  const joinCta = () => `<section class="city-join" data-tour="city-join"><p class="city-eyebrow">FOR SHOPS · 出店のご案内</p>
      <h3>あなたのお店も、SchoolPark City に出店できます</h3>
      <p>教室・カフェ・本屋など、学びや挑戦につながるお店を募集しています。お店の商品やイベントを、SchoolParkのメンバーに届けませんか。</p>
      ${button('contact','出店の相談をする','general')}</section>`;
  const productTile = p => `<button type="button" class="city-product" data-action="product" data-value="${escape(p.id)}">
      ${p.imageUrl ? `<img src="${escape(p.imageUrl)}" alt="" loading="lazy">` : `<span class="city-product-emoji" aria-hidden="true">${escape(p.emoji || '🎁')}</span>`}
      <b>${escape(p.name)}</b><span>${priceLabel(p)}${p.remaining === 0 ? ' · 在庫なし' : ''}</span></button>`;
  const productCard = p => `<article class="city-card">${p.imageUrl ? `<img src="${escape(p.imageUrl)}" alt="" loading="lazy">` : ''}<span class="city-badge virtual">EMUERで交換</span>
      <h3>${escape(p.emoji || '🎁')} ${escape(p.name)}</h3><p>${escape(p.description || '')}</p><p><b>${priceLabel(p)}</b>${stockLabel(p) ? ` · ${stockLabel(p)}` : ''}</p>
      ${button('product','くわしく見る・交換する',p.id)}</article>`;
  /* 使えるEMUERは2つある。
       ・ウォレットのEMUER … 受け取り済み（Emu のウォレットの「使えるEMUER」と同じ）。MetaMask で払う
       ・ウォレットに移す前のEMUER … まだ受け取っていない報酬。その場で引ける
     前は後者だけを「あなたの使えるEMUER」と出していたので、全部受け取った人は 0 に見えた（10/28）。 */
  function myEmuer() {
    if (!commerceMe?.emuer) return '';
    const wallet = walletBalance === undefined ? '確認中…' : walletBalance === null ? '—' : `${amountText(walletBalance)} EMUER`;
    return `<div class="city-wallet"><div><span>ウォレットのEMUER</span><b>${escape(wallet)}</b></div>
      <div><span>ウォレットに移す前のEMUER</span><b class="city-wallet-sub">${escape(commerceMe.emuer.unconverted ?? '0')} EMUER</b></div>
      ${walletBalance === null ? '<small class="city-wallet-note">ウォレットのEMUERは、MetaMask を Polygon で接続すると表示されます。</small>' : ''}
      ${commerceMe.emuer.ok ? '' : `<small>${escape(emuerWhy(commerceMe.emuer.error))}</small>`}</div>`;
  }
  function officialPage() {
    const shop = officialShop();
    /* イベント運営を開いたあとは、運営用の一覧（下書きも入る）に入れ替わっていることがある。
       ここに出すのは販売中のものだけ（公開の一覧には status が無い）。 */
    const products = (commerceProducts || []).filter(p => shop && p.shopId === shop.id && (p.status === undefined || p.status === 'live'));
    return `<section class="city-section"><p class="city-eyebrow">SCHOOLPARK OFFICIAL SHOP</p><h2 data-city-heading tabindex="-1">🏫 公式ショップ</h2>
      <p class="city-muted">SchoolParkの公式店舗です。活動でたまったEMUERで、商品と交換できます。</p>
      ${myEmuer()}
      ${!commerceShops || (shop && commerceProducts === null) ? '<p role="status">商品を読み込んでいます…</p>'
        : !shop ? unavailable('公式ショップ')
        : products.length ? `<div class="city-grid">${products.map(productCard).join('')}</div>`
        : empty('商品はこれから並びます','新しい商品が入ったら、ここに並びます。')}
      ${howTo()}
      <div class="city-row">${shop ? button('walk','🗺 3Dのお店に入る',shop.id,true) : ''}${button('page','街のお店を見る','partners',true)}${button('page','交換履歴を見る','orders',true)}</div></section>`;
  }
  /* 3Dの展示店が読めなかったときの控え。3Dの街に入れば同じお店がある。 */
  const FIELD_STORE = { id:'field-store', name:'THE FIELD STORE', subtitle:'学びと暮らしの、小さなお店。' };
  function partnersPage() {
    const partners = (commerceShops || []).filter(s => s.storeType === 'real_partner');
    const demos = demoShops === null ? [] : demoShops.length ? demoShops : [FIELD_STORE];
    return `<section class="city-section"><p class="city-eyebrow">SHOPS IN THE CITY</p><h2 data-city-heading tabindex="-1">🏪 街のお店</h2>
      <p class="city-muted">SchoolParkとつながる街のお店です。支払いは円・JPYCで、お店で行います（EMUERは使えません）。</p>
      ${!commerceShops && demoShops === null ? '<p role="status">お店を読み込んでいます…</p>' : ''}
      <div class="city-grid">${partners.map(s => `<article class="city-card">${s.imageUrl ? `<img src="${escape(s.imageUrl)}" alt="${escape(s.name)}" loading="lazy">` : ''}<span class="city-badge real">お店 · 円 / JPYC</span>
        <h3>${escape(s.emoji || '🏪')} ${escape(s.name)}</h3><p>${escape(s.description || '')}</p>${s.address ? `<p>📍 ${escape(s.address)}</p>` : ''}
        ${s.paymentGuide ? `<p class="city-note">${escape(s.paymentGuide)}</p>` : ''}${button('products','商品・サービスを見る',s.id)}${button('walk','3Dで入る',s.id,true)}</article>`).join('')}
        ${demos.map(d => `<article class="city-card"><span class="city-badge">デモ · 3Dの展示店</span>
        <h3>🏪 ${escape(d.name)}</h3><p>${escape(d.subtitle || d.description || '')}</p>
        <p>3Dの街で、お店に入って歩き、商品を見られます。展示用のお店なので、商品は購入できません。</p>${button('walk','3Dで入る',d.id,true)}</article>`).join('')}</div>
      ${commerceShops && !partners.length ? '<p class="city-note">提携しているお店は、これから増えていきます。</p>' : ''}
    </section>${joinCta()}`;
  }
  function productList() {
    const shop = commerceShops?.find(s => s.id === selected);
    const products = (commerceProducts || []).filter(p => p.shopId === selected);
    const isVirtual = shop?.storeType === 'schoolpark_virtual';
    return `<button type="button" class="city-link" data-action="page" data-value="${isVirtual ? 'commerce' : 'partners'}">← ${isVirtual ? '公式ショップ' : '街のお店'}</button>
      <section class="city-section"><h2 data-city-heading tabindex="-1">${escape(shop?.name || '商品一覧')}</h2><p class="city-muted">${escape(storeTypeLabel(shop || {}))}${isVirtual ? '' : '。価格・在庫・支払いは、お店でご確認ください。'}</p>
      ${commerceProducts === null ? '<p role="status">商品を読み込んでいます…</p>' : products.length ? `<div class="city-grid">${products.map(p => `<article class="city-card">${p.imageUrl ? `<img src="${escape(p.imageUrl)}" alt="" loading="lazy">` : ''}<span class="city-badge ${isVirtual?'virtual':'real'}">${isVirtual?'EMUER交換':'リアル店舗商品'}</span><h3>${escape(p.emoji || '🎁')} ${escape(p.name)}</h3><p>${escape(p.description || '')}</p><p><b>${isVirtual ? priceLabel(p) : `円 ${p.prices?.JPY == null ? '店頭確認' : '¥'+escape(p.prices.JPY)} / JPYC ${p.prices?.JPYC == null ? '店頭確認' : escape(p.prices.JPYC)}`}</b></p><p>在庫: ${p.remaining == null ? 'お店で確認' : escape(p.remaining)}</p>${button('product','くわしく見る',p.id)}</article>`).join('')}</div>` : empty('商品はこれから並びます','お店の商品・サービスが入ったら、ここに並びます。')}
      </section>`;
  }
  function productDetail() {
    const p = commerceProducts?.find(x => x.id === selected);
    if (!p) return unavailable('商品');
    const isVirtual = p.storeType === 'schoolpark_virtual';
    const price = emuerNumber(p.prices?.EMUER);
    const base = isVirtual && commerceMe?.emuer?.ok === true && p.remaining !== 0;
    const canWallet = base && p.methods?.includes('emuer_chain') && !!commerceMe?.wallet && (walletBalance == null || walletBalance >= price);
    const canLedger = base && p.methods?.includes('emuer_ledger') && emuerNumber(commerceMe?.emuer?.unconverted) >= price;
    const ok = canWallet || canLedger;
    const reason = !isVirtual ? '支払いは円・JPYCで、お店で行います。価格・在庫は、お店でご確認ください（EMUERは使えません）。'
      : p.remaining === 0 ? '在庫がなくなりました。' : !commerceMe ? 'あなたのEMUERを確かめています…' : !commerceMe.emuer?.ok
      ? emuerWhy(commerceMe.emuer?.error)
      : !p.methods?.some(m => m === 'emuer_ledger' || m === 'emuer_chain') ? 'この商品は、いまはEMUERで交換できません。'
      : !ok ? 'EMUERが足りません。ウォレットのEMUERか、ウォレットに移す前のEMUERのどちらかが、価格以上あれば交換できます。' : '';
    return `<button type="button" class="city-link" data-action="${isVirtual ? 'page' : 'products'}" data-value="${isVirtual ? 'commerce' : escape(p.shopId)}">← ${isVirtual ? '公式ショップ' : '商品一覧'}</button>
      <article class="city-card city-commerce-detail">${p.imageUrl ? `<img src="${escape(p.imageUrl)}" alt="${escape(p.name)}">` : ''}<span class="city-badge ${isVirtual?'virtual':'real'}">${isVirtual?'SchoolPark公式ショップ · EMUERで交換':'街のお店 · 円 / JPYC'}</span><h2 data-city-heading tabindex="-1">${escape(p.emoji || '🎁')} ${escape(p.name)}</h2>
      <p>${escape(p.description || '')}</p><p><b>${isVirtual ? `交換価格: ${priceLabel(p)}` : `円価格: ${p.prices?.JPY == null ? '店舗確認' : '¥'+escape(p.prices.JPY)} · JPYC価格: ${p.prices?.JPYC == null ? '店舗確認' : escape(p.prices.JPYC)}`}</b></p>${p.remaining == null ? '' : `<p>在庫: ${p.remaining === 0 ? 'なし' : `残り ${escape(p.remaining)}`}</p>`}
      ${isVirtual ? myEmuer() : ''}
      ${p.fulfillment ? `<p>受け取り方: ${escape(p.fulfillment)}</p>` : ''}${p.cancelPolicy ? `<p>キャンセル: ${escape(p.cancelPolicy)}</p>` : ''}
      ${reason ? `<p class="city-note">${escape(reason)}</p>` : ''}
      ${isVirtual ? `<div class="city-pay">${button('exchange-chain',commerceBusy ? '交換中…' : 'ウォレットのEMUERで交換する',p.id,false,commerceBusy || !canWallet)}
        ${button('exchange',commerceBusy ? '交換中…' : 'ウォレットに移す前のEMUERで交換する',p.id,true,commerceBusy || !canLedger)}</div>
        <p class="city-muted">ウォレットのEMUERで払うときは、MetaMask で確認します（Polygon のガス代がかかります）。交換すると、交換履歴に引換コードが出ます。</p>` : ''}</article>`;
  }
  function ordersPage() {
    if (!commerceOrders) return `<section class="city-section"><h2 data-city-heading tabindex="-1">交換履歴</h2><p role="status">履歴を読み込んでいます…</p></section>`;
    return `<section class="city-section"><h2 data-city-heading tabindex="-1">交換履歴</h2><p class="city-muted">交換した商品と引換コードです。受付で引換コードを見せて受け取ってください。</p>
      ${commerceOrders.length ? `<ul class="city-list">${commerceOrders.map(o => `<li><b>${escape(o.productName)}</b> · ${escape(o.amount)} ${escape(o.currency)}<span class="city-order-status" data-status="${escape(o.status)}">${escape(orderStatus(o))}</span><small>${escape(date(o.createdAt))}${o.pickupCode ? ` · 引換コード <b class="city-code">${escape(o.pickupCode)}</b>` : o.status === 'pending_payment' ? ' · 引換コードはお支払いのあとに出ます' : ''}</small>${o.digitalStickerAvailable ? button('download-sticker','冷蔵庫くんステッカーをダウンロード',o.id) : ''}${o.status === 'pending_payment' && o.method === 'emuer_chain' ? `<div class="city-row">${button('resume-pay','MetaMaskで払う',o.id,false,commerceBusy)}${button('confirm-order','支払いを確かめる',o.id,true,commerceBusy)}${button('cancel-order','取り消す',o.id,true,commerceBusy)}</div>` : ''}</li>`).join('')}</ul>` : empty('交換履歴はありません','公式ショップやイベントで交換すると、ここに並びます。')}${button('page','公式ショップを見る','commerce')}
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
    return `<section class="city-section"><div class="city-section-title"><h3>${page === 'real' ? 'REAL · 街の体験例' : page === 'virtual' ? 'VIRTUAL · 仮想の入口' : '体験スポット'}</h3><span class="city-muted">DEMO</span></div>
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
      <p class="city-muted">Passport・星空と同じ完走の記録です。</p></section>
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
      <p class="city-muted">公式ショップで交換したものは「交換履歴」で見られます。</p>${button('page','交換履歴を見る','orders',true)}</section>`;
  }
  /* トップの「公式ショップの商品」。読めなかったら、ページ全体の失敗にはしない。 */
  function showcaseSection() {
    const items = (showcase || []).slice(0, 4);
    const body = showcaseState === 'failed' ? '<p class="city-muted">商品を読み込めませんでした。「公式ショップ」から開き直せます。</p>'
      : showcase === null ? '<p role="status" class="city-muted">商品を読み込んでいます…</p>'
      : items.length ? `<div class="city-products">${items.map(productTile).join('')}</div>`
      : '<p class="city-muted">商品はこれから並びます。新しい商品が入ったら、ここに出ます。</p>';
    return `<section class="city-showcase" aria-label="公式ショップの商品" data-tour="city-showcase"><div class="city-section-title"><h3>🏫 公式ショップの商品</h3>${button('page','すべて見る','commerce',true)}</div>${body}</section>`;
  }
  function render() {
    const focus = host.contains(document.activeElement) ? document.activeElement : null;
    const focusAction = focus?.dataset.action, focusValue = focus?.dataset.value;
    host.innerHTML = `${page === 'home' ? `<section class="city-hero city-hero-3d"><img src="/schoolpark/city-showroom-preview.webp" alt="SchoolPark Cityの3Dショールーム。木の棚、商品、カウンターのある店内。" width="1200" height="675"><div class="city-hero-copy"><p class="city-eyebrow">SCHOOLPARK CITY</p><h2 data-city-heading tabindex="-1">SchoolPark City</h2><p>活動でたまったEMUERで、公式ショップの商品と交換できる街。<br>街のお店や、3Dの街も歩けます。</p>${button('walk','3Dの街へ入る ↗','',false,loading || !spots)}</div></section>` : ''}
      ${page === 'home' ? `<div class="city-doors" role="navigation" aria-label="Cityでできること" data-tour="city-doors">${[
        ['page','commerce','🏫','公式ショップ','EMUERで商品と交換','city-shop'],
        ['page','partners','🏪','街のお店','円・JPYCで使えるお店','city-partners'],
        ['walk','','🗺','3Dの街を歩く','お店に入って商品を見る','city-3d']
      ].map(([action,value,icon,label,note,tourId]) => `<button type="button" class="city-door" data-tour="${tourId}" data-action="${action}" data-value="${value}"${action === 'walk' && (loading || !spots) ? ' disabled' : ''}><span class="city-door-icon" aria-hidden="true">${icon}</span><b>${label}</b><span>${note}</span></button>`).join('')}</div>${showcaseSection()}` : ''}
      <nav class="city-nav ${page === 'home' ? 'city-nav-sub' : 'city-nav-compact'}" aria-label="Cityのページ">${[...(page === 'home' ? [] : [['commerce','公式ショップ','EMUERで交換'],['partners','街のお店','円・JPYC']]),['orders','交換履歴','引換コード'],...(commerceMe?.isOwner?[['event-ops','イベント運営','商品QR・引渡し']]:[]),['real','REAL','街の体験スポット'],['virtual','VIRTUAL','仮想の入口'],['quest','QUEST','クエストへ'],['my','MY CITY','自分の記録']].map(([id,label,note]) => `<button type="button"${id === 'orders' ? ' data-tour="city-orders"' : ''} data-action="${id === 'quest' ? 'quest' : 'page'}" data-value="${id === 'quest' ? '' : id}"${page === id || (id === 'commerce' && ['products','product'].includes(page) && officialShop()?.id === productShopId) ? ' aria-current="page"' : ''}><b>${label}</b><span>${note}</span></button>`).join('')}</nav>
      ${page !== 'home' ? '<button type="button" class="city-link" data-action="page" data-value="home">← City HOME</button>' : ''}
      ${error ? `<div role="alert" class="city-status city-error">${escape(error)}</div>` : ''}
      ${message ? `<div role="status" class="city-status">${escape(message)}</div>` : ''}
      ${['commerce','partners','products','product','orders','event-ops'].includes(page) ? (page === 'commerce' ? officialPage() : page === 'partners' ? partnersPage() : page === 'products' ? productList() : page === 'product' ? productDetail() : page === 'orders' ? ordersPage() : eventOpsPage())
        : loading ? '<p role="status" class="city-note">Cityの入口を確認しています…</p>' : !spots ? `${unavailable('City')}${button('retry','もう一度読み込む','',true)}`
        : page === 'spot' ? detail() : page === 'my' ? myCity() : catalog()}
      ${page === 'home' ? `${joinCta()}<p class="city-muted">3Dの街のお店（THE FIELD STORE）は展示用です。展示品は購入できません。体験スポットの記録は、現地を訪れた証明にはなりません。</p>` : ''}`;
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
    commerceBusy = false; render();
    try {
      /* トップの商品を読むときに店の一覧だけは先に読んでいることがある。
         そのときも、残高（/me）と商品はここで読む。 */
      const [catalog, me] = await Promise.all([commerceShops ? null : bridge.getCommerceShops(), bridge.getCommerceMe()]);
      if (catalog) commerceShops = shopsOf(catalog);
      commerceMe = me;
      loadWallet();
      const official = officialShop();
      if (official) await loadProducts(official.id);
    } catch (e) { fail(e); }
    render();
  }
  async function loadMe() {
    try { commerceMe = await bridge.getCommerceMe(); } catch (e) { fail(e); }
    render();
    await loadWallet();
  }
  async function loadWallet() {
    const version = epoch;
    const value = commerceMe?.wallet ? await bridge.walletEmuer(commerceMe.wallet).catch(() => null) : null;
    if (version !== epoch) return;
    walletBalance = value;
    render();
  }
  async function loadShowcase() {
    if (showcaseState === 'loading' || showcaseState === 'ready') return;
    const version = epoch;
    showcaseState = 'loading';
    try {
      if (!commerceShops) {
        const catalog = await bridge.getCommerceShops();
        if (version !== epoch) return;
        commerceShops = shopsOf(catalog);
      }
      const official = officialShop();
      const result = official ? await bridge.getCommerceProducts(official.id) : { products: [] };
      if (version !== epoch) return;
      showcase = (result.products || []).filter(p => !official || p.shopId === official.id);
      showcaseState = 'ready';
    } catch (e) { if (version === epoch) { showcaseState = 'failed'; showcase = []; } }
    if (version === epoch && page === 'home') render();
  }
  async function loadPartners() {
    const version = epoch;
    const [catalog, demo] = await Promise.allSettled([
      commerceShops ? Promise.resolve(null) : bridge.getCommerceShops(),
      demoShops ? Promise.resolve(null) : bridge.getShops()
    ]);
    if (version !== epoch) return;
    if (catalog.status === 'fulfilled' && catalog.value) commerceShops = shopsOf(catalog.value);
    else if (catalog.status === 'rejected') { commerceShops = commerceShops || []; fail(catalog.reason); }
    if (demo.status === 'fulfilled' && demo.value) demoShops = (demo.value.shops || []).map(d => ({ id:d.id, name:d.name, subtitle:d.subtitle, description:d.description }));
    else if (demo.status === 'rejected') demoShops = demoShops || [];
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
      commerceShops = shopsOf(catalog);
      const official = officialShop();
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
          immersive = mod.openShopWorld({bridge,spots:spots || [],wantedShop:value || 'schoolpark-official',onClose:()=>{immersive=null;},onMyCity:()=>go('my'),
            onRecord:(spot,result)=>{recorded.set(spot.spotId,result.checkin);myGeneration++;myJob=null;myLoading=false;myAt=0;}});
        } finally { immersiveOpening=false; }
        return;
      }
      if (action === 'page') return go(value);
      if (action === 'products') return go('products', value);
      if (action === 'contact') { bridge.openContact(value || 'general'); return; }
      if (action === 'product') {
        /* トップの商品から開いたときは、そちらの一覧を使う。 */
        if (!commerceProducts?.some(p => p.id === value) && showcase?.some(p => p.id === value)) commerceProducts = showcase.slice();
        const product = commerceProducts?.find(p => p.id === value);
        if (!product) return;
        productShopId = product.shopId;
        return go('product', value);
      }
      if (action === 'exchange') {
        if (commerceBusy) return;
        commerceBusy = true; error = ''; message = ''; render();
        const requestId = newRequestId();
        try {
          const result = await bridge.placeCommerceOrder(value, requestId);
          message = result.already ? 'この交換注文はすでに受け付け済みです。' : 'EMUER交換を受け付けました。注文履歴で引換情報を確認してください。';
          await Promise.all([loadCommerceOrders(), loadProducts(productShopId)]);
          page = 'orders';
        } finally { commerceBusy = false; }
        return;
      }
      /* ウォレットのEMUERで交換する。注文 → MetaMask で payExchange → サーバーが鎖を見て確定。
         MetaMask で断ったら注文を取り消して在庫を戻す（EMUERは動いていない）。
         払ったあとに確かめられなかったときは、注文は支払い待ちのまま残り、交換履歴から確かめ直せる。 */
      if (action === 'exchange-chain' || action === 'resume-pay') {
        if (commerceBusy) return;
        commerceBusy = true; error = ''; message = ''; render();
        let orderId = action === 'resume-pay' ? value : '';
        try {
          let exchange;
          if (action === 'resume-pay') exchange = (await bridge.exchangeAuthorization(orderId)).exchange;
          else {
            const result = await bridge.placeCommerceOrder(value, newRequestId(), 'emuer_chain');
            orderId = result.order?.id || '';
            exchange = result.exchange;
            if (!exchange) { message = 'この交換注文はすでに受け付け済みです。'; }
          }
          if (exchange) {
            message = 'MetaMask で支払いを確認してください。'; render();
            try { await bridge.payExchange(exchange, commerceMe?.wallet); }
            catch (e) {
              /* 払う前に止まったもの（断った・別のアカウント・ウォレットが無い・Polygon でない）は、
                 EMUERが動いていないので注文を取り消して在庫を戻す。新しく作った注文だけ。 */
              const beforePaying = rejected(e) || ['WALLET_MISMATCH','WALLET_NOT_FOUND','POLYGON_REQUIRED'].includes(e?.message);
              if (beforePaying && orderId && action === 'exchange-chain') await bridge.cancelCommerceOrder(orderId).catch(() => {});
              if (rejected(e)) { message = '支払いを取り消しました。EMUERは使われていません。'; return; }
              throw e;
            }
            message = '支払いを確かめています…'; render();
            await bridge.confirmCommerceOrder(orderId);
            message = 'ウォレットのEMUERで交換しました。引換コードは下の交換履歴にあります。';
          }
          await Promise.all([loadCommerceOrders(), productShopId ? loadProducts(productShopId) : null]);
          page = 'orders';
        } finally { commerceBusy = false; if (version === epoch) render(); }
        return;
      }
      if (action === 'confirm-order') {
        await bridge.confirmCommerceOrder(value);
        message = '支払いを確かめました。引換コードが出ています。';
        return await loadCommerceOrders();
      }
      if (action === 'cancel-order') {
        if (!window.confirm('この注文を取り消しますか？\nMetaMask で払っていなければ、EMUERは使われていません。')) return;
        await bridge.cancelCommerceOrder(value);
        message = '注文を取り消しました。';
        return await loadCommerceOrders();
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
  /* チュートリアル（reizo-tour-pages.js）が CITY のトップを指すときに送ってくる。 */
  host.addEventListener('city-tour-home', () => { if (page !== 'home') go('home'); });
  host.addEventListener('submit', event => {
    if (!event.target.matches('[data-ops-form]')) return;
    event.preventDefault(); act('lookup','');
  });
  bridge.onSessionChange(() => {
    immersive?.destroy(); immersive=null; immersiveOpening=false;
    epoch++; myGeneration++; spots = null; history = null; achievements = null; share = null;
    recorded.clear(); catalogAt = 0; myAt = 0; loadJob = null; myJob = null;
    commerceShops = null; commerceProducts = null; commerceMe = null; commerceOrders = null;
    showcase = null; showcaseState = 'idle'; demoShops = null; walletBalance = undefined;
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
  else loadShowcase();
  return { resume() { app.cityReturn = false; load(); if (page === 'home') loadShowcase(); } };
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
