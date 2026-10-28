/* 公式ショップの受け取り方（10/28 オーナー決定）を、本物の dao.html と City で確かめる。
     - Light は「月1回の楽しみ」と、プランごとの交換回数を出す
     - 物は配送が基本。会場での手渡しを選べる品もある。配送先が揃うまで交換できない
     - 受注生産は締切を出し、過ぎたら交換できない
     - 注意書き（換金できない・転売しない・18歳未満は保護者の同意）
     - 交換履歴：発送準備中／発送済み、配送先、取り消し、デジタルの品のダウンロード
     - 公式ショップと商品を開いた回数だけを送る
     - 運営：配送待ちの一覧と住所、「発送した」、数字
   みてみる（/api/mitemiru）は試験用の返事。本番のアカウントやお金は使わない。 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { startFixture } = require('./city-3d-fixture.cjs');

const DAY = 24 * 60 * 60 * 1000;
const SHOPS = { ok: true, shops: [{ id: 'schoolpark-official', name: 'SchoolPark公式仮想店舗', storeType: 'schoolpark_virtual' }] };
const base = { shopId: 'schoolpark-official', storeType: 'schoolpark_virtual', prices: { EMUER: 30 }, methods: ['emuer_ledger', 'emuer_chain'], remaining: null };
const PRODUCTS = [
  { ...base, id: 'badge', name: 'Guild バッジ', fulfillmentMode: 'ship', orderDeadline: Date.now() + 10 * DAY, orderClosed: false, cancelPolicy: '締切まで取り消せます' },
  { ...base, id: 'keyholder', name: 'アクキー', fulfillmentMode: 'ship_or_pickup', orderDeadline: Date.now() + 10 * DAY, orderClosed: false },
  { ...base, id: 'closed', name: '締切済み', fulfillmentMode: 'ship', orderDeadline: Date.now() - DAY, orderClosed: true },
  { ...base, id: 'wall', name: '壁紙', fulfillmentMode: 'digital', prices: { EMUER: 5 } }
];
const ME = (extra) => ({ ok: true, isOwner: false, wallet: '', emuer: { ok: true, error: null, plan: 'light', used: 0, limit: 1, unconverted: '100' }, ...extra });
const ORDERS = { ok: true, orders: [
  { id: 'o-ship', productName: 'Guild バッジ', amount: 30, currency: 'EMUER', status: 'paid', delivery: 'ship', pickupCode: 'K7Q2MX', createdAt: Date.now(),
    cancellable: true, shipTo: { name: '山田 太郎', postalCode: '819-0001', address: '福岡県福岡市西区小戸1-2-3' } },
  { id: 'o-sent', productName: '缶バッジ', amount: 30, currency: 'EMUER', status: 'fulfilled', delivery: 'ship', pickupCode: 'P3RT8A', createdAt: Date.now() - DAY, shippedAt: Date.now() - DAY,
    shipTo: { name: '山田 太郎', postalCode: '819-0001', address: '福岡県福岡市西区小戸1-2-3' } },
  { id: 'o-wall', productName: '壁紙', amount: 5, currency: 'EMUER', status: 'paid', delivery: 'digital', digitalAvailable: true, digitalFileName: 'reizo-wallpaper-v1.zip', pickupCode: 'W4LL22', createdAt: Date.now() - 2 * DAY }] };

let fixture, browser;
before(async () => { fixture = await startFixture(); browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] }); });
after(async () => { await browser?.close(); await fixture?.close(); });

async function open(width = 390, { me = ME() } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width < 700, acceptDownloads: true });
  const posts = [], errors = [], gets = [];
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.hostname === 'emu-realtime.onrender.com') {
      const json = body => route.fulfill({ json: body, headers: { 'Access-Control-Allow-Origin': '*' } });
      const p = url.pathname;
      if (req.method() === 'POST' && p.startsWith('/api/mitemiru/')) posts.push({ path: p, body: JSON.parse(req.postData() || '{}') });
      else if (p.startsWith('/api/mitemiru/')) gets.push(p + url.search);
      if (p === '/api/mitemiru/shops') return json(SHOPS);
      if (p === '/api/mitemiru/products') return json({ ok: true, products: PRODUCTS });
      if (p === '/api/mitemiru/me') return json(me);
      if (p === '/api/mitemiru/orders' && req.method() === 'POST') return json({ ok: true, order: { id: 'new', status: 'paid' } });
      if (p === '/api/mitemiru/orders') return json(ORDERS);
      if (p === '/api/mitemiru/orders/o-ship/cancel') return json({ ok: true, refunded: true });
      if (p === '/api/mitemiru/orders/o-wall/digital') return route.fulfill({ body: 'PK-zip', contentType: 'application/zip', headers: { 'Access-Control-Allow-Origin': '*' } });
      if (p === '/api/mitemiru/metrics') return json({ ok: true });
      if (p === '/api/mitemiru/admin/products') return json({ ok: true, products: [] });
      if (p === '/api/mitemiru/admin/shipping') return json({ ok: true, orders: [{ id: 'o-ship', productName: 'Guild バッジ', pickupCode: 'K7Q2MX', orderDeadline: Date.now() + DAY,
        shipTo: { name: '山田 太郎', postalCode: '819-0001', address: '福岡県福岡市西区小戸1-2-3', phone: '09012345678' } }] });
      if (p === '/api/mitemiru/admin/orders/o-ship/ship') return json({ ok: true });
      if (p === '/api/mitemiru/admin/metrics') return json({ ok: true, days: 30, total: { shopViews: 40, productViews: 20, exchanges: 5 }, rows: [] });
      const r = await fetch(fixture.base + p, { method: req.method(), headers: req.headers(), body: req.postData() || undefined });
      return route.fulfill({ status: r.status, body: await r.text(), contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' } });
    }
    if (url.origin !== fixture.base) return route.abort();
    return route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.goto(fixture.base + '/test/parent');
  const frame = page.frames().find(f => f.url().endsWith('/schoolpark/dao.html'));
  await frame.waitForFunction(() => window.app?.state.me.name === 'テスト用Passport');
  if (width >= 700 && !(await frame.getByText('08', { exact: true }).filter({ visible: true }).count())) await frame.getByTitle('サイドバーを開く', { exact: true }).click();
  await frame.getByText('08', { exact: true }).filter({ visible: true }).click();
  await frame.locator('.city-doors').waitFor();
  return { page, frame, posts, gets, errors, text: () => frame.locator('#sp-city').innerText(), close: () => context.close() };
}
const openProduct = async (f, id) => { await f.frame.locator(`.city-product[data-value="${id}"]`).click(); await f.frame.locator('.city-wallet').waitFor(); };

test('Light は「月1回の楽しみ」と、プランごとの交換回数を出す', async () => {
  const f = await open();
  try {
    await f.frame.locator('.city-door[data-value="commerce"]').click();
    await f.frame.locator('.city-wallet-count').waitFor();
    const t = await f.text();
    assert.match(t, /Light は月1回の楽しみ。今月はあと1回交換できます。/);
    assert.match(t, /交換できる回数：Light 月1回・Plus 週1回・Pro 回数制限なし/);
    assert.ok(f.posts.some(p => p.path === '/api/mitemiru/metrics' && p.body.event === 'shop_view'), '公式ショップを開いた回数を送る');
  } finally { await f.close(); }
  const pro = await open(390, { me: ME({ emuer: { ok: true, plan: 'pro', used: 0, limit: null, unconverted: '0' } }) });
  try {
    await pro.frame.locator('.city-door[data-value="commerce"]').click();
    await pro.frame.getByText(/Pro は回数の制限がありません。/).waitFor();
  } finally { await pro.close(); }
});

test('配送の品：締切と注意書きを出し、配送先が揃うまで交換できない。揃えたら住所を添えて注文する', async () => {
  const f = await open();
  try {
    await openProduct(f, 'badge');
    const t = await f.text();
    assert.match(t, /ご自宅へ配送します（送料は SchoolPark が負担します）/);
    assert.match(t, /注文の締切:/);
    assert.match(t, /売り買い・譲渡・換金はできません/); assert.match(t, /18歳未満の方は、保護者の同意/);
    assert.match(t, /受け取る前で締切の前なら、交換履歴から取り消せます/);
    assert.ok(f.posts.some(p => p.body.event === 'product_view' && p.body.productId === 'badge'), '商品を見た回数を送る');
    const ledger = f.frame.getByRole('button', { name: 'ウォレットに移す前のEMUERで交換する', exact: true });
    assert.equal(await ledger.isDisabled(), true, '住所が無いうちは押せない');
    await f.frame.getByText('配送先を入れると交換できます。').waitFor();
    await f.frame.getByLabel('お名前').fill('山田 太郎');
    await f.frame.getByLabel('郵便番号（例 819-0001）').fill('819-0001');
    await f.frame.getByLabel('住所').fill('福岡県福岡市西区小戸1-2-3');
    await f.frame.getByLabel('電話番号').fill('090-1234-5678');
    assert.equal(await f.frame.getByLabel('電話番号').inputValue(), '090-1234-5678', '描き直しても、入れた文字は消えない');
    assert.equal(await ledger.isDisabled(), false);
    await ledger.click();
    await f.frame.getByText(/EMUER交換を受け付けました/).waitFor();
    const sent = f.posts.find(p => p.path === '/api/mitemiru/orders').body;
    assert.equal(sent.productId, 'badge'); assert.equal(sent.delivery, 'ship');
    assert.deepEqual(sent.shipping, { name: '山田 太郎', postalCode: '819-0001', address: '福岡県福岡市西区小戸1-2-3', phone: '090-1234-5678' });
    assert.equal('amount' in sent || 'price' in sent, false, '金額は送らない');
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('配送か会場：会場を選ぶと住所はいらない。締切を過ぎた品は交換できない', async () => {
  const f = await open();
  try {
    await openProduct(f, 'keyholder');
    await f.frame.getByLabel('イベント会場で受け取る').check();
    assert.equal(await f.frame.getByLabel('住所').count(), 0, '会場で受け取るなら住所の欄を出さない');
    await f.frame.getByRole('button', { name: 'ウォレットに移す前のEMUERで交換する', exact: true }).click();
    await f.frame.getByText(/EMUER交換を受け付けました/).waitFor();
    const sent = f.posts.find(p => p.path === '/api/mitemiru/orders').body;
    assert.equal(sent.delivery, 'pickup'); assert.equal('shipping' in sent, false);
  } finally { await f.close(); }
  const g = await open();
  try {
    await g.frame.locator('.city-door[data-value="commerce"]').click();
    await g.frame.locator('[data-action="product"][data-value="closed"]').click();
    await g.frame.getByText('注文の受付は締め切りました。').waitFor();
    assert.equal(await g.frame.getByRole('button', { name: 'ウォレットに移す前のEMUERで交換する', exact: true }).isDisabled(), true);
    assert.equal(await g.frame.getByLabel('住所').count(), 0);
  } finally { await g.close(); }
});

test('交換履歴：発送準備中／発送済み、配送先、取り消し、デジタルの品のダウンロード', async () => {
  const f = await open();
  try {
    await f.frame.locator('.city-nav [data-value="orders"]').click();
    await f.frame.getByText('K7Q2MX').waitFor();
    const statuses = await f.frame.locator('.city-order-status').allInnerTexts();
    assert.deepEqual(statuses, ['発送準備中 · 締切のあと、翌月の中ごろに発送します', '発送済み', '受け取れます（ダウンロード）']);
    assert.match(await f.text(), /配送先: 〒819-0001 福岡県福岡市西区小戸1-2-3（山田 太郎）/);
    const download = f.page.waitForEvent('download');
    await f.frame.locator('[data-action="download-digital"][data-value="o-wall"]').click();
    assert.equal((await download).suggestedFilename(), 'reizo-wallpaper-v1.zip');
    await f.frame.locator('[data-action="cancel-paid"][data-value="o-ship"]').click();
    await f.frame.getByText('取り消しました。EMUERは全額戻りました。').waitFor();
    assert.ok(f.posts.some(p => p.path === '/api/mitemiru/orders/o-ship/cancel'));
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('運営：配送待ちの一覧と住所、「発送した」、公式ショップの数字', async () => {
  const f = await open(1440, { me: ME({ isOwner: true }) });
  try {
    // 運営メニューは /me を読んだあとに出る（公式ショップを開くと読む）
    await f.frame.locator('.city-door[data-value="commerce"]').click();
    await f.frame.locator('.city-nav [data-value="event-ops"]').click();
    await f.frame.getByText('配送待ち（1件）').waitFor();
    const t = await f.text();
    assert.match(t, /〒819-0001 福岡県福岡市西区小戸1-2-3 · 山田 太郎 · 09012345678/);
    assert.match(t, /ショップを開いた 40 回 → 商品を見た 20 回 → 交換 5 件/);
    assert.match(t, /交換した割合：25%/);
    await f.frame.locator('[data-action="ship-order"][data-value="o-ship"]').click();
    await f.frame.getByText('発送したことを記録しました。').waitFor();
    assert.ok(f.posts.some(p => p.path === '/api/mitemiru/admin/orders/o-ship/ship'));
  } finally { await f.close(); }
});
