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
