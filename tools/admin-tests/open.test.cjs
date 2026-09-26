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

/* ───────── クエストを出すところ ─────────

   本番でこれが出た（2026/9/26）。

     RestConnection RPC 'BatchGetDocuments' failed {"code":"permission-denied"}
     documents: [".../sp_quest_numbers/general-001-0-なし"]
     クエストを出せませんでした: Missing or insufficient permissions.

   断られたのは予約札を読むところ。決まりは canAccessSchoolPark() だけなので、
   運営なら通る。通らなかったのは、直前の

     [spTrack] error: Failed to get document because the client is offline.

   のとおり SDK が自分をオフラインと見なし、古い証のまま投げたため。
   読むほうには証を取り直す道が入っていたが、出すほうだけ素通りだった。 */
const INDEX = readHtml('frontend/public/index.html');

function issuer(opts) {
  opts = opts || {};
  const calls = { create: 0, refresh: 0 };
  const stubs = {
    console: { warn: function () {} },
    window: { db: {} },
    _spDenied: function (e) {
      return String((e && e.code) || '') === 'permission-denied'
        || String((e && e.message) || '').indexOf('Missing or insufficient permissions') >= 0;
    },
    _spRefreshAuth: async function () { calls.refresh++; return opts.refresh !== false; },
    SpQuestStore: {
      createQuest: async function () {
        calls.create++;
        const step = (opts.results || [])[calls.create - 1];
        if (step instanceof Error) throw step;
        return step || { id: 'q1' };
      }
    }
  };
  return { api: build(INDEX, ['_spCreateQuestRetry'], stubs), calls: calls };
}

const PERM = Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
const TAKEN = new Error('QUEST_NUMBER_TAKEN');

test('出す：1回で通れば、証は取り直さない', async () => {
  const i = issuer({ results: [{ id: 'q1' }] });
  assert.deepEqual(await i.api._spCreateQuestRetry({}, {}), { id: 'q1' });
  assert.equal(i.calls.create, 1);
  assert.equal(i.calls.refresh, 0);
});

test('出す：断られたら証を取り直して、もう一度出す', async () => {
  const i = issuer({ results: [PERM, { id: 'q2' }] });
  assert.deepEqual(await i.api._spCreateQuestRetry({}, {}), { id: 'q2' });
  assert.equal(i.calls.create, 2, 'やり直していない');
  assert.equal(i.calls.refresh, 1, '証を取り直していない');
});

test('出す：やり直しは1回だけ（本当に権限が無いときに待たせない）', async () => {
  const i = issuer({ results: [PERM, PERM] });
  await assert.rejects(function () { return i.api._spCreateQuestRetry({}, {}); },
    function (e) { return e.code === 'permission-denied'; });
  assert.equal(i.calls.create, 2);
});

test('出す：証を取り直せなくても、1回は試す（10秒の間引きがあるため）', async () => {
  const i = issuer({ results: [PERM, { id: 'q3' }], refresh: false });
  assert.deepEqual(await i.api._spCreateQuestRetry({}, {}), { id: 'q3' });
  assert.equal(i.calls.create, 2);
});

test('出す：番号が取られていたら、やり直さない（また同じ番号で弾かれる）', async () => {
  const i = issuer({ results: [TAKEN] });
  await assert.rejects(function () { return i.api._spCreateQuestRetry({}, {}); }, /QUEST_NUMBER_TAKEN/);
  assert.equal(i.calls.create, 1, '同じ番号でやり直している');
  assert.equal(i.calls.refresh, 0);
});

/* ───────── 承認待ち ─────────

   前は「クエストの状態を変える」カードの中に、クエストを全部並べて、
   その下に受けた人を並べるだけだった。21本出したら21本ぜんぶ開いて、
   誰が完走条件を満たしたかを目で探すことになる。
   しかも判断材料は報告の数だけで、知恵カードを置いたかは出ていなかった。
   完走条件は「報告3回＋知恵カード1枚＋運営の確認」なのに、
   そのまん中が管理画面に無かった。 */

test('承認待ちのカードがある', () => {
  assert.ok(ADMIN.indexOf('<h3>承認待ち') >= 0, 'カードが無い');
  assert.ok(ADMIN.indexOf('完走条件を満たしています') >= 0, '何人そろっているか出ていない');
});

test('承認待ちは、まだ認めていない人だけを集める', () => {
  const i = ADMIN.indexOf('const rows = [];');
  assert.ok(i > 0);
  const seg = ADMIN.slice(i, i + 400);
  assert.ok(seg.indexOf('if (t.approved) return;') >= 0, '認めた人まで並べている');
  assert.ok(seg.indexOf('t.logs >= 3 && t.wisdom >= 1') >= 0, '完走条件で判定していない');
});

test('条件を満たした人が先に並ぶ', () => {
  assert.ok(ADMIN.indexOf('rows.sort((a, b) => (b.ready - a.ready)') >= 0, '並び順が条件で決まっていない');
});

test('あと何が足りないかを出す', () => {
  assert.ok(ADMIN.indexOf('"報告あと" + (3 - r.t.logs) + "本"') >= 0);
  assert.ok(ADMIN.indexOf('"知恵カードあと1枚"') >= 0);
});

test('知恵カードの枚数を、人ごと・クエストごとに数えている', () => {
  const i = ADMIN.indexOf('const wisdomCount = {};');
  assert.ok(i > 0, '数えていない');
  const seg = ADMIN.slice(i, i + 400);
  assert.ok(seg.indexOf('String(d.questId || "") !== q.id') >= 0, 'クエストで絞っていない');
  assert.ok(seg.indexOf('String(d.author || "").toLowerCase()') >= 0, '人で絞っていない');
});

test('クエストの行にも、知恵カードの枚数が出る', () => {
  assert.ok(ADMIN.indexOf("' · 知恵カード ' + t.wisdom + '枚'") >= 0, '報告の数しか出ていない');
});

test('条件を満たしていない人を認めるときは、何が足りないかを見せて確かめる', () => {
  const i = ADMIN.indexOf('const short = [];');
  assert.ok(i > 0, '確かめていない');
  const seg = ADMIN.slice(i, i + 700);
  assert.ok(seg.indexOf('まだ完走条件を満たしていません') >= 0);
  assert.ok(seg.indexOf('それでも認めますか？') >= 0);
});

test('管理画面の完走も、承認した時点で数える（CLOSED を待たない）', () => {
  /* 前は「CLOSED、ただし一般#001 のLEARNだけ例外」という決め打ちだった。
     SchoolPark 側（spDaoLoadMembers / spTrustScore）とそろえる。 */
  assert.ok(ADMIN.indexOf('if (m && t.approved) m.done++;') >= 0, '承認で数えていない');
  assert.equal(ADMIN.indexOf('q.status === "CLOSED" ||\n          (q.series === "general"'), -1,
    '決め打ちが残っている');
});
