'use strict';
/* 起動画面の時間帯（11/6）。朝 5:00–9:59 / 昼 10:00–16:59 / それ以外は夜。
   ?splash= で確かめられる。夜は今までのまま（クラスも画像も変えない）。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '../..');
const INDEX = fs.readFileSync(path.join(root, 'frontend/public/index.html'), 'utf8');
const start = INDEX.indexOf('/* ── 起動画面の時間帯（11/6）──');
const SRC = INDEX.slice(start, INDEX.indexOf('</script>', start));

function run(hour, search) {
  const classes = new Set();
  const img = { src: 'logo-640.webp' };
  const stars = { innerHTML: '' };
  const clouds = [0, 1].map(() => ({ style: { animationDelay: '', getPropertyValue: () => '90s' } }));
  const el = {
    classList: { add: c => classes.add(c) },
    querySelector: sel => (sel.includes('sp-stars') ? stars : null),
    querySelectorAll: () => clouds
  };
  class FakeDate { getHours() { return hour; } }
  const window = {};
  vm.runInNewContext(SRC, {
    window, Date: FakeDate, Math, URLSearchParams, location: { search: search || '' },
    document: { getElementById: id => (id === 'logoScreen' ? el : id === 'logoImg' ? img : null) }
  });
  return { mode: window.SP_SPLASH_MODE, classes: [...classes], src: img.src, stars: (stars.innerHTML.match(/sp-star/g) || []).length, clouds };
}

test('時刻で朝・昼・夜を決める', () => {
  const at = h => run(h).mode;
  assert.deepEqual([4, 5, 9, 10, 16, 17, 23, 0].map(at), ['night', 'morning', 'morning', 'day', 'day', 'night', 'night', 'night']);
});

test('朝：クラスと朝のロゴ、星70個', () => {
  const r = run(7);
  assert.deepEqual(r.classes, ['sp-splash-morning']);
  assert.equal(r.src, 'logo-morning-640.webp');
  assert.equal(r.stars, 70);
});

test('昼：クラスと昼のロゴ、雲は途中から流す', () => {
  const r = run(13);
  assert.deepEqual(r.classes, ['sp-splash-day']);
  assert.equal(r.src, 'logo-day-640.webp');
  assert.ok(r.clouds.every(c => /^-\d/.test(c.style.animationDelay)));
});

test('夜は今までのまま', () => {
  const r = run(21);
  assert.deepEqual(r.classes, []);
  assert.equal(r.src, 'logo-640.webp');
});

test('?splash= で時間帯を指定できる（変な値は無視）', () => {
  assert.equal(run(21, '?splash=day').mode, 'day');
  assert.equal(run(13, '?splash=night').mode, 'night');
  assert.equal(run(13, '?splash=evil').mode, 'day');
});

test('朝・昼の画像がある。夜の星は朝・昼に描かない', () => {
  for (const f of ['logo-morning-640.webp', 'logo-day-640.webp']) assert.ok(fs.existsSync(path.join(root, 'frontend/public', f)), f);
  assert.match(INDEX, /if \(window\.SP_SPLASH_MODE && window\.SP_SPLASH_MODE !== 'night'\) return;\n  const canvas = document\.getElementById\('logoStarCanvas'\);/);
  assert.match(INDEX, /@media \(prefers-reduced-motion: reduce\)[\s\S]{0,200}#logoScreen \.sp-sky \*/);
});
