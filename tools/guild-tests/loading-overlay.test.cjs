/* 「読み込み中」の覆いは、必ず消えること。

   入場のとき、画面いっぱいに覆いを出して中身を読む。前は、
   読み終わったときだけ覆いを外していた。どこか1か所が返って
   こないと（通信が混んでいて断られたときなど）、覆いは永久に
   残り、画面は何も触れなくなる。実際そうなった。

   読めないことより、閉じ込められることのほうが悪い。
   中身が揃っていなくても、画面は開くべきである。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const INDEX = fs.readFileSync(
  path.join(__dirname, '../../frontend/public/index.html'), 'utf8');

const from = INDEX.indexOf('const _SP_REIZO_LOADING_LINES = [');
const to = INDEX.indexOf('\n}\n', INDEX.indexOf('function _hideSpLoadingOverlay()')) + 3;
const SRC = INDEX.slice(from, to);
assert.ok(from > 0 && SRC.length > 1500, '覆いの出し入れが見つかりません');
assert.match(SRC, /function _hideSpLoadingOverlay/, '切り出しが足りません');

/* 時間は自分で進める。25秒も30分も待たずに測れる。 */
function stage(opts) {
  const o = opts || {};
  let now = 0, seq = 0;
  const timers = new Map();
  const nodes = new Map();
  const warns = [];
  const ctx = vm.createContext({
    console: { warn: (...a) => warns.push(a.join('')), log() {}, error() {} },
    document: {
      getElementById(id) {
        if (o.missing) return null;
        if (!nodes.has(id)) nodes.set(id, { style: {}, textContent: '', offsetHeight: 0 });
        return nodes.get(id);
      }
    },
    setTimeout(fn, ms) { seq += 1; timers.set(seq, { at: now + (Number(ms) || 0), fn }); return seq; },
    clearTimeout(id) { timers.delete(id); }
  });
  vm.runInContext(SRC, ctx);
  function advance(ms) {
    const until = now + ms;
    for (;;) {
      let pick = null;
      for (const [id, t] of timers) {
        if (t.at <= until && (!pick || t.at < pick.t.at)) pick = { id, t };
      }
      if (!pick) break;
      timers.delete(pick.id);
      now = pick.t.at;
      pick.t.fn();
    }
    now = until;
  }
  const ov = () => (o.missing ? null : ctx.document.getElementById('spLoadingOverlay'));
  return { ctx, advance, warns, ov, pending: () => timers.size };
}

/* ───────── 何があっても消える ───────── */

test('誰も外さなくても、25秒で覆いは消える', () => {
  const s = stage();
  s.ctx._showSpLoadingOverlay();
  assert.equal(s.ov().style.display, 'flex', '覆いが出ていない');
  s.advance(24000);
  assert.equal(s.ov().style.display, 'flex', '早すぎる。読める見込みがまだある');
  s.advance(2000);
  assert.equal(s.ov().style.display, 'none', '25秒たっても閉じ込められたままになっている');
});

test('消すときは、なぜ消したのかを控えに残す', () => {
  const s = stage();
  s.ctx._showSpLoadingOverlay();
  s.advance(26000);
  assert.equal(s.warns.length, 1, '黙って消している');
  assert.match(s.warns[0], /読み込みが終わらない/);
  assert.match(s.warns[0], /読み直/, '足りないぶんがどうなるか書いていない');
});

test('ふつうに読み終われば、砦は出てこない', () => {
  const s = stage();
  s.ctx._showSpLoadingOverlay();
  s.advance(1000);
  s.ctx._hideSpLoadingOverlay();
  s.advance(3000);                       /* 準備完了の見せ方（1.5秒＋0.65秒） */
  assert.equal(s.ov().style.display, 'none');
  s.advance(60000);
  assert.equal(s.warns.length, 0, '正しく終わったのに「終わらない」と言っている');
});

test('途中でやめても、砦はあとから起きてこない', () => {
  const s = stage();
  s.ctx._showSpLoadingOverlay();
  s.ctx._cancelSpLoadingOverlay();
  assert.equal(s.ov().style.display, 'none');
  s.advance(60000);
  assert.equal(s.warns.length, 0, 'やめたあとに砦が動いている');
});

test('やめて出し直せば、砦はまた張られる', () => {
  const s = stage();
  s.ctx._showSpLoadingOverlay();
  s.ctx._cancelSpLoadingOverlay();
  s.ctx._showSpLoadingOverlay();
  assert.equal(s.ov().style.display, 'flex');
  s.advance(26000);
  assert.equal(s.ov().style.display, 'none', '2回目は砦が無い');
});

test('砦のタイマーは溜まらない（何度出しても1本）', () => {
  const s = stage();
  for (let i = 0; i < 20; i += 1) {
    s.ctx._cancelSpLoadingOverlay();
    s.ctx._showSpLoadingOverlay();
  }
  /* 残るのは砦1本と、最初の一言1本だけ。 */
  assert.ok(s.pending() <= 2, 'タイマーが ' + s.pending() + ' 本も残っている');
});

test('すでに手で消されていたら、砦は何も触らない', () => {
  const s = stage();
  s.ctx._showSpLoadingOverlay();
  s.ov().style.display = 'none';         /* 別の場所が先に消した */
  s.ov().style.opacity = '0.3';          /* 途中の見た目を残しておく */
  s.advance(26000);
  assert.equal(s.ov().style.opacity, '0.3', '消えているものをさらに書き換えている');
  assert.equal(s.warns.length, 0);
});

test('覆いそのものが無い画面では、何も起きない', () => {
  const s = stage({ missing: true });
  assert.doesNotThrow(() => s.ctx._showSpLoadingOverlay());
  assert.doesNotThrow(() => s.ctx._cancelSpLoadingOverlay());
  assert.doesNotThrow(() => s.ctx._hideSpLoadingOverlay());
  s.advance(60000);
});

/* ───────── 入場そのものが止まらないこと ───────── */

test('入場は、読み込みが返らなくても先へ進む', () => {
  const hub = INDEX.slice(INDEX.indexOf('async function goToChesHub()'),
                          INDEX.indexOf('function _showSpLoadingOverlay()'));
  assert.ok(hub.length > 500, '入場のところが見つかりません');
  assert.ok(hub.indexOf('await chesLandAfterLogin()') < 0,
    '返ってくるまで待っている。返ってこないと覆いが残る');
  assert.match(hub, /_spSoon\(Promise\.resolve\(chesLandAfterLogin\(\)\)/,
    '時間を区切って待っていない');
  /* 時間を区切ったあと、必ず覆いを外すところへ落ちること。 */
  const at = hub.indexOf('_spSoon(Promise.resolve(chesLandAfterLogin()');
  assert.ok(hub.indexOf('_hideSpLoadingOverlay()', at) > at,
    '待ったあとに覆いを外していない');
});

test('覆いを外す口は、どれも砦を片付ける', () => {
  for (const name of ['_cancelSpLoadingOverlay', '_hideSpLoadingOverlay']) {
    const body = INDEX.slice(INDEX.indexOf('function ' + name + '() {'),
                             INDEX.indexOf('\n}\n', INDEX.indexOf('function ' + name + '() {')));
    assert.match(body, /clearTimeout\(_spLoadingHardStop\)/,
      name + ' が砦を片付けていない（あとで勝手に動く）');
  }
});
