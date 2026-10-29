'use strict';
/* 運営の画面（membership-admin.html）の「取りこぼした Good・Change の報酬」パネル（10/29）。
   「数える」で件数と EMUER を出し、数を確かめてから「作り直す」を押すと、数えた数を添えて頼む。
   数えたあとに数が変わっていたら、作らずに数え直してもらう。サーバーの返事は試験用。 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '../../frontend/public');
const PAGE = `<!doctype html><meta charset="utf-8"><body><section id="tab-schoolpark"></section><script>
window.calls = [];
window.reply = { scan: null, run: null };
window.emuerV2AdminApi = async (p, options) => {
  window.calls.push({ p, options: options || null });
  const r = options && options.method === 'POST' ? window.reply.run : window.reply.scan;
  if (r && r.error) throw Object.assign(new Error(r.error), { code: r.error });
  return r;
};
</script><script src="/reaction-recovery-admin.js"></script></body>`;
const SCAN = { ok: true, scannedPosts: 120, checked: 9, missingGood: 5, missingChange: 2, missingEmuer: 7, authors: 3,
  reviewCount: 1, review: [{ postId: 'c', title: '保留の投稿', reason: '10/1より前の投稿で、移行のときの数の控えが無い' }],
  sample: [{ postId: 'a', title: '早起きの話', action: 'good', author: '0x' + 'a'.repeat(40) }] };

let server, base, browser;
before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/test/admin') { res.setHeader('content-type', 'text/html; charset=utf-8'); return res.end(PAGE); }
    const file = path.normalize(path.join(ROOT, url.pathname));
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.statusCode = 404; return res.end(); }
    res.setHeader('content-type', 'text/javascript; charset=utf-8');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
});
after(async () => { await browser?.close(); server?.close(); });

async function open() {
  const page = await browser.newPage();
  const errors = [], dialogs = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
  await page.goto(base + '/test/admin');
  await page.locator('#emuerV2RecoveryPanel').waitFor();
  return { page, errors, dialogs };
}

test('開いただけでは数えない。「数える」で件数・EMUER・要確認を出し、「作り直す」は数えた数を添えて頼む', async () => {
  const { page, errors, dialogs } = await open();
  try {
    assert.deepEqual(await page.evaluate(() => window.calls), [], '開いただけでは投稿を読まない');
    assert.equal(await page.locator('#ev2RecRun').isDisabled(), true);
    await page.evaluate(s => { window.reply.scan = s; window.reply.run = { ok: true, created: 7, authors: 3 }; }, SCAN);
    await page.locator('#ev2RecScan').click();
    await page.getByText('取りこぼし：Good 5件・Change 2件、合計 7 EMUER').waitFor();
    const text = await page.locator('#ev2RecResult').innerText();
    assert.match(text, /投稿 120件を調べました。/);
    assert.match(text, /受け取る人 3人/);
    assert.match(text, /要確認（作りません）：1件[\s\S]*保留の投稿[\s\S]*移行のときの数の控えが無い/);
    assert.match(text, /早起きの話[\s\S]*Good · 投稿した人 0xaaaa…aaaa/);
    await page.locator('#ev2RecRun').click();
    await page.getByText('7 EMUER ぶんの報酬を作り直しました').waitFor();
    assert.match(dialogs[0], /取りこぼした報酬 7 EMUER を作り直しますか？/);
    const post = (await page.evaluate(() => window.calls)).find(c => c.options && c.options.method === 'POST');
    assert.deepEqual(post, { p: '/admin/reaction-recovery', options: { method: 'POST', body: { expectedMissing: 7 } } });
    assert.equal(await page.locator('#ev2RecRun').isDisabled(), true, '作ったあとは押せない');
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('数えたあとに数が変わっていたら、作らずに数え直しを頼む。取りこぼしが無ければ作れない', async () => {
  const { page } = await open();
  try {
    await page.evaluate(s => { window.reply.scan = s; window.reply.run = { error: 'RECOVERY_CHANGED' }; }, SCAN);
    await page.locator('#ev2RecScan').click();
    await page.getByText('合計 7 EMUER').waitFor();
    await page.locator('#ev2RecRun').click();
    await page.getByText('数えたあとに数が変わりました。もう一度「数える」を押してください。').waitFor();
    await page.evaluate(() => { window.reply.scan = { ok: true, scannedPosts: 120, checked: 9, missingGood: 0, missingChange: 0, missingEmuer: 0, authors: 0, reviewCount: 0, review: [], sample: [] }; });
    await page.locator('#ev2RecScan').click();
    await page.getByText('作り直すものはありません。').waitFor();
    assert.equal(await page.locator('#ev2RecRun').isDisabled(), true);
  } finally { await page.close(); }
});
