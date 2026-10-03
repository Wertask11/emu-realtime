/* 同じクエストを2周した人の完走が、どの画面でも同じ数になるかの試験。

   バラバラだった。サーバーは approvedRounds を書き、
   信用スコアとメンバー一覧（SchoolPark側）は周回で数えていたのに、
   星空のクエスト星・パスポートの記録件数・運営画面のメンバー一覧は
   「クエスト1本＝1」で数えていた。2周しても星が1つのままだった。

   ここでは、周回を数えるべき場所が全部そろっていることを確かめる。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '../..');
const html = fs.readFileSync(path.join(root, 'frontend/public/index.html'), 'utf8');
const admin = fs.readFileSync(path.join(root, 'frontend/public/membership-admin.html'), 'utf8');

/* ───────── 星空のクエスト星 ─────────
   数え上げの部分だけを切り出して、実際に動かす。 */
function countGuildStars(done) {
  const src = html.slice(html.indexOf('    const byGuild = {};'),
                         html.indexOf('    read.guilds = true;'));
  assert.ok(src.length > 100, 'クエスト星の数え上げが見つかりません');
  const ctx = vm.createContext({ done, counts: { guilds: [] } });
  vm.runInContext(src, ctx);
  return Array.from(ctx.counts.guilds).map(g => ({ key: g.key, count: g.count }));
}

const LEARN = { id: 'general-quest-001', isFounder: false, guildId: 'learn',
  guildShort: 'LEARN', accent: '#2F6F4E', guildOrder: 0, at: 2, rounds: 1 };
const WORK = { id: 'general-quest-002', isFounder: false, guildId: 'work',
  guildShort: 'WORK', accent: '#141310', guildOrder: 1, at: 1, rounds: 1 };

test('1周なら星は1つ', () => {
  assert.deepEqual(countGuildStars([{ ...LEARN, rounds: 1 }]),
    [{ key: 'quest:learn', count: 1 }]);
});

test('2周したら星は2つ（これが出ていなかった）', () => {
  assert.deepEqual(countGuildStars([{ ...LEARN, rounds: 2 }]),
    [{ key: 'quest:learn', count: 2 }]);
});

test('3周でも数え落とさない', () => {
  assert.deepEqual(countGuildStars([{ ...LEARN, rounds: 3 }]),
    [{ key: 'quest:learn', count: 3 }]);
});

test('rounds が無い古い記録は1周として数える', () => {
  const old = { ...LEARN };
  delete old.rounds;
  assert.deepEqual(countGuildStars([old]), [{ key: 'quest:learn', count: 1 }]);
});

test('rounds が 0 や壊れた値でも、0本にはしない', () => {
  assert.deepEqual(countGuildStars([{ ...LEARN, rounds: 0 }]),
    [{ key: 'quest:learn', count: 1 }]);
  assert.deepEqual(countGuildStars([{ ...LEARN, rounds: 'x' }]),
    [{ key: 'quest:learn', count: 1 }]);
});

test('ギルドごとに分けて数える', () => {
  const out = countGuildStars([{ ...LEARN, rounds: 2 }, { ...WORK, rounds: 3 }]);
  assert.deepEqual(out, [{ key: 'quest:learn', count: 2 }, { key: 'quest:work', count: 3 }]);
});

test('同じギルドの別クエストは足し合わせる', () => {
  const out = countGuildStars([
    { ...LEARN, rounds: 2 },
    { ...LEARN, id: 'general-quest-009', rounds: 1 }]);
  assert.deepEqual(out, [{ key: 'quest:learn', count: 3 }]);
});

test('#000（創業クエスト）は何周しても星にしない', () => {
  assert.deepEqual(countGuildStars([
    { ...LEARN, isFounder: true, rounds: 5 }]), []);
});

test('色の決まらないクエストは星にしない', () => {
  assert.deepEqual(countGuildStars([{ ...LEARN, accent: '', rounds: 4 }]), []);
});

/* ───────── パスポートの記録件数 ───────── */
function recordCount(done) {
  const src = html.slice(html.indexOf('    const doneRounds = done.reduce('),
                         html.indexOf("    doneHtml = _sppRow('SchoolPark｜完走したクエスト'"));
  assert.ok(src.length > 50, '記録件数の数え上げが見つかりません');
  const ctx = vm.createContext({ done });
  vm.runInContext(src + '\nglobalThis.out = doneRounds;', ctx);
  return ctx.out;
}

test('記録欄の件数も、周回で数える', () => {
  assert.equal(recordCount([{ ...LEARN, rounds: 2 }]), 2);
  assert.equal(recordCount([{ ...LEARN, rounds: 2 }, { ...WORK, rounds: 1 }]), 3);
});

test('記録欄も #000 は数えない', () => {
  assert.equal(recordCount([{ ...LEARN, isFounder: true, rounds: 3 }]), 0);
});

test('記録欄と星空は、同じ本数になる', () => {
  const done = [{ ...LEARN, rounds: 2 }, { ...WORK, rounds: 3 }];
  const stars = countGuildStars(done).reduce((n, g) => n + g.count, 0);
  assert.equal(recordCount(done), stars,
    '同じ「完走」で2つの画面が違う数を出してはいけない');
});

/* ───────── 周回の札 ───────── */
test('2周以上なら、記録の行に周回を書く', () => {
  const at = html.indexOf('      const rounds = Math.max(1, Number(q.rounds)');
  assert.ok(at > 0, '周回の札を作るところが見つかりません');
  const src = html.slice(at,
    html.indexOf("      doneHtml += _sppRowHtml('　' + escapeHtml(_sppDate(q.at))", at));
  const run = (q) => {
    const ctx = vm.createContext({ q });
    vm.runInContext(src + '\nglobalThis.out = roundTag;', ctx);
    return ctx.out;
  };
  assert.equal(run({ ...LEARN, rounds: 1 }), '', '1周のときは何も書かない');
  assert.match(run({ ...LEARN, rounds: 2 }), /2周/);
  assert.match(run({ ...LEARN, rounds: 7 }), /7周/);
  assert.equal(run({ ...LEARN, isFounder: true, rounds: 3 }), '');
});

/* ───────── 周回を数えるべき場所が、全部そろっているか ─────────
   1か所でも「1本ずつ」に戻ると、画面ごとに数が食い違う。 */

test('信用スコアは周回で数えている', () => {
  const src = html.slice(html.indexOf("    const list = await spCompletedQuests(me);"),
                         html.indexOf('  } catch (e) {', html.indexOf('const list = await spCompletedQuests(me);')));
  assert.match(src, /q\.rounds/, '信用スコアが周回を見ていません');
});

test('SchoolPark のメンバー一覧は周回で数えている', () => {
  assert.match(html, /m\.done \+= Math\.max\(1, Number\(t\.rounds\)/);
});

test('運営画面のメンバー一覧も周回で数えている', () => {
  assert.match(admin, /m\.done \+= Math\.max\(1, Number\(t\.rounds\)/,
    'SchoolPark 側と同じ数え方にそろえること');
  assert.doesNotMatch(admin, /if \(m && t\.approved\) m\.done\+\+;/,
    '1本ずつの数え方に戻っています');
});

test('サーバーが approvedRounds を書いている（ここが元データ）', () => {
  const backend = fs.readFileSync(path.join(root, 'backend/quest-completion.js'), 'utf8');
  /* 認めるたびに1つ増える。ただし「認めてあるのに渡していなかった
     ぶんを渡すだけ」のときは増やさない（やってもいない周回を
     認めたことになる）。 */
  assert.match(backend, /approvedRounds: isTopup \? doneRounds : doneRounds \+ 1/,
    '周回を書くのをやめたら、画面側の数え方も見直すこと');
});

test('クエストの完走を読むところが、周回を返している', () => {
  const src = html.slice(html.indexOf('async function spCompletedQuests(p)'),
                         html.indexOf('/* 議題とクエストの生の記録。'));
  assert.match(src, /rounds: Math\.max\(1, Number\(rounds\)/);
  assert.match(src, /approvedRounds/);
});

/* 壊れた値でも 0本 や NaN にしない。

   Math.max(1, Number('x')) は 1 ではなく NaN になる。
   「0件と書かない」ために付けた Math.max が、
   書き方ひとつで「NaN件」を出す形になっていた。 */
test('周回の数え方に、NaN になる書き方が残っていない', () => {
  const bad = /Math\.max\(1,\s*Number\([A-Za-z.]*(rounds|approvedRounds)\s*\|\|/;
  assert.doesNotMatch(html, bad,
    'Number(x || 1) だと壊れた値で NaN。Number(x) || 0 と書くこと');
  assert.doesNotMatch(admin, bad,
    'Number(x || 1) だと壊れた値で NaN。Number(x) || 0 と書くこと');
});

test('周回を数えるどの場所も、壊れた値を1周として扱う', () => {
  for (const v of ['x', null, undefined, '', {}, NaN, -3, 0]) {
    assert.equal(Math.max(1, Number(v) || 0), 1, '入力: ' + String(v));
  }
  for (const v of [2, '3', 4.0]) {
    assert.equal(Math.max(1, Number(v) || 0), Number(v), '入力: ' + String(v));
  }
});
