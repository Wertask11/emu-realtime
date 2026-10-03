const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = product => Number.isSafeInteger(product.priceJPY) ? '¥'+product.priceJPY.toLocaleString('ja-JP') : '価格は店舗でご確認ください';
const glyph = kind => ({notebook:'01',mug:'02',tote:'03',coffee:'04'}[kind] || '—');

export function openShopWorld({bridge,spots,preview=false,onClose=()=>{},onMyCity=()=>{},onRecord=()=>{}}) {
  if(!document.querySelector('link[data-city-shop-style]')){
    const css=document.createElement('link');css.rel='stylesheet';css.href='/schoolpark/city-shop.css';css.dataset.cityShopStyle='';document.head.appendChild(css);
  }
  const priorFocus=document.activeElement,abort=new AbortController(),root=document.createElement('section');
  const listener={signal:abort.signal};
  let world=null,shop=null,catalog=null,selected=null,closed=false,busy=false,request=0,loadNumber=0,wantedShop='';
  root.id='city-explorer';root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');root.setAttribute('aria-label','SchoolPark City 3Dショールーム');
  root.innerHTML=`<canvas class="cs-canvas" tabindex="0" aria-label="3D店内。行きたい床をクリックまたはタップして移動し、ドラッグまたはスワイプで見回せます。"></canvas>
    <div class="cs-wash" aria-hidden="true"></div>
    <header class="cs-top"><button type="button" data-shop="close" class="cs-exit">← City</button><div class="cs-brand">SchoolPark<span>CITY</span></div><div class="cs-top-actions"><button type="button" data-shop="products">商品を見る</button><button type="button" data-shop="help" aria-label="歩き方">?</button></div></header>
    <div class="cs-place"><span class="cs-kicker">A SMALL STORE. A BIG WORLD.</span><h2>THE FIELD STORE</h2><p>学びと暮らしの、小さなお店。</p><span class="cs-demo">3D SHOWROOM · 展示用店舗</span></div>
    <div class="cs-load" role="status"><span class="cs-spinner"></span>Cityの扉を開いています…</div>
    <div class="cs-aim" aria-hidden="true">+</div><button class="cs-pick" type="button" data-shop="pick" hidden></button>
    <div class="cs-toast" role="status" hidden></div>
    <aside class="cs-panel" hidden></aside>
    <footer class="cs-controls"><div class="cs-route"><p><b>床をクリック / タップして移動</b> · ドラッグ / スワイプで見回す</p><div><button type="button" data-shop="waypoint" data-value="entrance">入店する ↗</button><button type="button" data-shop="waypoint" data-value="shelves">商品棚</button><button type="button" data-shop="waypoint" data-value="counter">カウンター</button></div></div>
      <button type="button" class="cs-passport" data-shop="checkin">Passport<br><b>チェックイン</b></button></footer>`;
  document.body.appendChild(root);
  let canvas=root.querySelector('canvas');
  const panel=root.querySelector('.cs-panel'),load=root.querySelector('.cs-load');
  const pick=root.querySelector('.cs-pick'),toast=root.querySelector('.cs-toast');
  let focusedProduct=null,toastTimer=null;
  function say(message){clearTimeout(toastTimer);toast.textContent=message;toast.hidden=false;toastTimer=setTimeout(()=>{toast.hidden=true;},6000);}
  function showPanel(html){panel.innerHTML=`<button type="button" class="cs-panel-close" data-shop="panel-close" aria-label="商品パネルを閉じる">×</button>${html}`;panel.hidden=false;world?.pause(true);pick.hidden=true;panel.querySelector('button')?.focus({preventScroll:true});}
  function closePanel(){request++;busy=false;panel.hidden=true;panel.innerHTML='';selected=null;world?.pause(false);world?.focus();}
  function destroy(){if(closed)return;closed=true;request++;loadNumber++;abort.abort();clearTimeout(toastTimer);world?.destroy();world=null;root.remove();priorFocus?.isConnected&&priorFocus.focus?.({preventScroll:true});onClose();}
  function productPanel(id){
    const product=shop?.products.find(p=>p.id===id);if(!product)return;request++;busy=false;selected=product;world?.focusProduct(id);
    showPanel(`<p class="cs-kicker">${esc(shop.name)} / ${shop.status==='live'?'SHOP':'SHOWROOM'}</p><div class="cs-product-mark" style="--product-color:${/^#[0-9a-f]{6}$/i.test(product.color)?product.color:'#355a48'}"><span>${glyph(product.kind)}</span><b>${esc(product.kind.toUpperCase())}</b></div>
      <h3>${esc(product.name)}</h3><p>${esc(product.description)}</p><div class="cs-price">${esc(money(product))}<small>${esc(product.priceLabel)}</small></div>
      ${product.checkoutEnabled?`<p class="cs-caption">支払い方法：${product.paymentMethods.map(esc).join(' / ')}</p><button type="button" class="cs-primary" data-shop="checkout">購入手続きへ</button><p class="cs-caption">販売・決済・受取は出店店舗が担当します。</p>`:`<button type="button" class="cs-primary" disabled>販売準備中</button><p class="cs-caption">${shop.status==='demo'?'これは展示品です。実際の注文・支払いは発生しません。':'店舗の決済準備が整い次第、購入できます。'}</p>`}
      <button type="button" class="cs-secondary" data-shop="products">ほかの商品を見る</button>`);
  }
  function productsPanel(){
    if(!shop){say('店舗の読み込みをお待ちください。');return;}
    selected=null;request++;
    showPanel(`<p class="cs-kicker">COLLECTION / ${shop.products.length} ITEMS</p><h3>店内の商品</h3><p>棚やテーブルの商品を、直接選ぶこともできます。</p><div class="cs-products">${shop.products.map(p=>`<button type="button" data-shop="product" data-value="${esc(p.id)}"><span class="cs-product-number">${glyph(p.kind)}</span><span><b>${esc(p.name)}</b><small>${esc(money(p))}${shop.status==='demo'?' / 参考価格':''}</small></span><span>↗</span></button>`).join('')}</div>${catalog.shops.length>1?`<h3>Cityのお店</h3>${catalog.shops.map(s=>`<button type="button" class="cs-secondary" data-shop="shop" data-value="${esc(s.id)}">${esc(s.name)}</button>`).join('')}`:''}<p class="cs-caption">${esc(catalog.goal)}</p><div class="cs-partners">${catalog.partnerSlots.map(p=>`<div><span>${esc(p.name)}</span><b>${p.status==='live'?'連携店舗':'出店準備中'}</b></div>`).join('')}</div>${preview?'':'<button type="button" class="cs-secondary" data-shop="mycity">MY CITYで記録を見る</button>'}`);
  }
  function help(){showPanel('<p class="cs-kicker">HOW TO EXPLORE</p><h3>行きたい場所を、選ぶだけ。</h3><dl class="cs-help"><dt>移動する</dt><dd>PCは床をクリックまたはダブルクリック。スマートフォンは床をタップすると、そこまで歩きます。</dd><dt>周囲を見る</dt><dd>画面をドラッグ／スワイプします。スワイプしただけでは移動しません。</dd><dt>商品を見る</dt><dd>商品を直接クリック／タップします。</dd><dt>迷ったら</dt><dd>「入店する」「商品棚」「カウンター」から場所を選べます。PCではWASDも補助操作として使えます。</dd></dl><button type="button" class="cs-primary" data-shop="panel-close">歩いてみる</button>');}
  async function checkout(){
    if(!selected?.checkoutEnabled||busy)return;
    const product=selected,version=++request;busy=true;const button=panel.querySelector('[data-shop="checkout"]');button.disabled=true;button.textContent='店舗を確認しています…';
    try{
      const result=await bridge.prepareShopCheckout(shop.id,product.id);
      if(closed||version!==request)return;
      const url=new URL(result.url);
      if(url.protocol!=='https:'||url.username||url.password||url.hostname!==result.host)throw Error('INVALID_CHECKOUT');
      showPanel(`<p class="cs-kicker">CHECKOUT / 店舗の決済へ</p><h3>${esc(result.productName)}</h3><p>販売者：${esc(result.merchant.name)}</p><dl class="cs-help"><dt>受取・提供方法</dt><dd>${esc(result.merchant.fulfillment)}</dd><dt>返品・キャンセル</dt><dd>${esc(result.merchant.refundPolicy)}</dd><dt>問い合わせ</dt><dd>${esc(result.merchant.contact)}</dd></dl><p>${esc(result.notice)}</p><a class="cs-primary" href="${esc(url.href)}" target="_blank" rel="noopener noreferrer">店舗の決済へ進む ↗</a><p class="cs-caption">移動先：${esc(url.hostname)}<br>この操作だけでは購入完了になりません。</p><button type="button" class="cs-secondary" data-shop="product" data-value="${esc(product.id)}">商品へ戻る</button>`);
    }catch(e){if(!closed&&version===request){say(e.message==='SHOP_CHECKOUT_NOT_READY'?'この商品の販売準備はまだ完了していません。':'店舗の決済先を確認できませんでした。もう一度お試しください。');button.disabled=false;button.textContent='購入手続きへ';}}
    finally{if(version===request)busy=false;}
  }
  async function checkin(){
    const spot=spots.find(s=>s.spotId===shop?.checkinSpotId),button=root.querySelector('[data-shop="checkin"]');
    if(!spot||button.disabled)return;button.disabled=true;
    try{const result=await bridge.checkIn(spot);if(closed)return;onRecord(spot,result);say(result.alreadyRecorded?'今日のチェックインは記録済みです。':'Passportに3Dショールームの訪問を記録しました。');button.innerHTML='Passport<br><b>✓ 記録済み</b>';}
    catch(_){if(!closed)say('記録できませんでした。通信を確認して、もう一度お試しください。');}
    finally{if(!closed)button.disabled=false;}
  }
  root.addEventListener('click',e=>{
    const b=e.target.closest('[data-shop]');if(!b||b.disabled)return;
    const action=b.dataset.shop,value=b.dataset.value;
    if(action==='close')destroy();else if(action==='products')productsPanel();else if(action==='product')productPanel(value);
    else if(action==='panel-close')closePanel();else if(action==='help')help();else if(action==='checkout')checkout();
    else if(action==='waypoint'){closePanel();world?.waypoint(value);world?.focus();root.dataset.location=value;}
    else if(action==='pick'&&focusedProduct)productPanel(focusedProduct);else if(action==='checkin')checkin();
    else if(action==='retry')init();else if(action==='mycity'){destroy();onMyCity();}
    else if(action==='shop'){wantedShop=value;closePanel();init();}
  },listener);
  root.addEventListener('keydown',e=>{
    if(e.key==='Escape'){e.preventDefault();panel.hidden?destroy():closePanel();}
    if(e.key==='Tab'){
      const scope=panel.hidden?root:panel,items=[...scope.querySelectorAll('button:not(:disabled),a[href],canvas[tabindex]')].filter(el=>el.getClientRects().length);
      const first=items[0],last=items.at(-1);if(!first)return;
      if(e.shiftKey&&(document.activeElement===first||!scope.contains(document.activeElement))){e.preventDefault();last.focus();}
      else if(!e.shiftKey&&(document.activeElement===last||!scope.contains(document.activeElement))){e.preventDefault();first.focus();}
    }
  },listener);
  async function init(){
    const version=++loadNumber;world?.destroy();world=null;load.hidden=false;load.textContent='Cityの扉を開いています…';
    // A disposed/lost WebGL context cannot be reused reliably on the same canvas.
    const fresh=canvas.cloneNode(false);for(const key of Object.keys(fresh.dataset))delete fresh.dataset[key];
    canvas.replaceWith(fresh);canvas=fresh;focusedProduct=null;pick.hidden=true;
    const [data,module]=await Promise.allSettled([bridge.getShops(),import('./city-world.js')]);
    if(closed||version!==loadNumber)return;
    if(data.status!=='fulfilled'||!data.value.shops?.length){load.innerHTML='店舗を読み込めませんでした。<button type="button" data-shop="retry">もう一度読み込む</button>';return;}
    catalog=data.value;shop=catalog.shops.find(s=>s.id===wantedShop)||catalog.shops[0];root.querySelector('.cs-place h2').textContent=shop.name;root.querySelector('.cs-place p').textContent=shop.subtitle;
    root.querySelector('.cs-demo').textContent=preview?'操作プレビュー · 記録・購入なし':shop.status==='live'?'3D SHOP · 出店店舗':'3D SHOWROOM · 展示用店舗';
    if(preview){const b=root.querySelector('[data-shop="checkin"]');b.disabled=true;b.innerHTML='操作プレビュー<br><b>記録・購入なし</b>';}
    try{
      if(module.status!=='fulfilled')throw module.reason;
      world=module.value.createWorld(canvas,{products:shop.products,onSelect:productPanel,onFocus:id=>{
        focusedProduct=id;const p=shop.products.find(p=>p.id===id);pick.hidden=!p||!panel.hidden;if(p)pick.textContent=p.name+' を見る ↗';
      },onLost:()=>{load.hidden=false;load.innerHTML='3D描画が中断しました。<button type="button" data-shop="retry">再開する</button>';}});
      load.hidden=true;world.focus();
    }catch(_){load.innerHTML='この端末では3D表示を利用できません。<button type="button" data-shop="products">商品一覧をひらく</button><button type="button" data-shop="retry">3Dを再試行</button>';}
  }
  root.querySelector('[data-shop="close"]').focus({preventScroll:true});init();
  return {destroy};
}
