'use strict';
/* ギルド一覧（11/18 オーナー）
   ・見出しは「入りたいギルドを選ぼう！」。下の説明文（関心の近い人が〜）は出さない
   ・「ギルドの決まり」は、見出しの右の「詳細」を押したときだけ出す（× か外側を押すと閉じる）。スマホでも画面からはみ出さない
   ・ギルドの中の画面では、上の「← 知識を試す」と見出し（GUILD・ギルド名・EMUER・サービス）を出さない
   SchoolPark の画面（dao.html）を、何も持たない親の枠の中で開いて確かめる。外への通信はしない。 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '../../frontend/public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.webp': 'image/webp' };
/* 親は、ギルド5つ（と、あとから増えた6つ目）を渡すだけ。扉を押して入ったギルドを window.entered に残す */
const GUILDS = [['learn','01','LEARN','知識を、やってみるに変える。'],['work','02','WORK','貢献を、仕事と次の機会へ。'],['play','03','PLAY','遊びから、挑戦と出会いを。'],
  ['connect','04','CONNECT','孤立ではなく、つながりながら自立する。'],['web3','05','WEB3','信用・価値・実績を持ち運べる社会基盤をつくる。']];
const PARENT = (extra) => '<!doctype html><meta charset="utf-8"><body style="margin:0"><script>window.entered=[];'
  + 'window.spDaoReloadAll=function(app){var G=' + JSON.stringify(GUILDS) + (extra ? '.concat([["extra","06","EXTRA","あとから増えたギルド"]])' : '') + ';'
  + 'app.setState({guildCount:G.length,guilds:G.map(function(g,i){return {id:g[0],code:g[1],short:g[2],name:g[2]+" Guild",concept:g[3],accent:"#333",'
  + 'joinCount:String(i+1),supportCount:String(i),proposalCount:"0",questCount:String(i*2),meLabel:i===1?"参加したい":"",meShow:i===1?"inline-block":"none",'
  + 'open:function(){window.entered.push(g[0]);}};})});};</script>'
  + '<iframe id="f" src="/schoolpark/dao.html?screen=logs" style="width:100vw;height:100vh;border:0"></iframe>';
let server, base, browser;
before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/p') { res.setHeader('content-type', TYPES['.html']); return res.end(PARENT(url.searchParams.has('extra'))); }
    const file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end(''); }
    res.setHeader('content-type', TYPES[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
});
after(async () => { await browser?.close(); server?.close(); });

async function open(width, { extra = false, reducedMotion = 'no-preference' } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion });
  await context.route('**/*', (route) => (new URL(route.request().url()).origin === base ? route.continue() : route.abort()));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + '/p' + (extra ? '?extra' : ''));
  const f = page.frameLocator('#f');
  await f.locator('[data-tour="guild-list"]').waitFor();
  return { page, f, errors, close: () => context.close() };
}

for (const width of [390, 1280]) {
  test(`ギルド一覧（幅${width}）：見出しが変わり、説明文は無く、決まりは「詳細」で開いて閉じられる`, async () => {
    const w = await open(width);
    try {
      assert.equal((await w.f.locator('[data-tour="guild-list"]').textContent()).trim(), '入りたいギルドを選ぼう！');
      assert.equal(await w.f.locator('text=関心の近い人が').count(), 0, '説明文は出さない');
      assert.equal(await w.f.locator('.sp-guild-rules-panel').count(), 0, 'はじめは決まりを出さない');

      const btn = w.f.locator('.sp-guild-rules-btn');
      assert.equal((await btn.textContent()).trim(), '詳細');
      const head = await w.f.locator('[data-tour="guild-list"]').boundingBox();
      const box = await btn.boundingBox();
      assert.ok(box.x > head.x + head.width, '詳細は見出しの右にある');

      await btn.click();
      const panel = w.f.locator('.sp-guild-rules-panel');
      await panel.waitFor();
      assert.match(await panel.textContent(), /ギルドの決まり/);
      const pb = await panel.boundingBox();
      assert.ok(pb.x >= 0 && pb.x + pb.width <= width + 0.5, '画面からはみ出さない');

      await w.f.locator('.sp-guild-rules-close').click();
      assert.equal(await w.f.locator('.sp-guild-rules-panel').count(), 0, '× で閉じる');
      await btn.click();
      await w.f.locator('.sp-guild-rules-panel').waitFor();
      await w.page.mouse.click(4, 420);
      assert.equal(await w.f.locator('.sp-guild-rules-panel').count(), 0, '外側を押すと閉じる');
      assert.deepEqual(w.errors, []);
    } finally { await w.close(); }
  });
}

test('ギルドの中の画面では、上の「← 知識を試す」と見出し（GUILD・ギルド名・EMUER・サービス）を出さない', () => {
  const dao = fs.readFileSync(path.join(ROOT, 'schoolpark/dao.html'), 'utf8');
  const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.ok(dao.includes('.sp-section-header[data-sp-screen="guild"] {display:none;}'));
  assert.ok(index.includes('body.emu-workspace-open[data-emu-screen="guild"] #spDaoPage > .emu-workspace-tools { display:none; }'));
  assert.ok(dao.includes('<div onClick="{{ goLogs }}" style="font-size:12px; color:#6E695C; cursor:pointer">← ギルド</div>'), '画面の中の「← ギルド」は残す');
});

test('PC：ギルドはホールの扉。数・参加したいの印が扉に重なり、押すと扉が開いて光ってから、そのギルドに入る', async () => {
  const w = await open(1440);
  try {
    const doors = w.f.locator('.gh-hall .gh-door');
    await doors.nth(4).waitFor();
    assert.equal(await doors.count(), 5);
    assert.equal(await w.f.locator('.gh-swipe').isVisible(), false, 'PC ではスワイプの並びを出さない');
    const learn = doors.nth(0);
    assert.equal((await learn.locator('.gh-name').textContent()).trim(), 'LEARN');
    // 扉には名前だけ。ひとこと・数・参加したいの印は、扉の上の札に出す（11/18 オーナー：扉に文字を重ねすぎない）
    assert.equal(await learn.locator('.gh-stats, .gh-line, .gh-me').count(), 0, '扉には名前だけ');
    const infos = w.f.locator('.gh-hall .gh-info');
    assert.equal(await infos.count(), 5);
    const floors = w.f.locator('.gh-hall .gh-floor');
    assert.match(await floors.nth(0).locator('.gh-stats').textContent(), /参加したい 1.*応援 0.*議題 0.*クエスト 0/, '数は扉の前の札');
    assert.match(await infos.nth(0).locator('.gh-line').textContent(), /知識を、やってみるに変える。/);
    assert.equal(await floors.nth(1).locator('.gh-me').isVisible(), true, '自分が参加したいギルドには印');
    assert.equal(await floors.nth(0).locator('.gh-me').isVisible(), false);
    for (let i = 0; i < 5; i++) {
      const ib = await infos.nth(i).boundingBox(), db = await doors.nth(i).boundingBox();
      assert.ok(ib.y + ib.height <= db.y + 2, '札は扉の上（扉に重ならない）');
      const fb = await floors.nth(i).boundingBox();
      assert.ok(fb.y >= db.y + db.height - 2, '数の札は扉の前（扉に重ならない）');
      assert.ok(Math.abs((ib.x + ib.width / 2) - (db.x + db.width / 2)) < 4, '札は扉の真上');
      const fs = await infos.nth(i).locator('.gh-line').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      assert.ok(fs >= 11, '文字が小さすぎない');
    }
    // 横断幕
    assert.match(await w.f.locator('.gh-banner').textContent(), /SchoolPark/);
    const bb = await w.f.locator('.gh-banner').boundingBox();
    assert.ok(bb.y + bb.height <= (await infos.nth(1).boundingBox()).y, '横断幕は札より上');
    // 扉は左から順に並び、ホールの中に収まる
    const hall = await w.f.locator('.gh-hall').boundingBox();
    const xs = [];
    for (let i = 0; i < 5; i++) { const b = await doors.nth(i).boundingBox(); xs.push(b.x); assert.ok(b.x >= hall.x && b.x + b.width <= hall.x + hall.width + 1); }
    assert.deepEqual([...xs].sort((a, b) => a - b), xs);
    // 絵が読み込めている
    assert.ok(await doors.nth(2).locator('img.gh-frame').evaluate((img) => img.complete && img.naturalWidth === 800));

    await doors.nth(2).click();
    assert.equal(await doors.nth(2).getAttribute('data-open'), '1', '押した扉が開く');
    // 扉は少しずつ開く（11/19：画面の描き直しで、いきなり開いた形になっていた）
    const angle = () => doors.nth(2).locator('.gh-leaf-l').evaluate((el) => {
      const m = new DOMMatrixReadOnly(getComputedStyle(el).transform); return Math.round(Math.acos(Math.max(-1, Math.min(1, m.m11))) * 180 / Math.PI);
    });
    const a1 = await angle();
    await w.page.waitForTimeout(500);
    const a2 = await angle();
    assert.ok(a1 < 60 && a2 > a1, '途中の角度を通って開く（' + a1 + '→' + a2 + '）');
    assert.equal(await w.f.locator('.gh-hall').getAttribute('data-entering'), '1');
    assert.deepEqual(await w.page.evaluate(() => window.entered), [], '開いている間はまだ入らない');
    await w.page.waitForFunction(() => window.entered.length === 1, null, { timeout: 4000 });
    assert.deepEqual(await w.page.evaluate(() => window.entered), ['play']);
    assert.deepEqual(w.errors, []);
  } finally { await w.close(); }
});

test('スマホ：扉を1枚ずつ横にスワイプ。押すと開いて入る。動きを減らす設定ではすぐ入る', async () => {
  const w = await open(390);
  try {
    const slides = w.f.locator('.gh-swipe .gh-slide');
    await slides.nth(4).waitFor({ state: 'attached' });
    assert.equal(await slides.count(), 5);
    assert.equal(await w.f.locator('.gh-hall').isVisible(), false);
    const first = await slides.nth(0).boundingBox();
    assert.ok(first.width > 280 && first.width < 390, '1枚がほぼ画面の幅');
    assert.ok(await w.f.locator('.gh-swipe').evaluate((el) => el.scrollWidth > el.clientWidth * 3), '横に並んでいる');
    assert.match(await slides.nth(0).locator('.gh-info .gh-line').textContent(), /知識を、やってみるに変える。/, 'スマホでも扉の上に札');
    await w.f.locator('.gh-swipe').evaluate((el) => { el.scrollLeft = el.scrollWidth; });
    await w.f.locator('.gh-swipe .gh-door').nth(4).click();
    await w.page.waitForFunction(() => window.entered.length === 1, null, { timeout: 4000 });
    assert.deepEqual(await w.page.evaluate(() => window.entered), ['web3']);
  } finally { await w.close(); }
  const r = await open(390, { reducedMotion: 'reduce' });
  try {
    await r.f.locator('.gh-swipe .gh-door').first().click();
    assert.deepEqual(await r.page.evaluate(() => window.entered), ['learn'], 'すぐ入る');
  } finally { await r.close(); }
});

test('あとから増えたギルド（扉の絵が無いもの）は、今までのカードで出す', async () => {
  const w = await open(1440, { extra: true });
  try {
    await w.f.locator('.gh-hall .gh-door').nth(4).waitFor();
    assert.equal(await w.f.locator('.sp-ux-guild-card').count(), 1);
    assert.match(await w.f.locator('.sp-ux-guild-card').textContent(), /EXTRA/);
  } finally { await w.close(); }
});
