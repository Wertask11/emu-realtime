/* クエストの並びと、案件ものの見え方。

   15本まとめて出した #002 は作った時刻がほぼ同じなので、
   記録が返ってきた順に出すと、開くたびに並びが変わる。
   #002-4 標準 の次に #002-1 実践 が来るような一覧になっていた。

   あわせて、案件もののクエストは「元の知識」を持たないのに、
   カードに空の箱が15本ぜんぶに出ていた。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../..');
const S = require(path.join(root, 'frontend/public/schoolpark/quest-store.js'));
const INDEX = fs.readFileSync(path.join(root, 'frontend/public/index.html'), 'utf8');
const DAO = fs.readFileSync(path.join(root, 'frontend/public/schoolpark/dao.html'), 'utf8');
const SEED = JSON.parse(fs.readFileSync(
  path.join(root, 'tools/quest-seeds/general-002-work.json'), 'utf8'));

const founder = { id: 'founder-quest-000', kind: 'founder', questNumber: 0 };
const label = q => S.isFounder(q) ? '#000' : (S.fullLabel(q) || '（番号なし）');

test('#002 の15本が、枝番→段の順に並ぶ', () => {
  const shuffled = SEED.slice().reverse();
  shuffled.sort(S.compare);
  assert.deepEqual(shuffled.map(label), [
    '#002-1 入門', '#002-1 標準', '#002-1 実践',
    '#002-2 入門', '#002-2 標準', '#002-2 実践',
    '#002-3 入門', '#002-3 標準', '#002-3 実践',
    '#002-4 入門', '#002-4 標準', '#002-4 実践',
    '#002-5 入門', '#002-5 標準', '#002-5 実践']);
});

test('何度並べても同じ順になる', () => {
  const a = SEED.slice().sort(S.compare).map(label);
  const b = SEED.slice().reverse().sort(S.compare).map(label);
  assert.deepEqual(a, b, '並べるたびに変わると、探し直すことになる');
});

test('#000 は先頭。番号の無い古いクエストは最後', () => {
  const list = [{ title: '古い' }, SEED[7], founder, SEED[0]];
  list.sort(S.compare);
  assert.equal(label(list[0]), '#000');
  assert.equal(label(list.at(-1)), '（番号なし）');
});

test('一般が特殊より先', () => {
  const list = [{ series: 'special', questNumber: 1, branch: 0, stage: '' },
                { series: 'general', questNumber: 9, branch: 0, stage: '' }];
  list.sort(S.compare);
  assert.deepEqual(list.map(label), ['#009', '特殊 #001']);
});

test('空を混ぜても落ちない', () => {
  assert.doesNotThrow(() => [null, undefined, SEED[0]].sort(S.compare));
});

test('クエスト一覧とギルドの一覧、どちらも同じ並べ方を使う', () => {
  const uses = INDEX.split('\n').filter(l => /SpQuestStore\.compare/.test(l));
  assert.ok(uses.length >= 2, '片方だけ番号順だと、同じものを探し直すことになる: ' + uses.length);
  assert.doesNotMatch(INDEX,
    /docs\.sort\(\(a, b\) => Number\(SpQuestStore\.isFounder\(b\)\)/,
    '古い並べ方（#000だけ先頭）が残っています');
});

/* ───────── カードの「元の知識」 ───────── */

test('案件ものは、カードに空の「元の知識」を出さない', () => {
  assert.match(INDEX, /knowledgeShow:/, '出し分けが無い');
  assert.match(DAO, /display:\{\{ e\.knowledgeShow \}\}/,
    'カードの箱が出しっぱなしになっています');
});

/* ───────── 現場の図 ───────── */

test('#002 の現場資料に、緑ヶ丘の案内図を添える', () => {
  assert.match(INDEX, /'general-2':/, '#002 の図が対応表に無い');
  assert.match(INDEX, /midorigaoka-map\.jpg/);
  assert.ok(fs.existsSync(path.join(root, 'frontend/public/schoolpark/midorigaoka-map.jpg')),
    '図そのものが置かれていない');
});

test('図は現場資料の中（たたんだ中）に出す', () => {
  /* この画面には別の <details>（#000 の章）も在る。
     探し始める位置を渡さないと、そちらの閉じに当たって空になる。 */
  const at = DAO.indexOf('現場の資料を読む');
  assert.ok(at > 0, '現場資料のたたみが見つかりません');
  const det = DAO.slice(at, DAO.indexOf('</details>', at));
  assert.match(det, /cur\.briefImage/, '資料の外に出ている');
  assert.match(det, /cur\.brief \}\}/, '資料の本文もたたみの中にあること');
});

test('現場資料を持たないクエストには、図を出さない', () => {
  const src = INDEX.slice(INDEX.indexOf('function _spBriefImage(q)'),
                          INDEX.indexOf('function _spBriefImageAlt(q)'));
  assert.match(src, /if \(!v\.brief\) return ''/,
    '資料の無いクエストにも図が出てしまう');
});

test('これから出すクエストは、図をデータに持てる', () => {
  const ADMIN = fs.readFileSync(path.join(root, 'frontend/public/membership-admin.html'), 'utf8');
  assert.match(ADMIN, /briefImage:/, 'まとめて出す口が図を受け取らない');
  /* 外の宛先を書けると、クエストの中から外の見張りを呼べてしまう。 */
  const line = ADMIN.slice(ADMIN.indexOf('briefImage:'), ADMIN.indexOf('briefImage:') + 300);
  assert.match(line, /https/, '宛先の形を確かめていない');
});

/* ───────── ギルドの「参加したい・応援する」 ─────────

   Listen が切れているあいだ、SDK の読みは
   「Failed to get document because the client is offline」で断る。
   押しても何も起きず、断りの言葉だけが出ていた。
   投稿の回数を数えるところ（_emuAddUsage）と同じ症状。 */

const TOGGLE = INDEX.slice(INDEX.indexOf('window.spGuildToggle = async function'),
                           INDEX.indexOf('/* 採択する。運営だけ。'));

test('SDKで読めなくても、普通の通信で確かめ直す', () => {
  assert.ok(TOGGLE.length > 300, 'ギルドの切り替えが見つかりません');
  assert.match(TOGGLE, /_spRestDoc\('sp_guild_members\/'/,
    '読めなかったときの逃げ道が無い');
  assert.match(TOGGLE, /joined === null/,
    '読めたかどうかと、入っているかどうかを区別していない');
});

test('両方だめなときだけ、あきらめて理由を出す', () => {
  assert.match(TOGGLE, /いまの状態を確かめられませんでした/);
  /* 逃げ道を通る前にあきらめていないこと。 */
  const giveUp = TOGGLE.indexOf('いまの状態を確かめられませんでした');
  const fallback = TOGGLE.indexOf('_spRestDoc');
  assert.ok(fallback < giveUp, '逃げ道を試す前にあきらめている');
});

test('読まずに書くことはしない（入るのは1回だけ、という決まりのため）', () => {
  /* すでに入っているのに setDoc すると update になり、
     記録の決まりが認めていないので断られる。 */
  assert.match(TOGGLE, /joined \? fb\.deleteDoc\(ref\) : fb\.setDoc\(ref/,
    '入っているかどうかで書き分けていない');
});

test('断られたら、証を取り直して1回だけやり直す', () => {
  assert.match(TOGGLE, /_spDenied\(e\) && await _spRefreshAuth\(\)/);
  /* やり直す前に、押せる状態へ戻していること。
     戻さないと、やり直した先の最初の行で跳ね返される。 */
  const at = TOGGLE.indexOf('_spRefreshAuth()');
  const after = TOGGLE.slice(at, at + 200);
  assert.match(after, /_spGuildBusy = false/, 'やり直す前に錠を外していない');
});

test('何が起きても、次に押せる状態へ戻す', () => {
  assert.match(TOGGLE, /finally \{[\s\S]*?_spGuildBusy = false/,
    '押しても何も起きない状態に戻ってしまう');
});
