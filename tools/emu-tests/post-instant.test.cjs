'use strict';
/* 11/27 オーナー（スマホのスクショ）：「投稿し終わったあとはすぐに反映して。前できてたのに最近遅い。閉じるのも遅い」。

   原因：親（index.html）は、一覧の読み直し（refreshAllPosts → syncKnowledgeFrame）が全部終わるまで
   「書けました」を返していなかった。読み直しは、段・書き手・下書き・予約・テーマ・総数・Good数・みんなの結論を
   順に待つので数秒〜十数秒かかり、裏の読み直しが走っていればその後ろに並ぶ。その間、書く画面は閉じなかった。

   直したこと
   1. 書けた時点で「書けました」を返して閉じる。読み直しは待たずに裏で走らせる。
   2. 書いた投稿は、読み直しを待たずに一覧の先頭へすぐ出す（emu-knowledge-post-added）。
   3. 書く前に始まっていた読み直しが遅れて届いても、書いた投稿が一度消えて見えないようにする。 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '../../frontend/public');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const OLD = { id: 'old1', title: '前からある知識', body: '前の本文', tags: '', address: '0xbbb', displayName: 'だれか', createdAt: '2026-11-20T00:00:00.000Z' };
const NEW = { id: 'new1', title: '届ける', body: '完璧じゃなくていいから、まずは誰かに届けてみる。', tags: '届ける', address: '0xabc', displayName: 'わたし', createdAt: '2026-11-27T09:00:00.000Z' };
const PARENT = `<!doctype html><meta charset="utf-8"><iframe id="k" src="/knowledge.html" style="width:420px;height:860px;border:0"></iframe>
<script>
window.sent = [];
const f = document.getElementById('k');
window.toK = m => f.contentWindow.postMessage(m, location.origin);
addEventListener('message', e => {
  if (e.source !== f.contentWindow) return;
  const m = e.data || {};
  window.sent.push(m);
  if (m.type === 'emu-knowledge-ready') toK({ type:'emu-knowledge-posts', posts:[${JSON.stringify(OLD)}], totalCount:1, drafts:[], canDraft:true, canSchedule:true, account:'0xabc' });
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


test('親：書けたらすぐ「書けました」を返し、書いた投稿を先に送る。一覧の読み直しは待たない', () => {
  const i = INDEX.indexOf('postForm.addEventListener("submit"');
  const src = INDEX.slice(i, INDEX.indexOf('\n});', i));
  const show = src.indexOf('window.emuKnowledgeShowPost?.(_shownId, postData');
  const done = src.indexOf('finishKnowledgeRequest(true, "")');
  const refresh = src.indexOf('refreshAllPosts()');
  assert.ok(show > 0 && done > show, '書いた投稿を送ってから「書けました」を返す');
  assert.ok(refresh > done, '読み直しは「書けました」のあと');
  assert.ok(!/await\s+refreshAllPosts\(\)/.test(src), '読み直しを待たない（待つと書く画面が閉じない）');
  assert.match(INDEX, /window\.emuKnowledgeShowPost = function \(id, data, edited\)/);
});

test('知識を読む：書いた投稿がすぐ先頭に出る。遅れて届いた古い一覧でも消えず、新しい一覧では二重にならない', async () => {
  const context = await browser.newContext({ viewport: { width: 420, height: 900 } });
  await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(base + '/test/parent');
    const frame = page.frames().find(f => f.url().endsWith('/knowledge.html'));
    await page.waitForFunction(() => window.sent.some(m => m.type === 'emu-knowledge-ready'));
    const titles = () => frame.locator('article.card h3').allInnerTexts();
    await frame.locator('article.card h3').first().waitFor();
    assert.deepEqual(await titles(), [OLD.title]);

    await page.evaluate(p => toK({ type:'emu-knowledge-post-added', post:p, edited:false, authors:{} }), NEW);
    await frame.waitForFunction(() => document.querySelectorAll('article.card').length === 2);
    assert.deepEqual(await titles(), [NEW.title, OLD.title], '書いた投稿がすぐ先頭に出る');

    // 書く前に始まっていた読み直しが、いま届いた（書いた投稿はまだ入っていない）
    await page.evaluate(p => toK({ type:'emu-knowledge-posts', posts:[p], totalCount:1, drafts:[], canDraft:true, canSchedule:true, account:'0xabc' }), OLD);
    await page.waitForTimeout(200);
    assert.deepEqual(await titles(), [NEW.title, OLD.title], '古い一覧が届いても、書いた投稿は消えない');

    // 書いたあとの読み直し（書いた投稿が入っている）
    await page.evaluate(([a, b]) => toK({ type:'emu-knowledge-posts', posts:[a, b], totalCount:2, drafts:[], canDraft:true, canSchedule:true, account:'0xabc' }), [NEW, OLD]);
    await page.waitForTimeout(200);
    assert.deepEqual(await titles(), [NEW.title, OLD.title], '二重に出ない');

    // 直した投稿は、その場で中身だけ入れ替わる（並びは変わらない）
    await page.evaluate(p => toK({ type:'emu-knowledge-post-added', post:{ ...p, title:'前からある知識（直した）' }, edited:true, authors:{} }), OLD);
    await page.waitForTimeout(200);
    assert.deepEqual(await titles(), [NEW.title, '前からある知識（直した）']);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});
