'use strict';
/* SchoolPark の右上（アカウントのボタン）に、保存したプロフィール写真を出す（10/29 オーナーから）。

   SchoolPark は2つの枠のどちらかで開く。ふつうは spDaoFrame。「みてみる」
   「City の公式ショップで使う」からは spRoomFrame（小部屋）で開く。
   写真を入れる処理は spDaoFrame しか見ていなかったので、小部屋で開いた SchoolPark の
   右上は👤のままだった。しかも SchoolPark は描き直すたびにボタンを作り直す。

   index.html の本物の関数を取り出し、偽物の SchoolPark（描き直すとボタンが👤に戻る）で確かめる。 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { chromium } = require('playwright');
const { readHtml, grab } = require('../year-goals-tests/extract.cjs');

const INDEX = readHtml('frontend/public/index.html');
const PHOTO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
const FUNCS = ['_emuHeadPut', '_emuHeadIsOurs', '_emuPaintIdentityButton', 'emuPaintHeaderIdentity', 'spRoomWatchRender', 'openSpRoom']
  .map(n => grab(INDEX, n)).join('\n');
/* 偽物の SchoolPark。描き直すと、右上のボタンを👤で作り直す（本物の draw と同じ）。 */
const FRAME = `<!doctype html><meta charset="utf-8"><div id="dao-root"></div><script>
function draw(){ const head=document.createElement('div'); head.setAttribute('data-sp-head','');
  head.innerHTML='<button class="service-profile">👤</button>'; document.getElementById('dao-root').replaceChildren(head); }
draw(); window.redraw=draw;
</script>`;
const PARENT = `<!doctype html><meta charset="utf-8"><body>
<button id="walletAddressButton">ログイン</button><button id="emuHeaderProfile">👤</button>
<div id="spRoomPage"><iframe id="spRoomFrame"></iframe></div>
<iframe id="spDaoFrame" src="/test/frame"></iframe>
<script>
let _emuHeadLabel = null; const _emuHeadOwn = new WeakSet(); let _emuHeadBroken = '';
const _emuAddress = () => '0x' + 'a'.repeat(40);
const emuDisplayName = () => 'めんま';
const emuProfileKnown = () => ({ headerIdentityMode: 'avatar', avatar: ${JSON.stringify(PHOTO)} });
${FUNCS}
</script></body>`;

let server, base, browser;
before(async () => {
  server = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    if (req.url.startsWith('/test/frame')) return res.end(FRAME);
    if (req.url === '/test/parent') return res.end(PARENT);
    res.statusCode = 404; res.end();
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
});
after(async () => { await browser?.close(); server?.close(); });

const photoIn = (page, id) => page.evaluate(i => {
  const b = document.getElementById(i).contentDocument.querySelector('[data-sp-head] .service-profile');
  return b ? (b.querySelector('img.emu-head-avatar')?.getAttribute('src') || b.textContent) : null;
}, id);

test('小部屋（spRoomFrame）で開いた SchoolPark の右上にも写真を出し、描き直しても戻す', async () => {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(base + '/test/parent');
    await page.evaluate(() => openSpRoom('/test/frame?screen=city', 'SchoolPark City'));
    await page.waitForFunction(p => document.getElementById('spRoomFrame').contentDocument
      ?.querySelector('.service-profile img')?.getAttribute('src') === p, PHOTO);
    // SchoolPark が描き直すと、ボタンは👤で作り直される。写真を入れ直す
    await page.evaluate(() => document.getElementById('spRoomFrame').contentWindow.redraw());
    await page.waitForFunction(p => document.getElementById('spRoomFrame').contentDocument
      .querySelector('.service-profile img')?.getAttribute('src') === p, PHOTO);
    assert.equal(await photoIn(page, 'spRoomFrame'), PHOTO);
    // ふつうの枠（spDaoFrame）にも、これまでどおり出す
    await page.evaluate(() => emuPaintHeaderIdentity());
    assert.equal(await photoIn(page, 'spDaoFrame'), PHOTO);
    // 別のページを開き直しても、新しいページを見張る
    await page.evaluate(() => openSpRoom('/test/frame?screen=home', 'SchoolPark'));
    await page.waitForFunction(() => /screen=home/.test(document.getElementById('spRoomFrame').contentWindow.location.search));
    await page.evaluate(() => document.getElementById('spRoomFrame').contentWindow.redraw());
    await page.waitForFunction(p => document.getElementById('spRoomFrame').contentDocument
      .querySelector('.service-profile img')?.getAttribute('src') === p, PHOTO);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});
