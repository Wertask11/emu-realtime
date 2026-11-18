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
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css' };
const PARENT = '<!doctype html><meta charset="utf-8"><body style="margin:0"><iframe id="f" src="/schoolpark/dao.html?screen=logs" style="width:100vw;height:100vh;border:0"></iframe>';
let server, base, browser;
before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/p') { res.setHeader('content-type', TYPES['.html']); return res.end(PARENT); }
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

async function open(width) {
  const context = await browser.newContext({ viewport: { width, height: 844 } });
  await context.route('**/*', (route) => (new URL(route.request().url()).origin === base ? route.continue() : route.abort()));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + '/p');
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
