'use strict';
/* 起動画面の時間帯（11/6）。朝 4:00–9:59 / 昼 10:00–15:59 / 夜 16:00–3:59。
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
  const attrs = {};
  class FakeDate { getHours() { return hour; } }
  const window = {};
  vm.runInNewContext(SRC, {
    window, Date: FakeDate, Math, URLSearchParams, location: { search: search || '' },
    document: { documentElement: { setAttribute: (k, v) => { attrs[k] = v; } },
      getElementById: id => (id === 'logoScreen' ? el : id === 'logoImg' ? img : null) }
  });
  return { time: attrs['data-sp-time'], mode: window.SP_SPLASH_MODE, classes: [...classes], src: img.src, stars: (stars.innerHTML.match(/sp-star/g) || []).length, clouds };
}

test('時刻で朝・昼・夜を決める', () => {
  const at = h => run(h).mode;
  assert.deepEqual([3, 4, 9, 10, 15, 16, 23, 0].map(at), ['night', 'morning', 'morning', 'day', 'day', 'night', 'night', 'night']);
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

test('ログイン画面にも同じ時間帯を渡す（夜も）', () => {
  assert.equal(run(7).time, 'morning');
  assert.equal(run(13).time, 'day');
  assert.equal(run(21).time, 'night');
});

test('ログイン画面：見た目だけを時間帯で変え、ボタンと動きは変えない', () => {
  const css = INDEX.slice(INDEX.indexOf('<style id="ws-time-styles">'), INDEX.indexOf('</style>', INDEX.indexOf('<style id="ws-time-styles">')));
  for (const t of ['morning', 'day', 'night']) {
    assert.match(css, new RegExp('html\\[data-sp-time="' + t + '"\\] #walletScreen \\.ws-sky-' + t));
    assert.match(css, new RegExp('html\\[data-sp-time="' + t + '"\\] \\.ches-btn-email'));
  }
  assert.doesNotMatch(css, /display:\s*none[^;]*;[^}]*ches-btn|#chesLineButton|#chesGoogleButton/, 'ボタンを隠したり差し替えたりしない');
  // ボタンの順番は LINE → Google → メール のまま
  const a = INDEX.indexOf('id="chesLineButton"'), b = INDEX.indexOf('id="chesGoogleButton"'), c = INDEX.indexOf('id="chesEmailButton"');
  assert.ok(a > 0 && a < b && b < c);
});
