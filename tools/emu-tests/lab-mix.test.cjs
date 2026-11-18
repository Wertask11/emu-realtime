'use strict';
/* Knowledge Lab の掛け合わせの画面（11/18 オーナー）
   ・Knowledge Text と同じように、まず分野のカード。押すとその分野の知識
   ・「掛け合わせる」をオン → 最初の1つがメイン、あとから最大4つ。Knowledge Text の教材も枠に入れられる
   ・書き手が AI の利用に同意していない知識は入れられない
   ・混ぜる → はじける → 新しい発見。1日3回（残りを出す。0回なら押せない）
   ・行き先：自分だけに保存／公開／ギルドの議題（公開してから）／クエストに参加
   サーバーは偽物（このテストの中の決まった答え）。本物のアカウントやデータは使わない。 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '../../frontend/public');
const TERMS = require('../../backend/knowledge-lab/taxonomy.json').map((t) => ({ ...t, active: true }));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json', '.webp': 'image/webp' };
const PARENT = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><body style="margin:0">
<iframe id="f" src="/knowledge-lab.html" style="width:100vw;height:100vh;border:0"></iframe>
<script>window.emuAuthHeaders=async()=>({'Content-Type':'application/json',Authorization:'Bearer test'});window.msgs=[];addEventListener('message',e=>{if(e.data&&e.data.type==='emu-lab-action')msgs.push(e.data)});</script></body>`;
let server, base, browser;
before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/test/parent') { res.setHeader('content-type', TYPES['.html']); return res.end(PARENT); }
    const file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end('{}'); }
    res.setHeader('content-type', TYPES[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
});
after(async () => { await browser?.close(); server?.close(); });

const POSTS = ['髪を傷めないブローのコツ', '開業1年目の資金繰り', '接客で常連をつくる', 'SNSで予約を増やした話', 'スタッフ教育の失敗談', '同意のない知識'].map((title, i) => ({
  id: 'p' + i, title, body: '本文の例です。'.repeat(6), displayName: '書き手' + i,
  knowledgeLab: { aiUseConsent: { allowed: i !== 5 } }, facets: { field: ['field-beauty'] },
}));
async function open({ width = 390, remaining = 3, counts = { 'field-beauty': 12, 'field-business': 0 } } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 844 } });
  const seen = { mix: [], notes: [], search: [] };
  let quota = { available: true, used: 3 - remaining, limit: 3, remaining };
  await context.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    if (!u.pathname.startsWith('/api/knowledge-lab')) return u.origin === base ? route.continue() : route.abort();
    const p = u.pathname.replace('/api/knowledge-lab', '');
    const json = (j, status = 200) => route.fulfill({ status, json: j });
    const method = route.request().method();
    if (p === '/config') return json({ enabled: true });
    if (p === '/taxonomy') return json(TERMS);
    if (p === '/ai/status') return json({ available: true, semanticAvailable: false, configured: true, environmentEnabled: true, stopped: false, model: 'm' });
    if (p === '/me') return json({ spid: 'sp-test', owner: false });
    if (p === '/search') { seen.search.push(Object.fromEntries(u.searchParams)); return json({ items: POSTS, next: null }); }
    if (p === '/field-counts') return counts ? json({ counts }) : json({ error: 'INDEX_NOT_READY' }, 503);
    if (p === '/texts') return json([{ id: 'kt_a1', title: '詐欺の見抜き方', theme: 'money', subTheme: '守り方', subSubTheme: '', excerpt: 'うまい話には理由がある' }]);
    if (p === '/texts/kt_a1') return json({ id: 'kt_a1', title: '詐欺の見抜き方', body: 'うまい話には理由がある。全文です。' });
    if (p === '/ai/mix/quota') return json(quota);
    if (p === '/ai/mix') {
      const body = JSON.parse(route.request().postData());
      seen.mix.push(body);
      quota = { ...quota, used: quota.used + 1, remaining: quota.remaining - 1 };
      const ids = [body.mainId, ...body.otherIds];
      const title = (id) => (id === 'kt_a1' ? '詐欺の見抜き方' : POSTS.find((x) => x.id === id).title);
      return json({ id: 'run-1', mode: 'mix', mainId: body.mainId, sources: ids.map((id) => ({ id, title: title(id) })),
        analysis: { hypotheses: [{ text: 'ブローの技術を予約前の動画にすると常連が生まれやすい', citations: [{ sourceId: ids[0] }] }],
          connections: ids.slice(1).map((id) => ({ text: 'つながり ' + id, citations: [{ sourceId: id }] })), cautions: [{ text: '注意', citations: [{ sourceId: ids[0] }] }] },
        quota: { used: quota.used, limit: 3, remaining: quota.remaining } });
    }
    if (p === '/notes' && method === 'PUT') { const b = JSON.parse(route.request().postData()); seen.notes.push(b); return json({ id: 'note-1', revision: seen.notes.length }); }
    return json({ items: [] });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.goto(base + '/test/parent');
  const f = page.frameLocator('#f');
  await f.locator('#mixFields .mix-card').first().waitFor();
  await page.evaluate(() => { const w = document.getElementById('f').contentWindow; try { w.ReizoTour?.skip?.(); } catch (_) {} w.document.querySelectorAll('.rk-panel,#rk-tour').forEach((e) => e.remove()); });
  return { page, f, seen, errors, close: () => context.close() };
}

test('分野のカードが並び（分類の「分野」だけ）、押すとその分野の知識が出る', async () => {
  const w = await open();
  try {
    const labels = await w.f.locator('#mixFields .mix-card b').allInnerTexts();
    const fields = TERMS.filter((t) => t.axis === 'field').map((t) => t.label);
    assert.deepEqual(labels, fields);
    assert.ok(labels.includes('美容') && labels.includes('経営・起業'));
    await w.f.locator('#mixFields [data-field="field-beauty"]').click();
    await w.f.locator('.mix-item').first().waitFor();
    assert.equal(w.seen.search[0].field, 'field-beauty');
    assert.equal(await w.f.locator('#mixListTitle').innerText(), '美容');
    assert.equal(await w.f.locator('[data-take]').count(), 0, 'オフのあいだは「枠に入れる」を出さない');
    assert.deepEqual(w.errors, []);
  } finally { await w.close(); }
});

test('メイン1つ＋最大4つ。教材も入る。同意の無い知識は入らない。5つ目は入らない。混ぜる→新しい発見→保存・公開・議題・クエスト', async () => {
  const w = await open();
  try {
    await w.f.locator('#mixFields [data-field="field-beauty"]').click();
    await w.f.locator('.mix-item').first().waitFor();
    await w.f.locator('.mix-switch').click();
    assert.match(await w.f.locator('.mix-item[data-id="p5"]').innerText(), /同意していないので、混ぜられません/);
    assert.equal(await w.f.locator('[data-take="p5"]').count(), 0);
    for (const id of ['p0', 'p1', 'p2']) await w.f.locator(`[data-take="${id}"]`).click();
    await w.f.locator('[data-src="texts"]').click();
    await w.f.locator('[data-theme="money"]').click();
    await w.f.locator('[data-read-text="kt_a1"]').click();
    await w.f.locator('.mix-text-full').filter({ hasText: '全文です' }).waitFor();
    await w.f.locator('[data-take="kt_a1"]').click();
    await w.f.locator('#mixBack').click();
    await w.f.locator('[data-src="posts"]').click();
    await w.f.locator('#mixFields [data-field="field-beauty"]').click();
    await w.f.locator('[data-take="p3"]').waitFor();
    await w.f.locator('[data-take="p3"]').click();
    assert.deepEqual(await w.page.evaluate(() => document.getElementById('f').contentWindow.EmuLabMix.state().others), ['p1', 'p2', 'kt_a1', 'p3']);
    await w.f.locator('[data-take="p4"]').click();
    assert.match(await w.f.locator('#status').innerText(), /枠がいっぱい/);
    assert.equal(await w.page.evaluate(() => document.getElementById('f').contentWindow.EmuLabMix.state().main), 'p0');
    // メインの枠を外すと、次の知識がメインになる
    await w.f.locator('.mix-slot.main[data-drop]').click();
    assert.equal(await w.page.evaluate(() => document.getElementById('f').contentWindow.EmuLabMix.state().main), 'p1');
    await w.f.locator('[data-take="p0"]').click();
    // 同意の確認が無いと押せない
    assert.equal(await w.f.locator('#mixGo').isDisabled(), true);
    assert.match(await w.f.locator('#mixQuota').innerText(), /今日あと 3 回/);
    await w.f.locator('#mixConsent').check();
    assert.equal(await w.f.locator('#mixGo').isDisabled(), false);
    await w.f.locator('#mixGo').click();
    await w.f.locator('.mix-stage.done .mix-result').waitFor({ timeout: 10000 });
    assert.deepEqual(w.seen.mix[0].mainId, 'p1');
    assert.deepEqual(w.seen.mix[0].otherIds, ['p2', 'kt_a1', 'p3', 'p0']);
    assert.equal(w.seen.mix[0].externalAIConsent, true);
    assert.match(await w.f.locator('.mix-find').innerText(), /常連が生まれやすい/);
    assert.match(await w.f.locator('.mix-badge').innerText(), /NEW DISCOVERY/);
    // 自分だけに保存
    await w.f.locator('[data-act="private"]').click();
    await w.f.locator('#mixActMsg').filter({ hasText: '保存しました' }).waitFor();
    assert.equal(w.seen.notes[0].mode, 'mix');
    assert.equal(w.seen.notes[0].visibility, 'private');
    assert.equal(w.seen.notes[0].aiRunId, 'run-1');
    assert.deepEqual(w.seen.notes[0].sourceIds, ['p1', 'p2', 'kt_a1', 'p3', 'p0']);
    assert.deepEqual(w.seen.notes[0].fields, []);
    // ギルドの議題：公開してから、議題の画面へ
    await w.f.locator('[data-act="guild"]').click();
    await w.page.waitForFunction(() => window.msgs.some((m) => m.action === 'guild-proposal'));
    assert.equal(w.seen.notes[1].visibility, 'public');
    assert.equal(w.seen.notes[1].id, 'note-1', '同じ記録を公開に変える');
    assert.deepEqual(await w.page.evaluate(() => window.msgs.find((m) => m.action === 'guild-proposal').noteId), 'note-1');
    // クエストに参加：クエストの一覧へ
    await w.f.locator('[data-act="quest"]').click();
    await w.page.waitForFunction(() => window.msgs.some((m) => m.action === 'quests'));
    assert.deepEqual(w.errors, []);
  } finally { await w.close(); }
});

test('今日の3回を使い切っていたら「混ぜる」は押せない', async () => {
  const w = await open({ remaining: 0 });
  try {
    await w.f.locator('#mixFields [data-field="field-beauty"]').click();
    await w.f.locator('.mix-item').first().waitFor();
    await w.f.locator('.mix-switch').click();
    await w.f.locator('[data-take="p0"]').click();
    await w.f.locator('[data-take="p1"]').click();
    await w.f.locator('#mixConsent').check();
    await w.f.locator('#mixQuota').filter({ hasText: '今日はもう混ぜられません' }).waitFor();
    assert.equal(await w.f.locator('#mixGo').isDisabled(), true);
  } finally { await w.close(); }
});

test('プロフィールボタンのメニューから Knowledge Lab の記録・書き手プロフィール。運営管理は管理画面から', () => {
  const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(index, /onclick="emuAccountLab\('mine'\)">Knowledge Lab の記録<\/button>/);
  assert.match(index, /onclick="emuAccountLab\('writer'\)">書き手プロフィール<\/button>/);
  const admin = fs.readFileSync(path.join(ROOT, 'membership-admin.html'), 'utf8');
  assert.match(admin, /href="\/\?lab=admin"[^>]*>Knowledge Lab の運営管理/);
  const lab = fs.readFileSync(path.join(ROOT, 'knowledge-lab.html'), 'utf8');
  assert.match(lab, /<nav class="tabs"[^>]*hidden>/, 'Lab のタブは出さない');
});

test('分野のカードの右上に、その分野の知識の数を出す。数えられなかったときは出さない', async () => {
  const w = await open({ width: 1280 });
  try {
    await w.f.locator('#mixFields [data-field="field-beauty"] .mix-count').waitFor();
    assert.equal(await w.f.locator('#mixFields [data-field="field-beauty"] .mix-count').innerText(), '12件');
    assert.equal(await w.f.locator('#mixFields [data-field="field-business"] .mix-count').innerText(), '0件');
    assert.equal(await w.f.locator('#mixFields [data-field="field-money"] .mix-count').count(), 0, '数の無い分野は出さない');
    // 右上にある
    const card = await w.f.locator('#mixFields [data-field="field-beauty"]').boundingBox();
    const badge = await w.f.locator('#mixFields [data-field="field-beauty"] .mix-count').boundingBox();
    assert.ok(badge.x + badge.width > card.x + card.width - 30 && badge.y < card.y + 30, '右上');
    // Knowledge Text のテーマにも教材の数
    await w.f.locator('[data-src="texts"]').click();
    assert.equal(await w.f.locator('[data-theme="money"] .mix-count').innerText(), '1件');
    assert.deepEqual(w.errors, []);
  } finally { await w.close(); }
  const off = await open({ counts: null });
  try {
    await off.page.waitForTimeout(300);
    assert.equal(await off.f.locator('#mixFields .mix-count').count(), 0);
    assert.equal(await off.f.locator('#mixFields .mix-card').count() > 0, true, 'カードはそのまま出る');
  } finally { await off.close(); }
});
