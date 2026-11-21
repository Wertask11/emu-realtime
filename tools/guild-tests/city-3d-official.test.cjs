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
openShopWorld({ spots: [], wantedShop: 'schoolpark-official', bridge: {
  getShops: async () => ({ shops: [{ id: 'field-store', name: 'THE FIELD STORE', subtitle: '', status: 'demo', products: [] }], partnerSlots: [], goal: '' }),
  getCommerceShops: async () => ({ shops: [{ id: 'schoolpark-official', storeType: 'schoolpark_virtual', name: 'SchoolPark公式仮想店舗' }] }),
  getCommerceProducts: async () => ({ products: ${JSON.stringify(SHOP_PRODUCTS)} })
} });
</script></body>`;

let server, base, browser;
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
    for (const p of PRODUCTS) {
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
    await pg.click('[data-shop="products"]');
    await pg.click('[data-shop="product"][data-value="official-can-badge-v1"]');
    const img = pg.locator('.cs-panel .cs-product-photo img');
    await img.waitFor();
    assert.equal(await img.getAttribute('src'), '/schoolpark/shop/official/09_shop_canbadge.webp');
    assert.match(await img.getAttribute('alt'), /缶バッジ/);
    await pg.waitForFunction(() => document.querySelector('.cs-panel .cs-product-photo img')?.naturalWidth > 0);
    assert.equal(await pg.locator('.cs-panel .cs-product-mark').count(), 0, '🎁 は出さない');
    assert.equal(await pg.evaluate(() => document.querySelector('.cs-panel').scrollTop), 0, '一覧の下のほうから開いても、説明は上から見せる');
    await pg.click('[data-shop="panel-close"]');
    await pg.click('[data-shop="products"]');
    await pg.click('[data-shop="product"][data-value="' + PRODUCTS[0].id + '"]');
    await pg.locator('.cs-panel .cs-product-mark').waitFor();
    assert.match(await pg.textContent('.cs-panel .cs-product-mark'), /🎁/);
    assert.deepEqual(errors, []);
  } finally { await pg.close(); }
});

test('スマホ：下のボタンが Passport の下にもぐらない。商品の一覧は番号と EMUER の値段', async () => {
  for (const width of [360, 390, 412]) {
    const ctx = await browser.newContext({ viewport: { width, height: 800 }, isMobile: true, hasTouch: true });
    const pg = await ctx.newPage();
    try {
      await pg.goto(base + '/t/shop');
      await pg.waitForSelector('.cs-canvas[data-ready="true"]', { timeout: 60000 });
      const boxes = await pg.evaluate(() => [...document.querySelectorAll('.cs-route button, .cs-passport')].map(b => { const r = b.getBoundingClientRect(); return { t: b.textContent.trim(), l: r.left, r: r.right, top: r.top, b: r.bottom, sw: b.scrollWidth, cw: b.clientWidth }; }));
      const passport = boxes.find(b => /Passport/.test(b.t));
      for (const b of boxes.filter(x => x !== passport)) {
        assert.ok(b.r <= passport.l + 0.5, `${width}px: 「${b.t}」が Passport に重なる（${b.r} > ${passport.l}）`);
        assert.ok(b.sw <= b.cw + 1, `${width}px: 「${b.t}」の文字がはみ出す`);
      }
      assert.ok(passport.r <= width, `${width}px: Passport が画面の外`);
      await pg.click('[data-shop="products"]');
      const rows = await pg.$$eval('.cs-products button', bs => bs.map(b => b.textContent.replace(/\s+/g, ' ').trim()));
      assert.match(rows[0], /^01冷蔵庫くん/);
      assert.match(rows[10], /^11/);
      assert.ok(rows.every(r => /\d+ EMUER/.test(r)), '値段は EMUER（「店舗でご確認ください」ではない）');
    } finally { await ctx.close(); }
  }
});

/* 11/21 オーナー：公式店舗と THE FIELD STORE は切り替えずに1つの街に。THE FIELD STORE は公式店舗のとなりに置く。
   City の遊び（ECHO FIELD など）は、公式仮想店舗の中の「遊ぶ」からも開ける。 */
const FIELD = [{ id: 'field-note', name: '探究ノート', description: 'のーと', kind: 'notebook', color: '#b3794f', priceJPY: 1200, priceLabel: '展示用の参考価格', checkoutEnabled: false, paymentMethods: [] },
  { id: 'field-mug', name: 'ひと息のマグ', description: 'まぐ', kind: 'mug', color: '#355a48', priceJPY: 1800, priceLabel: '展示用の参考価格', checkoutEnabled: false, paymentMethods: [] }];
const unifiedPage = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><script type="module">
import { openShopWorld } from '/schoolpark/city-shop.js';
window.played = [];
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
    assert.equal(await pg.textContent('.cs-place h2'), 'SchoolPark City', 'この空間そのものが City');
    assert.match(await pg.textContent('.cs-place p'), /SchoolPark公式仮想店舗とTHE FIELD STOREが並ぶ街/);
    await pg.click('[data-shop="products"]');
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
    await pg.click('[data-shop="plays"]');
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
