'use strict';
/* 左タブを閉じたら、どの画面も広がる（11/6）。
   - 知恵ライブラリ・City・ギルド/クエスト（#spDaoPage）は左タブの右端から始まる。その位置を、閉じたときにも測り直す
   - 知識を探す・知識を試すも、知識を読むと同じ幅（1760px）まで広げる。1180px で止めていたので広がらなかった */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readHtml, build } = require('../year-goals-tests/extract.cjs');

const INDEX = readHtml('frontend/public/index.html');

test('左タブの開け閉めで、SchoolPark の画面の位置を測り直す', () => {
  const calls = [];
  const classes = new Set();
  const api = build(INDEX, ['emuNavToggle'], {
    document: { body: { classList: { toggle: (c) => (classes.has(c) ? classes.delete(c) : classes.add(c)) } } },
    window: { EmuNavigation: { fit: () => calls.push('fit') } },
    emuFitContact: () => calls.push('contact')
  });
  api.emuNavToggle();
  assert.ok(classes.has('emu-nav-closed'));
  assert.deepEqual(calls, ['contact', 'fit']);
  api.emuNavToggle();
  assert.ok(!classes.has('emu-nav-closed'));
  assert.deepEqual(calls, ['contact', 'fit', 'contact', 'fit']);
});

test('EmuNavigation がまだ無くても止まらない', () => {
  const api = build(INDEX, ['emuNavToggle'], {
    document: { body: { classList: { toggle() {} } } }, window: {}, emuFitContact() {}
  });
  assert.doesNotThrow(() => api.emuNavToggle());
});

test('知識を探す・知識を試すも、知識を読むと同じ幅まで広がる', () => {
  const m = INDEX.match(/((?:body\.emu-[a-z-]+-open #emuTodayHome,?\s*)+)\{\s*max-width:1760px;/);
  assert.ok(m, '1760px の幅の決まりが無い');
  for (const view of ['knowledge', 'requests', 'practice']) assert.ok(m[1].includes('body.emu-' + view + '-open #emuTodayHome'), view);
});
