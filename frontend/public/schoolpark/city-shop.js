import { cityTime, CITY_TIME_LABEL, cityDay, citySeason } from './city-time.js';
import { fetchRealWeather, WEATHER_KINDS, WEATHER_LABEL, WEATHER_ICON } from './city-weather.js';
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = product => Number.isSafeInteger(product.priceJPY) ? '¥'+product.priceJPY.toLocaleString('ja-JP') : '価格は店舗でご確認ください';
const glyph = kind => ({notebook:'01',mug:'02',tote:'03',coffee:'04'}[kind] || '—');

/* 11/21 オーナー：公式店舗と THE FIELD STORE は切り替えずに1つの街にまとめる。
   手前の建物が SchoolPark 公式店舗（公式ショップの品）、右どなりに同じ大きさの THE FIELD STORE（展示品は店の中の台）。
   商品の一覧も、店ごとに分けて1つにまとめて出す（店の切り替えボタンは置かない）。
   この3Dの空間そのものが City。遊び（ECHO FIELD など）も、上の「遊ぶ」から開ける（onPlay）。City のトップには置かない。
   11/26 オーナー：街の中に遊ぶ場所（あそび場＝ゲームセンター）を作る。近づくと「あそび場で遊ぶ」が出る。
   ゲーム機をタップすると、そのゲームが開く。下の「あそび場」で、その前まで行ける。 */
/* 11/28 オーナー：「右下に丸形のスティック。さらに奥にやると走る」「上の文字は削除、← City だけ表示」「下の文字も削除」
   「リアルタイム天気の同期と、カスタム天候」「アバターの追加」。
   画面に出すのは「← City」と、右上の小さな「⋯」（行き先・商品・遊ぶ・天気・視点・Passport をまとめた入れ物）だけ。
   スマホは右下に丸いスティック。外側まで倒すと走る。視点と天気は、この端末に覚えておく。 */
const store={get(k){try{return localStorage.getItem(k);}catch(_){return null;}},set(k,v){try{localStorage.setItem(k,v);}catch(_){}}};
/* 11/28 オーナー：旧SchoolParkの「願いの泉」を、City の広場のまんなかの置物で。朝・昼・夜で変わる */
const WISH_TEXT={
  morning:{place:'願いの泉',button:'⛲ 願いの泉に願いを書く',title:'願いの泉',lead:'噴水に願いを書くと、光になって空へのぼっていきます。',go:'🌠 願いを届ける'},
  day:{place:'願いのクリスタル',button:'💎 クリスタルに願いを書く',title:'願いのクリスタル',lead:'浮かぶクリスタルに願いを書くと、光になって空へのぼっていきます。',go:'🌠 願いを届ける'},
  night:{place:'やぐらの太鼓',button:'🥁 太鼓に願いを書く',title:'やぐらの太鼓',lead:'願いを書いて太鼓を叩くと、音とともに花火が上がります。',go:'🥁 太鼓を叩く'}
};
/* 12/31 は「年越しの願い」。夜は除夜の鐘を鳴らす（11/28 オーナー：12月の挑戦納めカレンダー） */
const NEWYEAR_WISH={
  morning:{place:'年越しの願いの泉',button:'⛲ 年越しの願いを書く',title:'年越しの願い',lead:'来年の願いを書くと、光になって空へのぼっていきます。今年もおつかれさまでした。',go:'🌠 願いを届ける'},
  day:{place:'年越しの願いのクリスタル',button:'💎 年越しの願いを書く',title:'年越しの願い',lead:'来年の願いを書くと、光になって空へのぼっていきます。今年もおつかれさまでした。',go:'🌠 願いを届ける'},
  night:{place:'除夜の鐘',button:'🔔 年越しの願いを書く',title:'年越しの願い・除夜の鐘',lead:'来年の願いを書いて鐘を鳴らすと、除夜の鐘とともに花火が上がります。今年もおつかれさまでした。',go:'🔔 鐘を鳴らす'}
};
const PLAYS=[['echo','ECHO FIELD','記憶・配置戦略・心理戦で遊ぶ。'],['ringo','林檎の方程式','手札のカードを使い、交渉を進める。'],['gods','日常の神々','神々のカードをCPUと同時に公開して勝負。'],['elevator','エレベーター','階を巡り、これまでの発見を続ける。']];
export function openShopWorld({bridge,spots,wantedShop='',preview=false,onClose=()=>{},onMyCity=()=>{},onRecord=()=>{},onPlay=null}) {
  if(!document.querySelector('link[data-city-shop-style]')){
    const css=document.createElement('link');css.rel='stylesheet';css.href='/schoolpark/city-shop.css';css.dataset.cityShopStyle='';document.head.appendChild(css);
  }
  const priorFocus=document.activeElement,abort=new AbortController(),root=document.createElement('section');
  const listener={signal:abort.signal};
  let world=null,shop=null,main=null,side=null,catalog=null,selected=null,closed=false,busy=false,request=0,loadNumber=0;
  /* その品がどの店のものか（公式店舗・となりのお店・街のお店） */
  function ownerOf(id){return (catalog?.shops||[]).find(s=>s.products?.some(p=>p.id===id))||null;}
  const time=cityTime(),timeLabel=CITY_TIME_LABEL[time],season=citySeason(cityDay());
  const wishText=(season==='newyear'?NEWYEAR_WISH:WISH_TEXT)[time];
  root.id='city-explorer';root.dataset.time=time;root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');root.setAttribute('aria-label','SchoolPark City 3Dショールーム');
  let viewPref=store.get('sp-city-view')==='first'?'first':'third';
  let weatherPref=WEATHER_KINDS.includes(store.get('sp-city-weather'))?store.get('sp-city-weather'):'real',realWeather=null;
  const chip=(action,value,label,on)=>`<button type="button" data-shop="${action}" data-value="${value}" aria-pressed="${on}">${label}</button>`;
  root.innerHTML=`<canvas class="cs-canvas" tabindex="0" aria-label="3DのCity。床をタップして移動、スワイプで見回し、右下のスティックでも歩けます。"></canvas>
    <div class="cs-wash" aria-hidden="true"></div>
    <header class="cs-top"><button type="button" data-shop="close" class="cs-exit">← City</button><button type="button" class="cs-more" data-shop="menu" aria-label="メニュー" aria-expanded="false" aria-controls="cs-menu">⋯</button></header>
    <div class="cs-load" role="status"><span class="cs-spinner"></span>Cityの扉を開いています…</div>
    <div class="cs-aim" aria-hidden="true">+</div><button class="cs-pick" type="button" data-shop="pick" hidden></button>
    <button class="cs-arcade" type="button" data-shop="arcade" hidden>🎮 あそび場で遊ぶ</button>
    <button class="cs-wish" type="button" data-shop="wish" hidden>${wishText.button}</button>
    <div class="cs-wish-msg" role="status" hidden></div>
    <div class="cs-toast" role="status" hidden></div>
    <nav class="cs-menu" id="cs-menu" aria-label="Cityのメニュー" hidden>
      <div class="cs-menu-row"><button type="button" data-shop="products">商品を見る</button>${onPlay&&!preview?'<button type="button" data-shop="plays">遊ぶ</button>':''}<button type="button" data-shop="help">歩き方</button></div>
      <p class="cs-menu-h">行き先</p>
      <div class="cs-menu-grid"><button type="button" data-shop="waypoint" data-value="entrance">入店する ↗</button><button type="button" data-shop="waypoint" data-value="shelves">商品棚</button><button type="button" data-shop="waypoint" data-value="counter">カウンター</button>${onPlay&&!preview?'<button type="button" data-shop="waypoint" data-value="arcade">あそび場</button>':''}<button type="button" data-shop="waypoint" data-value="plaza">${timeLabel.plaza}</button><button type="button" data-shop="waypoint" data-value="wish">${wishText.place}</button><button type="button" data-shop="waypoint" data-value="neighbor" hidden>となりのお店</button></div>
      <p class="cs-menu-h">天気 <small class="cs-weather-now"></small></p>
      <div class="cs-chips" data-group="weather">${WEATHER_KINDS.map(k=>chip('weather',k,WEATHER_ICON[k]+' '+WEATHER_LABEL[k],k===weatherPref)).join('')}</div>
      <p class="cs-menu-h">視点</p>
      <div class="cs-chips" data-group="view">${chip('view','third','🧍 アバター',viewPref==='third')}${chip('view','first','👀 一人称',viewPref==='first')}</div>
      <button type="button" class="cs-passport" data-shop="checkin">Passport <b>チェックイン</b></button>
    </nav>
    <div class="cs-stick" aria-hidden="true"><span class="cs-stick-run">RUN</span><div class="cs-stick-knob"></div></div>
    <aside class="cs-panel" hidden></aside>`;
  document.body.appendChild(root);
  let canvas=root.querySelector('canvas');
  const panel=root.querySelector('.cs-panel'),load=root.querySelector('.cs-load');
  const pick=root.querySelector('.cs-pick'),toast=root.querySelector('.cs-toast'),arcade=root.querySelector('.cs-arcade');
  const menu=root.querySelector('.cs-menu'),more=root.querySelector('.cs-more'),stick=root.querySelector('.cs-stick'),knob=root.querySelector('.cs-stick-knob');
  let focusedProduct=null,toastTimer=null,nearArcade=false,nearWish=false,wishing=false;
  const wishButton=root.querySelector('.cs-wish'),wishMessage=root.querySelector('.cs-wish-msg');
  function showWish(){wishButton.hidden=!(nearWish&&panel.hidden&&!wishing&&!nearArcade);}
  function wishPanel(){
    const w=wishText;selected=null;request++;
    showPanel(`<p class="cs-kicker">WISH / 願いごと</p><h3>${esc(w.title)}</h3><p>${esc(w.lead)}</p>
      <textarea class="cs-wish-input" maxlength="60" rows="3" aria-label="願いごと" placeholder="願いごとを書いてね（60字まで）"></textarea>
      <p class="cs-caption">書いた願いは、この画面に映すだけです。どこにも送らず、残しません。</p>
      <button type="button" class="cs-primary" data-shop="wish-go">${esc(w.go)}</button>`);
    panel.querySelector('.cs-wish-input')?.focus({preventScroll:true});
  }
  function sendWish(){
    const text=String(panel.querySelector('.cs-wish-input')?.value||'').trim();
    if(!text){say('願いごとを書いてね。');return;}
    if(!world||wishing)return;
    closePanel();wishing=true;showWish();
    world.makeWish(text).then(ok=>{
      wishing=false;showWish();if(!ok||closed)return;
      wishMessage.textContent=season==='newyear'?'よいお年を！\nあなたの願いが叶いますように！':'あなたの願いが\n叶いますように！';wishMessage.hidden=false;
      clearTimeout(wishMessage._t);wishMessage._t=setTimeout(()=>{wishMessage.hidden=true;},4500);
    });
  }
  function openMenu(open){menu.hidden=!open;more.setAttribute('aria-expanded',String(open));if(open){menu.scrollTop=0;resetStick();}}
  function markChips(group,value){root.querySelectorAll(`[data-group="${group}"] [data-value]`).forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.value===value)));}
  function setView(mode){viewPref=mode==='first'?'first':'third';store.set('sp-city-view',viewPref);markChips('view',viewPref);world?.setView(viewPref);root.dataset.view=viewPref;}
  async function setWeather(kind){
    weatherPref=WEATHER_KINDS.includes(kind)?kind:'real';store.set('sp-city-weather',weatherPref);markChips('weather',weatherPref);
    const now=root.querySelector('.cs-weather-now');
    if(weatherPref!=='real'){world?.setWeather(weatherPref);now.textContent='';return;}
    /* 12/24・25 は、リアルを選んでいても City は雪（クリスマス） */
    if(season==='xmas'){world?.setWeather('snow');now.textContent='🎄 クリスマスは City に雪が降ります';return;}
    world?.setWeather(realWeather?.kind||'clear');now.textContent=realWeather?`いまの${realWeather.place}：${WEATHER_LABEL[realWeather.kind]}${realWeather.temp==null?'':' '+realWeather.temp+'℃'}`:'福岡の天気を読み込み中…';
    const result=realWeather||await fetchRealWeather();
    if(closed||weatherPref!=='real')return;
    if(!result){now.textContent='天気を読めませんでした（晴れで表示）';world?.setWeather('clear');return;}
    realWeather=result;world?.setWeather(result.kind);now.textContent=`いまの${result.place}：${WEATHER_LABEL[result.kind]}${result.temp==null?'':' '+result.temp+'℃'}`;
  }
  /* 右下のスティック。内側は歩く（倒した分だけ）、外側の輪まで倒すと走る */
  let stickId=null;
  function resetStick(){stickId=null;knob.style.transform='';stick.classList.remove('is-run','is-on');world?.setJoystick(0,0,false);}
  stick.addEventListener('pointerdown',e=>{if(!world||!panel.hidden)return;e.preventDefault();openMenu(false);stickId=e.pointerId;try{stick.setPointerCapture(e.pointerId);}catch{}stick.classList.add('is-on');moveStick(e);},listener);
  function moveStick(e){
    const r=stick.getBoundingClientRect(),R=r.width*.3,dx=e.clientX-(r.left+r.width/2),dy=e.clientY-(r.top+r.height/2),d=Math.hypot(dx,dy)||1;
    const run=d>R*1.25,travel=Math.min(d,R*(run?1.45:1.25)),k=Math.min(1,d/R);
    knob.style.transform=`translate(${dx/d*travel}px,${dy/d*travel}px)`;
    if(run!==stick.classList.contains('is-run')){stick.classList.toggle('is-run',run);if(run)try{navigator.vibrate?.(12);}catch{}}
    world?.setJoystick(dx/d*k,dy/d*k,run);
  }
  stick.addEventListener('pointermove',e=>{if(e.pointerId===stickId)moveStick(e);},listener);
  for(const type of ['pointerup','pointercancel','lostpointercapture'])stick.addEventListener(type,e=>{if(e.pointerId===stickId)resetStick();},listener);
  /* メニューの外（3Dの画面）に触れたら、メニューを閉じる */
  root.addEventListener('pointerdown',e=>{if(!menu.hidden&&!e.target.closest('.cs-menu,.cs-more'))openMenu(false);},{...listener,capture:true});
  const playable=!!onPlay&&!preview;
  const playTitle=id=>(PLAYS.find(p=>p[0]===id)||[])[1]||'';
  /* ゲーム機（'play:<id>'）は商品と同じ仕組みで選ばれる */
  const playOf=id=>String(id||'').startsWith('play:')?String(id).slice(5):'';
  function showArcade(){arcade.hidden=!(playable&&nearArcade&&panel.hidden);}
  function play(id){if(!playable||!playTitle(id))return;Promise.resolve().then(()=>onPlay(id)).catch(()=>say('開けませんでした。もう一度お試しください。'));}
  function say(message){clearTimeout(toastTimer);toast.textContent=message;toast.hidden=false;toastTimer=setTimeout(()=>{toast.hidden=true;},6000);}
  function showPanel(html){openMenu(false);resetStick();wishButton.hidden=true;panel.innerHTML=`<button type="button" class="cs-panel-close" data-shop="panel-close" aria-label="商品パネルを閉じる">×</button>${html}`;panel.scrollTop=0;panel.hidden=false;world?.pause(true);pick.hidden=true;showArcade();panel.querySelector('button')?.focus({preventScroll:true});}
  function closePanel(){request++;busy=false;panel.hidden=true;panel.innerHTML='';selected=null;world?.pause(false);showArcade();showWish();world?.focus();}
  function destroy(){if(closed)return;closed=true;request++;loadNumber++;abort.abort();clearTimeout(toastTimer);world?.destroy();world=null;root.remove();priorFocus?.isConnected&&priorFocus.focus?.({preventScroll:true});onClose();}
  function productPanel(id){
    if(playOf(id)){play(playOf(id));return;}
    const owner=ownerOf(id);if(owner)shop=owner;
    const product=shop?.products.find(p=>p.id===id);if(!product)return;request++;busy=false;selected=product;world?.focusProduct(id);
    if(shop.storeType==='schoolpark_virtual'){
      const canExchange=product.methods?.includes('emuer_ledger')&&product.remaining!==0;
      /* 商品の写真（公式ショップの画像）。無い商品だけ 🎁 */
      const photo=product.imageUrl?`<figure class="cs-product-photo"><img src="${esc(product.imageUrl)}" alt="${esc(product.name)}" loading="lazy"></figure>`:'<div class="cs-product-mark"><span>🎁</span></div>';
      showPanel(`<p class="cs-kicker">${esc(shop.name)} / EMUER STORE</p>${photo}
        <h3>${esc(product.name)}</h3><p>${esc(product.description)}</p><div class="cs-price">${esc(product.prices?.EMUER??'価格未設定')} EMUER</div>
        <p class="cs-caption">在庫：${product.remaining==null?'制限なし':esc(product.remaining)} · 交換条件と引渡しは登録済みの商品情報を確認してください。</p>
        <button type="button" class="cs-primary" data-shop="exchange" ${canExchange?'':'disabled'}>EMUERで交換する</button>
        <p class="cs-caption">${canExchange?'交換を確定すると、既存みてみるAPIの注文・在庫・EMUER処理を利用します。':product.remaining===0?'在庫がありません。':'交換機能停止中、または利用条件を確認できません。'}</p>
        <button type="button" class="cs-secondary" data-shop="products">ほかの商品を見る</button>`);return;
    }
    if(shop.storeType==='real_partner'){
      showPanel(`<p class="cs-kicker">${esc(shop.name)} / REAL PARTNER</p><h3>${esc(product.name)}</h3><p>${esc(product.description)}</p>
        <p>円：${product.prices?.JPY==null?'店舗へ確認':'¥'+Number(product.prices.JPY).toLocaleString('ja-JP')} · JPYC：${product.prices?.JPYC==null?'店舗へ確認':esc(product.prices.JPYC)}</p>
        <p class="cs-caption">EMUERは利用できません。決済・最終価格・在庫は店舗へ確認してください。Reji連携は仕様確認中で、Cityは決済完了を判定しません。</p>
        <button type="button" class="cs-secondary" data-shop="products">ほかの商品を見る</button>`);return;
    }
    showPanel(`<p class="cs-kicker">${esc(shop.name)} / ${shop.status==='live'?'SHOP':'SHOWROOM'}</p><div class="cs-product-mark" style="--product-color:${/^#[0-9a-f]{6}$/i.test(product.color)?product.color:'#355a48'}"><span>${glyph(product.kind)}</span><b>${esc(product.kind.toUpperCase())}</b></div>
      <h3>${esc(product.name)}</h3><p>${esc(product.description)}</p><div class="cs-price">${esc(money(product))}<small>${esc(product.priceLabel)}</small></div>
      ${product.checkoutEnabled?`<p class="cs-caption">支払い方法：${product.paymentMethods.map(esc).join(' / ')}</p><button type="button" class="cs-primary" data-shop="checkout">購入手続きへ</button><p class="cs-caption">販売・決済・受取は出店店舗が担当します。</p>`:`<button type="button" class="cs-primary" disabled>販売準備中</button><p class="cs-caption">${shop.status==='demo'?'これは展示品です。実際の注文・支払いは発生しません。':'店舗の決済準備が整い次第、購入できます。'}</p>`}
      <button type="button" class="cs-secondary" data-shop="products">ほかの商品を見る</button>`);
  }
  function productRows(store){
    return `<div class="cs-products">${store.products.map((p,i)=>`<button type="button" data-shop="product" data-value="${esc(p.id)}"><span class="cs-product-number">${store.storeType==='schoolpark_virtual'?String(i+1).padStart(2,'0'):glyph(p.kind)}</span><span><b>${esc(p.name)}</b><small>${esc(store.storeType==='schoolpark_virtual'?(p.priceLabel||money(p)):money(p))}${store.status==='demo'?' / 参考価格':''}</small></span><span>↗</span></button>`).join('')}</div>`;
  }
  function productsPanel(){
    if(!main){say('店舗の読み込みをお待ちください。');return;}
    selected=null;request++;
    const others=(catalog.shops||[]).filter(s=>s!==main&&s!==side&&s.products?.length);
    showPanel(`<p class="cs-kicker">COLLECTION / ${main.products.length} ITEMS</p><h3>${esc(main.name)}の商品</h3><p>棚やテーブルの商品を、直接選ぶこともできます。</p>${productRows(main)}
      ${side?`<h3>となりのお店：${esc(side.name)}</h3><p>${esc(side.subtitle||'')}</p>${productRows(side)}<button type="button" class="cs-secondary" data-shop="waypoint" data-value="neighbor">${esc(side.name)}に入る</button>`:''}
      ${others.map(o=>`<h3>${esc(o.name)}</h3>${productRows(o)}`).join('')}
      <p class="cs-caption">${esc(catalog.goal)}</p><div class="cs-partners">${catalog.partnerSlots.map(p=>`<div><span>${esc(p.name)}</span><b>${p.status==='live'?'連携店舗':'出店準備中'}</b></div>`).join('')}</div>${preview?'':'<button type="button" class="cs-secondary" data-shop="mycity">MY CITYで記録を見る</button>'}`);
  }
  /* 遊ぶ・探索する（City のトップと同じゲーム・保存状態で開く） */
  function playsPanel(){
    selected=null;request++;
    showPanel(`<p class="cs-kicker">GAME CENTER / あそび場</p><h3>Cityで遊ぶ</h3><p>これまでと同じゲーム・保存状態で開きます。利用条件と遊べる回数は現在のプランに従います。あそび場のゲーム機を直接タップしても遊べます。</p>
      <div class="cs-products">${PLAYS.map(([id,title,note],i)=>`<button type="button" data-shop="play" data-value="${id}"><span class="cs-product-number">${String(i+1).padStart(2,'0')}</span><span><b>${esc(title)}</b><small>${esc(note)}</small></span><span>↗</span></button>`).join('')}</div>`);
  }
  function help(){showPanel(`<p class="cs-kicker">HOW TO EXPLORE</p><h3>行きたい場所を、選ぶだけ。</h3><dl class="cs-help"><dt>移動する</dt><dd>スマートフォンは右下のスティックで歩きます。外側の輪まで倒すと走ります。床をタップしても、そこまで歩きます。PCは床をクリック、またはWASD（Shiftで走る）。</dd><dt>周囲を見る</dt><dd>画面をドラッグ／スワイプします。スワイプしただけでは移動しません。</dd><dt>商品を見る</dt><dd>商品を直接クリック／タップします。</dd>${playable?'<dt>願いごと</dt><dd>広場のまんなかの置物（朝は噴水・昼はクリスタル・夜はやぐらの太鼓）に近づくと、願いを書けます。「⋯」の行き先からも行けます。</dd><dt>遊ぶ</dt><dd>「⋯」の「あそび場」で、ゲームセンターの前まで行けます。近づくと「あそび場で遊ぶ」が出ます。ゲーム機をタップしても遊べます。</dd>':''}<dt>迷ったら</dt><dd>右上の「⋯」の「行き先」から場所を選べます。天気（いまの福岡の天気・晴れ・雨・雪など）と視点（アバター・一人称）も「⋯」で変えられます。</dd></dl><button type="button" class="cs-primary" data-shop="panel-close">歩いてみる</button>`);}
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
  async function exchange(){
    if(shop?.storeType!=='schoolpark_virtual'||!selected||busy)return;
    const product=selected,version=++request;busy=true;
    const button=panel.querySelector('[data-shop="exchange"]');if(button){button.disabled=true;button.textContent='交換条件を確認しています…';}
    try{
      const me=await bridge.getCommerceMe();
      if(!me.emuer?.ok)throw new Error(me.emuer?.error||'EMUER_NOT_ACTIVE');
      if(!product.methods?.includes('emuer_ledger'))throw new Error('METHOD_NOT_AVAILABLE');
      const requestId=(crypto.randomUUID?.()||`${Date.now()}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g,'').slice(0,80);
      const result=await bridge.placeCommerceOrder(product.id,requestId);
      if(closed||version!==request)return;
      showPanel(`<p class="cs-kicker">ORDER / 交換受付</p><h3>${esc(product.name)}</h3><p>${result.already?'交換注文はすでに受け付け済みです。':'既存のEMUER交換処理で注文を受け付けました。'}</p><div class="cs-price">引換コード<br><b>${esc(result.order?.pickupCode||'履歴で確認')}</b></div><p>運営者にこのコードを提示してください。商品のお渡しは運営者の確認後に記録されます。</p><button type="button" class="cs-primary" data-shop="products">商品へ戻る</button>`);
    }catch(e){if(!closed&&version===request){const reason={INSUFFICIENT_EMUER:'利用可能なEMUERが不足しています。',PERIOD_LIMIT_REACHED:'プランの交換回数上限に達しています。',SOLD_OUT:'在庫がなくなりました。',PASSPORT_LINK_REQUIRED:'Passport IDを連携してください。',EMUER_NOT_ACTIVE:'EMUER交換機能は停止中です。'}[e.message]||'交換できませんでした。Passport・残高・プラン条件を確認してください。';say(reason);if(button){button.disabled=false;button.textContent='EMUERで交換する';}}}
    finally{busy=false;}
  }
  async function checkin(){
    const spot=spots.find(s=>s.spotId===(main?.checkinSpotId||side?.checkinSpotId)),button=root.querySelector('[data-shop="checkin"]');
    if(!spot||button.disabled)return;button.disabled=true;
    try{const result=await bridge.checkIn(spot);if(closed)return;onRecord(spot,result);say(result.alreadyRecorded?'今日のチェックインは記録済みです。':'Passportに3Dショールームの訪問を記録しました。');button.innerHTML='Passport <b>✓ 記録済み</b>';}
    catch(_){if(!closed)say('記録できませんでした。通信を確認して、もう一度お試しください。');}
    finally{if(!closed)button.disabled=false;}
  }
  root.addEventListener('click',e=>{
    const b=e.target.closest('[data-shop]');if(!b||b.disabled)return;
    const action=b.dataset.shop,value=b.dataset.value;
    if(action==='menu'){openMenu(menu.hidden);return;}
    if(action==='weather'){setWeather(value);return;}
    if(action==='view'){setView(value);return;}
    if(action!=='checkin')openMenu(false);
    if(action==='close')destroy();else if(action==='products')productsPanel();else if(action==='product')productPanel(value);
    else if(action==='plays'||action==='arcade')playsPanel();else if(action==='wish')wishPanel();else if(action==='wish-go')sendWish();else if(action==='play')play(value);
    else if(action==='panel-close')closePanel();else if(action==='help')help();else if(action==='checkout')checkout();
    else if(action==='exchange')exchange();
    else if(action==='waypoint'){closePanel();world?.waypoint(value);world?.focus();root.dataset.location=value;}
    else if(action==='pick'&&focusedProduct)productPanel(focusedProduct);else if(action==='checkin')checkin();
    else if(action==='retry')init();else if(action==='mycity'){destroy();onMyCity();}
    else if(action==='shop'){wantedShop=value;closePanel();init();}
  },listener);
  root.addEventListener('keydown',e=>{
    if(e.key==='Escape'){e.preventDefault();if(!menu.hidden){openMenu(false);more.focus();}else panel.hidden?destroy():closePanel();}
    if(e.key==='Tab'){
      const scope=!panel.hidden?panel:!menu.hidden?menu:root,items=[...scope.querySelectorAll('button:not(:disabled),a[href],canvas[tabindex]')].filter(el=>el.getClientRects().length);
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
    /* 呼べない口（お試しページには getCommerceShops が無い）で止まらないよう、どれも失敗として受け止める（11/3 点検 5） */
    const call=(name,...a)=>Promise.resolve().then(()=>bridge[name](...a));
    const [data,module,commerce]=await Promise.allSettled([call('getShops'),import('./city-world.js'),call('getCommerceShops')]);
    if(closed||version!==loadNumber)return;
    if(data.status!=='fulfilled'||!data.value.shops?.length){load.innerHTML='店舗を読み込めませんでした。<button type="button" data-shop="retry">もう一度読み込む</button>';return;}
    catalog=data.value;
    if(commerce.status==='fulfilled'){
      const rows=commerce.value.shops||[];
      const official=rows.find(s=>s.storeType==='schoolpark_virtual');
      if(official){
        try{const products=await bridge.getCommerceProducts(official.id);official.products=(products.products||[]).map(p=>({...p,kind:'notebook',color:'#355a48',priceJPY:null,priceLabel:`${p.prices?.EMUER??'—'} EMUER`,checkoutEnabled:false}));}
        catch(_){official.products=[];}
        official.status='live';official.subtitle=official.description||'EMUER専用商品交換';catalog.shops.unshift(official);
      }
      for(const partner of rows.filter(s=>s.storeType==='real_partner')){
        let items=[];try{const result=await bridge.getCommerceProducts(partner.id);items=(result.products||[]).map(p=>({...p,kind:'notebook',color:'#355a48',priceJPY:p.prices?.JPY??null,priceLabel:'店舗へ確認',checkoutEnabled:false}));}catch(_){items=[];}
        catalog.shops.push({...partner,status:'live',subtitle:partner.address||'リアル提携店舗',products:items,checkinSpotId:''});
      }
    }
    /* 手前は公式店舗（無ければ、頼まれた店か最初の店）。THE FIELD STORE は、そのとなりに並べる */
    main=catalog.shops.find(s=>s.storeType==='schoolpark_virtual')||catalog.shops.find(s=>s.id===wantedShop)||catalog.shops[0];
    side=main.id!=='field-store'?catalog.shops.find(s=>s.id==='field-store')||null:null;
    shop=main;
    /* この空間そのものが City（11/21 オーナー）。題名は店の名前ではなく「SchoolPark City」にして、並んでいるお店を添える */
    /* 画面の文字は出さない（11/28）。どこにいるかは、読み上げの名前にだけ残す */
    root.setAttribute('aria-label',side?`SchoolPark City（${main.name}と${side.name}が並ぶ街）`:`SchoolPark City（${main.name}）`);
    const neighbor=root.querySelector('[data-shop="waypoint"][data-value="neighbor"]');neighbor.hidden=!side;if(side)neighbor.textContent=side.name;
    if(preview){const b=root.querySelector('[data-shop="checkin"]');b.disabled=true;b.innerHTML='操作プレビュー <b>記録・購入なし</b>';}
    try{
      if(module.status!=='fulfilled')throw module.reason;
      world=module.value.createWorld(canvas,{products:main.products,sideProducts:side?.products||[],
        mainSign:main.storeType==='schoolpark_virtual'?'SCHOOLPARK OFFICIAL STORE':main.name,sideSign:side?.name||'',
        time,season,view:viewPref,plays:playable?PLAYS.map(([id,title])=>[id,title]):[],onSelect:productPanel,onFocus:id=>{
        focusedProduct=id;
        const game=playable&&playTitle(playOf(id));
        const p=game?null:ownerOf(id)?.products.find(p=>p.id===id);pick.hidden=!(p||game)||!panel.hidden;
        if(game)pick.textContent=game+' で遊ぶ ↗';else if(p)pick.textContent=p.name+' を見る ↗';
      },onNear:where=>{nearArcade=where==='arcade';nearWish=where==='wish';showArcade();showWish();},onLost:()=>{load.hidden=false;load.innerHTML='3D描画が中断しました。<button type="button" data-shop="retry">再開する</button>';}});
      load.hidden=true;root.dataset.view=viewPref;root.dataset.season=season;setWeather(weatherPref);world.focus();
      if(season==='toji')say('🌙 今日は冬至。願いの泉で、今年の挑戦をふり返ってみませんか。');
      else if(season==='xmas')say('🎄 メリークリスマス！ お店の前にツリーが立っています。');
      else if(season==='newyear')say('🎍 今日は大晦日。広場で年越しの願いを書けます。');
    }catch(_){load.innerHTML='この端末では3D表示を利用できません。<button type="button" data-shop="products">商品一覧をひらく</button><button type="button" data-shop="retry">3Dを再試行</button>';}
  }
  root.querySelector('[data-shop="close"]').focus({preventScroll:true});init();
  return {destroy};
}
