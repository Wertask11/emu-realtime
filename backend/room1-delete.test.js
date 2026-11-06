/* Knowledge Text（旧 Room1）のコンテンツを1件だけ消す（11/6）。

   消す手段が「全削除」しか無く、テスト投稿だけを消せなかった。
   1件削除は管理者だけ・指定した1件だけ・"all" を受けない、を確かめる。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SERVER = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const SRC = SERVER.slice(SERVER.indexOf('// ── コンテンツを1件だけ削除'),
                         SERVER.indexOf('// ═══', SERVER.indexOf('// ── コンテンツを1件だけ削除')));
assert.match(SRC, /app\.delete\("\/api\/room1\/contents\/:id", requireRoom1Admin,/, '入口が切り出せていないか、管理者の確認が外れています');

test('"/contents/all"（全削除）より後ろに置いてある', () => {
  assert.ok(SERVER.indexOf('app.delete("/api/room1/contents/all"') < SERVER.indexOf('app.delete("/api/room1/contents/:id"'));
});

function stage(docs) {
  const deleted = [];
  const cache = { data: ['cached'], fetchedAt: 1 };
  const db = {
    collection(name) {
      assert.equal(name, 'room1_contents');
      return { doc(id) { return {
        async get() { return { exists: id in docs, data: () => docs[id] }; },
        async delete() { deleted.push(id); }
      }; } };
    }
  };
  let handler = null;
  const app = { delete(route, ...fns) { if (route === '/api/room1/contents/:id') handler = fns[fns.length - 1]; } };
  vm.runInNewContext(SRC, { app, db, console: { log() {}, error() {} }, requireRoom1Admin() {},
    ROOM1_CONTENTS_COL: 'room1_contents', _room1Cache: cache, String });
  const run = async (id) => {
    const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await handler({ params: { id } }, res);
    return res;
  };
  return { deleted, cache, run };
}

test('指定した1件だけを消し、一覧の控えを捨てる', async () => {
  const s = stage({ a1: { title: 'money/増やし方' }, b2: { title: 'blue/姿勢' } });
  const res = await s.run('a1');
  assert.equal(res.code, 200);
  assert.deepEqual(s.deleted, ['a1']);
  assert.equal(s.cache.data, null, '控えが残っていると、消したものが10分出続ける');
});

test('"all" や変な ID では何も消さない', async () => {
  for (const id of ['all', '', '../x', 'a b', 'x'.repeat(101)]) {
    const s = stage({ all: {} });
    const res = await s.run(id);
    assert.equal(res.code, 400, id);
    assert.deepEqual(s.deleted, [], id);
  }
});

test('無いものは 404 で、何も消さない', async () => {
  const s = stage({});
  const res = await s.run('missing1');
  assert.equal(res.code, 404);
  assert.deepEqual(s.deleted, []);
});
