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

/* ───────── サーバーへの用事も、証を取り直す ─────────

   ログインの証（Firebase の ID トークン）は1時間で切れる。
   管理画面は開きっぱなしで使うので、1時間たつとサーバーへの
   用事がぜんぶ INVALID_AUTH_TOKEN（401）で断られる。
   画面は生きているのに、押すボタンが全部だめになる。

   9/29、EMUER の予算を公開しようとして実際にそうなった。
   Firestore への書き込みには取り直す道を付けてあったが
   （spWrite）、サーバーへの用事にだけ無かった。 */
const vm2 = require('node:vm');

function apiSrc() {
  const from = ADMIN.indexOf('async function spIdToken(');
  const to = ADMIN.indexOf('\n}\n', ADMIN.indexOf('async function api(path, options)')) + 3;
  const src = ADMIN.slice(from, to);
  assert.ok(from > 0 && src.length > 500, 'サーバーへの用事の口が見つかりません');
  return src;
}

function caller(opts) {
  const o = opts || {};
  const seen = { tokens: [], forced: [], calls: 0 };
  let live = o.freshToken || 'fresh';
  const ctx = vm2.createContext({
    API: 'https://x',
    console: { warn() {} },
    JSON, Object, Error,
    auth: { currentUser: {
      getIdToken: async function (force) {
        seen.forced.push(!!force);
        if (o.refreshThrows) throw new Error('network');
        return force ? live : (o.staleToken || 'stale');
      }
    } },
    fetch: async function (url, init) {
      seen.calls += 1;
      seen.tokens.push(String(init.headers.Authorization || '').replace('Bearer ', ''));
      const ok = !o.alwaysReject && seen.tokens[seen.tokens.length - 1] === live;
      return { ok: ok, status: ok ? 200 : (o.status || 401),
        json: async () => (ok ? { ok: true } : { error: 'INVALID_AUTH_TOKEN' }) };
    }
  });
  vm2.runInContext('let idToken = null;\n' + apiSrc(), ctx);
  return { ctx, seen };
}

test('断られたら、証を取り直して1回だけやり直す', async () => {
  const c = caller({ staleToken: 'stale', freshToken: 'fresh' });
  const out = await c.ctx.api('/api/emuer/v2/guild-quest/budgets', { method: 'POST', body: { a: 1 } });
  assert.deepEqual(Array.from(c.seen.tokens), ['stale', 'fresh'],
    '取り直さずにあきらめている');
  assert.equal(out.ok, true);
  assert.equal(c.seen.calls, 2, 'やり直しが ' + c.seen.calls + '回になっている');
});

test('やり直すときだけ、はっきり取り直す', async () => {
  const c = caller({ staleToken: 'stale', freshToken: 'fresh' });
  await c.ctx.api('/x');
  assert.deepEqual(Array.from(c.seen.forced), [false, true],
    '毎回はっきり取り直すと、Firebase に無駄な往復が増える');
});

test('権限が無い（403）ときは、やり直さない', async () => {
  const c = caller({ staleToken: 'stale', freshToken: 'fresh', status: 403 });
  await assert.rejects(() => c.ctx.api('/x'));
  assert.equal(c.seen.calls, 1, '取り直しても同じなのに、もう一度投げている');
});

test('取り直せなかったときは、断られたことをそのまま返す', async () => {
  const c = caller({ refreshThrows: true });
  await assert.rejects(() => c.ctx.api('/x'), (e) => {
    assert.equal(e.code, 'INVALID_AUTH_TOKEN', '出た文言: ' + e.message);
    assert.equal(e.status, 401);
    return true;
  });
});

test('2回目も断られたら、そこであきらめる（無限にやり直さない）', async () => {
  const c = caller({ alwaysReject: true });   /* 取り直しても断られ続ける */
  await assert.rejects(() => c.ctx.api('/x'));
  assert.equal(c.seen.calls, 2, 'やり直しが ' + c.seen.calls + '回。止まらなくなっている');
});

test('ログインの証は、毎回そのときのものを使う', () => {
  const src = apiSrc();
  assert.match(src, /await spIdToken\(false\)/,
    '取っておいた古い証をそのまま使っている');
  assert.equal(ADMIN.indexOf('"Authorization": "Bearer " + idToken'), -1,
    '1回だけ取った証を使い回す書き方が残っている');
});
