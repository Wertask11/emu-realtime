'use strict';
/* 運営の画面（membership-admin.html）の「知識を試す・City」タブ（11/28 管理画面といまのアプリの突き合わせ）。
   - たまり場の通報：本文と通報の理由・数・今の状態を出し、「隠したままにする／戻す」を送る
   - 協賛と応援：協賛の袋と応援の合計を出す（だれが贈ったかは出さない）
   - タブが描き直されても、このパネルと JPYC のパネルが消えない
   サーバーの返事は試験用。 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '../../frontend/public');
const PAGE = `<!doctype html><meta charset="utf-8"><body><section id="tab-schoolpark"></section><script>
window.calls = [];
window.reply = {};
window.emuAdminApi = async (p, options) => {
  window.calls.push({ p, options: options || null });
  const r = window.reply[p];
  if (r && r.error) throw Object.assign(new Error(r.error), { code: r.error });
  return r || { ok: true };
};
window.emuerV2AdminApi = async () => ({ ok: true, pending: [], totals: {}, budgets: [] });
</script><script src="/community-admin.js"></script><script src="/jpyc-gifts-admin.js"></script></body>`;

const REPORTS = { ok: true, reports: [], targets: [
  { target: 'together/p1', room: 'together', postId: 'p1', replyId: '', reasons: { spam: 2, harass: 1 }, lastAtMs: Date.UTC(2026, 10, 28, 3),
    exists: true, body: '一緒に何かしよう', authorName: 'ありす', hidden: true, deleted: false, reportCount: 3, reviewedAtMs: null },
  { target: 'hobby/p2', room: 'hobby', postId: 'p2', replyId: '', reasons: { other: 1 }, lastAtMs: 1, exists: true, deleted: true, body: '' }
] };
const SUMMARY = { ok: true,
  sponsor: { total: 30, paidOut: 10, pots: [{ questId: 'q1', title: '一般 #001 入門', pot: 20, total: 30, sponsors: 1, bonusCount: 1 }] },
  cheer: { posts: 1, total: 5, top: [{ postId: 'p1', title: '朝の音読', total: 5, people: 1 }] } };

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
  await page.locator('#tamaReportsAdmin').waitFor();
  return { page, errors, dialogs };
}

test('たまり場の通報：開いただけでは読まない。本文・理由・状態を出し、消された書き込みは出さない。隠す・戻すを送る', async () => {
  const { page, errors } = await open();
  try {
    assert.deepEqual(await page.evaluate(() => window.calls), [], '開いただけでは読まない');
    await page.evaluate(r => { window.reply['/api/schoolpark/tamariba/admin/reports'] = r; }, REPORTS);
    await page.locator('#tamaLoad').click();
    await page.getByText('一緒に何かしよう').waitFor();
    const text = await page.locator('#tamaReports').innerText();
    assert.match(text, /なにか一緒にやりたい/);
    assert.match(text, /隠れています/);
    assert.match(text, /通報 3 件（宣伝・スパム 2・いやがらせ 1）/);
    assert.match(text, /まだ確認していません/);
    assert.equal(await page.locator('[data-tama-row]').count(), 1, '消された書き込みは出さない');
    await page.getByRole('button', { name: '問題なし（表示に戻す）' }).click();
    await page.waitForFunction(() => window.calls.some(c => c.p === '/api/schoolpark/tamariba/admin/hide'));
    const hide = await page.evaluate(() => window.calls.find(c => c.p === '/api/schoolpark/tamariba/admin/hide'));
    assert.deepEqual(hide.options, { method: 'POST', body: { room: 'together', postId: 'p1', hidden: false } });
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('通報：運営でないときは理由を出す', async () => {
  const { page } = await open();
  try {
    await page.evaluate(() => { window.reply['/api/schoolpark/tamariba/admin/reports'] = { error: 'OWNER_ONLY' }; });
    await page.locator('#tamaLoad').click();
    await page.getByText('運営のアカウントでのみ見られます。').waitFor();
  } finally { await page.close(); }
});

test('協賛と応援：袋ごとの残り・合計と、応援が多い投稿の題名を出す', async () => {
  const { page, errors } = await open();
  try {
    await page.evaluate(r => { window.reply['/api/emu/gifts/admin/summary'] = r; }, SUMMARY);
    await page.locator('#giftsSumLoad').click();
    await page.getByText('一般 #001 入門').waitFor();
    const text = await page.locator('#giftsSummary').innerText();
    assert.match(text, /協賛：積まれた合計\s*30 EMUER/);
    assert.match(text, /残り 20 \/ 合計 30 EMUER/);
    assert.match(text, /朝の音読\s*1 人・5 EMUER/);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('タブが描き直されても、通報・協賛・JPYC のパネルが付き直す', async () => {
  const { page } = await open();
  try {
    await page.locator('#jpycGiftsPanel').waitFor();
    await page.evaluate(() => { document.getElementById('tab-schoolpark').innerHTML = '<div class="card">クエストの一覧</div>'; });
    await page.locator('#tamaReportsAdmin').waitFor();
    await page.locator('#giftsSummaryAdmin').waitFor();
    await page.locator('#jpycGiftsPanel').waitFor();
    assert.equal(await page.locator('#tab-schoolpark').innerText().then(t => t.includes('クエストの一覧')), true);
  } finally { await page.close(); }
});
