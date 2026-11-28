'use strict';
/* 3Dのお店（THE FIELD STORE）に、公式ショップの11品を置く（10/30 オーナーから、Claude デザインで作成）。
   - 11品それぞれが、決まった場所に置かれ、正面から見て選べる（押すと商品の説明が出る）
   - 値札はサーバーの値（EMUER）
   - ハロウィンの飾りは 11/1 にオーナーの判断で外した
   本物のサーバーにはつながない（商品の一覧は backend/official-shop-products.json から作る）。 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '../../frontend/public');
const raw = require('../../backend/official-shop-products.json');
const PRODUCTS = (raw.products || raw).map(p => ({ id: p.id, name: p.name, prices: { EMUER: p.priceEmuer ?? p.price } }));
const page = (products) => `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%}canvas{width:100vw;height:100vh;display:block}</style>
<canvas id="c"></canvas><script type="module">
import { createWorld } from '/schoolpark/city-world.js';
window.selected = [];
// カメラを動かしたら、描き直してから（次の絵で）真ん中を選ぶ。人が押すときと同じ
window.pickAfterFocus = id => new Promise(r => { window.selected = []; window.w.focusProduct(id);
  requestAnimationFrame(() => requestAnimationFrame(() => { window.w.selectCenter(); r(window.selected); })); });
window.w = createWorld(document.getElementById('c'), { products: ${JSON.stringify(products)}, onSelect: id => window.selected.push(id) });
</script>`;

/* 3Dのお店の画面（city-shop.js）。サーバーの代わりに、公式ショップの商品を返す（画像あり・1品だけ画像なし）。 */
const SHOP_PRODUCTS = PRODUCTS.map((p, i) => ({ ...p, description: 'せつめい', remaining: 10, methods: ['emuer_ledger'],
  ...(i === 0 ? {} : { imageUrl: '/schoolpark/shop/official/' + (raw.products || raw)[i].image }) }));
const shopPage = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><script type="module">
import { openShopWorld } from '/schoolpark/city-shop.js';
localStorage.setItem('sp-city-view', window.__VIEW || 'first'); localStorage.setItem('sp-city-weather', window.__WEATHER || 'clear');
openShopWorld({ spots: [], wantedShop: 'schoolpark-official', bridge: {
  getShops: async () => ({ shops: [{ id: 'field-store', name: 'THE FIELD STORE', subtitle: '', status: 'demo', products: [] }], partnerSlots: [], goal: '' }),
  getCommerceShops: async () => ({ shops: [{ id: 'schoolpark-official', storeType: 'schoolpark_virtual', name: 'SchoolPark公式仮想店舗' }] }),
  getCommerceProducts: async () => ({ products: ${JSON.stringify(SHOP_PRODUCTS)} })
} });
</script></body>`;

let server, base, browser;
/* 11/28：商品・遊ぶ・行き先は右上の「⋯」の中 */
async function openMenu(pg) { if (await pg.locator('.cs-menu').isHidden()) await pg.click('[data-shop="menu"]'); }
before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/t/official') return res.end(page(PRODUCTS));
    if (url.pathname === '/t/shop') return res.end(shopPage);
    const file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end(); }
    res.setHeader('content-type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.webp') ? 'image/webp' : file.endsWith('.css') ? 'text/css' : 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
});
after(async () => { await browser?.close(); server?.close(); });

async function open(p) {
  const pg = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const errors = [], requests = [];
  pg.on('pageerror', e => errors.push(e.message));
  pg.on('request', r => requests.push(new URL(r.url()).pathname));
  await pg.goto(base + p);
  await pg.waitForFunction(() => document.getElementById('c').dataset.ready === 'true', null, { timeout: 60000 });
  return { pg, errors, requests };
}

test('公式ショップの11品が、それぞれの場所に置かれ、正面から見て選べる', async () => {
  const { pg, errors, requests } = await open('/t/official');
  try {
    // マイCityの部屋の道具（11/25 追加）は、3Dのお店には模型を置かない。一覧から選ぶ
    const models = PRODUCTS.filter(p => !p.id.startsWith('official-room-'));
    assert.equal(models.length, 11);
    for (const p of models) {
      const got = await pg.evaluate(id => window.pickAfterFocus(id), p.id);
      assert.deepEqual(got, [p.id], p.name + ' を正面から選べる');
    }
    // 商品の絵柄は、お店の中の画像を使う（外のサイトには行かない）
    await pg.waitForTimeout(500);
    // （ステッカーとアクリルキーホルダーは、冷蔵庫くんを模型の側で描くので画像を使わない）
    const images = [...new Set(requests.filter(r => r.startsWith('/schoolpark/shop/official/')))];
    assert.equal(images.length, 9, '画像を使う9品');
    for (const img of images) assert.ok(fs.existsSync(path.join(ROOT, img)), img + ' がある');
    // ハロウィンの飾りは 11/1 にオーナーの判断で外した。お店に残っていないこと
    assert.equal(await pg.evaluate(() => document.getElementById('c').dataset.halloween), undefined);
    assert.equal(requests.some(r => r.includes('halloween')), false);
    assert.deepEqual(errors, []);
  } finally { await pg.close(); }
});

test('商品を選ぶと、右の説明に商品の写真を出す（写真の無い商品は 🎁）', async () => {
  const pg = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  pg.on('pageerror', e => errors.push(e.message));
  try {
    await pg.goto(base + '/t/shop');
    await pg.waitForSelector('.cs-canvas[data-ready="true"]', { timeout: 60000 });
    await openMenu(pg); await pg.click('.cs-menu [data-shop="products"]');
    await pg.click('[data-shop="product"][data-value="official-can-badge-v1"]');
    const img = pg.locator('.cs-panel .cs-product-photo img');
    await img.waitFor();
    assert.equal(await img.getAttribute('src'), '/schoolpark/shop/official/09_shop_canbadge.webp');
    assert.match(await img.getAttribute('alt'), /缶バッジ/);
    await pg.waitForFunction(() => document.querySelector('.cs-panel .cs-product-photo img')?.naturalWidth > 0);
    assert.equal(await pg.locator('.cs-panel .cs-product-mark').count(), 0, '🎁 は出さない');
    assert.equal(await pg.evaluate(() => document.querySelector('.cs-panel').scrollTop), 0, '一覧の下のほうから開いても、説明は上から見せる');
    await pg.click('[data-shop="panel-close"]');
    await openMenu(pg); await pg.click('.cs-menu [data-shop="products"]');
    await pg.click('[data-shop="product"][data-value="' + PRODUCTS[0].id + '"]');
    await pg.locator('.cs-panel .cs-product-mark').waitFor();
    assert.match(await pg.textContent('.cs-panel .cs-product-mark'), /🎁/);
    assert.deepEqual(errors, []);
  } finally { await pg.close(); }
});

/* 11/28 オーナー：「上の文字とかは削除 ←Cityだけ表示」「下の文字とかも削除」「右下に丸形のスティック」 */
test('スマホ：画面に出るのは「← City」「⋯」と右下のスティックだけ。メニューは画面に収まる。商品の一覧は番号と EMUER の値段', async () => {
  for (const width of [360, 390, 412]) {
    const ctx = await browser.newContext({ viewport: { width, height: 800 }, isMobile: true, hasTouch: true });
    const pg = await ctx.newPage();
    try {
      await pg.goto(base + '/t/shop');
      await pg.waitForSelector('.cs-canvas[data-ready="true"]', { timeout: 60000 });
      const shown = await pg.evaluate(() => [...document.querySelectorAll('#city-explorer button, #city-explorer h2, #city-explorer p, #city-explorer footer')].filter(e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden').map(e => e.textContent.trim()));
      assert.deepEqual(shown, ['← City', '⋯'], `${width}px: 上と下の文字は出さない（${JSON.stringify(shown)}）`);
      assert.equal(await pg.locator('.cs-controls, .cs-place, .cs-brand, .cs-plaza').count(), 0);
      const stick = await pg.locator('.cs-stick').boundingBox();
      assert.ok(stick && stick.x + stick.width <= width && stick.x > width / 2 && stick.y > 800 / 2, `${width}px: スティックは右下 ${JSON.stringify(stick)}`);
      await pg.click('[data-shop="menu"]');
      const menu = await pg.evaluate(() => { const m = document.querySelector('.cs-menu').getBoundingClientRect(); return { l: m.left, r: m.right, b: m.bottom, over: [...document.querySelectorAll('.cs-menu button')].filter(b => b.getClientRects().length && b.scrollWidth > b.clientWidth + 1 && !b.closest('.cs-menu-grid')).map(b => b.textContent) }; });
      assert.ok(menu.l >= 0 && menu.r <= width && menu.b <= 800, `${width}px: メニューが画面に収まる ${JSON.stringify(menu)}`);
      assert.deepEqual(menu.over, [], '文字がはみ出さない');
      await pg.click('.cs-menu [data-shop="products"]');
      assert.equal(await pg.locator('.cs-menu').isHidden(), true, '商品を開いたらメニューは閉じる');
      const rows = await pg.$$eval('.cs-products button', bs => bs.map(b => b.textContent.replace(/\s+/g, ' ').trim()));
      assert.match(rows[0], /^01冷蔵庫くん/);
      assert.match(rows[10], /^11/);
      assert.ok(rows.every(r => /\d+ EMUER/.test(r)), '値段は EMUER（「店舗でご確認ください」ではない）');
    } finally { await ctx.close(); }
  }
});

/* 11/28 オーナー：「右下に丸形のスティック(ゲームとかにあるやつ) 走る場合は、さらに奥にやると走る」「アバターの追加」
   「リアルタイム天気の同期と、カスタム天候の追加」。 */
test('スティック：内側で歩き、外側の輪まで倒すと走る。離すと止まる。アバター視点・天気（リアル／選ぶ）を切り替えられる', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true });
  /* リアルの天気：外の天気APIの代わりに「雪・3℃」を返す。送るのは決まった緯度・経度だけ */
  const asked = [];
  await ctx.route('https://api.open-meteo.com/**', route => { asked.push(route.request().url()); route.fulfill({ json: { current: { weather_code: 73, temperature_2m: 2.6 } } }); });
  await ctx.addInitScript(() => { window.__VIEW = 'third'; window.__WEATHER = 'rain'; });
  const pg = await ctx.newPage();
  const errors = []; pg.on('pageerror', e => errors.push(e.message));
  try {
    await pg.goto(base + '/t/shop');
    await pg.waitForSelector('.cs-canvas[data-ready="true"]', { timeout: 60000 });
    assert.equal(await pg.getAttribute('.cs-canvas', 'data-view'), 'third', 'アバター視点');
    assert.equal(await pg.getAttribute('.cs-canvas', 'data-weather'), 'rain', '選んだ天気（雨）');
    const pos = async () => JSON.parse(await pg.getAttribute('.cs-canvas', 'data-position'));
    const box = await pg.locator('.cs-stick').boundingBox(), cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    const send = (type, x, y) => pg.locator('.cs-stick').dispatchEvent(type, { pointerId: 5, pointerType: 'touch', button: 0, clientX: x, clientY: y });
    /* 少し倒す：歩く */
    const start = await pos();
    await send('pointerdown', cx, cy); await send('pointermove', cx, cy - box.width * .22);
    await pg.waitForFunction(() => document.querySelector('.cs-canvas').dataset.pace === 'walk', null, { timeout: 10000 });
    assert.equal(await pg.locator('.cs-stick.is-run').count(), 0);
    /* 外側まで倒す：走る */
    await send('pointermove', cx, cy - box.width * .6);
    await pg.waitForFunction(() => document.querySelector('.cs-canvas').dataset.pace === 'run', null, { timeout: 10000 });
    assert.equal(await pg.locator('.cs-stick.is-run').count(), 1, '走っている印');
    await send('pointerup', cx, cy - box.width * .6);
    await pg.waitForFunction(() => document.querySelector('.cs-canvas').dataset.pace === 'stop', null, { timeout: 10000 });
    const end = await pos();
    assert.ok(Math.hypot(end.x - start.x, end.z - start.z) > .5, '前へ進んだ ' + JSON.stringify([start, end]));
    const still = await pos(); await pg.waitForTimeout(400); const later = await pos();
    assert.ok(Math.hypot(later.x - still.x, later.z - still.z) < .02, '離すと止まる');
    /* 天気：リアル（福岡のいまの天気）→ 雪。メニューに「いまの福岡：雪 3℃」 */
    await openMenu(pg);
    await pg.click('.cs-menu [data-shop="weather"][data-value="real"]');
    await pg.waitForFunction(() => document.querySelector('.cs-canvas').dataset.weather === 'snow', null, { timeout: 10000 });
    assert.equal(await pg.textContent('.cs-weather-now'), 'いまの福岡：雪 3℃');
    assert.equal(asked.length, 1);
    const url = new URL(asked[0]);
    assert.deepEqual([...url.searchParams.keys()].sort(), ['current', 'latitude', 'longitude', 'timezone'], '送るのは決まった場所と、ほしい項目だけ');
    assert.equal(url.searchParams.get('latitude'), '33.59');
    assert.equal(await pg.evaluate(() => localStorage.getItem('sp-city-weather')), 'real', '選んだ天気を覚える');
    await pg.click('.cs-menu [data-shop="weather"][data-value="storm"]');
    assert.equal(await pg.getAttribute('.cs-canvas', 'data-weather'), 'storm');
    assert.equal(await pg.getAttribute('.cs-menu [data-value="storm"]', 'aria-pressed'), 'true');
    /* 視点：一人称へ */
    await pg.click('.cs-menu [data-shop="view"][data-value="first"]');
    assert.equal(await pg.getAttribute('.cs-canvas', 'data-view'), 'first');
    assert.equal(await pg.evaluate(() => localStorage.getItem('sp-city-view')), 'first');
    /* メニューの外に触れると閉じる */
    await pg.touchscreen.tap(60, 770);
    assert.equal(await pg.locator('.cs-menu').isHidden(), true);
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test('リアルの天気：天気コードの読み替えと、30分の記憶と、読めないとき（晴れのまま）', async () => {
  const m = await import(path.join(ROOT, 'schoolpark/city-weather.js'));
  assert.deepEqual([0, 1, 2, 3, 45, 48, 51, 61, 65, 80, 71, 75, 85, 95, 99, 'x'].map(m.weatherFromCode),
    ['clear', 'clear', 'cloudy', 'cloudy', 'fog', 'fog', 'rain', 'rain', 'rain', 'rain', 'snow', 'snow', 'snow', 'storm', 'storm', 'clear']);
  const mem = new Map(), storage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  let calls = 0;
  const ok = async () => { calls++; return { ok: true, json: async () => ({ current: { weather_code: 61, temperature_2m: 14.4 } }) }; };
  const first = await m.fetchRealWeather({ fetchImpl: ok, storage, now: 1000 });
  assert.deepEqual({ kind: first.kind, temp: first.temp, place: first.place }, { kind: 'rain', temp: 14, place: '福岡' });
  await m.fetchRealWeather({ fetchImpl: ok, storage, now: 1000 + 60 * 1000 });
  assert.equal(calls, 1, '30分は同じ答えを使う');
  await m.fetchRealWeather({ fetchImpl: ok, storage, now: 1000 + 31 * 60 * 1000 });
  assert.equal(calls, 2);
  assert.equal(await m.fetchRealWeather({ fetchImpl: async () => { throw new Error('offline'); }, storage: null }), null, '読めないときは null（画面は晴れ）');
  assert.equal(await m.fetchRealWeather({ fetchImpl: async () => ({ ok: false }), storage: null }), null);
});

/* 11/21 オーナー：公式店舗と THE FIELD STORE は切り替えずに1つの街に。THE FIELD STORE は公式店舗のとなりに置く。
   City の遊び（ECHO FIELD など）は、公式仮想店舗の中の「遊ぶ」からも開ける。 */
const FIELD = [{ id: 'field-note', name: '探究ノート', description: 'のーと', kind: 'notebook', color: '#b3794f', priceJPY: 1200, priceLabel: '展示用の参考価格', checkoutEnabled: false, paymentMethods: [] },
  { id: 'field-mug', name: 'ひと息のマグ', description: 'まぐ', kind: 'mug', color: '#355a48', priceJPY: 1800, priceLabel: '展示用の参考価格', checkoutEnabled: false, paymentMethods: [] }];
const unifiedPage = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><script type="module">
import { openShopWorld } from '/schoolpark/city-shop.js';
window.played = [];
localStorage.setItem('sp-city-view', window.__VIEW || 'first'); localStorage.setItem('sp-city-weather', window.__WEATHER || 'clear');
openShopWorld({ spots: [], wantedShop: 'schoolpark-official', onPlay: id => { window.played.push(id); }, bridge: {
  getShops: async () => ({ shops: [{ id: 'field-store', name: 'THE FIELD STORE', subtitle: '学びと暮らしの、小さなお店。', status: 'demo', products: ${JSON.stringify(FIELD)} }], partnerSlots: [], goal: '' }),
  getCommerceShops: async () => ({ shops: [{ id: 'schoolpark-official', storeType: 'schoolpark_virtual', name: 'SchoolPark公式仮想店舗' }] }),
  getCommerceProducts: async () => ({ products: ${JSON.stringify(SHOP_PRODUCTS)} })
} });
</script></body>`;

test('公式店舗と THE FIELD STORE を1つにまとめる（切り替えなし・となりに並ぶ）。店の中から遊べる', async () => {
  const origin = server.listeners('request')[0];
  server.removeAllListeners('request');
  server.on('request', (req, res) => (new URL(req.url, 'http://x').pathname === '/t/unified' ? res.end(unifiedPage) : origin(req, res)));
  const pg = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = []; pg.on('pageerror', e => errors.push(e.message));
  try {
    await pg.goto(base + '/t/unified');
    await pg.waitForSelector('.cs-canvas[data-ready="true"]', { timeout: 60000 });
    /* 11/28：画面の文字は出さない。どこにいるかは読み上げの名前に残す */
    assert.equal(await pg.getAttribute('#city-explorer', 'aria-label'), 'SchoolPark City（SchoolPark公式仮想店舗とTHE FIELD STOREが並ぶ街）', 'この空間そのものが City');
    await openMenu(pg); await pg.click('.cs-menu [data-shop="products"]');
    const panel = await pg.textContent('.cs-panel');
    assert.match(panel, /となりのお店：THE FIELD STORE/, '一覧に、となりのお店の品もまとめて出る');
    assert.match(panel, /探究ノート/);
    assert.equal(await pg.locator('.cs-panel [data-shop="shop"]').count(), 0, '店を切り替えるボタンは置かない');
    /* となりのお店の品を開くと、その店の説明（展示品）になる。公式の品を開くと EMUER の交換になる */
    await pg.click('.cs-panel [data-shop="product"][data-value="field-note"]');
    assert.match(await pg.textContent('.cs-panel'), /THE FIELD STORE[\s\S]*これは展示品です/);
    await pg.click('.cs-panel [data-shop="products"]');
    await pg.click(`.cs-panel [data-shop="product"][data-value="${SHOP_PRODUCTS[1].id}"]`);
    assert.match(await pg.textContent('.cs-panel'), /EMUERで交換する/);
    /* THE FIELD STORE に入れる（公式店舗と同じ大きさの店が右どなりに建っている） */
    await pg.click('.cs-panel [data-shop="products"]');
    await pg.click('.cs-panel [data-shop="waypoint"][data-value="neighbor"]');
    assert.equal(await pg.locator('.cs-panel').isHidden(), true);
    /* 遊ぶ：4つの遊びが出て、押すと City の遊びを開く */
    await openMenu(pg); await pg.click('.cs-menu [data-shop="plays"]');
    assert.equal(await pg.locator('.cs-panel [data-shop="play"]').count(), 4);
    await pg.click('.cs-panel [data-shop="play"][data-value="echo"]');
    await pg.click('.cs-panel [data-shop="play"][data-value="elevator"]');
    assert.deepEqual(await pg.evaluate(() => window.played), ['echo', 'elevator']);
    assert.deepEqual(errors, []);
  } finally { await pg.close(); server.removeAllListeners('request'); server.on('request', origin); }
});

test('3D：THE FIELD STORE は公式店舗と同じ大きさで右どなりに建ち、店の中の台の品を正面から選べる', async () => {
  const pg = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const errors = []; pg.on('pageerror', e => errors.push(e.message));
  try {
    await pg.goto(base + '/t/official');
    await pg.waitForFunction(() => document.getElementById('c').dataset.ready === 'true', null, { timeout: 60000 });
    await pg.evaluate(fields => { window.w.destroy(); window.selected = [];
      /* 一度使った canvas は描けなくなる（WebGL を手放している）ので、新しい canvas にする */
      const old = document.getElementById('c'), fresh = document.createElement('canvas'); fresh.id = 'c'; old.replaceWith(fresh);
      return import('/schoolpark/city-world.js').then(m => { window.w = m.createWorld(fresh, {
        products: [], sideProducts: fields, mainSign: 'SCHOOLPARK OFFICIAL STORE', sideSign: 'THE FIELD STORE', onSelect: id => window.selected.push(id) }); }); }, FIELD);
    await pg.waitForFunction(() => document.getElementById('c').dataset.ready === 'true', null, { timeout: 60000 });
    for (const p of FIELD) assert.deepEqual(await pg.evaluate(id => window.pickAfterFocus(id), p.id), [p.id], p.name + ' を THE FIELD STORE の中で選べる');
    /* 入口へ行ける（右どなりの店の中まで歩いて入れる大きさがある） */
    await pg.evaluate(() => window.w.waypoint('neighbor'));
    const pos = JSON.parse(await pg.evaluate(() => document.getElementById('c').dataset.position));
    assert.ok(pos.x > 12 && pos.x < 15, 'THE FIELD STORE の入口（x≒13.5）にいる ' + JSON.stringify(pos));
    assert.deepEqual(errors, []);
  } finally { await pg.close(); }
});

/* 11/26 オーナー：City の中に遊ぶ場所を作る（ゲームセンターのような所）。近づいたらボタンが出て遊べる。
   下の「あそび場」で前まで行く → 「あそび場で遊ぶ」が出る → 押すと4つの遊び。ゲーム機を正面から選ぶと、そのゲームが開く。
   離れるとボタンは消える。お試し表示（遊びが無い）では建てない。 */
test('あそび場（ゲームセンター）：近づくと「あそび場で遊ぶ」が出て、ゲーム機を選ぶとそのゲームが開く', async () => {
  const origin = server.listeners('request')[0];
  server.removeAllListeners('request');
  server.on('request', (req, res) => (new URL(req.url, 'http://x').pathname === '/t/unified' ? res.end(unifiedPage) : origin(req, res)));
  const pg = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = []; pg.on('pageerror', e => errors.push(e.message));
  try {
    await pg.goto(base + '/t/unified');
    await pg.waitForSelector('.cs-canvas[data-ready="true"]', { timeout: 60000 });
    assert.equal(await pg.locator('.cs-arcade').isHidden(), true, '最初（街の通り）では出ない');
    await openMenu(pg); await pg.click('.cs-menu [data-shop="waypoint"][data-value="arcade"]');
    await pg.waitForSelector('.cs-canvas[data-near="arcade"]', { timeout: 20000 });
    await pg.locator('.cs-arcade').waitFor({ state: 'visible' });
    assert.match(await pg.textContent('.cs-arcade'), /あそび場で遊ぶ/);
    await pg.screenshot({ path: path.join(process.env.CITY_QA_DIR || require('os').tmpdir(), 'city-arcade-1280.png') });
    /* 押すと4つの遊び。パネルが出ているあいだはボタンを隠す */
    await pg.click('.cs-arcade');
    assert.equal(await pg.locator('.cs-panel [data-shop="play"]').count(), 4);
    assert.match(await pg.textContent('.cs-panel'), /ECHO FIELD[\s\S]*林檎の方程式/);
    assert.equal(await pg.locator('.cs-arcade').isHidden(), true);
    await pg.click('.cs-panel [data-shop="play"][data-value="echo"]');
    await pg.click('.cs-panel [data-shop="panel-close"]');
    await pg.locator('.cs-arcade').waitFor({ state: 'visible' });
    /* 正面のゲーム機（林檎の方程式）を選ぶ：真ん中のボタンが「… で遊ぶ」になり、押すとそのゲームが開く */
    await pg.locator('.cs-pick').waitFor({ state: 'visible', timeout: 20000 });
    assert.equal(await pg.textContent('.cs-pick'), '林檎の方程式 で遊ぶ ↗');
    await pg.click('.cs-pick');
    assert.deepEqual(await pg.evaluate(() => window.played), ['echo', 'ringo']);
    /* 離れると消える */
    await openMenu(pg); await pg.click('.cs-menu [data-shop="waypoint"][data-value="entrance"]');
    await pg.waitForSelector('.cs-canvas[data-near=""]', { timeout: 20000 });
    assert.equal(await pg.locator('.cs-arcade').isHidden(), true);
    assert.deepEqual(errors, []);
  } finally { await pg.close(); server.removeAllListeners('request'); server.on('request', origin); }
});

/* 11/28 オーナー：旧SchoolParkの「願いの泉」を City の広場のまんなかで。朝・昼・夜で変わる。
   夜は太鼓：願いを書く → 太鼓を叩く → 花火 → 「あなたの願いが叶いますように！」。朝・昼は願いが空へのぼる。
   書いた願いはどこにも送らない。 */
for (const time of ['night', 'morning']) test(`願いの泉（${time}）：置物に近づくとボタンが出て、願いを書いて届けると「叶いますように！」。願いはどこにも送らない`, async () => {
  const origin = server.listeners('request')[0];
  server.removeAllListeners('request');
  server.on('request', (req, res) => (new URL(req.url, 'http://x').pathname === '/t/unified' ? res.end(unifiedPage) : origin(req, res)));
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true });
  await ctx.addInitScript(t => { window.__SP_CITY_TIME = t; }, time);
  const sent = [];
  ctx.on('request', r => { if (r.method() !== 'GET' || decodeURIComponent(r.url()).includes('楽しく学べ') || (r.postData() || '').includes('楽しく学べ')) sent.push(r.url()); });
  const pg = await ctx.newPage();
  const errors = []; pg.on('pageerror', e => errors.push(e.message));
  try {
    await pg.goto(base + '/t/unified');
    await pg.waitForSelector('.cs-canvas[data-ready="true"]', { timeout: 60000 });
    assert.equal(await pg.locator('.cs-wish').isHidden(), true, '最初（街の通り）では出ない');
    await openMenu(pg); await pg.click('.cs-menu [data-shop="waypoint"][data-value="wish"]');
    await pg.waitForSelector('.cs-canvas[data-near="wish"]', { timeout: 20000 });
    await pg.locator('.cs-wish').waitFor({ state: 'visible' });
    assert.match(await pg.textContent('.cs-wish'), time === 'night' ? /太鼓に願いを書く/ : /願いの泉に願いを書く/);
    await pg.click('.cs-wish');
    await pg.fill('.cs-wish-input', 'みんなと楽しく学べますように');
    assert.equal(await pg.textContent('[data-shop="wish-go"]'), time === 'night' ? '🥁 太鼓を叩く' : '🌠 願いを届ける');
    await pg.click('[data-shop="wish-go"]');
    assert.equal(await pg.getAttribute('.cs-canvas', 'data-wish'), 'playing');
    await pg.locator('.cs-wish-msg').waitFor({ state: 'visible', timeout: 20000 });
    assert.equal(await pg.textContent('.cs-wish-msg'), 'あなたの願いが\n叶いますように！');
    assert.equal(await pg.getAttribute('.cs-canvas', 'data-wish'), 'done');
    assert.deepEqual(sent, [], '願いはどこにも送らない');
    /* 空の願いは届けない */
    await pg.click('.cs-wish'); await pg.click('[data-shop="wish-go"]');
    assert.match(await pg.textContent('.cs-toast'), /願いごとを書いてね/);
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); server.removeAllListeners('request'); server.on('request', origin); }
});

test('あそび場：お試し表示（遊びが無い）では建てず、ボタンも出さない', async () => {
  const { pg, errors } = await open('/t/official');
  try {
    await pg.evaluate(() => window.w.waypoint('arcade'));
    await pg.waitForTimeout(600);
    assert.notEqual(await pg.evaluate(() => document.getElementById('c').dataset.near), 'arcade');
    assert.deepEqual(errors, []);
  } finally { await pg.close(); }
});
