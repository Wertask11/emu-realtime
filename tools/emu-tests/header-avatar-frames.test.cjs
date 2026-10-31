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

/* 10/30 スマホで、また👤に戻っていた。原因を1つに決めつけず、次の3つで写真を入れ直す。
   1. SchoolPark（dao.html）が描き直すたびに、自分から親に「入れ直して」と頼む（親の見張りが外れていても戻る）
   2. 前に読めた写真と表示のしかたを端末に控え、読み終わるのを待たずに出す（同じ人のときだけ）
   3. 写真の読み取りに失敗したら、少しおいて読み直す（描き直しのたびには読まない） */
const DAO = readHtml('frontend/public/schoolpark/dao.html');
test('SchoolPark は描き直すたびに、親に右上の写真を入れ直してもらう', () => {
  const draw = DAO.slice(DAO.indexOf('function draw() {'), DAO.indexOf('/* まとめて1回だけ描き直す。'));
  assert.ok(draw.includes('window.parent.emuPaintHeaderIdentity()'), 'draw() の最後で親に頼む');
  const watch = INDEX.slice(INDEX.indexOf('function spDaoWatchRender() {'), INDEX.indexOf('function spDaoWatchRender() {') + 900);
  assert.ok(watch.includes('window._spDaoMORoot === root'), '枠が読み直されたら、新しい dao-root を見張り直す');
});

const CACHE_FUNCS = ['_emuSafeAvatar', '_emuHeadCached', '_emuProfileRetry', 'emuSyncMyProfile', '_emuHeadPut', '_emuHeadIsOurs', '_emuPaintIdentityButton', 'emuPaintHeaderIdentity']
  .map(n => grab(INDEX, n)).join('\n');
const ME = '0x' + 'b'.repeat(40);
const CACHE_PAGE = `<!doctype html><meta charset="utf-8"><body>
<button id="walletAddressButton">ログイン</button><button id="emuHeaderProfile">👤</button>
<script>
let _emuHeadLabel = null; const _emuHeadOwn = new WeakSet(); let _emuHeadBroken = '';
let _emuProfileRetryAt = 0, _emuProfileRetryTimer = 0;
const _emuProfiles = new Map(), _emuProfilesKnown = new Map();
window.reads = 0; window.readResult = 'fail';
const _emuAddress = () => ${JSON.stringify(ME)};
const emuDisplayName = () => 'めんま';
function emuProfileKnown(a) { return _emuProfilesKnown.get(a); }
/* 読み取りの代わり：失敗させるか、写真ありで返す */
function emuProfileOf(a) {
  window.reads++;
  const p = window.readResult === 'fail' ? Promise.reject(new Error('offline'))
    : Promise.resolve({ displayName: 'めんま', avatar: ${JSON.stringify(PHOTO)}, headerIdentityMode: 'avatar' });
  _emuProfiles.set(a, p);
  p.then(v => _emuProfilesKnown.set(a, v), () => _emuProfiles.delete(a));
  return p;
}
${CACHE_FUNCS}
</script></body>`;

test('前に読めた写真を控えておき、読めないあいだも出す。失敗したら少しおいて読み直す', async () => {
  const page = await browser.newPage();
  await page.route('**/test/cache', r => r.fulfill({ body: CACHE_PAGE, contentType: 'text/html; charset=utf-8' }));
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    // 控えがある（前に読めた）。読み取りは失敗する（スマホで通信が切れている）
    await page.addInitScript(([me, photo]) => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('ches_avatar', photo);
      localStorage.setItem('emu_head_mode', JSON.stringify({ addr: me, mode: 'avatar' }));
    }, [ME, PHOTO]);
    await page.goto(base + '/test/cache');
    await page.evaluate(() => emuPaintHeaderIdentity());
    assert.equal(await page.evaluate(() => document.querySelector('#emuHeaderProfile img.emu-head-avatar')?.getAttribute('src')), PHOTO, '控えの写真をすぐ出す');
    // 描き直しが何度来ても、失敗した読み取りをそのたびにやり直さない（読み直しは時間をおいて1回ずつ）
    await page.waitForFunction(() => window.reads === 1);
    for (let i = 0; i < 5; i++) await page.evaluate(() => emuPaintHeaderIdentity());
    assert.equal(await page.evaluate(() => window.reads), 1);
    assert.equal(await page.evaluate(() => !!_emuProfileRetryTimer), true, '少しおいて読み直す予定を立てる');
    // 通信が戻ったら、読み直しで本当の写真が入る
    await page.evaluate(() => { window.readResult = 'ok'; });
    await page.waitForFunction(() => window.reads === 2, null, { timeout: 15000 });
    await page.waitForFunction(() => _emuProfilesKnown.size === 1);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('emu_head_mode')).mode), 'avatar');
    // 別の人の控えは使わない
    await page.evaluate(() => { localStorage.setItem('emu_head_mode', JSON.stringify({ addr: '0x' + 'c'.repeat(40), mode: 'avatar' })); });
    assert.equal(await page.evaluate(a => _emuHeadCached(a), '0x' + 'd'.repeat(40)), undefined);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});
