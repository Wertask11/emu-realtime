/* 管理画面の SchoolPark タブが開けるか。

   起きていたこと：

     SchoolPark を開けませんでした
     アカウントの記録を読めませんでした（unavailable）。uid: wallet:0xdcc687…

   unavailable は「権限が無い」ではなく「サーバーへ届いていない」。
   ところが spMyAddress は getDoc を1回投げるだけで、転んだらそこで終わりだった。
   読み直す道も、普通の通信へ逃げる道も無い。画面にも「もう一度読む」が無い。

   SchoolPark 本体（index.html）は逃げ道を持っているので、
   別タブでは開けているのにこの画面だけ開けない、という見え方になっていた。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { build, readHtml } = require('../year-goals-tests/extract.cjs');

const ADMIN = readHtml('frontend/public/membership-admin.html');

const UNAVAILABLE = Object.assign(new Error('The service is currently unavailable.'), { code: 'unavailable' });
const OFFLINE = Object.assign(new Error('Failed to get document because the client is offline.'), { code: 'unavailable' });
const DENIED = Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });

const UID = 'wallet:0xdcc687c05f130e57597a8525771299a4efb6edf7';
const WALLET = '0xdcc687c05f130e57597a8525771299a4efb6edf7';
const CHES = '0x195f4478ee3865ee1dd360b79e121c638bdd42ac';
const ACCOUNT = { walletAddress: WALLET, chesAddress: CHES };

/* Firestore が返す形（値に型の名前が付く） */
function restDoc(o) {
  const fields = {};
  Object.keys(o).forEach(function (k) { fields[k] = { stringValue: o[k] }; });
  return { ok: true, status: 200, json: async function () { return { fields: fields }; } };
}

function admin(opts) {
  opts = opts || {};
  const calls = { getDoc: 0, fetch: 0, waits: [], warn: [] };
  const stubs = {
    console: { warn: function () { calls.warn.push([].slice.call(arguments).join(' ')); } },
    setTimeout: function (fn, ms) { calls.waits.push(ms); fn(); return 1 },
    fetch: async function (url, init) {
      calls.fetch++; calls.url = url; calls.init = init;
      if (opts.fetch) return await opts.fetch(url);
      throw new Error('通信できない');
    },
    app: { options: { projectId: 'emusch-2a111', apiKey: 'KEY' } },
    auth: { currentUser: opts.signedOut ? null
      : { uid: UID, getIdToken: async function () { return 'TOKEN'; } } },
    spReady: async function () {
      return {
        db: {},
        doc: function () { return {}; },
        getDoc: async function () {
          calls.getDoc++;
          const step = opts.getDoc || [];
          const v = typeof step === 'function' ? step(calls.getDoc) : step[calls.getDoc - 1];
          if (v instanceof Error) throw v;
          if (v === 'missing') return { exists: function () { return false; } };
          return { exists: function () { return true; }, data: function () { return v || ACCOUNT; } };
        }
      };
    },
    SP_OWNER_ADDRS: [WALLET, CHES]
  };
  const api = build(ADMIN,
    ['spTransient', 'ydFromRestValue', 'ydFromRestFields', 'spRestDoc', 'spMyAddress'],
    stubs, 'const spWait = (ms) => new Promise((r) => setTimeout(r, ms));\n');
  return { api: api, calls: calls };
}

test('1回で読めれば、それで終わり', async () => {
  const a = admin({ getDoc: [ACCOUNT] });
  const me = await a.api.spMyAddress();
  assert.equal(me.addr, CHES);
  assert.equal(a.calls.getDoc, 1);
  assert.equal(a.calls.fetch, 0);
});

test('unavailable で転んでも、読み直して開ける', async () => {
  const a = admin({ getDoc: [UNAVAILABLE, ACCOUNT] });
  const me = await a.api.spMyAddress();
  assert.equal(me.addr, CHES, '読み直していない');
  assert.equal(a.calls.getDoc, 2);
  assert.equal(a.calls.fetch, 0, 'まだ逃げ道を使う場面ではない');
});

test('SDK が3回とも転んだら、普通の通信で取りに行く', async () => {
  const a = admin({
    getDoc: [UNAVAILABLE, OFFLINE, UNAVAILABLE],
    fetch: async function () { return restDoc(ACCOUNT); }
  });
  const me = await a.api.spMyAddress();
  assert.equal(me.addr, CHES, '逃げ道が効いていない');
  assert.equal(a.calls.getDoc, 3);
  assert.equal(a.calls.fetch, 1);
  assert.match(a.calls.url, /documents\/ches_accounts\/wallet%3A0xdcc687/);
  assert.equal(a.calls.init.headers.Authorization, 'Bearer TOKEN');
});

test('読み直しは、だんだん間隔を空ける（すぐ3連打しない）', async () => {
  const a = admin({ getDoc: [UNAVAILABLE, UNAVAILABLE, ACCOUNT] });
  await a.api.spMyAddress();
  assert.deepEqual(a.calls.waits, [800, 1600]);
});

test('権限で断られたときは読み直さない（何度やっても同じなので）', async () => {
  const a = admin({ getDoc: [DENIED, ACCOUNT] });
  const me = await a.api.spMyAddress();
  assert.equal(me.addr, null);
  assert.equal(a.calls.getDoc, 1, '断られたのに読み直している');
  assert.match(me.why, /permission-denied/);
  assert.ok(!me.retry, '断られたのに「もう一度」を勧めている');
});

test('どうしても読めないときは、もう一度を勧める', async () => {
  const a = admin({ getDoc: [UNAVAILABLE, UNAVAILABLE, UNAVAILABLE] });
  const me = await a.api.spMyAddress();
  assert.equal(me.addr, null);
  assert.equal(me.retry, true);
  assert.match(me.why, /unavailable/);
  assert.match(me.why, /もう一度/);
});

test('記録が本当に無いときは、読み直さずそう言う', async () => {
  const a = admin({ getDoc: ['missing'] });
  const me = await a.api.spMyAddress();
  assert.equal(a.calls.getDoc, 1);
  assert.match(me.why, /記録がありません/);
  assert.ok(!me.retry);
});

test('記録が 404 のときも、逃げ道は「無い」と答える', async () => {
  const a = admin({
    getDoc: [UNAVAILABLE, UNAVAILABLE, UNAVAILABLE],
    fetch: async function () { return { ok: false, status: 404 }; }
  });
  const me = await a.api.spMyAddress();
  assert.equal(me.addr, null);
});

test('ログインしていなければ、何も読まない', async () => {
  const a = admin({ signedOut: true });
  const me = await a.api.spMyAddress();
  assert.match(me.why, /ログインしていません/);
  assert.equal(a.calls.getDoc, 0);
  assert.equal(a.calls.fetch, 0);
});

test('運営のアドレスは、自分の持ち番号のうち運営に登録されているほうを選ぶ', async () => {
  const a = admin({ getDoc: [{ walletAddress: WALLET, chesAddress: '0xsomething-else' }] });
  const me = await a.api.spMyAddress();
  assert.equal(me.addr, '0xsomething-else');
  assert.equal(me.ownerAddr, WALLET, '運営として登録されているほうを選んでいない');
});

test('届かなかったのか、断られたのかを見分ける', () => {
  const a = admin({});
  assert.equal(a.api.spTransient(UNAVAILABLE), true);
  assert.equal(a.api.spTransient(OFFLINE), true);
  assert.equal(a.api.spTransient({ code: 'deadline-exceeded' }), true);
  assert.equal(a.api.spTransient(DENIED), false);
  assert.equal(a.api.spTransient({ code: 'not-found' }), false);
  assert.equal(a.api.spTransient(null), false);
});

test('画面に「もう一度読む」がある', () => {
  assert.ok(ADMIN.indexOf('id="spMeRetry"') >= 0, 'ボタンが無い');
  assert.ok(ADMIN.indexOf('$("#spMeRetry")') >= 0, '押しても何も起きない');
});
