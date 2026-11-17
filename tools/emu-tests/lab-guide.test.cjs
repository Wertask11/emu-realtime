'use strict';
/* Knowledge Lab（11/17 オーナー）
   ・名前は「Knowledge Lab」「Knowledge Text」（頭の Emu を外す）。文言はオーナーの指定どおり
   ・「はじめての使い方・投稿ガイド」は、ページを移らずに Lab の中の窓で開く。
     前は別タブで開き、スマホ・アプリ内ブラウザでは同じ画面で開いて、ガイドの「戻る」で Emu が最初（ロゴの画面）から読み直しになっていた
   ・Emu の冷蔵庫くんの「この画面のガイド」が、Lab を開いているあいだ「準備中」だった。Lab の画面ごとのガイドを呼ぶ
   サーバーへの通信は止めて開く（本物のアカウントやデータは使わない）。 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '../../frontend/public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json' };
let server, base, browser;
before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
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

async function openLab() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(base + '/knowledge-lab.html');
  await page.waitForFunction(() => window.EmuLabGuide);
  return { page, errors, close: () => context.close() };
}

test('名前と文言：Knowledge Lab・Knowledge Text、説明文と3つのカードはオーナーの指定どおり', async () => {
  const lab = fs.readFileSync(path.join(ROOT, 'knowledge-lab.html'), 'utf8');
  const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(lab, /<h1>Knowledge Lab<\/h1>/);
  assert.match(index, /<h3>Knowledge Lab<\/h3><p>教科書にない答えは、経験の中にある。違う経験同士を組み合わせて、自分だけの答えを探す場所。<\/p>/);
  assert.match(index, /<h3>Knowledge Text<\/h3>/);
  for (const dir of ['', 'knowledge-lab/', 'reizo/', 'schoolpark/'])
    for (const f of fs.readdirSync(path.join(ROOT, dir)).filter(n => /\.(html|js)$/.test(n)))
      assert.doesNotMatch(fs.readFileSync(path.join(ROOT, dir, f), 'utf8'), /Emu Knowledge (Lab|Text)/, dir + f);
  const w = await openLab();
  try {
    const intro = await w.page.locator('.intro').innerText();
    /* 11/18 オーナー：説明文と研究所の注意書きは消す。上の帯は「KNOWLEDGE LAB」と「← Emu for SchoolParkに戻る」 */
    assert.doesNotMatch(intro, /誰かの経験が、あなたのヒントになる/);
    assert.doesNotMatch(await w.page.content(), /人が考える研究ノートとして利用できます/);
    assert.equal((await w.page.locator('.lab-header > div:first-child').innerText()).trim(), 'KNOWLEDGE LAB');
    assert.equal((await w.page.locator('#backToEmu').innerText()).trim(), '← Emu for SchoolParkに戻る');
    assert.equal(await w.page.locator('.lab-step').count(), 0);
    /* 11/18 オーナー：知識図書館は廃止。掛け合わせる画面の名前は「Knowledge Lab」で、開いたら最初にここ */
    assert.deepEqual(await w.page.$$eval('nav.tabs button:not([hidden])', bs => bs.map(b => b.textContent.replace(/\s+/g, '').trim())),
      ['KnowledgeLab', 'マイライブラリー', '書き手プロフィール']);
    assert.equal(await w.page.locator('#library').isVisible(), false, '知識図書館は出さない');
    assert.equal(await w.page.locator('#research').isVisible(), true, '最初に Knowledge Lab（掛け合わせ）を出す');
    assert.equal((await w.page.locator('#research .lead').innerText()).trim(), '違う経験を2〜3つ重ねると、自分だけの答えが見えてくる');
    assert.doesNotMatch(await w.page.locator('body').innerText(), /知識図書館|掛け合わせ研究所/);
    assert.doesNotMatch(intro, /別タブ/);
    assert.deepEqual(w.errors, []);
  } finally { await w.close(); }
});

test('ガイドはページを移らずに窓で開き、閉じたら Knowledge Lab のまま。中の「経験知を書き始める」は窓を閉じる', async () => {
  const w = await openLab();
  try {
    const url = w.page.url();
    await w.page.locator('#openGuide').click();
    await w.page.locator('#guideDialog[open]').waitFor();
    const frame = w.page.frames().find(f => f.url().includes('knowledge-lab-guide.html?embed=1'));
    assert.ok(frame, 'ガイドは窓の中で開く');
    await frame.waitForLoadState();
    assert.equal(await frame.evaluate(() => getComputedStyle(document.querySelector('.lab-header')).display), 'none', '窓の中ではガイドの上の帯を出さない');
    await frame.locator('#participate').click();
    await w.page.waitForFunction(() => !document.getElementById('guideDialog').open);
    assert.equal(w.page.url(), url, 'ページは移らない（Emu を最初から読み直さない）');
    // もう一度開いて、× で閉じる
    await w.page.locator('#openGuide').click();
    await w.page.locator('#guideDialog[open]').waitFor();
    await w.page.locator('#guideDialog .close').click();
    assert.equal(await w.page.evaluate(() => document.getElementById('guideDialog').open), false);
    assert.equal(w.page.url(), url);
    assert.deepEqual(w.errors, []);
  } finally { await w.close(); }
});

test('Lab は自分の画面ごとのガイドを外（Emu の冷蔵庫くん）へ出す', async () => {
  const w = await openLab();
  try {
    assert.equal(await w.page.evaluate(() => window.EmuLabGuide.available()), true);
  } finally { await w.close(); }
});

/* reizo/mode-switch.js の guideInfo：Lab を小部屋で開いているあいだは、Lab のガイドを「見られる」にする */
test('冷蔵庫くんの「この画面のガイド」：Lab を開いているあいだは準備中にならず、Lab のガイドを呼ぶ', () => {
  const src = fs.readFileSync(path.join(ROOT, 'reizo/mode-switch.js'), 'utf8');
  const code = src.slice(src.indexOf('  function labGuide()'), src.indexOf('  function closeRequestWin()'));
  let started = 0;
  const labWin = { EmuLabGuide: { available: () => true, progress: () => ({ state: 'none' }), start: () => { started++; } } };
  const classes = new Set(['sp-room-open']);
  const ctx = {
    document: { body: { classList: { contains: c => classes.has(c) } }, getElementById: id => (id === 'spRoomFrame' ? { contentWindow: labWin } : null) },
    window: { ReizoTour: { list: () => [] } },
    screenId: () => '',
  };
  vm.runInNewContext(code + '\nthis.guideInfo = guideInfo;', ctx);
  const g = ctx.guideInfo();
  assert.equal(g.ok, true, 'Lab のガイドがあるので「準備中」にしない');
  g.lab.start();
  assert.equal(started, 1);
  classes.delete('sp-room-open');
  assert.equal(ctx.guideInfo().ok, false, '小部屋を閉じていれば、Emu の画面のガイドを見る（ここでは無い）');
  assert.match(src, /if \(g\.lab\) \{ g\.lab\.start\(\); return; \}/, '選んだら Lab のガイドを始める');
});

test('知識を試すの説明文はオーナーの指定どおり', () => {
  const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(index, /<p>同じ興味の仲間が集まる場所。みんなの挑戦や悩みを見て、『自分もやってみよう』が見つかる。<\/p>/);
  assert.match(index, /<p>知識を、実際にやってみよう。完了を報告して、知恵カードとして残そう。<\/p>/);
});

/* 冷蔵庫くんのガイド：大きな対象を案内しているとき、スクロールのたびに元の位置へ戻していた（「スクロール進まない」） */
test('ガイドの自動のずらしは、1つの手順につき1回だけ（自分のスクロールを戻さない）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'tour/reizo-tour.js'), 'utf8');
  assert.match(src, /if \(!shifted\) \{\s*shifted = true;/);
  assert.match(src, /scrolled = false; shifted = false;/, '次の手順に進んだら、また1回ずらせる');
  const lab = fs.readFileSync(path.join(ROOT, 'knowledge-lab/lab.js'), 'utf8');
  assert.doesNotMatch(lab, /"lab-search",\s*"キーワードだけでも探せるよ"/, '知識図書館の案内は外した（11/18）');
  assert.match(lab, /"lab-intro",\s*"ここが Knowledge Lab"/, 'Knowledge Lab の案内から始まる');
});

/* 11/18 オーナー：「冷蔵庫くんは全部、Emu の冷蔵庫くんの窓（聞く・頼む・この画面のガイドを左上で切り替える）に統一して」 */
test('Lab の冷蔵庫くんボタンは、Emu の中では Emu の冷蔵庫くんの窓を開く（古い選ぶ窓は使わない）', () => {
  const lab = fs.readFileSync(path.join(ROOT, 'knowledge-lab/lab.js'), 'utf8');
  assert.doesNotMatch(lab, /tour\.choose\(/);
  assert.match(lab, /host\.ReizoTourAsk\(event\.currentTarget\)/);
  for (const f of ['admin/room1/index.html', 'knowledge.html', 'schoolpark/dao.html'])
    assert.doesNotMatch(fs.readFileSync(path.join(ROOT, f), 'utf8'), /\.choose\(/, f + ' も古い選ぶ窓を開かない');
});

/* 11/18 オーナー：「分類で絞って探す機能は、検索バーに追加して」。知識を読む（knowledge.html）の検索バーに「分類で絞る」 */
test('知識を読む：検索バーの「分類で絞る」で、分野などから絞れる。外すと元に戻る', async () => {
  const PARENT = `<!doctype html><meta charset="utf-8"><iframe id="k" src="/knowledge.html" style="width:1100px;height:900px;border:0"></iframe>
<script>window.sent=[];const f=document.getElementById('k');window.toFrame=m=>f.contentWindow.postMessage(m,location.origin);
addEventListener('message',e=>{if(e.source===f.contentWindow)window.sent.push(e.data||{});});</script>`;
  const terms = [{ id: 'f-edu', axis: 'field', label: '教育・学び', active: true }, { id: 'f-it', axis: 'field', label: 'IT・AI', active: true }, { id: 'i-shop', axis: 'industry', label: '小売', active: true }];
  const context = await browser.newContext({ viewport: { width: 1200, height: 950 } });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/test/parent') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: PARENT });
    if (url.pathname === '/api/knowledge-lab/taxonomy') return route.fulfill({ json: terms });
    return url.origin === base ? route.continue() : route.abort();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(base + '/test/parent');
    await page.waitForFunction(() => window.sent.some(m => m.type === 'emu-knowledge-ready'));
    const frame = page.frames().find(f => f.url().endsWith('/knowledge.html'));
    const now = new Date().toISOString();
    const posts = [
      { id: 'a', title: '授業の工夫', body: '本文', address: '0x' + '1'.repeat(40), displayName: 'A', createdAt: now, facets: { field: ['f-edu'] } },
      { id: 'b', title: 'AIで効率化', body: '本文', address: '0x' + '2'.repeat(40), displayName: 'B', createdAt: now, facets: { field: ['f-it'], industry: ['i-shop'] } },
      { id: 'c', title: '分類なしの知識', body: '本文', address: '0x' + '3'.repeat(40), displayName: 'C', createdAt: now }];
    await page.evaluate(p => window.toFrame({ type: 'emu-knowledge-posts', posts: p, hasMore: false, totalCount: 3 }), posts);
    await frame.waitForFunction(() => document.querySelectorAll('#posts .card').length === 3);
    const titles = () => frame.$$eval('#posts .card h2, #posts .card h3', hs => hs.map(h => h.textContent.trim()).filter(t => /授業|AI|分類なし/.test(t)));
    await frame.locator('#facetFilter').click();
    await frame.locator('[data-term="f-it"]').click();
    await frame.waitForFunction(() => document.querySelectorAll('#posts .card').length === 1);
    assert.deepEqual(await titles(), ['AIで効率化'], '分野で絞れる');
    assert.match(await frame.locator('#facetFilter').innerText(), /分類で絞る（1）/);
    await frame.locator('[data-term="f-edu"]').click();
    await frame.waitForFunction(() => document.querySelectorAll('#posts .card').length === 2);
    assert.equal((await titles()).length, 2, '同じ分類の中は「どれか」');
    await frame.locator('[data-term="i-shop"]').click();
    await frame.waitForFunction(() => document.querySelectorAll('#posts .card').length === 1);
    assert.deepEqual(await titles(), ['AIで効率化'], '違う分類どうしは「すべて」');
    await frame.locator('[data-kf-clear]').click();
    await frame.waitForFunction(() => document.querySelectorAll('#posts .card').length === 3);
    assert.match(await frame.locator('#facetFilter').innerText(), /^分類で絞る$/);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('親（index.html）は、知識を読むへ渡す投稿に分類の ID を添える', () => {
  const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const code = index.slice(index.indexOf('  function knowledgeFacetIds(data) {'), index.indexOf('\n  }\n', index.indexOf('  function knowledgeFacetIds(data) {')) + 4);
  const raw = vm.runInNewContext(code + ';knowledgeFacetIds');
  const fn = (v) => JSON.parse(JSON.stringify(raw(v)));
  assert.deepEqual(fn({ knowledgeLab: { facets: { field: ['f-edu', 'bad id!'], industry: [] } } }), { field: ['f-edu'] });
  assert.deepEqual(fn({ facets: { field: ['x1'] } }), { field: ['x1'] });
  assert.deepEqual(fn({}), {});
  assert.match(index, /facets: knowledgeFacetIds\(data\),/);
});
