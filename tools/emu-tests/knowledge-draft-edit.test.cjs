'use strict';
/* マイライブラリーの下書きを「編集」で開き直せるか（10/29 オーナーから）。

   知識を読む（knowledge.html）のマイライブラリーへ移したとき、
   下書きには「削除」しか無く、保存した下書きを二度と開けなかった。
   一覧には本文の最初の100文字しか出ないので、写して書き直すこともできない。

   いまは「編集」で、題名・本文・テーマ・タグ・画像が入った投稿の画面が開く。
   もう一度「下書き保存」を押すと同じ下書きを上書きし（数は増えない）、
   投稿・予約するとその下書きは消える（親の index.html が消す）。

   親の役は、このテストの小さなページが受け持つ。本物の保存先は使わない。 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '../../frontend/public');
const BODY = '昔は早寝すると早起きできると言われていたが、最近の医学研究では逆だとなった。人間は起きた時間の14時間後に眠くなると言われてるので早起きすると必然的に早く寝れるようになり健康的になる。もちろん個人差はある。';
const DRAFT = { id: 'd1', title: '早寝より早起き', body: BODY, tags: '失敗,睡眠,健康', imageUrl: '' };
const PARENT = `<!doctype html><meta charset="utf-8"><iframe id="k" src="/knowledge.html" style="width:420px;height:860px;border:0"></iframe>
<script>
window.sent = [];
const DRAFT = ${JSON.stringify(DRAFT)};
const f = document.getElementById('k');
addEventListener('message', e => {
  if (e.source !== f.contentWindow) return;
  const m = e.data || {}, w = f.contentWindow, to = location.origin;
  window.sent.push(m);
  if (m.type === 'emu-knowledge-ready') w.postMessage({ type:'emu-knowledge-posts', posts:[], drafts:[DRAFT], canDraft:true, canSchedule:false, account:'0xabc' }, to);
  if (m.type === 'emu-knowledge-panel') w.postMessage({ type:'emu-knowledge-panel-data', kind:m.kind, items:{ posts:[], drafts:[DRAFT] } }, to);
  if (m.type === 'emu-knowledge-draft' || m.type === 'emu-knowledge-publish')
    w.postMessage({ type:'emu-knowledge-save-result', kind:m.type === 'emu-knowledge-draft' ? 'draft' : 'publish', requestId:m.requestId, ok:true }, to);
});
</script>`;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

let server, base, browser;
before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/test/parent') { res.setHeader('content-type', 'text/html; charset=utf-8'); return res.end(PARENT); }
    const file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end(); }
    res.setHeader('content-type', TYPES[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
});
after(async () => { await browser?.close(); server?.close(); });

async function open() {
  const context = await browser.newContext({ viewport: { width: 420, height: 900 } });
  await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(base + '/test/parent');
  const frame = page.frames().find(f => f.url().endsWith('/knowledge.html'));
  await page.waitForFunction(() => window.sent.some(m => m.type === 'emu-knowledge-ready'));
  const library = async () => {
    await page.evaluate(() => document.getElementById('k').contentWindow.postMessage({ type: 'emu-knowledge-open-library' }, location.origin));
    await frame.locator('[data-edit-draft="d1"]').waitFor();
  };
  const sent = type => page.evaluate(t => window.sent.filter(m => m.type === t), type);
  return { page, frame, errors, library, sent, close: () => context.close() };
}

test('下書きに「編集」と「削除」があり、編集で題名・本文の全部・テーマ・タグが入った投稿画面が開く', async () => {
  const k = await open();
  try {
    await k.library();
    assert.equal(await k.frame.locator('[data-edit-draft="d1"]').innerText(), '編集');
    assert.equal(await k.frame.locator('[data-delete-draft="d1"]').innerText(), '削除');
    await k.frame.locator('[data-edit-draft="d1"]').click();
    await k.frame.locator('#composer.open').waitFor();
    assert.equal(await k.frame.locator('#panel').getAttribute('aria-hidden'), 'true', 'ライブラリーは閉じる');
    assert.equal(await k.frame.locator('#title').inputValue(), '早寝より早起き');
    assert.equal(await k.frame.locator('#body').inputValue(), BODY, '100文字で切らずに全部戻す');
    assert.equal(await k.frame.locator('#tags').inputValue(), '睡眠,健康', 'テーマはタグの欄に入れない');
    assert.equal(await k.frame.locator('[data-compose-theme="失敗"]').getAttribute('aria-pressed'), 'true', 'テーマを戻す');
    assert.match(await k.frame.locator('#editingDraftNote').innerText(), /下書きを編集しています/);
    assert.deepEqual(k.errors, []);
  } finally { await k.close(); }
});

test('もう一度「下書き保存」すると、同じ下書きを上書きする', async () => {
  const k = await open();
  try {
    await k.library();
    await k.frame.locator('[data-edit-draft="d1"]').click();
    await k.frame.locator('#body').fill(BODY + '追記した。');
    await k.frame.locator('#draft').click();
    await k.frame.getByText('下書きを上書きしました').waitFor();
    const [saved] = await k.sent('emu-knowledge-draft');
    assert.equal(saved.payload.draftId, 'd1');
    assert.equal(saved.payload.body, BODY + '追記した。');
    assert.equal(saved.payload.tags, '失敗,睡眠,健康');
    assert.equal(await k.frame.locator('#editingDraftNote').isHidden(), true, '閉じたら編集の印は外す');
  } finally { await k.close(); }
});

test('編集して投稿すると、どの下書きから出したかを親に伝える。新しく書くときは伝えない', async () => {
  const k = await open();
  try {
    await k.library();
    await k.frame.locator('[data-edit-draft="d1"]').click();
    await k.frame.locator('#publish').click();
    await k.frame.locator('#composer:not(.open)').waitFor({ state: 'attached' });
    for (let i = 0; i < 40 && !(await k.sent('emu-knowledge-publish')).length; i += 1) await k.page.waitForTimeout(50);
    const [first] = await k.sent('emu-knowledge-publish');
    assert.equal(first.payload.draftId, 'd1');
    assert.equal(first.payload.title, '早寝より早起き');
    // 投稿のあとに新しく書くと、下書きとは結びつかない
    await k.frame.evaluate(() => { document.getElementById('title').value = '新しい知識'; document.getElementById('body').value = '新しく書いた本文です。'; });
    await k.frame.evaluate(() => document.getElementById('composer').classList.add('open'));
    await k.frame.locator('#publish').click();
    for (let i = 0; i < 40 && (await k.sent('emu-knowledge-publish')).length < 2; i += 1) await k.page.waitForTimeout(50);
    const second = (await k.sent('emu-knowledge-publish'))[1];
    assert.equal(second.payload.title, '新しい知識');
    assert.equal(second.payload.draftId, undefined);
  } finally { await k.close(); }
});

/* 親（index.html）の受け持ち。保存先（Firestore）につながないと動かせないので、作りを確かめる。 */
test('親：下書きから来た保存は上書きし、投稿・予約が済んだら、その下書きを消す', () => {
  const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const fn = INDEX.slice(INDEX.indexOf('async function updateKnowledgeDraft'), INDEX.indexOf('const knowledgePublishDrafts'));
  assert.match(fn, /fbLib\.updateDoc\(window\.fbLib\.doc\(window\.db, 'knowledge_drafts', String\(draftId\)\), patch\)/, '同じ下書きを書き換える');
  assert.doesNotMatch(fn, /increment\(/, '上書きでは持っている数を増やさない');
  assert.ok(INDEX.includes("if (payload.draftId) await updateKnowledgeDraft(account, payload.draftId, payload);\n        else await createKnowledgeDraft(account, payload);"), '下書きから来たら上書き');
  assert.ok(INDEX.includes("if (payload.draftId) knowledgePublishDrafts.set(postForm._knowledgeRequestId, String(payload.draftId));"), '投稿の申し込みと下書きを結ぶ');
  assert.ok(INDEX.includes("if (detail.ok && draftId) dropPublishedDraft(draftId);"), '投稿できたときだけ消す');
  assert.ok(INDEX.includes("if (payload.draftId) dropPublishedDraft(String(payload.draftId));"), '予約できたら消す');
  // 上書きは Firestore のルールで本人にだけ許されている（作り直しではないので、件数の上限に引っかからない）
  const RULES = fs.readFileSync(path.join(__dirname, '../../firestore.rules'), 'utf8');
  assert.match(RULES, /match \/knowledge_drafts\/\{draftId\} \{[\s\S]*?allow read, update: if isMyWallet\(resource\.data\.get\('owner', ''\)\);/);
});
