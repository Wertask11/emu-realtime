'use strict';
/* 運営画面の SchoolPark タブで、Quest #000 の中身を読み、論文以外の節を書き直せる（11/5）。
   統合のあと、#000 の中身を見る場所が無く、起業観①に書き足す道も無かった。 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '../..');
const ADMIN = fs.readFileSync(path.join(ROOT, 'frontend/public/membership-admin.html'), 'utf8');
const STORE = fs.readFileSync(path.join(ROOT, 'frontend/public/schoolpark/quest-store.js'), 'utf8');

function fn(name) {
  const start = ADMIN.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name + ' が無い');
  let i = ADMIN.indexOf('{', start), depth = 0;
  for (; i < ADMIN.length; i++) { if (ADMIN[i] === '{') depth++; else if (ADMIN[i] === '}' && --depth === 0) break; }
  return ADMIN.slice(start, i + 1);
}

const FOUNDER = {
  id: 'founder-quest-000', kind: 'founder', questNumber: 0, founderVersion: 4, founderUpdatedAt: Date.parse('2026-11-05T03:00:00Z'),
  founderSections: [
    { title: 'SchoolPark論文', body: '論文の本文' }, { title: 'A：要素', body: 'A' }, { title: 'B：やりたいこと', body: 'B' },
    { title: '起業観①', body: '本の抜粋' }, { title: '起業観②', body: '企業観' }, { title: '人生観', body: '<b>タグはそのまま文字</b>' }
  ]
};

let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

async function open(apiImpl) {
  const page = await browser.newPage();
  await page.setContent('<!doctype html><meta charset="utf-8"><style>.hide{display:none!important}</style><div id="tab"></div>');
  await page.addScriptTag({ content: STORE });
  await page.addScriptTag({ content: [
    'const esc = s => String(s == null ? "" : s).replace(/[&<>"\']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","\'":"&#39;"}[c]));',
    'window.calls = []; window.alerts = []; window.renders = 0;',
    'window.alert = m => window.alerts.push(m); window.confirm = () => true;',
    'function renderSchoolPark() { window.renders++; }',
    'async function api(p, o) { window.calls.push({ p, o }); return (' + apiImpl + ')(p, o); }',
    fn('founderCardHtml'), fn('wireFounderCard'),
    'const el = document.getElementById("tab"); el.innerHTML = founderCardHtml(' + JSON.stringify(FOUNDER) + '); wireFounderCard(el);'
  ].join('\n') });
  return page;
}

test('6つの節をすべて読める。論文には「書き直す」を出さない。本文はタグにならず文字のまま', async () => {
  const page = await open('async () => ({})');
  const titles = await page.$$eval('#spFounderCard summary', s => s.map(x => x.textContent));
  assert.equal(titles.length, 6);
  assert.match(titles[3], /^4\. 起業観①/);
  assert.equal(await page.$('[data-fedit="0"]'), null, '論文に書き直すが出ている');
  assert.equal((await page.$$('[data-fedit]')).length, 5);
  assert.equal(await page.$('#spFounderCard b'), null, '本文のタグが効いている');
  assert.match(await page.textContent('[data-fview="5"]'), /<b>タグはそのまま文字<\/b>/);
  assert.match(await page.textContent('#spFounderCard'), /第4版/);
  await page.close();
});

test('起業観①を書き直すと、番号・題名・開いたときの版・本文をサーバーへ送り、読み直す', async () => {
  const page = await open('async () => ({ ok: true, updated: true, version: 5 })');
  await page.click('#spFounderCard details:nth-of-type(4) summary');
  await page.click('[data-fedit="3"]');
  await page.fill('[data-ftext="3"]', '本の抜粋\nヒルヤー・ヒュヴァー・トゥレー');
  await page.click('[data-fsave="3"]');
  await page.waitForFunction(() => window.renders === 1);
  const calls = await page.evaluate(() => window.calls);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].p, '/api/schoolpark/founder/section');
  assert.deepEqual(calls[0].o, { method: 'POST', body: { index: 3, title: '起業観①', version: 4, body: '本の抜粋\nヒルヤー・ヒュヴァー・トゥレー' } });
  assert.match((await page.evaluate(() => window.alerts))[0], /起業観①」を書き直しました（第5版）/);
  await page.close();
});

test('別のところで書き換わっていたら、上書きされなかったことを伝える（読み直さない＝書いた文は欄に残る）', async () => {
  const page = await open('async () => { throw Object.assign(new Error("VERSION_CONFLICT"), { code: "VERSION_CONFLICT" }); }');
  await page.click('#spFounderCard details:nth-of-type(4) summary');
  await page.click('[data-fedit="3"]');
  await page.fill('[data-ftext="3"]', '書いた文');
  await page.click('[data-fsave="3"]');
  await page.waitForFunction(() => window.alerts.length === 1);
  assert.match((await page.evaluate(() => window.alerts))[0], /別のところで書き換えられていました/);
  assert.equal(await page.evaluate(() => window.renders), 0);
  assert.equal(await page.inputValue('[data-ftext="3"]'), '書いた文');
  await page.close();
});

test('タブの名前に SchoolPark と Emu が出ている', () => {
  assert.ok(ADMIN.includes('<button data-tab="schoolpark">SchoolPark（ギルド・クエスト・#000）</button>'));
  assert.ok(ADMIN.includes('<button data-tab="emu">Emu（知識を読む・探す）</button>'));
});
