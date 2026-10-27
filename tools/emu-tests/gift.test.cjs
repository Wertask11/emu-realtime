/* 運営からのギフト（2026-10-27から）。画面・サーバー・ルールの約束がずれていないかを見る。
   渡す・断るの中身は backend/emu-gift.test.js が確かめる。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

test('the gift starts at the same moment on screen and on the server (2026-10-27 0:00 JST)', () => {
  const ui = read('frontend/public/emu-gift-ui.js');
  const at = Date.parse(ui.match(/var EMU_GIFT_FROM = Date\.parse\('([^']+)'\)/)[1]);
  const { GIFT_STARTS_AT } = require(path.join(root, 'backend/emu-gift.js'));
  assert.equal(at, GIFT_STARTS_AT);
  assert.equal(at, Date.parse('2026-10-27T00:00:00+09:00'));
});

test('the header has the gift button (hidden until the script decides) and loads the gift screen', () => {
  const index = read('frontend/public/index.html');
  assert.match(index, /<button type="button" id="emuGiftButton" class="emu-gift-button" hidden onclick="emuGiftOpen\(\)" aria-label="運営からのギフト">/);
  assert.ok(index.includes('<script src="/emu-gift-ui.js"></script>'));
});

test('gift records are server-only: the open rule never covers emu_gift*', () => {
  const rules = read('firestore.rules');
  const open = rules.indexOf('match /{coll}/{document=**} {');
  const guard = rules.indexOf("&& !coll.matches('emu_gift.*')", open);
  assert.ok(open > 0 && guard > open && guard - open < 2000, 'emu_gift* must be excluded from the open rule');
});

test('the screen never sends a Passport ID it was typed; the server uses its own', () => {
  const ui = read('frontend/public/emu-gift-ui.js');
  assert.ok(!/<input/.test(ui), 'no input box for the ID');
  assert.match(ui, /call\('POST', '\/extension'\)/);
  assert.ok(!/JSON\.stringify\(/.test(ui), 'requests carry no body from the screen');
});
