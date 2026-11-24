/* 11/24 オーナー（スマホのスクショ）：書き手アカウントの一覧で、「キーの末尾」の欄の「次に入ったときに出ます」が
   1文字ずつ縦に並び、表が崩れていた。短い「まだ」にして折り返さない。末尾があるときは「…xxxx」を出す。
   本物の membership-admin.html の一覧を作る処理（loadWriters）と、本物の画面の見た目（<style>）で、390px の幅で確かめる。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ADMIN = fs.readFileSync(path.join(__dirname, '../../frontend/public/membership-admin.html'), 'utf8');
const cut = (a, b) => { const i = ADMIN.indexOf(a); const j = ADMIN.indexOf(b, i); assert.ok(i >= 0 && j > i, a); return ADMIN.slice(i, j); };

test('書き手の一覧：キーの末尾は「…xxxx」、まだ無いときは「まだ」。390px でも1行に収まり、縦に崩れない', async () => {
  const style = cut('<style>', '</style>') + '</style>';
  const helpers = cut('const $ = s =>', '\n', ) + '\n' + cut('const esc = s =>', '\n') + '\n';
  const list = cut('async function loadWriters() {', '\ndocument.querySelectorAll(".tabs button")');
  const items = [
    { id: 'aaaaaaaaaaaa', name: 'ミルクティー', note: 'Muse2', active: true, lastLoginAt: Date.UTC(2026, 10, 23, 1, 50), address: '0xb5c1000000000000000000000000000000006689', keyHint: '' },
    { id: 'bbbbbbbbbbbb', name: '店長', note: 'Muse3', active: true, lastLoginAt: Date.UTC(2026, 10, 18, 4, 59), address: '0x0cc1000000000000000000000000000000002494', keyHint: 'Q_7z' },
  ];
  const html = '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">' + style
    + '<body><section id="tab-writers"><div id="wrList"></div></section><script>'
    + helpers + 'const api = async () => ({ items: ' + JSON.stringify(items) + ' });\n' + list
    + '\nloadWriters().then(() => { window.__done = true; });</script></body>';
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.setContent(html);
    await page.waitForFunction('window.__done === true');
    const r = await page.evaluate(() => {
      const head = [...document.querySelectorAll('#wrList thead th')].map(th => th.textContent);
      const col = head.indexOf('キーの末尾');
      const cells = [...document.querySelectorAll('#wrList tbody tr')].map(tr => tr.children[col]);
      const line = c => { const s = getComputedStyle(c); return parseFloat(s.lineHeight) || parseFloat(s.fontSize) * 1.6; };
      return { col, texts: cells.map(c => c.textContent), titles: cells.map(c => (c.querySelector('[title]') || {}).title || ''),
        tall: cells.map(c => c.querySelector('small, code').getBoundingClientRect().height / line(c.querySelector('small, code'))) };
    });
    assert.ok(r.col > 0, '「キーの末尾」の列がある');
    assert.deepEqual(r.texts, ['まだ', '…Q_7z']);
    assert.match(r.titles[0], /作り直すか、正しいキーで1回入ると出ます/);
    for (const [i, lines] of r.tall.entries()) assert.ok(lines < 1.6, `${i + 1}行目の末尾が1行に収まっていない（${lines.toFixed(2)}行分）`);
  } finally { await browser.close(); }
});
