'use strict';
/* 画面のエラーを運営に知らせる（frontend/public/client-errors.js、11/3 点検 15）。
   送るのは、エラーの文・このサイトのファイルと行・ページだけ。ほかのサイトのエラーと、同じエラーの繰り返しは送らない。 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '../../frontend/public');
const PAGE = `<!doctype html><meta charset="utf-8"><script src="/client-errors.js"></script><body>
<button id="boom" onclick="null.post">boom</button>
<button id="reject" onclick="Promise.reject(new Error('読めなかった'))">reject</button>
<script>window.addEventListener('load', () => document.body.dataset.ready = '1');</script>`;

let server, base, browser;
before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/page') { res.setHeader('content-type', 'text/html; charset=utf-8'); return res.end(PAGE); }
    const file = path.join(ROOT, url.pathname);
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.statusCode = 404; return res.end(); }
    res.setHeader('content-type', 'text/javascript'); fs.createReadStream(file).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); server?.close(); });

test('エラーと約束の失敗を、決まった中身だけで1回ずつ送る。ほかのサイトのエラーは送らない', async () => {
  const ctx = await browser.newContext();
  const sent = [];
  await ctx.route('https://emu-realtime.onrender.com/api/client-errors', r => {
    sent.push({ type: r.request().headers()['content-type'], body: JSON.parse(r.request().postData()) });
    r.fulfill({ status: 204, body: '' });
  });
  const pg = await ctx.newPage();
  pg.on('pageerror', () => {});
  await pg.goto(base + '/page?secret=1#x');
  await pg.waitForSelector('body[data-ready="1"]');
  await pg.click('#boom'); await pg.click('#boom');   // 同じエラーは1回
  await pg.click('#reject');
  // ほかのサイト（拡張機能など）から来たことにしたエラーは送らない
  await pg.evaluate(() => window.dispatchEvent(new ErrorEvent('error', { message: 'ext', filename: 'chrome-extension://abc/x.js', lineno: 1 })));
  await pg.waitForTimeout(400);
  assert.equal(sent.length, 2, JSON.stringify(sent));
  for (const s of sent) {
    assert.equal(s.type, 'text/plain');
    assert.deepEqual(Object.keys(s.body).sort(), ['col', 'kind', 'line', 'message', 'page', 'source']);
    assert.equal(s.body.page, base + '/page', 'ページの ? と # のうしろを送っている');
  }
  assert.equal(sent[0].body.kind, 'error');
  assert.match(sent[0].body.message, /null|post/);
  assert.equal(sent[1].body.kind, 'rejection');
  assert.match(sent[1].body.message, /読めなかった/);
  await ctx.close();
});

test('主な画面で読み込んでいる', () => {
  for (const f of ['index.html', 'knowledge.html', 'schoolpark/dao.html', 'knowledge-lab.html'])
    assert.ok(fs.readFileSync(path.join(ROOT, f), 'utf8').includes('<script src="/client-errors.js"></script>'), f);
});
