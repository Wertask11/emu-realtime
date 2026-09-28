/* 断られたときに、証を取り直して1回だけやり直すこと。

   通信が切れているあいだ、SDK は証（IDトークン）を更新できない。
   復旧しても古い証のまま投げ続けるので、記録の決まりは当然それを断る。
   人は何も変わっていないのに「権限がありません」になる。

   SchoolPark 本体（index.html の _spRefreshAuth）は前からこれをやって
   いたが、この画面には無かった。トレジャリーの記録が permission-denied
   で落ちたのがこれ。ルールもアカウントも正しかった。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ADMIN = fs.readFileSync(
  path.join(__dirname, '../../frontend/public/membership-admin.html'), 'utf8');

const src = ADMIN.slice(ADMIN.indexOf('let spTokenRefreshedAt = 0;'),
                        ADMIN.indexOf('async function spMyAddress()'));
assert.ok(src.length > 300, 'やり直しの仕組みが見つかりません');

function make(over) {
  const calls = { token: 0 };
  const ctx = vm.createContext({
    console: { warn() {} }, Date, String, Number,
    auth: { currentUser: { getIdToken: async (force) => {
      calls.token += 1; calls.force = force;
      if (over && over.tokenThrows) throw new Error('取れない');
      return 'tok';
    } } }
  });
  vm.runInContext(src, ctx);
  return { ctx, calls };
}
const denied = () => Object.assign(new Error('Missing or insufficient permissions'),
  { code: 'permission-denied' });

test('通れば、そのまま返す（証は取り直さない）', async () => {
  const { ctx, calls } = make();
  let ran = 0;
  const out = await ctx.spWrite(async () => { ran += 1; return 'ok'; });
  assert.equal(out, 'ok');
  assert.equal(ran, 1);
  assert.equal(calls.token, 0, '通っているのに証を取り直している');
});

test('断られたら、証を取り直して1回だけやり直す', async () => {
  const { ctx, calls } = make();
  let ran = 0;
  const out = await ctx.spWrite(async () => {
    ran += 1;
    if (ran === 1) throw denied();
    return 'ok';
  });
  assert.equal(out, 'ok', 'やり直していない');
  assert.equal(ran, 2);
  assert.equal(calls.token, 1);
  assert.equal(calls.force, true, '取り直しに force を付けていない');
});

test('本当に権限が無いときは、2回目であきらめる', async () => {
  const { ctx } = make();
  let ran = 0;
  await assert.rejects(
    () => ctx.spWrite(async () => { ran += 1; throw denied(); }),
    /permissions/);
  assert.equal(ran, 2, '何度もやり直して待たせてはいけない');
});

test('通信が届かないだけのときは、やり直さずそのまま返す', async () => {
  const { ctx, calls } = make();
  let ran = 0;
  await assert.rejects(
    () => ctx.spWrite(async () => {
      ran += 1;
      throw Object.assign(new Error('offline'), { code: 'unavailable' });
    }), /offline/);
  assert.equal(ran, 1, '断られたわけではないのにやり直している');
  assert.equal(calls.token, 0);
});

test('証を取り直せなければ、やり直さない', async () => {
  const { ctx } = make({ tokenThrows: true });
  let ran = 0;
  await assert.rejects(() => ctx.spWrite(async () => { ran += 1; throw denied(); }));
  assert.equal(ran, 1);
});

test('10秒のあいだは、何度呼ばれても取り直しは1回', async () => {
  const { ctx, calls } = make();
  assert.equal(await ctx.spRefreshAuth(), true);
  assert.equal(await ctx.spRefreshAuth(), false, '続けて取り直している');
  assert.equal(calls.token, 1);
});

test('断られたかの判定は、符号と文言の両方を見る', () => {
  const { ctx } = make();
  assert.equal(ctx.spDenied({ code: 'permission-denied' }), true);
  assert.equal(ctx.spDenied({ message: 'Missing or insufficient permissions' }), true);
  assert.equal(ctx.spDenied({ code: 'unavailable' }), false);
  assert.equal(ctx.spDenied(null), false);
  assert.equal(ctx.spDenied({}), false);
});

/* ───────── 包み忘れが無いこと ───────── */

test('管理画面の書き込みは、すべてやり直しを通している', () => {
  const bare = ADMIN.split('\n')
    .map((line, i) => [i + 1, line])
    .filter(([, l]) => /await (f\.(addDoc|setDoc|updateDoc|deleteDoc)|SpQuestStore\.createQuest)/.test(l))
    .filter(([, l]) => l.indexOf('spWrite') < 0);
  assert.deepEqual(bare, [],
    'やり直しを通していない書き込みが残っています（行番号つき）');
});

test('SchoolPark 本体にも、同じ仕組みがある', () => {
  const index = fs.readFileSync(
    path.join(__dirname, '../../frontend/public/index.html'), 'utf8');
  assert.match(index, /async function _spRefreshAuth\(\)/,
    '本体の仕組みが消えたら、この画面だけ直しても意味が無い');
});
