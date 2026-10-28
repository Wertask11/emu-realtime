/* City の「出店の相談をする」。Emu の画面のお問い合わせを、その種類で開く。
   入力の途中なら「次へ」は押さない（押すと、途中の内容を確かめて送信まで進むため）。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

function fakeParent({ open = false, step = 1 } = {}) {
  const log = [];
  const classes = new Set(open ? ['open'] : []);
  const back = { style: { display: step > 1 ? 'block' : 'none' } };
  const pick = { dataset: { type: 'general' } };
  const parent = {
    auth: { currentUser: { uid: 'alice' } }, _spIdentity: { schoolParkId: 'SP-A' },
    document: {
      getElementById: id => id === 'emu-contact-panel' ? { classList: { contains: c => classes.has(c) } } : id === 'w-back' ? back : null,
      querySelector: sel => sel === '.w-cat-btn[data-type="general"]' ? pick : null
    },
    toggleContactPanel: () => { log.push('toggle'); classes.has('open') ? classes.delete('open') : classes.add('open'); },
    switchContactTab: tab => log.push('tab:' + tab),
    selectCategory: el => log.push('select:' + el.dataset.type),
    nextStep: () => log.push('next')
  };
  return { parent, log };
}

async function bridgeFor(parent) {
  const { createBridge } = await import(pathToFileURL(path.join(__dirname, '../../frontend/public/schoolpark/city-bridge.js')).href);
  return createBridge(parent, { state: {} });
}

test('閉じていれば開いて、種類を選んで、入力の画面まで進める', async () => {
  const { parent, log } = fakeParent();
  assert.equal((await bridgeFor(parent)).openContact('general'), true);
  assert.deepEqual(log, ['toggle', 'tab:contact', 'select:general', 'next']);
});

test('開いていれば閉じない', async () => {
  const { parent, log } = fakeParent({ open: true });
  (await bridgeFor(parent)).openContact('general');
  assert.deepEqual(log, ['tab:contact', 'select:general', 'next']);
});

test('入力の途中なら、開くだけで「次へ」は押さない', async () => {
  for (const step of [2, 3]) {
    const { parent, log } = fakeParent({ open: true, step });
    (await bridgeFor(parent)).openContact('general');
    assert.deepEqual(log, ['tab:contact'], step + '番目の手順で進めている');
  }
});
