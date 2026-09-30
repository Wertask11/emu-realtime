/* ギルドの数字は、読めなかったときに 0 と書かないこと。

   9/30、ギルドの「参加したい・応援する」が押せず、数字も
   出ていなかった。画面には「参加したい 0・応援 0」と出る。
   だが読めていないだけで、0人ではない。押した本人には
   「自分の1票が消えた」に見える。

   このコードベースは、ほかの場所では「0と書かない」を守っている
   （完走の数え・信用スコア・知恵カード）。ここだけ守れていなかった。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const INDEX = fs.readFileSync(
  path.join(__dirname, '../../frontend/public/index.html'), 'utf8');

function labeler() {
  const src = INDEX.slice(INDEX.indexOf('function _spCountLabel(n) {'),
                          INDEX.indexOf('function _spGuildCard(g, mem, defs, app) {'));
  assert.ok(src.length > 50, '数え方の見出しが見つかりません');
  const ctx = vm.createContext({ String });
  vm.runInContext(src, ctx);
  return ctx._spCountLabel;
}

test('数えられた数は、そのまま出す', () => {
  const f = labeler();
  assert.equal(f(0), '0');
  assert.equal(f(1), '1');
  assert.equal(f(42), '42');
});

test('数えられなかったものは「—」。0 とは書かない', () => {
  const f = labeler();
  assert.equal(f(null), '—', '読めていないのに 0人 と出している');
  assert.equal(f(undefined), '—');
});

test('本当に0人のときと、読めなかったときを取り違えない', () => {
  const f = labeler();
  assert.notEqual(f(0), f(null),
    '「誰もいない」と「分からない」が同じ表示になっている');
});

/* ───────── 渡すほう ───────── */

test('一覧は、読めなかったギルドに null を渡す', () => {
  const at = INDEX.indexOf('return _spGuildCard(g, {');
  assert.ok(at > 0, 'ギルド一覧の組み立てが見つかりません');
  const src = INDEX.slice(at, at + 300);
  assert.match(src, /joins: js \? joins : null/, '読めなくても 0 を渡している');
  assert.match(src, /supports: ss \? supports : null/);
});

test('詳細も、読めなかったら null のまま', () => {
  /* 固定の文字数で切らない。中身が増えると、確かめたい行が窓の外へ
     出て、直っているのに落ちる。関数の終わりまでを見る。 */
  const at = INDEX.indexOf('window.spGuildOpen = async function');
  const end = INDEX.indexOf('window.spGuildToggle = async function', at);
  assert.ok(at > 0 && end > at, 'ギルドの詳細が見つかりません');
  const src = INDEX.slice(at, end);
  assert.match(src, /let joins = null, supports = null/,
    '0 から数え始めているので、読めなくても 0人 と出る');
  assert.match(src, /joinCount: _spCountLabel\(joins\)/,
    '詳細が生の数字を出している');
});

test('一覧と詳細が、同じ出し方を通る', () => {
  const uses = INDEX.split('\n').filter(l => l.indexOf('joinCount:') >= 0);
  assert.ok(uses.length >= 2, 'ギルドの数字を出すところが足りません');
  uses.forEach(l => {
    assert.ok(/_spCountLabel\(|joinCount: '—'/.test(l),
      '生の数字を出しているところが残っています: ' + l.trim());
  });
});

/* ───────── 押してだめだったとき ───────── */

function why() {
  const src = INDEX.slice(INDEX.indexOf('function _spWhyFailed(e) {'),
                          INDEX.indexOf('/* 数えられた数か、数えられなかったか。'));
  assert.ok(src.length > 300, '理由を言うところが見つかりません');
  return function (state, err) {
    const ctx = vm.createContext({
      Date, Math, String,
      _spRestState: () => state
    });
    vm.runInContext(src, ctx);
    return ctx._spWhyFailed(err);
  };
}

test('枠を使い切っているときは、そう言う', () => {
  const f = why();
  const msg = f({ reason: 'quota', blockedUntil: Date.now() + 8 * 60000 }, new Error('HTTP 429'));
  assert.match(msg, /読み取り枠を使い切っています/);
  assert.match(msg, /通信の問題ではありません/,
    '通信を疑わせている。確かめる先が違う');
  assert.match(msg, /あと \d+分/, 'いつ戻るか言っていない');
});

test('ただの通信の失敗なら、これまでどおり', () => {
  const f = why();
  const msg = f({ reason: 'busy', blockedUntil: 0 }, new Error('保存が返ってきませんでした'));
  assert.match(msg, /通信を確かめて/);
  assert.match(msg, /保存が返ってきませんでした/, '何が起きたか出ていない');
});

test('枠切れでも、時間が過ぎていれば通信の話に戻す', () => {
  const f = why();
  const msg = f({ reason: 'quota', blockedUntil: Date.now() - 1000 }, new Error('x'));
  assert.match(msg, /通信を確かめて/, '開いているのに枠切れと言い続けている');
});

test('状態そのものが読めなくても、落ちない', () => {
  const src = INDEX.slice(INDEX.indexOf('function _spWhyFailed(e) {'),
                          INDEX.indexOf('/* 数えられた数か、数えられなかったか。'));
  const ctx = vm.createContext({ Date, Math, String,
    _spRestState: () => { throw new Error('まだ無い'); } });
  vm.runInContext(src, ctx);
  assert.match(ctx._spWhyFailed(new Error('y')), /通信を確かめて/);
});

test('押してだめだったときの文言が、そこを通る', () => {
  const at = INDEX.indexOf('window.spGuildToggle = async function');
  const src = INDEX.slice(at, at + 3000);
  assert.match(src, /alert\(_spWhyFailed\(e\)\)/,
    'どこで転んでも同じ文言を出している');
});
