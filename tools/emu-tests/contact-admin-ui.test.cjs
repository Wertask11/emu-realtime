/* 運営画面の「お問い合わせ」タブ（membership-admin.html の renderContacts）。
   届いた本文や名前は利用者が書いたものなので、そのまま HTML にせず、文字として出すこと。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { grab } = require('../year-goals-tests/extract.cjs');

const html = fs.readFileSync(path.join(__dirname, '../../frontend/public/membership-admin.html'), 'utf8');

test('the contacts tab exists and shows what was sent, escaped, with the right mark', async () => {
  assert.ok(html.includes('<button data-tab="contacts">お問い合わせ</button>'));
  assert.ok(html.includes('<section id="tab-contacts" class="hide"></section>'));
  const consts = html.match(/const CONTACT_TYPE_LABEL = [\s\S]*?\nlet _contactStatus = "open";/)[0];
  const el = { innerHTML: '', querySelectorAll: () => [] };
  const calls = [];
  const ctx = {
    $: () => el,
    esc: s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    fmt: v => String(v || ''),
    api: async p => { calls.push(p); return { counts: { open: 1, done: 2 }, rows: [{ id: 'x1', type: 'event', name: '<b>店</b>', email: 'shop@example.com', company: 'カフェ', topic: '店舗提携', message: '<img src=x onerror=alert(1)>相談です', submittedAt: '2026-10-27', status: 'open' }] }; },
    window: { alert() {} },
  };
  vm.runInNewContext(consts.replace('let _contactStatus', 'var _contactStatus') + '\n' + grab(html, 'renderContacts') + '\nthis.renderContacts = renderContacts;', ctx);
  await ctx.renderContacts();
  assert.deepEqual(calls, ['/api/contact/admin?status=open']);
  assert.ok(el.innerHTML.includes('🎪イベント'));
  assert.ok(el.innerHTML.includes('&lt;img src=x onerror=alert(1)&gt;相談です'), 'the message is text, not HTML');
  assert.ok(!el.innerHTML.includes('<img src=x'));
  assert.ok(el.innerHTML.includes('&lt;b&gt;店&lt;/b&gt;'));
  assert.ok(el.innerHTML.includes('mailto:shop@example.com'));
  assert.ok(el.innerHTML.includes('店舗提携') && el.innerHTML.includes('カフェ'));
  assert.ok(el.innerHTML.includes('未対応（1）') && el.innerHTML.includes('対応済み（2）'));
  assert.ok(el.innerHTML.includes('data-contact-to="done"'));
});

/* 11/16：文字化けして届いたもの・長い空白なしの文字・送られた場所の出し方 */
async function renderWith(rows) {
  const consts = html.match(/const CONTACT_TYPE_LABEL = [\s\S]*?\nlet _contactStatus = "open";/)[0];
  const el = { innerHTML: '', querySelectorAll: () => [] };
  const ctx = {
    $: () => el,
    esc: s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    fmt: v => String(v || ''),
    api: async () => ({ counts: { open: rows.length, done: 0 }, rows }),
    window: { alert() {} },
  };
  vm.runInNewContext(consts.replace('let _contactStatus', 'var _contactStatus') + '\n' + grab(html, 'renderContacts') + '\nthis.renderContacts = renderContacts;', ctx);
  await ctx.renderContacts();
  return el.innerHTML;
}
const LONG = 'a'.repeat(400);
const ROWS = [
  { id: 'g1', type: 'general', name: 'takakiasaka1', email: 'x@example.com', place: 'Emu�i�m', device: 'Windows / Chrome', source: 'unknown', message: '�y�e�X', submittedAt: '2026-08-29', status: 'open' },
  { id: 'g2', type: 'general', name: LONG, email: 'y@example.com', source: 'emu-widget', message: LONG, status: 'open' }
];

test('文字化けして届いたものには、元に戻らないことを添える。送られた場所は言葉で出す', async () => {
  const out = await renderWith(ROWS);
  assert.equal((out.match(/文字化けして届いています/g) || []).length, 1, '文字化けしたものにだけ出す');
  assert.ok(out.includes('不明（フォームの印がありません'), 'unknown をそのまま出さない');
  assert.ok(!/<span>unknown<\/span>/.test(out));
  assert.ok(out.includes('Emu の中のお問い合わせフォーム'));
  assert.ok(out.includes('日時なし'), '日時の無い古い記録');
});

test('長い空白なしの文字があっても、運営画面が横にはみ出さない（実際の運営画面のCSSで）', async () => {
  const { chromium } = require('playwright');
  const style = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  const out = await renderWith(ROWS);
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    for (const width of [1280, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.setContent('<!doctype html><meta charset="utf-8"><style>' + style + '</style><body><main class="wrap"><section id="tab-contacts">' + out + '</section></main></body>');
      const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      assert.ok(sw <= cw, `幅 ${width}px で横にはみ出さない（${sw} > ${cw}）`);
      const label = await page.evaluate(() => [...document.querySelectorAll('.row-label')].find(e => e.textContent === 'メール').getBoundingClientRect().width);
      assert.ok(label > 30, '「メール」などの見出しはつぶれない');
      await page.close();
    }
  } finally { await browser.close(); }
});
