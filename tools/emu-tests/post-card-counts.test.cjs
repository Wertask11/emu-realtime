'use strict';
/* 投稿カードの数の欄は、数にしてから画面へ埋める（11/11 点検）。
   前は記録の値をそのまま HTML に埋めていた。採用の数の欄に文字（HTML）を入れた投稿を作れたので、
   その投稿で「役に立った」を押した人の画面でスクリプトが動いた（index.html の createPostElementFromData）。
   ルール側（firestore.rules）でも、作るときは 0 か無しだけにした。ここは画面側の見張り。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const index = fs.readFileSync(path.join(__dirname, '../../frontend/public/index.html'), 'utf8');
const start = index.indexOf('function createPostElementFromData(post)');
const card = index.slice(start, index.indexOf('\n}\n', start));

test('投稿カードは、数の欄を記録の値のまま HTML に埋めていない', () => {
  assert.ok(start > 0, 'createPostElementFromData が見つからない');
  for (const raw of ['${post.goodCount', '${post.changeCount', '${post.acceptedChangeCount', '${post.reflectedChangeCount']) {
    assert.equal(card.includes(raw), false, raw + ' をそのまま埋めている');
  }
  assert.match(card, /const _kwAccepted = _kwCount\(post\.acceptedChangeCount\);/);
  assert.match(card, /const _kwGoodCount = _kwCount\(post\.goodCount\);/);
  assert.match(card, /const _kwChangeCount = _kwCount\(post\.changeCount\);/);
});

test('数にする関数は、文字・HTML・負の数・小数を、0 以上の整数にする', () => {
  const line = card.split('\n').find((l) => l.includes('const _kwCount ='));
  assert.ok(line, '_kwCount が見つからない');
  const ctx = {};
  vm.runInNewContext(line.replace('const _kwCount =', 'this.f ='), ctx);
  assert.equal(ctx.f('<img src=x onerror=alert(1)>'), 0);
  assert.equal(ctx.f('12'), 12);
  assert.equal(ctx.f(7), 7);
  assert.equal(ctx.f(3.9), 3);
  assert.equal(ctx.f(-5), 0);
  assert.equal(ctx.f(undefined), 0);
  assert.equal(ctx.f({ toString() { return '<b>'; } }), 0);
  assert.equal(ctx.f(Infinity), 0);
});

test('表示名を変える知らせ（room2_name_set）は、このサイトの画面からだけ受ける', () => {
  const at = index.indexOf("event.data.type === 'room2_name_set'");
  assert.ok(at > 0);
  const block = index.slice(at, at + 900);
  assert.match(block, /if \(event\.origin !== window\.location\.origin\) return;/);
  assert.ok(block.indexOf('event.origin !== window.location.origin') < block.indexOf('/api/user/setname') || !block.includes('/api/user/setname'),
    '送り主を確かめる前に保存している');
});
