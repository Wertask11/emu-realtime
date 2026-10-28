/* City をわかりやすくした画面（10/28）。
   入口を「公式ショップ／街のお店／3Dの街」の3つにし、公式ショップの商品をトップに並べ、
   街のお店に 3D の展示店（THE FIELD STORE）と出店の案内を出す。
   ここでは、その約束が守られているかを本物の dao.html と City で確かめる。
   みてみる（/api/mitemiru）は試験用の返事。本番のアカウントやお金は使わない。 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { startFixture } = require('./city-3d-fixture.cjs');

const SHOPS = { ok: true, shops: [
  { id: 'schoolpark-official', name: 'SchoolPark公式仮想店舗', emoji: '🏫', storeType: 'schoolpark_virtual', description: '公式' },
  { id: 'cafe-nagi', name: 'カフェ 凪', emoji: '☕', storeType: 'real_partner', description: '本と珈琲', address: '東京都渋谷区 1-2-3', paymentGuide: 'レジで円・JPYC' },
  { id: 'old-shop', name: '昔のお店', storeType: 'legacy' }] };
const PRODUCTS = [
  { id: 'sticker', shopId: 'schoolpark-official', storeType: 'schoolpark_virtual', name: '冷蔵庫くんステッカー', prices: { EMUER: 1 }, methods: ['emuer_ledger'], remaining: null, fulfillment: 'その場でダウンロード' },
  { id: 'note', shopId: 'schoolpark-official', storeType: 'schoolpark_virtual', name: '探究ノート', prices: { EMUER: 30 }, methods: ['emuer_ledger'], remaining: 12 },
  { id: 'coffee', shopId: 'cafe-nagi', storeType: 'real_partner', name: '探究ブレンド', prices: { JPY: 600, JPYC: 600 }, methods: [], remaining: null }];
const ME = { ok: true, isOwner: false, emuer: { ok: false, error: 'PLAN_REQUIRED', unconverted: '42' } };
const ORDERS = { ok: true, orders: [
  { id: 'o1', productName: '探究ノート', amount: 30, currency: 'EMUER', status: 'paid', pickupCode: 'K7Q2MX', createdAt: Date.parse('2026-10-27T10:00:00Z') },
  { id: 'o2', productName: '冷蔵庫くんステッカー', amount: 1, currency: 'EMUER', status: 'fulfilled', pickupCode: 'P3RT8A', createdAt: Date.parse('2026-10-20T10:00:00Z') }] };

let fixture, browser;
before(async () => {
  fixture = await startFixture();
  browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
});
after(async () => { await browser?.close(); await fixture?.close(); });

async function open(width = 390, { products = PRODUCTS, shopsFail = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width < 700 });
  const calls = [], errors = [];
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.hostname === 'emu-realtime.onrender.com') {
      calls.push(url.pathname);
      const json = body => route.fulfill({ json: body, headers: { 'Access-Control-Allow-Origin': '*' } });
      if (url.pathname === '/api/mitemiru/shops') return shopsFail ? route.fulfill({ status: 503, json: { error: 'X' }, headers: { 'Access-Control-Allow-Origin': '*' } }) : json(SHOPS);
      if (url.pathname === '/api/mitemiru/products') { const id = url.searchParams.get('shopId'); return json({ ok: true, products: products.filter(p => !id || p.shopId === id) }); }
      if (url.pathname === '/api/mitemiru/me') return json(ME);
      if (url.pathname === '/api/mitemiru/orders') return json(ORDERS);
      const r = await fetch(fixture.base + url.pathname, { method: req.method(), headers: req.headers(), body: req.postData() || undefined });
      return route.fulfill({ status: r.status, body: await r.text(), contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' } });
    }
    if (url.hostname === 'emu-for-schoolpark.vercel.app') { calls.push(url.href); return route.fulfill({ body: '<!doctype html><title>Emu</title>', contentType: 'text/html' }); }
    if (url.origin !== fixture.base) return route.abort();
    return route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(fixture.base + '/test/parent');
  const frame = page.frames().find(f => f.url().endsWith('/schoolpark/dao.html'));
  await frame.waitForFunction(() => window.app?.state.me.name === 'テスト用Passport');
  if (width >= 700 && !(await frame.getByText('08', { exact: true }).filter({ visible: true }).count())) await frame.getByTitle('サイドバーを開く', { exact: true }).click();
  await frame.getByText('08', { exact: true }).filter({ visible: true }).click();
  await frame.locator('.city-doors').waitFor();
  const text = () => frame.locator('#sp-city').innerText();
  return { page, frame, calls, errors, text, close: () => context.close() };
}

test('トップは3つの入口と、公式ショップの商品。残高（/me）は読まない', async () => {
  const f = await open();
  try {
    const doors = await f.frame.locator('.city-door b').allInnerTexts();
    assert.deepEqual(doors, ['公式ショップ', '街のお店', '3Dの街を歩く']);
    await f.frame.locator('.city-product').first().waitFor();
    assert.deepEqual(await f.frame.locator('.city-product b').allInnerTexts(), ['冷蔵庫くんステッカー', '探究ノート'], '公式ショップの商品だけを並べる');
    assert.equal(f.calls.some(p => p.endsWith('/me')), false, 'トップでは自分の記録を読まない');
    assert.match(await f.text(), /出店の相談をする/);
    assert.equal(await f.frame.getByRole('button', { name: '3Dの街へ入る ↗', exact: true }).count(), 1);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('商品が無ければ「これから並びます」。読めなくてもページ全体の失敗にはしない', async () => {
  let f = await open(390, { products: [] });
  try {
    await f.frame.getByText('商品はこれから並びます。新しい商品が入ったら、ここに出ます。').waitFor();
  } finally { await f.close(); }
  f = await open(390, { shopsFail: true });
  try {
    await f.frame.getByText(/商品を読み込めませんでした/).waitFor();
    assert.equal(await f.frame.locator('[role="alert"]').count(), 0, 'トップの商品が読めないだけで警告を出さない');
  } finally { await f.close(); }
});

test('トップの商品から開いて、交換できない理由を分かる言葉で出す', async () => {
  const f = await open();
  try {
    await f.frame.locator('.city-product[data-value="note"]').click();
    await f.frame.getByText('あなたの使えるEMUER: 42 EMUER').waitFor();
    const t = await f.text();
    assert.match(t, /Light・Plus・Pro プランで使えます/);
    assert.equal(await f.frame.getByRole('button', { name: 'EMUERで交換する', exact: true }).isDisabled(), true);
    assert.doesNotMatch(t, /PLAN_REQUIRED|未変換|既存のEMUER注文処理/);
  } finally { await f.close(); }
});

test('公式ショップ：残高、商品、使い方', async () => {
  const f = await open(1440);
  try {
    await f.frame.locator('.city-door[data-value="commerce"]').click();
    await f.frame.locator('.city-wallet').waitFor();
    const t = await f.text();
    assert.match(t, /42 EMUER/);
    assert.match(t, /EMUERをためる[\s\S]*商品と交換する[\s\S]*受け取る/);
    assert.equal(await f.frame.locator('.city-section .city-card').count(), 2);
    assert.doesNotMatch(t, /みてみるデータ|Camellia|SchoolPark公式仮想店舗/);
  } finally { await f.close(); }
});

test('街のお店：提携店と 3D の展示店と出店の案内。昔の店（legacy）は出さない', async () => {
  const f = await open();
  try {
    await f.frame.locator('.city-door[data-value="partners"]').click();
    await f.frame.getByText('THE FIELD STORE').waitFor();
    const t = await f.text();
    assert.match(t, /カフェ 凪/); assert.match(t, /東京都渋谷区 1-2-3/);
    assert.doesNotMatch(t, /昔のお店/);
    assert.match(t, /EMUERは使えません/);
    assert.equal(await f.frame.locator('[data-action="walk"][data-value="field-store"]').count(), 1, '3Dで入る');
    assert.equal(await f.frame.locator('.city-join [data-action="contact"]').count(), 1);
  } finally { await f.close(); }
});

test('交換履歴の状態は日本語で出し、引換コードを見せる', async () => {
  const f = await open();
  try {
    await f.frame.locator('.city-nav [data-value="orders"]').click();
    await f.frame.getByText('K7Q2MX').waitFor();
    const statuses = await f.frame.locator('.city-order-status').allInnerTexts();
    assert.deepEqual(statuses, ['受け取り待ち · 引換コードを受付で見せてください', '受け取り済み']);
    assert.doesNotMatch(await f.text(), /\bpaid\b|\bfulfilled\b|既存みてみる注文|Passport ID/);
  } finally { await f.close(); }
});

test('出店の相談は、Emu の画面が無ければ同じフォームを別のタブで開く', async () => {
  const f = await open();
  try {
    const popup = f.page.context().waitForEvent('page');
    await f.frame.locator('.city-join [data-action="contact"]').click();
    const opened = await popup;
    await opened.waitForLoadState();
    const asked = f.calls.find(u => u.startsWith('https://emu-for-schoolpark.vercel.app/'));
    assert.ok(asked, 'お問い合わせのフォームを開いていない');
    assert.equal(new URL(asked).searchParams.get('contact'), 'general');
    await opened.close();
  } finally { await f.close(); }
});
