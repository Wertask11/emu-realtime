/* 普通の通信（REST）の関門。

   専用の通信路（Listen）が切れているとき、画面のあちこちが
   いっせいに REST へ逃げる。クエストが2本のうちは気づかなかったが、
   17本に増えた日に Firestore から 429（Too Many Requests）が返り、
   何も読めなくなった。画面は「ゲスト」になり、数字は全部0になった。

   逃げ道そのものは要る。要らないのは「いっせいに」のほう。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const INDEX = fs.readFileSync(
  path.join(__dirname, '../../frontend/public/index.html'), 'utf8');

/* 関門は2か所に分かれている（本物の通信をはさんで前と後ろ）。
   本物の通信は測れる偽物に差し替えるので、そこだけ外して繋ぐ。 */
const SRC = 'var _spRestGetOnce;\n'
  + INDEX.slice(INDEX.indexOf('function _spRestState() {'),
                INDEX.indexOf('async function _spRestGetOnce('))
  + INDEX.slice(INDEX.indexOf('/* 関門つきの入口。'),
                INDEX.indexOf('async function _spRestDoc('));
assert.ok(SRC.length > 800, '関門が見つかりません');

/* 偽の通信を差し込んで、何本が同時に走ったかを数える。 */
function gate(opts) {
  const o = opts || {};
  const seen = { peak: 0, live: 0, calls: 0, paths: [] };
  const ctx = vm.createContext({
    console: { warn() {} }, Date, Map, Promise, Number, String, Math,
    setTimeout, window: {},
    _fake: async (p) => {
      seen.calls += 1; seen.paths.push(p);
      seen.live += 1; seen.peak = Math.max(seen.peak, seen.live);
      await new Promise(r => setTimeout(r, o.ms || 15));
      seen.live -= 1;
      if (o.throwEvery && seen.calls % o.throwEvery === 0) throw new Error('boom');
      return { path: p };
    }
  });
  vm.runInContext(SRC, ctx);
  vm.runInContext('_spRestGetOnce = _fake;', ctx);
  return { ctx, seen };
}

test('17本が同時に来ても、走るのは3本まで', async () => {
  const { ctx, seen } = gate();
  await Promise.all(Array.from({ length: 17 }, (_, i) =>
    ctx._spRestGet('sp_quests/q' + i + '/commits', true)));
  assert.equal(seen.peak, 3, '同時に ' + seen.peak + ' 本走っている');
  assert.equal(seen.calls, 17, '要求そのものは落とさないこと');
});

test('同じ行き先は、取っておいて1回で済ませる', async () => {
  const { ctx, seen } = gate();
  const all = await Promise.all(Array.from({ length: 17 }, () =>
    ctx._spRestGet('sp_quests', true)));
  assert.equal(seen.calls, 1, '17本が同じ一覧を別々に取りに行っている');
  all.forEach(v => assert.deepEqual(v, { path: 'sp_quests' }, '同じ答えが返ること'));
});

test('行き先が違えば、取っておいたものは使わない', async () => {
  const { ctx, seen } = gate();
  await Promise.all([ctx._spRestGet('a', true), ctx._spRestGet('b', true)]);
  assert.equal(seen.calls, 2);
});

test('証が要るかどうかが違えば、別のものとして扱う', async () => {
  const { ctx, seen } = gate();
  await Promise.all([ctx._spRestGet('a', true), ctx._spRestGet('a', false)]);
  assert.equal(seen.calls, 2, '証の有無で答えが変わるのに混ぜている');
});

test('混んでいると言われたら、しばらく誰も通さない', async () => {
  const { ctx, seen } = gate();
  ctx._spRestBlock({ headers: { get: () => null } });
  let waited = 0;
  await Promise.all(Array.from({ length: 20 }, (_, i) =>
    ctx._spRestGet('p' + i, true).catch(e => {
      if (/429/.test(e.message)) waited += 1;
    })));
  assert.equal(seen.calls, 0, '混んでいるところへ押し返している');
  assert.equal(waited, 20);
});

test('Retry-After があれば、その秒数だけ待つ', () => {
  const { ctx } = gate();
  const before = Date.now();
  ctx._spRestBlock({ headers: { get: () => '30' } });
  /* let で宣言した変数は、vm のコンテキストのプロパティにならない。
     中で評価して取り出す。 */
  const until = vm.runInContext('_spRestState().blockedUntil', ctx);
  assert.ok(until - before >= 29000 && until - before <= 31000,
    '待つ時間が ' + Math.round((until - before) / 1000) + '秒になっている');
});

test('Retry-After が無いか、おかしな値なら10秒', () => {
  for (const v of [null, '', 'abc', '-5', '99999']) {
    const { ctx } = gate();
    const before = Date.now();
    ctx._spRestBlock({ headers: { get: () => v } });
    const w = vm.runInContext('_spRestState().blockedUntil', ctx) - before;
    assert.ok(w >= 9000 && w <= 11000, '値 ' + String(v) + ' で ' + w + 'ms');
  }
});

/* ───────── 「混んでいる」と「枠を使い切った」は別物 ───────── */

test('その日の読み取り枠を使い切ったと言われたら、10分待つ', () => {
  const body = '{"error":{"code":429,"message":"Quota exceeded",'
    + '"status":"RESOURCE_EXHAUSTED"}}';
  const { ctx } = gate();
  const before = Date.now();
  ctx._spRestBlock({ headers: { get: () => null } }, body);
  const st = vm.runInContext('_spRestState()', ctx);
  const w = st.blockedUntil - before;
  assert.ok(w >= 9.5 * 60000 && w <= 10.5 * 60000,
    '枠切れなのに ' + Math.round(w / 1000) + '秒しか待っていない');
  assert.equal(st.reason, 'quota', 'どちらの429なのかを覚えていない');
});

test('枠切れのときは、返ってきた文面を控えに残す', () => {
  const { ctx } = gate();
  ctx._spRestBlock({ headers: { get: () => null } },
    '{"error":{"status":"RESOURCE_EXHAUSTED","message":"Quota exceeded"}}');
  const st = vm.runInContext('_spRestState()', ctx);
  assert.match(st.message, /RESOURCE_EXHAUSTED/, '原因が手元に残らない');
  assert.ok(st.message.length <= 400, '控えが長すぎる');
});

test('ただ混んでいるだけなら、これまでどおり10秒', () => {
  for (const body of ['', '{"error":{"message":"too many requests"}}', 'rate limit']) {
    const { ctx } = gate();
    const before = Date.now();
    ctx._spRestBlock({ headers: { get: () => null } }, body);
    const st = vm.runInContext('_spRestState()', ctx);
    assert.equal(st.reason, 'busy', '文面「' + body + '」を枠切れと取り違えている');
    const w = st.blockedUntil - before;
    assert.ok(w >= 9000 && w <= 11000, body + ' で ' + w + 'ms');
  }
});

test('Retry-After は枠切れの見立てより強い', () => {
  const { ctx } = gate();
  const before = Date.now();
  ctx._spRestBlock({ headers: { get: () => '45' } },
    '{"error":{"status":"RESOURCE_EXHAUSTED"}}');
  const st = vm.runInContext('_spRestState()', ctx);
  const w = st.blockedUntil - before;
  assert.ok(w >= 44000 && w <= 46000,
    '相手が45秒と言っているのに ' + Math.round(w / 1000) + '秒待っている');
  assert.equal(st.reason, 'quota', '理由のほうは覚えておくこと');
});

test('失敗したものは取っておかない（すぐ試し直せる）', async () => {
  const { ctx, seen } = gate({ throwEvery: 1 });
  await ctx._spRestGet('x', true).catch(() => {});
  await ctx._spRestGet('x', true).catch(() => {});
  assert.equal(seen.calls, 2, '失敗を取っておくと、直っても読み直せない');
});

test('取っておく数には上限がある（溜め込まない）', async () => {
  const { ctx } = gate({ ms: 1 });
  for (let i = 0; i < 260; i += 1) await ctx._spRestGet('p' + i, true);
  const size = vm.runInContext('_spRestState().cache.size', ctx);
  assert.ok(size <= 200, '取っておいたものが ' + size + '件まで増えている');
});

test('並んだものは、順に必ず片付く（取りこぼさない）', async () => {
  const { ctx, seen } = gate({ ms: 5 });
  const out = await Promise.all(Array.from({ length: 30 }, (_, i) =>
    ctx._spRestGet('q' + i, true)));
  assert.equal(out.length, 30);
  assert.equal(seen.calls, 30);
  assert.equal(seen.live, 0, '走りっぱなしのものが残っている');
});

test('1本が転んでも、並んでいる残りは走る', async () => {
  const { ctx, seen } = gate({ throwEvery: 3, ms: 3 });
  const out = await Promise.allSettled(Array.from({ length: 12 }, (_, i) =>
    ctx._spRestGet('r' + i, true)));
  assert.equal(seen.calls, 12, '転んだところで列が止まっている');
  assert.ok(out.some(x => x.status === 'rejected'));
  assert.ok(out.some(x => x.status === 'fulfilled'));
});

/* ───────── 通り道が1本であること ───────── */

test('REST を呼ぶところは、すべて関門を通る', () => {
  /* _spRestGetOnce を直に呼ぶところがあると、そこだけ素通りする。 */
  const direct = INDEX.split('\n')
    .map((l, i) => [i + 1, l])
    .filter(([, l]) => l.indexOf('_spRestGetOnce(') >= 0)
    .filter(([, l]) => l.indexOf('async function _spRestGetOnce(') < 0)
    .filter(([, l]) => l.indexOf('_spRestGetOnce = ') < 0)
    .filter(([, l]) => l.indexOf('return _spRestGetOnce(path, needAuth);') < 0);
  assert.deepEqual(direct, [], '関門を通らない呼び方が残っています');
});

test('429 を見分けて、関門を閉じている', () => {
  const once = INDEX.slice(INDEX.indexOf('async function _spRestGetOnce('),
                           INDEX.indexOf('/* 関門つきの入口。'));
  assert.match(once, /r\.status === 429/, '429 を他の失敗と同じに扱っている');
  assert.match(once, /_spRestBlock\(r, why\)/, '文面を読まずに閉めている');
  assert.match(once, /await r\.text\(\)/, '429 の言い分を読んでいない');
  /* 404 は「まだ無い」であって失敗ではない。閉じてはいけない。 */
  const at404 = once.indexOf('r.status === 404');
  const at429 = once.indexOf('r.status === 429');
  assert.ok(at404 > 0 && at404 < at429, '404 の判定が 429 より後ろにある');
});
