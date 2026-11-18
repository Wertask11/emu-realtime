'use strict';
/* スマホで上から引っぱったら、ブラウザの再読み込みではなく Emu の中の読み直しにする（11/16 オーナー）。

   見ること
     ・知識を読む（中の枠 knowledge.html）で引っぱって離すと、親（Emu）に「読み直して」と頼み、親がその枠の読み直しをする
     ・指を動かしているあいだはブラウザの動き（再読み込み）を止める（preventDefault）
     ・少しだけ引いたとき・下へスクロールしているとき・モーダルの中・横に動かしたときは読み直さない
     ・Emu 本体の画面で引っぱると、本体の読み直し（source は null）
     ・読み直せなかったときは、そう出す（黙って成功に見せない）
     ・パソコンの幅、Emu の外（emuInAppRefresh が無いページ）では何もしない（ブラウザの動きのまま）
     ・index.html の emuInAppRefresh が、引っぱられた場所ごとに正しい読み直しを呼ぶ
   親の役は、このテストの小さなページが受け持つ。本物のサーバーやアカウントは使わない。 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '../../frontend/public');
const PARENT = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<body style="margin:0"><div id="top" style="height:120px;background:#eee">Emu の本体</div>
<iframe id="k" src="/knowledge.html" style="width:100%;height:600px;border:0;display:block"></iframe>
<script>
window.calls = [];
window.failNext = false;
window.emuInAppRefresh = async (source) => {
  window.calls.push(source === null ? 'self' : source === document.getElementById('k').contentWindow ? 'knowledge' : 'other');
  await new Promise(r => setTimeout(r, 60));
  if (window.failNext) { window.failNext = false; throw new Error('down'); }
  return 'ok';
};
</script><script src="/emu-pull-refresh.js"></script></body>`;
const PLAIN = `<!doctype html><meta charset="utf-8"><body><div id="top" style="height:300px">Emu の外</div><script src="/emu-pull-refresh.js"></script></body>`;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

let server, base, browser;
before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/test/parent') { res.setHeader('content-type', TYPES['.html']); return res.end(PARENT); }
    if (url.pathname === '/test/plain') { res.setHeader('content-type', TYPES['.html']); return res.end(PLAIN); }
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

async function open(url = '/test/parent', { width = 390 } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: true, isMobile: width < 700 });
  await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(base + url);
  await page.waitForFunction(() => window.emuPullRefresh);
  let frame = null;
  if (url === '/test/parent') {
    await page.waitForFunction(() => document.getElementById('k').contentWindow.emuPullRefresh);
    frame = page.frames().find(f => f.url().endsWith('/knowledge.html'));
  }
  return { page, frame, errors, close: () => context.close() };
}
/* 指で上から下へ（dy）動かして離す。preventDefault されたか（ブラウザの動きを止めたか）を返す。 */
function pull(where, selector, dy, dx = 0) {
  return where.evaluate(({ selector, dy, dx }) => {
    const el = document.querySelector(selector);
    const r = el.getBoundingClientRect(); const x = r.left + 20, y = r.top + 20;
    const t = (cy, cx) => new Touch({ identifier: 1, target: el, clientX: cx, clientY: cy });
    const fire = (type, touches, changed) => { const ev = new TouchEvent(type, { bubbles: true, cancelable: true, touches, targetTouches: touches, changedTouches: changed }); el.dispatchEvent(ev); return ev.defaultPrevented; };
    fire('touchstart', [t(y, x)], [t(y, x)]);
    let prevented = false;
    for (let i = 1; i <= 10; i++) { const p = t(y + dy * i / 10, x + dx * i / 10); prevented = fire('touchmove', [p], [p]) || prevented; }
    fire('touchend', [], [t(y + dy, x + dx)]);
    return prevented;
  }, { selector, dy, dx });
}
const pillText = where => where.evaluate(() => document.getElementById('emuPtr')?.innerText || '');

test('知識を読む（中の枠）で引っぱって離すと、ブラウザではなく Emu が知識を読み直す', async () => {
  const w = await open();
  try {
    assert.equal(await w.frame.evaluate(() => document.documentElement.classList.contains('emu-ptr')), true, 'ブラウザの引っぱり再読み込みを止める印');
    assert.equal(await w.frame.evaluate(() => getComputedStyle(document.documentElement).overscrollBehaviorY), 'none');
    const prevented = await pull(w.frame, '#posts', 220);
    assert.equal(prevented, true, '指を動かしているあいだはブラウザの再読み込みにしない');
    await w.frame.waitForFunction(() => /読み直しました/.test(document.getElementById('emuPtr')?.innerText || ''));
    assert.deepEqual(await w.page.evaluate(() => window.calls), ['knowledge']);
    assert.deepEqual(w.errors, []);
  } finally { await w.close(); }
});

test('少しだけ・下へスクロール中・モーダルの中・横の動きでは読み直さない', async () => {
  const w = await open();
  try {
    assert.equal(await pull(w.frame, '#posts', 60), true);
    await w.frame.waitForTimeout(150);
    assert.deepEqual(await w.page.evaluate(() => window.calls), [], '少しだけ引いて戻したときは読み直さない');

    assert.equal(await pull(w.frame, '#posts', 30, 160), false, '横に動かすのは邪魔しない');

    await w.frame.evaluate(() => { const m = document.createElement('div'); m.id = 'modal'; m.style.cssText = 'position:fixed;inset:0;background:#fff8'; m.innerHTML = '<p id="inmodal">モーダル</p>'; document.body.appendChild(m); });
    assert.equal(await pull(w.frame, '#inmodal', 220), false, 'モーダルの中は邪魔しない');
    await w.frame.evaluate(() => document.getElementById('modal').remove());

    await w.frame.evaluate(() => { document.body.style.minHeight = '4000px'; window.scrollTo(0, 400); });
    assert.equal(await pull(w.frame, '#posts', 220), false, '下へスクロールしているときは、ふつうに上へ戻るだけ');
    await w.frame.waitForTimeout(150);
    assert.deepEqual(await w.page.evaluate(() => window.calls), []);
  } finally { await w.close(); }
});

test('Emu 本体の画面で引っぱると本体を読み直す。読み直せなかったときは、そう出す', async () => {
  const w = await open();
  try {
    await w.page.evaluate(() => { window.failNext = true; });
    assert.equal(await pull(w.page, '#top', 220), true);
    await w.page.waitForFunction(() => /読み直せませんでした/.test(document.getElementById('emuPtr')?.innerText || ''));
    assert.deepEqual(await w.page.evaluate(() => window.calls), ['self']);
    await w.page.waitForTimeout(2800);
    await pull(w.page, '#top', 220);
    await w.page.waitForFunction(() => /読み直しました/.test(document.getElementById('emuPtr')?.innerText || ''));
    assert.deepEqual(await w.page.evaluate(() => window.calls), ['self', 'self']);
    // 中の枠からの読み直しが失敗したときも、枠の中で「読み直せませんでした」
    await w.page.evaluate(() => { window.failNext = true; });
    await pull(w.frame, '#posts', 220);
    await w.frame.waitForFunction(() => /読み直せませんでした/.test(document.getElementById('emuPtr')?.innerText || ''));
  } finally { await w.close(); }
});

test('パソコンの幅と、Emu の外のページでは何もしない（ブラウザの動きのまま）', async () => {
  const wide = await open('/test/parent', { width: 1200 });
  try {
    assert.equal(await wide.frame.evaluate(() => document.documentElement.classList.contains('emu-ptr')), false);
    assert.equal(await pull(wide.frame, '#posts', 220), false);
    assert.deepEqual(await wide.page.evaluate(() => window.calls), []);
  } finally { await wide.close(); }
  const plain = await open('/test/plain');
  try {
    assert.equal(await plain.page.evaluate(() => document.documentElement.classList.contains('emu-ptr')), false);
    assert.equal(await pull(plain.page, '#top', 220), false);
    assert.equal(await pillText(plain.page), '');
  } finally { await plain.close(); }
});

/* index.html の emuInAppRefresh を取り出して、引っぱられた場所ごとの読み直し先を確かめる */
test('index.html：知識を読む・SchoolPark・価値プロフィール・ほかの画面で、それぞれの読み直しを呼ぶ', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const start = html.indexOf('window.emuInAppRefresh = async function');
  assert.ok(start > 0);
  const code = html.slice(start, html.indexOf('\n};\n', start) + 3);
  const called = [];
  const frames = { emuKnowledgeFrame: { contentWindow: { k: 1 } }, spDaoFrame: { contentWindow: { d: 1 } }, spRoomFrame: { contentWindow: { r: 1 } } };
  let classes = new Set();
  const window = {
    syncKnowledgeFrame: async (o) => called.push('knowledge:' + JSON.stringify(o)),
    spDaoRefreshNow: async (why) => called.push('sp:' + why),
    loadEmuValueProfile: async () => called.push('profile'),
    showEmuRequests: () => called.push('requests'),
    showEmuPractice: () => called.push('practice')
  };
  const document = { getElementById: id => frames[id] || null, body: { classList: { contains: c => classes.has(c) } } };
  vm.runInNewContext(code, { window, document });
  assert.equal(await window.emuInAppRefresh(frames.emuKnowledgeFrame.contentWindow), 'knowledge');
  assert.equal(await window.emuInAppRefresh(frames.spDaoFrame.contentWindow), 'schoolpark');
  assert.equal(await window.emuInAppRefresh(frames.spRoomFrame.contentWindow), 'schoolpark');
  classes = new Set(['emu-profile-open']);
  assert.equal(await window.emuInAppRefresh(null), 'profile');
  classes = new Set(['emu-requests-open']);
  assert.equal(await window.emuInAppRefresh(null), 'view');
  classes = new Set(['emu-practice-open']);
  assert.equal(await window.emuInAppRefresh(null), 'view');
  assert.deepEqual(called, ['knowledge:{"append":false,"strict":true}', 'sp:引っぱって読み直し', 'sp:引っぱって読み直し', 'profile', 'requests', 'practice']);
});
