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
  /* 見るのは「数から表示を作るところ」だけ。押した直後にその場で
     動かすところ（_spGuildApplyLocal）は、もう表示になっている値を
     受け取って足し引きするので、ここには入らない。 */
  const raw = INDEX.split('\n')
    .filter(l => /joinCount:\s*String\(|supportCount:\s*String\(/.test(l));
  assert.deepEqual(Array.from(raw), [],
    '生の数字を出しているところが残っています');
  const n = (INDEX.match(/_spCountLabel\(/g) || []).length;
  assert.ok(n >= 5, '出し方を通っているところが ' + n + 'か所しかありません');
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

/* ───────── 押した瞬間に、画面が動くこと ─────────

   前は、書き終えてから spDaoLoadVotes で全部読み直していた。
   読み直しは重い（議題・クエスト・5ギルド×2往復・信用スコア）ので、
   押してから数字が動くまで数秒かかる。そのあいだ画面はまったく
   変わらないので、押せたのかどうか分からない。
   「ちょっと待つと反映される」のはこれである。

   クエストの「受ける」は、押した結果をその場で出してから
   読み直している。ギルドだけそうなっていなかった。 */

function local() {
  const from = INDEX.indexOf('function _spGuildBtn(iJoined, iSupport) {');
  const to = INDEX.indexOf('/* 押してだめだったとき、何が起きているのかを言う。');
  const src = INDEX.slice(from, to);
  assert.ok(from > 0 && src.length > 1200, 'その場で出すところが見つかりません');
  const ctx = vm.createContext({ Object, Number, Math, String, Array });
  vm.runInContext(src, ctx);
  return ctx;
}

function scene(opts) {
  const o = opts || {};
  const state = {
    guilds: [{ id: 'learn', joinCount: o.join === undefined ? '3' : o.join,
      supportCount: o.sup === undefined ? '5' : o.sup,
      meJoined: !!o.meJoined, meSupport: !!o.meSupport, meLabel: '', meShow: 'none' }],
    curGuild: o.open ? { id: 'learn', joinCount: o.join === undefined ? '3' : o.join,
      supportCount: o.sup === undefined ? '5' : o.sup,
      meJoined: !!o.meJoined, meSupport: !!o.meSupport } : null
  };
  return { state: state, setState: function (x) { Object.assign(state, x); } };
}

test('押すと、その場でボタンが変わる', () => {
  const ctx = local();
  const app = scene({ open: true });
  ctx._spGuildApplyLocal('learn', 'join', true, app);
  assert.equal(app.state.curGuild.joinLabel, '✓ 参加したい', '押しても見た目が変わらない');
  assert.equal(app.state.curGuild.meJoined, true);
  assert.equal(app.state.guilds[0].meLabel, '参加したい', '一覧のほうが変わらない');
});

test('押すと、その場で数字が動く', () => {
  const ctx = local();
  const app = scene({ open: true });
  ctx._spGuildApplyLocal('learn', 'join', true, app);
  assert.equal(app.state.guilds[0].joinCount, '4', '3 → 4 になっていない');
  assert.equal(app.state.curGuild.joinCount, '4');
  assert.equal(app.state.guilds[0].supportCount, '5', '関係ない数字まで動いている');
});

test('取り消すと、その場で戻る', () => {
  const ctx = local();
  const app = scene({ open: true, meJoined: true });
  ctx._spGuildApplyLocal('learn', 'join', false, app);
  assert.equal(app.state.guilds[0].joinCount, '2', '3 → 2 になっていない');
  assert.equal(app.state.curGuild.joinLabel, 'このギルドに参加したい');
  assert.equal(app.state.curGuild.meJoined, false);
});

test('同じ状態をもう一度入れても、数字は動かない', () => {
  const ctx = local();
  const app = scene({ open: true, meJoined: true });
  ctx._spGuildApplyLocal('learn', 'join', true, app);
  assert.equal(app.state.guilds[0].joinCount, '3', '押していないのに数字が増えている');
});

test('数えられていない（—）ものは、数えないまま', () => {
  const ctx = local();
  const app = scene({ open: true, join: '—' });
  ctx._spGuildApplyLocal('learn', 'join', true, app);
  assert.equal(app.state.guilds[0].joinCount, '—',
    '読めていないのに 1 と数えている');
  /* 見た目（自分が入ったこと）は動いてよい。そこは分かっている。 */
  assert.equal(app.state.curGuild.meJoined, true);
});

test('応援を押しても、参加の数字は動かない', () => {
  const ctx = local();
  const app = scene({ open: true });
  ctx._spGuildApplyLocal('learn', 'support', true, app);
  assert.equal(app.state.guilds[0].supportCount, '6');
  assert.equal(app.state.guilds[0].joinCount, '3');
  assert.equal(app.state.curGuild.supportLabel, '✓ 応援している');
});

test('ほかのギルドは、いっさい動かない', () => {
  const ctx = local();
  const app = scene({ open: true });
  app.state.guilds.push({ id: 'work', joinCount: '9', supportCount: '9',
    meJoined: false, meSupport: false });
  ctx._spGuildApplyLocal('learn', 'join', true, app);
  const work = app.state.guilds.filter(g => g.id === 'work')[0];
  assert.equal(work.joinCount, '9', '押していないギルドの数字が動いている');
});

test('詳細を開いていなくても、一覧だけは動く', () => {
  const ctx = local();
  const app = scene({ open: false });
  ctx._spGuildApplyLocal('learn', 'join', true, app);
  assert.equal(app.state.guilds[0].joinCount, '4');
  assert.equal(app.state.curGuild, null);
});

test('数字が0のときに取り消しても、マイナスにならない', () => {
  const ctx = local();
  const app = scene({ open: true, join: '0', meJoined: true });
  ctx._spGuildApplyLocal('learn', 'join', false, app);
  assert.equal(app.state.guilds[0].joinCount, '0', 'マイナスになっている');
});

/* ───────── 押したところが、それを使っていること ───────── */

function toggle() {
  const at = INDEX.indexOf('window.spGuildToggle = async function');
  const end = INDEX.indexOf('window.spVoteAdopt = async function', at);
  assert.ok(at > 0 && end > at, '押すところが見つかりません');
  return INDEX.slice(at, end);
}

test('押した瞬間に先へ出し、だめなら戻す', () => {
  const src = toggle();
  const flip = src.indexOf('_spGuildApplyLocal(guildId, kind, !wasMine, app)');
  const back = src.indexOf('_spGuildApplyLocal(guildId, kind, wasMine, app)');
  const write = src.indexOf('fb.setDoc(ref');
  assert.ok(flip > 0, '押しても画面が動かない');
  assert.ok(flip < write, '書き終わるまで待ってから画面を動かしている');
  assert.ok(back > write, 'だめだったときに元へ戻していない');
});

test('書けたあとは、サーバーの値で上書きする', () => {
  const src = toggle();
  assert.match(src, /await window\.spDaoLoadVotes\(app\)/,
    '先に動かしたぶんが間違っていても直らない');
});

test('ボタンの見た目は、1か所で決める', () => {
  /* 一覧・詳細・押した直後で式が3つに分かれていると、
     どれか1つだけ直る、ということが起きる。 */
  const n = (INDEX.match(/'✓ 参加したい'/g) || []).length;
  assert.equal(n, 1, "'✓ 参加したい' が " + n + "か所に書かれている");
  const m = (INDEX.match(/'✓ 応援している'/g) || []).length;
  assert.equal(m, 1, "'✓ 応援している' が " + m + "か所に書かれている");
});
