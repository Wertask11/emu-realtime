/* 取り込んだものが、読める形で出ているか。

   Camellia β は localStorage を1件1文書で送ってくる。文書のIDは
   「種類 + UUID」で、中身は JSON の文字列。
   そのまま並べていたので、管理画面は UUID の列になり、開いても
   生の JSON が1行出るだけだった。届いてはいるのに読めない。

   種類ごとにまとめて、欄の名前と値を日本語にする。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '../..');
const HTML = fs.readFileSync(path.join(root, 'frontend/public/membership-admin.html'), 'utf8');

function cut(from, to) {
  const i = HTML.indexOf(from);
  assert.ok(i >= 0, '切り出しの始まりが見つかりません: ' + from);
  const j = HTML.indexOf(to, i);
  assert.ok(j > i, '切り出しの終わりが見つかりません: ' + to);
  return HTML.slice(i, j);
}

const SRC = cut('const CAM_IMPORT_KIND_JA', '/* 行動。どの画面をいつ開いたか');

const ctx = vm.createContext({
  esc: s => String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  fmt: iso => iso ? new Date(iso).toLocaleString('ja-JP') : '—'
});
vm.runInContext(SRC + '\nglobalThis.__camImports = camImports;', ctx);
const camImports = ctx.__camImports;

/* 画面に実際に出ていた1件。これが読めるようになることが目的。 */
const REAL = {
  type: 'context-memory-bd8013a7-3d39-406d-84b7-38c9e6d8adb6',
  kind: 'context-memory',
  name: 'Camellia β context-memory',
  characters: 187,
  importedAt: '2026-09-09T06:23:43.651Z',
  content: JSON.stringify({
    id: 'bd8013a7-3d39-406d-84b7-38c9e6d8adb6',
    actionId: 'circle', event: 'proposed',
    context: { mood: 5, timeBand: '夕方', weekday: 3, lifestyle: '' },
    createdAt: '2026-09-09T06:23:43.651Z'
  })
};

test('種類ごとにまとまり、件数が出る', () => {
  const html = camImports([REAL, { ...REAL, type: 'context-memory-x' }]);
  assert.ok(html.indexOf('すすめた記録') > 0, '種類の日本語が出ていません');
  assert.ok(html.indexOf('2件') > 0, '件数が出ていません');
  /* まとまりは1つ。1件ずつ別々に並べない。 */
  assert.equal(html.split('<summary').length - 1, 2, '見出しの数が合いません（本体＋元のまま）');
});

test('中身が日本語で読める', () => {
  const html = camImports([REAL]);
  assert.ok(html.indexOf('すすめた') > 0, 'できごとが英語のままです（proposed）');
  assert.ok(html.indexOf('😄 とてもよい') > 0, '気分が数字のままです');
  assert.ok(html.indexOf('水曜') > 0, '曜日が数字のままです');
  assert.ok(html.indexOf('夕方') > 0, '時間帯が出ていません');
  assert.ok(html.indexOf('やること') > 0, '欄の名前が英語のままです（actionId）');
});

test('読む助けにならない欄は出さない', () => {
  const html = camImports([REAL]);
  const body = html.slice(0, html.indexOf('元のまま見る'));
  assert.ok(body.indexOf('bd8013a7-3d39-406d-84b7-38c9e6d8adb6') < 0,
    'UUID が本文に出ています');
});

test('元のままも見られる', () => {
  const html = camImports([REAL]);
  assert.ok(html.indexOf('元のまま見る') > 0, '生データへの口がありません');
  assert.ok(html.indexOf('&quot;actionId&quot;') > 0 || html.indexOf('actionId') > 0,
    '生データが入っていません');
});

test('時刻は読める形にする', () => {
  /* 「元のまま見る」の中は ISO でよい。読む側の本文だけを見る。 */
  const html = camImports([REAL]);
  const body = html.slice(0, html.indexOf('元のまま見る'));
  assert.ok(body.indexOf('2026') > 0, '時刻が出ていません');
  assert.ok(body.indexOf('2026-09-09T06:23:43.651Z') < 0, 'ISO のまま出ています');
});

test('種類が入っていなくても、文書のIDから拾う', () => {
  const html = camImports([{ ...REAL, kind: undefined }]);
  assert.ok(html.indexOf('すすめた記録') > 0, 'IDから種類を拾えていません');
});

test('中身が壊れていても、落ちずに出す', () => {
  const html = camImports([{ type: 'checkin-1', kind: 'checkin', content: '{壊れた' }]);
  assert.ok(html.indexOf('チェックイン') > 0, '種類が出ていません');
  assert.ok(html.indexOf('壊れた') > 0, '中身が消えています');
});

test('ほかの種類も日本語になる', () => {
  const pairs = [
    ['checkin', 'チェックイン'], ['fortune', '占い'], ['tree-leaf', '木の葉（人）'],
    ['analytics', '画面の動き'], ['insight', '気づき'], ['action', 'やってみたこと'],
    ['saved-action', 'あとでやる'], ['conversation', 'AIとのやりとり'],
    ['meta', '全体の状態'], ['profile', 'プロフィール']
  ];
  pairs.forEach(([kind, ja]) => {
    const html = camImports([{ type: kind + '-1', kind, content: '{}' }]);
    assert.ok(html.indexOf(ja) > 0, kind + ' が日本語になっていません');
  });
});

test('決まった言葉が日本語になる', () => {
  const cases = [
    [{ event: 'completed' }, 'やった'],
    [{ event: 'dismissed' }, 'ことわった'],
    [{ rating: 'great' }, 'とてもよかった'],
    [{ dismissReason: 'no_time' }, '時間がない'],
    [{ timing: 'when_free' }, '手が空いたら'],
    [{ category: 'REST' }, '休む'],
    [{ orientation: 'reversed' }, '逆位置'],
    [{ verdict: 'correct' }, '当たり'],
    [{ status: 'skipped' }, 'とばした'],
    [{ sleep: 7 }, '7時間'],
    [{ periodDays: 2 }, '2日目'],
    [{ confidence: 0.75 }, '75%'],
    [{ periodEnabled: true }, 'はい']
  ];
  cases.forEach(([record, want]) => {
    const html = camImports([{ type: 'x-1', kind: 'x', content: JSON.stringify(record) }]);
    assert.ok(html.indexOf(want) > 0, JSON.stringify(record) + ' → ' + want + ' になっていません');
  });
});

test('入れ子（context）も1行に開く', () => {
  const html = camImports([{ type: 'x-1', kind: 'x',
    content: JSON.stringify({ context: { mood: 1, sleep: 4, body: '疲れ気味' } }) }]);
  assert.ok(html.indexOf('😢 とてもつらい') > 0, '入れ子の気分が出ていません');
  assert.ok(html.indexOf('4時間') > 0, '入れ子の睡眠が出ていません');
  assert.ok(html.indexOf('疲れ気味') > 0, '入れ子のからだが出ていません');
});

test('空の欄は出さない', () => {
  const html = camImports([{ type: 'x-1', kind: 'x',
    content: JSON.stringify({ note: '', name: 'さくら' }) }]);
  assert.ok(html.indexOf('さくら') > 0, '値が出ていません');
  assert.ok(html.indexOf('メモ') < 0, '空の欄まで出しています');
});

test('何も無ければ、何も出さない', () => {
  assert.equal(camImports([]), '');
  assert.equal(camImports(null), '');
});
