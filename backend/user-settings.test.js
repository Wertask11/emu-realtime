/* 右上のユーザー表示（名前 / プロフィール画像）の保存。

   本人が「設定」で選んだものを、名前と写真と同じ user_profiles/{アドレス} に
   1項目（headerIdentityMode）だけ足して残す。名前と写真の欄には触らないこと、
   決まった2つの値しか受け付けないこと、本人のアドレスにしか書かないことを確かめる。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SERVER = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const SRC = SERVER.slice(SERVER.indexOf('// ── 右上のユーザー表示'),
                         SERVER.indexOf('// ── ランキング用サーバーキャッシュ'));
assert.match(SRC, /app\.post\('\/api\/user\/settings', requireFirebaseUser, requireOwnAddress,/,
  '入口が切り出せていないか、本人確認が外れています');

function stage(body) {
  const writes = [];
  const db = {
    collection(name) {
      return { doc(id) { return { async set(data, opts) { writes.push({ name, id, data, opts }); } }; } };
    }
  };
  let handler = null;
  const app = { post(route, ...fns) { if (route === '/api/user/settings') handler = fns[fns.length - 1]; } };
  vm.runInNewContext(SRC, { app, db, console, requireFirebaseUser() {}, requireOwnAddress() {} });
  const res = {
    code: 200, body: null,
    status(c) { this.code = c; return this; },
    json(b) { this.body = b; return this; }
  };
  return { writes, run: () => handler({ body }, res).then(() => res) };
}

test('選んだ表示だけを、名前と写真の書類に足す（名前と写真は消さない）', async () => {
  /* requireOwnAddress が本人のアドレスに置き換えたあとの形 */
  const s = stage({ address: '0xABCDEF0000000000000000000000000000000001', headerIdentityMode: 'avatar' });
  const res = await s.run();
  assert.equal(res.code, 200);
  /* vm の中で作られた値は別の世界の Object なので、写してから比べる */
  assert.deepEqual({ ...res.body }, { success: true, headerIdentityMode: 'avatar' });
  assert.equal(s.writes.length, 1);
  const w = s.writes[0];
  assert.equal(w.name, 'user_profiles');
  assert.equal(w.id, '0xabcdef0000000000000000000000000000000001');
  assert.deepEqual({ ...w.opts }, { merge: true }, 'merge でないと名前と写真が消えます');
  assert.deepEqual(Object.keys(w.data).sort(), ['address', 'headerIdentityMode', 'updatedAt']);
  assert.equal(w.data.headerIdentityMode, 'avatar');
});

test('名前に戻すこともできる', async () => {
  const s = stage({ address: '0xabcdef0000000000000000000000000000000001', headerIdentityMode: 'name' });
  const res = await s.run();
  assert.equal(res.code, 200);
  assert.equal(s.writes[0].data.headerIdentityMode, 'name');
});

test('決まった2つ以外は受け付けず、何も書かない', async () => {
  for (const mode of ['', 'image', 'AVATAR', null, undefined, 1, { a: 1 }]) {
    const s = stage({ address: '0xabcdef0000000000000000000000000000000001', headerIdentityMode: mode });
    const res = await s.run();
    assert.equal(res.code, 400, String(mode));
    assert.equal(s.writes.length, 0, String(mode));
  }
});

test('アドレスが無ければ書かない', async () => {
  const s = stage({ headerIdentityMode: 'avatar' });
  const res = await s.run();
  assert.equal(res.code, 400);
  assert.equal(s.writes.length, 0);
});
