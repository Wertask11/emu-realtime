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

/* ───────── ④ 承認で報酬を、全クエスト共通に ─────────

   前は「一般 #001 の LEARN」だけがサーバーを通り、
   それ以外のクエストは Firestore に approved を直接書いていた。
   だから #002 以降と特殊クエストは、いくら認めても
   EMUER も証明書も動かない。予算そのものも公開できなかった。 */

const BACKEND = require('node:fs').readFileSync(
  require('node:path').join(__dirname, '..', '..', 'backend', 'quest-completion.js'), 'utf8');

test('予算は、#000 以外のどのクエストでも公開できる', () => {
  assert.ok(ADMIN.indexOf("data-qbudget=") >= 0, 'ボタンが無い');
  assert.equal(ADMIN.indexOf("Number(q.questNumber) === 1 && q.guildId === 'learn'"), -1,
    'LEARN #001 の決め打ちが残っている');
  assert.equal(ADMIN.indexOf('EMUER個別予算10,000を公開'), -1, '10,000の決め打ちが残っている');
  const i = ADMIN.indexOf('data-qbudget="');
  assert.ok(ADMIN.slice(i - 200, i).indexOf('SpQuestStore.isFounder(q)') >= 0,
    '#000 を外していない');
});

test('予算は、1人あたりと人数を聞いてから送る', () => {
  const i = ADMIN.indexOf('const per = parseInt(prompt(');
  assert.ok(i > 0, '1人あたりを聞いていない');
  const seg = ADMIN.slice(i, i + 900);
  assert.ok(seg.indexOf('const people = parseInt(prompt(') >= 0, '人数を聞いていない');
  assert.ok(seg.indexOf('const total = per * people;') >= 0, '総額を出していない');
  assert.ok(seg.indexOf('perPersonEmuer: per, totalEmuer: total') >= 0, 'サーバーへ渡していない');
  assert.ok(seg.indexOf('いちど公開すると、額は変えられません') >= 0, '取り返せないことを伝えていない');
});

test('承認は、どのクエストでもサーバーを通す', () => {
  const i = ADMIN.indexOf('/approve", { method:"POST" });');
  assert.ok(i > 0, 'サーバーを呼んでいない');
  assert.equal(ADMIN.indexOf('q.series === "general" && Number(q.questNumber) === 1 && q.guildId === "learn"'), -1,
    'LEARN #001 だけを通す分岐が残っている');
});

test('サーバーが使えないときは、承認だけは通して EMUER が未払いだと伝える', () => {
  const i = ADMIN.indexOf('const soft = [');
  assert.ok(i > 0, '逃げ道が無い');
  const seg = ADMIN.slice(i, i + 1200);
  ['NOT_STARTED', 'BUDGET_NOT_PUBLISHED', 'WALLET_REQUIRED', 'CERTIFICATE_NOT_DEPLOYED',
   'FIRESTORE_UNAVAILABLE', 'Failed to fetch'].forEach(code =>
    assert.ok(seg.indexOf(code) >= 0, code + ' で転んだときに承認が止まる'));
  assert.ok(seg.indexOf('f.updateDoc(') >= 0, 'Firestore へ逃げていない');
  assert.ok(seg.indexOf('ただし EMUER は渡せていません') >= 0, '未払いだと伝えていない');
});

test('本当に断られたときは、Firestore へ逃げない', () => {
  const i = ADMIN.indexOf('const soft = [');
  const seg = ADMIN.slice(i, i + 700);
  assert.ok(seg.indexOf('if (!soft && code.indexOf("Failed to fetch") < 0') >= 0,
    'どんな失敗でも承認してしまう');
});

test('段ごとの額は、管理画面とサーバーで同じ', () => {
  /* ここが食い違うと、運営が見た既定額と実際に払う額がずれる。
     既定額は「年内目標」の資料どおり（入門3日50／標準7日100／実践14日200）。 */
  const pick = src => {
    const i = src.indexOf('"入門"');
    assert.ok(i > 0, '段ごとの額が無い');
    const seg = src.slice(i, src.indexOf('}', i));
    const out = {};
    seg.replace(/"(入門|標準|実践)":\s*(\d+)/g, (_, k, v) => { out[k] = Number(v); return ''; });
    return out;
  };
  const admin = pick(ADMIN);
  assert.deepEqual(admin, { 入門: 50, 標準: 100, 実践: 200 }, '管理画面の額が資料と違う');
  assert.deepEqual(pick(BACKEND), admin, 'サーバーと管理画面で額が違う');
  assert.match(ADMIN.slice(ADMIN.indexOf('SP_STAGE_EMUER ='), ADMIN.indexOf('SP_STAGE_EMUER =') + 300),
    /\|\|\s*100/, '段が無いときの100が無い');
  assert.match(BACKEND.slice(BACKEND.indexOf('function defaultPerPerson'),
    BACKEND.indexOf('function defaultPerPerson') + 200), /\|\|\s*100/,
    'サーバー側に段が無いときの100が無い');
});

test('サーバーは、運営のブラウザから来た額を信じない', () => {
  const i = BACKEND.indexOf('const per = Number(budget.perPersonEmuer');
  assert.ok(i > 0, '予算から額を読んでいない');
  const seg = BACKEND.slice(i - 400, i + 400);
  assert.ok(seg.indexOf('req.body') < 0, '承認のときに本文の額を見ている');
});

test('証明書は、そのクエストのギルドの色になる', () => {
  assert.ok(BACKEND.indexOf('GUILD_COLOR[guildId] || "#6E695C"') >= 0, '色が決め打ちのまま');
  assert.equal(BACKEND.indexOf('guildId: "learn", guildColor: "#0F5C3F"'), -1, 'LEARN 固定が残っている');
  assert.equal(BACKEND.indexOf('SchoolPark #001 LEARN</text>'), -1, '絵の字が #001 LEARN のまま');
});

test('ギルドの色は、ギルドの台帳と同じ', () => {
  const store = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', '..', 'frontend', 'public', 'schoolpark', 'guild-store.js'), 'utf8');
  [['learn', '#0F5C3F'], ['work', '#141310'], ['play', '#C2703D'],
   ['connect', '#B0405A'], ['web3', '#3B382F']].forEach(([id, color]) => {
    assert.ok(BACKEND.indexOf(color) >= 0, id + ' の色がサーバーに無い');
    assert.ok(store.indexOf(color) >= 0, id + ' の色がギルドの台帳と違う（' + color + '）');
  });
});

test('EMUER を引き当てた承認は、取り消せない', () => {
  /* 取り消せてしまうと、報酬と証明書は予約されたまま approved だけ消える。
     サーバーはその食い違いを COMPLETION_STATE_CONFLICT で止めるので、
     その人はもう二度と認められなくなる。 */
  assert.ok(ADMIN.indexOf('rewardEmuer: Number(d.rewardEmuer || 0)') >= 0,
    '引き当てた額を読んでいない');
  assert.ok(ADMIN.indexOf('t.rewardEmuer > 0') >= 0, '額で見分けていない');
  const i = ADMIN.indexOf('t.rewardEmuer > 0');
  const seg = ADMIN.slice(i, ADMIN.indexOf('取り消す</button>', i) + 20);
  assert.ok(seg.indexOf('EMUERの承認済み') >= 0, '承認済みだと出していない');
  /* 引き当て済みの枝には取り消すボタンが無い（取り消せるのは 0 のほうだけ）。 */
  assert.ok(seg.indexOf('EMUERの承認済み') < seg.indexOf('data-qunapprove'),
    '引き当て済みでも取り消せてしまう');
  assert.equal(seg.slice(0, seg.indexOf('data-qunapprove')).indexOf('取り消す'), -1,
    '引き当て済みの枝に取り消すが入っている');
  assert.ok(BACKEND.indexOf('rewardEmuer: per') >= 0, 'サーバーが額を記録していない');
});

test('渡せていない承認には、「EMUERを渡す」が出る', () => {
  /* 予算を公開する前に認めた人、Render へ届かないまま通した人。
     承認は残っているので、あとから渡せる道が要る。 */
  const i = ADMIN.indexOf("data-qtopup=");
  assert.ok(i > 0, '渡し直す道が無い');
  const seg = ADMIN.slice(i - 400, i + 300);
  assert.ok(seg.indexOf('t.rewardEmuer > 0') >= 0, '引き当て済みの人にも出してしまう');
  assert.ok(seg.indexOf('EMUERを渡す') >= 0);
  assert.ok(seg.indexOf('data-qapprove') >= 0, '承認と同じ道を通っていない');
});

test('渡し直すときは、完走条件ではなく支払いを聞く', () => {
  const i = ADMIN.indexOf('if (b.dataset.qtopup) {');
  assert.ok(i > 0, '分けていない');
  const seg = ADMIN.slice(i, ADMIN.indexOf('} else if', i));
  assert.ok(seg.indexOf('EMUER がまだ渡っていません') >= 0);
  assert.ok(seg.indexOf('それでも認めますか') < 0, '完走条件を聞いてしまっている');
  assert.ok(seg.indexOf('return;') >= 0, '断ったときに止めていない');
});

test('渡し直しが失敗したときは、Firestore を触らない', () => {
  const i = ADMIN.lastIndexOf('if (b.dataset.qtopup) {');
  const end = ADMIN.indexOf('renderSchoolPark(); return;', i);
  assert.ok(end > i, '止めていない');
  const seg = ADMIN.slice(i, end);
  assert.ok(seg.indexOf('EMUER はまだ渡せません') >= 0);
  assert.ok(seg.indexOf('f.updateDoc(') < 0, '承認をもう一度書いてしまっている');
});

test('サーバーは、渡せていない承認にあとから渡せる', () => {
  /* 前はこれも COMPLETION_STATE_CONFLICT で止めていた。 */
  assert.ok(BACKEND.indexOf('if (prior.exists || certificate.exists) {') >= 0,
    '承認の印だけで止めている');
  assert.ok(BACKEND.indexOf('Number(was.approvedAt) > 0 ? Number(was.approvedAt) : now') >= 0,
    '認めた日を上書きしてしまう');
});
