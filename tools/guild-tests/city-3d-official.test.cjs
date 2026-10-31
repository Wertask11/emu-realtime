'use strict';
/* 3Dのお店（THE FIELD STORE）に、公式ショップの11品とハロウィンの飾りを置く（10/30 オーナーから、Claude デザインで作成）。
   - 11品それぞれが、決まった場所に置かれ、正面から見て選べる（押すと商品の説明が出る）
   - 値札はサーバーの値（EMUER）
   - ハロウィンは毎年 10/24〜11/1（日本時間）だけ。飾っても、お店の中は歩ける
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
const page = (products, halloween) => `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%}canvas{width:100vw;height:100vh;display:block}</style>
<canvas id="c"></canvas><script type="module">
import { createWorld, isHalloweenSeason } from '/schoolpark/city-world.js';
window.isHalloweenSeason = isHalloweenSeason;
window.selected = [];
// カメラを動かしたら、描き直してから（次の絵で）真ん中を選ぶ。人が押すときと同じ
window.pickAfterFocus = id => new Promise(r => { window.selected = []; window.w.focusProduct(id);
  requestAnimationFrame(() => requestAnimationFrame(() => { window.w.selectCenter(); r(window.selected); })); });
window.w = createWorld(document.getElementById('c'), { products: ${JSON.stringify(products)}, halloween: ${halloween}, onSelect: id => window.selected.push(id) });
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
    if (url.pathname === '/t/official') return res.end(page(PRODUCTS, false));
    if (url.pathname === '/t/halloween') return res.end(page(PRODUCTS, true));
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
    assert.equal(await pg.evaluate(() => document.getElementById('c').dataset.halloween), undefined, '期間の外は飾らない');
    assert.deepEqual(errors, []);
  } finally { await pg.close(); }
});

test('ハロウィン：飾っても、入口から店内へ歩いて入れ、商品も選べる', async () => {
  const { pg, errors } = await open('/t/halloween');
  try {
    assert.equal(await pg.evaluate(() => document.getElementById('c').dataset.halloween), 'true');
    // 入口の前（外）から、入口の真ん中を通って店の中へ
    await pg.evaluate(() => window.w.waypoint('entrance'));
    const pose = () => pg.evaluate(() => JSON.parse(document.getElementById('c').dataset.position || '{}'));
    assert.equal((await pose()).z, 2.6);
    assert.deepEqual(await pg.evaluate(id => window.pickAfterFocus(id), 'official-guild-badge-v1'), ['official-guild-badge-v1']);
    assert.deepEqual(errors, []);
  } finally { await pg.close(); }
});

test('ハロウィンの期間は、毎年 10/24〜11/1（日本時間）', async () => {
  const { pg } = await open('/t/official');
  try {
    const at = s => pg.evaluate(t => window.isHalloweenSeason(Date.parse(t)), s);
    assert.equal(await at('2026-10-23T23:59:00+09:00'), false);
    assert.equal(await at('2026-10-24T00:00:00+09:00'), true);
    assert.equal(await at('2026-10-31T20:00:00+09:00'), true);
    assert.equal(await at('2026-11-01T23:59:00+09:00'), true);
    assert.equal(await at('2026-11-02T00:00:00+09:00'), false);
    assert.equal(await at('2027-10-31T12:00:00+09:00'), true, '来年も');
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
