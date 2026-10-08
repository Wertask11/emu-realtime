/* パソコン版のメンバー・貢献が「自分だけ」になっていた。

   一覧を読む共通の口（_spReadAllOnce）は、SDK の getDocs が手元の控え（fromCache）から
   返したとき、「0件」だけを疑い、1件でもあればそれを全件として使っていた。
   控えに入っているのは、この端末がたまたま前に読んだ記録だけ。SDK の常時接続が
   切れていると（パソコンで起きやすい）、クエストを受けた記録は自分の1件しか無く、
   メンバー表が自分だけになった。控えなら普通の通信（REST）で全件を読み直す。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readHtml, build } = require('../year-goals-tests/extract.cjs');

const INDEX = readHtml('frontend/public/index.html');

function stage({ fromCache, sdkRows, restRows, restFails }) {
  const calls = [];
  const snap = {
    metadata: { fromCache },
    forEach: (cb) => sdkRows.forEach((r) => cb({ id: r.id, data: () => ({ name: r.name }) }))
  };
  const stubs = {
    window: { db: {}, fbLib: { collection: () => ({}), getDocs: async () => snap } },
    _spSoon: async (p) => ({ ok: true, value: await p }),
    _spRestGet: async (path) => {
      calls.push(path);
      if (restFails) throw new Error('HTTP 429');
      return { documents: restRows.map((r) => ({ name: 'projects/p/databases/(default)/documents/x/' + r.id, fields: { name: { stringValue: r.name } } })) };
    },
    _spRestFields: (f) => ({ name: f.name.stringValue }),
    console: { warn: () => {} }
  };
  const { _spReadAllOnce } = build(INDEX, ['_spReadAllOnce'], stubs);
  return { read: () => _spReadAllOnce('sp_quests/q1/commits'), calls };
}
const ALL = [{ id: '0xme', name: '俺たちの青春' }, { id: '0xa', name: '天輝' }, { id: '0xb', name: '単3電池' }, { id: '0xc', name: 'やこたけ' }];

test('控えに自分の1件しか無いときも、普通の通信で全員を読み直す', async () => {
  const s = stage({ fromCache: true, sdkRows: [ALL[0]], restRows: ALL });
  const rows = await s.read();
  assert.deepEqual(rows.map((r) => r.name), ALL.map((r) => r.name));
  assert.deepEqual(s.calls, ['sp_quests/q1/commits?pageSize=300']);
});

test('サーバーから返ってきたもの（控えではない）は、そのまま使う（余計に読まない）', async () => {
  const s = stage({ fromCache: false, sdkRows: ALL, restRows: [] });
  assert.equal((await s.read()).length, 4);
  assert.deepEqual(s.calls, []);
});

test('控えしか無く、普通の通信も届かないときは「読めなかった」（null）。控えの一部を全件と言わない', async () => {
  const s = stage({ fromCache: true, sdkRows: [ALL[0]], restRows: [], restFails: true });
  assert.equal(await s.read(), null);
});

test('メンバー表は、一部しか読めなかったときに黙って少ない人数を出さない', () => {
  const i = INDEX.indexOf('window.spDaoLoadMembers');
  const body = INDEX.slice(i > 0 ? i : INDEX.indexOf('async function spDaoLoadMembers'));
  assert.ok(body.indexOf('if (!cs) partial = true;') > 0);
  assert.ok(body.indexOf("membersNote: (failed || partial)") > 0);
});
