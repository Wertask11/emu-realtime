/* クエスト詳細の「現場の資料を読む」と、右の ACCEPT。

   1. 資料が勝手に閉じていた。
      SchoolPark の画面は、描き直すたびにまるごと作り直す。<details> は
      毎回「閉じた」状態で生まれ直す。親（index.html）は、タブに戻った
      とき・画面に戻ったとき・5分ごとに中身を読み直して描き直すので、
      長い資料を読んでいる途中で閉じた。

   2. 右の ACCEPT が見切れていた。
      資料を下へ読み進めると、右の列も一緒に上へ流れて、見出しの下に
      隠れた。「受ける」「知恵カードを置く」「完了にする」が見えなくなる。
      その前は top:24px で止めていて、見出し（およそ90px）の下に潜って切れた。

   本物の dao.html を iframe の中で開いて確かめる（直に開くと入口へ戻される）。

   使い方:
     npm ci --prefix tools/guild-tests
     node --test tools/guild-tests/quest-detail-keep.test.cjs               */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

const PUB = path.join(__dirname, '..', '..', 'frontend', 'public');
const PARENT = '<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%}'
  + 'iframe{border:0;width:100%;height:100%;display:block}</style>'
  + '<iframe src="/schoolpark/dao.html"></iframe>';

/* 資料は長くしておく。読み進める（下へ動かす）余地が要る。 */
const BRIEF = Array.from({ length: 60 }, (_, i) => '現場の資料 ' + (i + 1) + '行目。').join('\n');
const caseQuest = (id, title) => ({
  id, status: 'OPEN', fullTitle: title, title, isCase: true, introShow: 'none',
  briefShow: 'block', brief: BRIEF, briefImageShow: 'none',
  given: '与件', deliverable: '提出するもの', criteria: '評価',
  commits: 1, need: 5, iTook: true, isMine: true, progress: '20%',
  people: ['俺たちの青春'], budget: '50 EMUER', perHead: '0 EMUER'
});
const QUESTS = [caseQuest('q1', '#002-1 入門 地域イベントのアイデアを3案出す'),
                caseQuest('q2', '#002-1 標準 地域イベントのアイデアを1案に絞る')];
const FOUNDER = { id: 'founder-quest-000', isFounder: true, status: 'OPEN', title: 'SchoolPark Quest #000',
  founderSections: [{ title: '第1章 はじまり', body: '本文1' }, { title: '第2章 原点', body: '本文2' }] };

let server, base, browser;

before(async () => {
  server = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
    if (u === '/test/parent.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(PARENT);
    }
    fs.readFile(path.join(PUB, u), (e, d) => {
      if (e) { res.writeHead(404); return res.end('nf'); }
      res.writeHead(200, { 'Content-Type': u.endsWith('.html') ? 'text/html' : 'text/javascript' });
      res.end(d);
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); server?.close(); });

/* 画面を開いて、クエスト詳細を出す。外への通信（フォントなど）は止める。 */
async function open(width, height, state) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  await ctx.route('**/*', r => (new URL(r.request().url()).origin === base ? r.continue() : r.abort()));
  const top = await ctx.newPage();
  const errors = [];
  top.on('pageerror', e => errors.push(e.message));
  await top.goto(base + '/test/parent.html');
  await top.waitForFunction(() => !!(document.querySelector('iframe').contentWindow || {}).app);
  const frame = top.frames().find(f => f.url().endsWith('/schoolpark/dao.html'));
  await frame.evaluate(s => window.app.setState(s),
    Object.assign({ screen: 'detail', expId: 'q1', quests: QUESTS }, state || {}));
  return { frame, ctx, errors };
}

/* 親の読み直しと同じこと（どの読み直しも最後は setState になる）。 */
const redraw = frame => frame.evaluate(async () => {
  window.app.setState({});
  window.app.setState({});
  await new Promise(r => setTimeout(r, 30));
});
const briefOpen = frame => frame.evaluate(() => {
  const d = [...document.querySelectorAll('details')].find(x => /現場の資料を読む/.test(x.textContent));
  return !!(d && d.open);
});

test('現場の資料は、裏の読み直しで閉じない（読んでいた位置も動かない）', async () => {
  const { frame, ctx, errors } = await open(1853, 961);
  try {
    await frame.locator('summary', { hasText: '現場の資料を読む' }).click();
    assert.equal(await briefOpen(frame), true);
    const at = await frame.evaluate(() => { window.app.scroller.current.scrollTop = 500; return window.app.scroller.current.scrollTop; });
    await redraw(frame);
    assert.equal(await briefOpen(frame), true, '描き直しで資料が閉じた');
    assert.equal(await frame.evaluate(() => window.app.scroller.current.scrollTop), at, '読んでいた位置が動いた');
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test('手で閉じた資料は、閉じたまま', async () => {
  const { frame, ctx } = await open(1853, 961);
  try {
    const summary = frame.locator('summary', { hasText: '現場の資料を読む' });
    await summary.click();
    await summary.click();
    await redraw(frame);
    assert.equal(await briefOpen(frame), false);
  } finally { await ctx.close(); }
});

test('別のクエストへ、開き方を持ち越さない', async () => {
  const { frame, ctx } = await open(1853, 961);
  try {
    await frame.locator('summary', { hasText: '現場の資料を読む' }).click();
    await frame.evaluate(() => window.app.setState({ expId: 'q2' }));
    await frame.evaluate(() => new Promise(r => setTimeout(r, 30)));
    assert.match(await frame.evaluate(() => document.body.textContent), /1案に絞る/);
    assert.equal(await briefOpen(frame), false);
  } finally { await ctx.close(); }
});

test('#000 の章も、開いたまま', async () => {
  const { frame, ctx } = await open(1853, 961,
    { expId: FOUNDER.id, quests: [FOUNDER].concat(QUESTS) });
  try {
    await frame.locator('summary', { hasText: '第2章 原点' }).click();
    await redraw(frame);
    const opened = await frame.evaluate(() => [...document.querySelectorAll('details')]
      .map(d => d.querySelector('summary').textContent.trim() + ':' + d.open));
    assert.deepEqual(opened, ['第1章 はじまり:false', '第2章 原点:true']);
  } finally { await ctx.close(); }
});

/* ───────── 右の ACCEPT ───────── */

async function measure(frame, scroll) {
  return frame.evaluate(async y => {
    const sc = window.app.scroller.current;
    sc.scrollTop = y;
    await new Promise(r => setTimeout(r, 60));
    const head = document.querySelector('[data-sp-head]').getBoundingClientRect();
    const side = document.querySelector('.sp-quest-side');
    const label = [...side.querySelectorAll('div')].find(x => x.textContent.trim() === 'ACCEPT');
    const card = label.closest('div[style*="background:#141310"]').getBoundingClientRect();
    return {
      headBottom: head.bottom, cardTop: card.top, cardBottom: card.bottom, vh: window.innerHeight,
      position: getComputedStyle(side).position,
      cols: getComputedStyle(document.querySelector('.sp-quest-detail-grid')).gridTemplateColumns.split(' ').length,
      overflowX: side.scrollWidth - side.clientWidth
    };
  }, scroll);
}

for (const [w, h] of [[1853, 961], [1440, 900], [1440, 640]]) {
  test(`資料を読み進めても、ACCEPT は見出しのすぐ下に見えている（${w}×${h}）`, async () => {
    const { frame, ctx } = await open(w, h);
    try {
      await frame.locator('summary', { hasText: '現場の資料を読む' }).click();
      const m = await measure(frame, 600);
      assert.equal(m.cols, 2);
      assert.equal(m.position, 'sticky');
      assert.ok(m.cardTop >= m.headBottom, `見出しの下に潜っている: card ${m.cardTop} < head ${m.headBottom}`);
      assert.ok(m.cardTop <= m.headBottom + 40, `見出しから離れすぎ: ${m.cardTop - m.headBottom}px`);
      assert.ok(m.cardBottom <= m.vh, `下が切れている: ${m.cardBottom} > ${m.vh}`);
      assert.ok(m.overflowX <= 0, '右の列が横にはみ出している');
    } finally { await ctx.close(); }
  });
}

test('画面が低くても、右の列の中で「受けている人」まで見られる', async () => {
  const { frame, ctx } = await open(1440, 640);
  try {
    await frame.locator('summary', { hasText: '現場の資料を読む' }).click();
    await measure(frame, 600);
    const r = await frame.evaluate(async () => {
      const side = document.querySelector('.sp-quest-side');
      side.scrollTop = side.scrollHeight;
      await new Promise(res => setTimeout(res, 60));
      const people = [...side.querySelectorAll('div')].find(x => /^受けている人/.test(x.textContent.trim()));
      return { bottom: people.closest('div[style*="border-radius:12px"]').getBoundingClientRect().bottom, vh: window.innerHeight };
    });
    assert.ok(r.bottom <= r.vh, `受けている人が画面の外: ${r.bottom} > ${r.vh}`);
  } finally { await ctx.close(); }
});

for (const [w, h] of [[1280, 800], [834, 1112], [390, 844]]) {
  test(`1列のときは止めない（${w}×${h}）`, async () => {
    const { frame, ctx } = await open(w, h);
    try {
      const m = await measure(frame, 0);
      assert.equal(m.cols, 1);
      assert.equal(m.position, 'static', '1列で止めると、下の中身に重なる');
    } finally { await ctx.close(); }
  });
}
