/* 完走と分配は、別のときに動く。

   完走（信用スコア ×10 と「完走◯本」）
     運営が認めた時点。クエスト全体を閉じるのを待たない。
     閉じるのは運営の都合で、その人が完走したかとは別のこと。
     パスポートの記録も星空も approved を見ているので、そこへそろえる。

   分配（お金）
     クエストが完了してから。走っている最中は、まだ受ける人が増えるので
     1人あたりの額が決まらない。

   前はどちらも CLOSED を待っていた。だから
   「パスポートには完走が出ているのに、メンバー画面は参加中のまま」
   「知恵カードを置いたのに信用スコアが0のまま」になっていた。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { build, readHtml } = require('../year-goals-tests/extract.cjs');

const INDEX = readHtml('frontend/public/index.html');
const DAO = readHtml('frontend/public/schoolpark/dao.html');

const ME = '0xme';
const YOU = '0xyou';

function snap(rows) {
  return { forEach: function (f) {
    rows.forEach(function (r) { f({ id: r.id, data: function () { return r; } }); });
  } };
}

function loader(opts) {
  opts = opts || {};
  const state = { members: [], noMembers: true, membersNote: '', trust: null };
  const warn = [];
  const app = { state: state, setState: function (o) { Object.assign(state, o); } };
  const stubs = {
    console: { warn: function () { warn.push([].slice.call(arguments).join(' ')); } },
    SP_CURRENCIES: ['JPY', 'JPYC', 'EMUER'],
    SP_SHARE_DONE: 0.8,
    _spShortAddr: function (a) { return String(a).slice(0, 6) + '…'; },
    spMoney: function (v, c) { return c + ' ' + v; },
    spPassportLoad: async function () { return opts.me === null ? null : { addr: ME, createdAt: 0 }; },
    spTrustScore: async function () { return opts.trust || { total: 15, need: 20, done: 1, wisdom: 1, cited: 0, months: 0 }; },
    window: {
      db: {}, fbLib: {
        collection: function () { return { path: [].slice.call(arguments, 1).join('/') }; },
        getDocs: async function (ref) {
          const path = ref.path || '';
          if (path === 'sp_wisdom') {
            if (opts.wisdomFails) throw new Error('offline');
            return snap(opts.wisdom || []);
          }
          if (path === 'sp_quests') {
            if (opts.questsFail) throw new Error('offline');
            return snap(opts.quests || []);
          }
          if (/^sp_wisdom\/.*\/cites$/.test(path)) return snap(opts.cites || []);
          if (/^sp_quests\/(.*)\/commits$/.test(path)) {
            const id = path.split('/')[1];
            return snap((opts.commits || {})[id] || []);
          }
          return snap([]);
        }
      },
      spTrustScore: null
    }
  };
  stubs.window.spTrustScore = stubs.spTrustScore;
  const api = build(INDEX, ['spDaoLoadMembers'], stubs);
  return { api: api, app: app, state: state, warn: warn };
}

const OPEN_QUEST = { id: 'q1', status: 'OPEN', budget: '12500', budgetCurrency: 'EMUER' };
const CLOSED_QUEST = { id: 'q1', status: 'CLOSED', budget: '12500', budgetCurrency: 'EMUER' };
const APPROVED = [{ id: ME, name: '俺', approved: true }];

test('走っているクエストでも、認められた人は「完走1本」になる', async () => {
  const l = loader({ quests: [OPEN_QUEST], commits: { q1: APPROVED } });
  await l.api.spDaoLoadMembers(l.app);
  assert.equal(l.state.members.length, 1);
  assert.equal(l.state.members[0].done, 1, 'CLOSED を待っている');
  assert.equal(l.state.members[0].role, '完走 1本');
});

test('走っているあいだは、分配しない', async () => {
  const l = loader({ quests: [OPEN_QUEST], commits: { q1: APPROVED } });
  await l.api.spDaoLoadMembers(l.app);
  assert.equal(l.state.members[0].share, '—', '完了前に配っている');
});

test('完了したら、予算の80%を完走した人で分ける', async () => {
  const l = loader({ quests: [CLOSED_QUEST], commits: { q1: APPROVED } });
  await l.api.spDaoLoadMembers(l.app);
  assert.equal(l.state.members[0].done, 1);
  assert.match(l.state.members[0].share, /EMUER 10000/, '12500 × 80% になっていない');
});

test('認められていない人は「参加中」。完走にはならない', async () => {
  const l = loader({ quests: [CLOSED_QUEST], commits: { q1: [{ id: YOU, name: 'あなた', approved: false }] } });
  await l.api.spDaoLoadMembers(l.app);
  assert.equal(l.state.members.length, 0, '何もしていない人が並んでいる');
});

test('知恵カードを置いた人は、クエストが無くても並ぶ', async () => {
  const l = loader({ wisdom: [{ id: 'w1', author: ME, authorName: '俺' }] });
  await l.api.spDaoLoadMembers(l.app);
  assert.equal(l.state.members.length, 1);
  assert.equal(l.state.members[0].wisdom, 1);
});

test('メンバーを並べたあと、信用スコアも数え直す', async () => {
  const l = loader({ wisdom: [{ id: 'w1', author: ME, authorName: '俺' }] });
  await l.api.spDaoLoadMembers(l.app);
  assert.ok(l.state.trust, '信用スコアを数え直していない');
  assert.equal(l.state.trust.total, 15);
  assert.match(l.state.trust.detail, /完走 1（×10）／知恵 1（×5）/);
});

test('読めなかったときは「記録がありません」と言わない', async () => {
  const l = loader({ questsFail: true, wisdomFails: true });
  await l.api.spDaoLoadMembers(l.app);
  assert.equal(l.state.noMembers, false, '読めなかったのに「無い」と言い切っている');
  assert.match(l.state.membersNote, /読めませんでした/);
  assert.ok(l.warn.length >= 2, '黙って握りつぶしている');
});

test('読めたうえで本当に0件なら、そう言う', async () => {
  const l = loader({ quests: [], wisdom: [] });
  await l.api.spDaoLoadMembers(l.app);
  assert.equal(l.state.noMembers, true);
  assert.equal(l.state.membersNote, '');
});

test('知恵カードを置いたあと、信用スコアとメンバーを数え直す', () => {
  const i = INDEX.indexOf('spWisdomCelebrate(insight, _spWisdomApp);');
  assert.ok(i > 0);
  const after = INDEX.slice(i, i + 700);
  assert.ok(after.indexOf('spDaoLoadMembers(_spWisdomApp)') >= 0, 'メンバーを数え直していない');
  assert.ok(after.indexOf('spDaoLoadVotes(_spWisdomApp)') >= 0, '信用スコアを数え直していない');
});

test('画面に、読めなかったときの一言が出る口がある', () => {
  assert.ok(DAO.indexOf('hasMembersNote') >= 0, '結び付けが無い');
  assert.ok(DAO.indexOf('{{ membersNote }}') >= 0, '出す場所が無い');
});

/* ───────── 信用スコアそのもの ─────────

   画面に「あなたの信用スコア 1/20 ／ 完走0・知恵0」と出るのに、
   パスポートには完走が出ている、ということが起きていた。

   原因は2つ。どちらも spTrustScore の中にあった。

     1. 名義をひとつ（addr＝ches優先の表示用）しか見ていなかった。
        受けた記録の文書IDは、受けたときの名義で作る。ウォレットで受けて
        CHESで数えれば、承認されていても完走0になる。
        パスポートの記録（spCompletedQuests）は両方見ていたので、
        片方だけ正しい、という形になっていた。

     2. 読めなかったときに、黙って0を出していた。
        getDocs は通信が落ちても例外を投げない。手元の控えを返すので、
        控えが空なら「0件で成功」になる。catch だけでは足りない。 */

function scorer(opts) {
  opts = opts || {};
  const warn = [];
  const stubs = {
    console: { warn: function () { warn.push([].slice.call(arguments).join(' ')); } },
    SP_TRUST_NEED: 20,
    SpQuestStore: { isFounder: function (q) { return !!q.isFounder; } },
    spCompletedQuests: async function (me) {
      if (opts.doneFails) return null;
      opts.sawMe = me;
      return opts.done || [];
    },
    window: {
      db: {}, fbLib: {
        collection: function () { return { path: [].slice.call(arguments, 1).join('/') }; },
        getDocs: async function (ref) {
          const path = ref.path || '';
          if (path === 'sp_wisdom') {
            if (opts.wisdomFails) throw new Error('offline');
            const rows = opts.wisdom || [];
            return { size: rows.length, metadata: { fromCache: !!opts.fromCache },
                     forEach: function (f) { rows.forEach(function (r) { f({ id: r.id, data: function () { return r; } }); }); } };
          }
          return { size: 0, metadata: { fromCache: false }, forEach: function () {} };
        }
      }
    }
  };
  const api = build(INDEX, ['spTrustScore'], stubs);
  return { score: api.spTrustScore, opts: opts, warn: warn, api: api };
}

const PASSPORT = { addr: '0xches', wallet: '0xwallet', ches: '0xches', aliases: ['0xwallet', '0xches'] };

test('ウォレットで受けた完走も数える（名義はパスポートと同じ決め方）', async () => {
  const s = scorer({ done: [{ id: 'q1' }] });
  const sc = await s.score('0xches', 0, PASSPORT);
  assert.equal(sc.done, 1, '完走が数えられていない');
  /* 完走の数え直しは spCompletedQuests ひとつに任せる（記録・星空と同じ元データ） */
  assert.deepEqual(s.opts.sawMe, PASSPORT, 'パスポートを渡していない');
});

test('知恵カードも、どちらの名義でも自分のものと見なす', async () => {
  const s = scorer({ wisdom: [{ id: 'w1', author: '0xWALLET' }, { id: 'w2', author: '0xよそ' }] });
  const sc = await s.score('0xches', 0, PASSPORT);
  assert.equal(sc.wisdom, 1, 'ウォレット名義の知恵カードを落としている');
});

test('Quest #000 は完走に数えない', async () => {
  const s = scorer({ done: [{ id: 'q1' }, { id: 'founder-quest-000', isFounder: true }] });
  const sc = await s.score('0xches', 0, PASSPORT);
  assert.equal(sc.done, 1);
});

test('完走を読めなかったら、0ではなく「読めなかった」と言う', async () => {
  const s = scorer({ doneFails: true, wisdom: [] });
  const sc = await s.score('0xches', 0, PASSPORT);
  assert.equal(sc.failed, true, '読めなかったことを伝えていない');
  assert.match(s.warn.join(''), /完走を数えられませんでした/);
});

test('知恵カードを読めなかったときも同じ', async () => {
  const s = scorer({ wisdomFails: true });
  const sc = await s.score('0xches', 0, PASSPORT);
  assert.equal(sc.failed, true);
});

test('控えしか無いときの「0件」は、0件として扱わない', async () => {
  /* getDocs は通信が落ちても投げない。ここが今回いちばん効く。 */
  const s = scorer({ wisdom: [], fromCache: true });
  const sc = await s.score('0xches', 0, PASSPORT);
  assert.equal(sc.failed, true, '控えの空っぽを0件だと信じている');
});

test('ぜんぶ読めたときは failed が立たない', async () => {
  const s = scorer({ done: [{ id: 'q1' }], wisdom: [{ id: 'w1', author: '0xches' }] });
  const sc = await s.score('0xches', 0, PASSPORT);
  assert.equal(sc.failed, false);
  assert.equal(sc.total, 1 * 10 + 1 * 5, '完走×10＋知恵×5 になっていない');
});

test('パスポートを渡さなくても、渡されたアドレスだけで数えられる', async () => {
  const s = scorer({ done: [{ id: 'q1' }], wisdom: [{ id: 'w1', author: '0xsolo' }] });
  const sc = await s.score('0xsolo', 0);
  assert.equal(sc.done, 1);
  assert.equal(sc.wisdom, 1);
});

/* ───────── 呼び出し側 ───────── */

test('読めなかったときは、いま出ている数字を0で塗りつぶさない', () => {
  const i = INDEX.indexOf('} else if (sc) {');
  assert.ok(i > 0, '読めなかったときの枝が無い');
  const seg = INDEX.slice(i, i + 700);
  assert.ok(seg.indexOf('(app.state || {}).trust') >= 0, '前の数字を見ていない');
  assert.ok(seg.indexOf('いま数え直せませんでした') >= 0, '読めなかったと伝えていない');
});

test('メンバーを数え直したあとも、読めなければ書き換えない', () => {
  assert.ok(INDEX.indexOf('if (sc && !sc.failed) {') >= 0, '読めたときだけ書く形になっていない');
});

test('議題の案内でも、読めていないのに「足りない」と言い切らない', () => {
  assert.ok(INDEX.indexOf('いまの信用スコアを数え直せませんでした') >= 0);
});

test('3か所とも、パスポートを渡して呼ぶ', () => {
  const n = INDEX.split('spTrustScore(p.addr, p.createdAt, p)').length - 1;
  assert.equal(n, 3, '名義をひとつしか見ない呼び方が残っている');
  assert.equal(INDEX.indexOf('spTrustScore(p.addr, p.createdAt)\n'), -1);
});

/* ───────── SDK が死んでいても数える ─────────

   実際の画面のコンソールに出ていたもの：

     WebChannelConnection RPC 'Listen' stream ... transport errored
     完走を数えられませんでした: 完走したクエストを読めなかった
     知恵カードを数えられませんでした: 手元の控えしか無かった
     クエストを普通の通信で読みました（2件）        ← 一覧だけは通っている

   SDK の通信が切れている。クエスト一覧は普通の通信（REST）へ逃げる道を
   持っているので出る。信用スコアが使う2つには、その道が無かった。
   だから「知恵ライブラリもメンバー・貢献も出ているのに、スコアだけ0」。 */

function offline(opts) {
  opts = opts || {};
  const warn = [];
  /* 手元の控えしか返さない SDK。例外は投げない（本物と同じ）。 */
  const cacheOnly = { size: 0, metadata: { fromCache: true }, forEach: function () {},
                      exists: function () { return false; } };
  const stubs = {
    console: { warn: function () { warn.push([].slice.call(arguments).join(' ')); } },
    SP_TRUST_NEED: 20,
    SpQuestStore: { isFounder: function (q) { return !!q.isFounder; },
                    fullLabel: function () { return '一般 #001'; } },
    SpGuildStore: { guildIdOf: function (q) { return q.guildId || ''; }, byId: function () { return null; } },
    spGuildDefs: async function () { return []; },
    _spRestQuests: async function () {
      if (opts.restQuestsFail) throw new Error('HTTP 403');
      return opts.restQuests || [{ id: 'q1', title: 'クエスト', guildId: 'learn' }];
    },
    _spRestQuestCommits: async function (id) {
      if (opts.restCommitsFail) throw new Error('HTTP 403');
      return (opts.restCommits || {})[id] || [];
    },
    _spRestWisdom: async function () {
      if (opts.restWisdomFail) throw new Error('HTTP 403');
      return opts.restWisdom || [];
    },
    _spRestCites: async function () { return opts.restCites === undefined ? 0 : opts.restCites; },
    window: {
      db: {}, fbLib: {
        doc: function () { return { path: [].slice.call(arguments, 1).join('/') }; },
        collection: function () { return { path: [].slice.call(arguments, 1).join('/') }; },
        getDoc: async function () { return cacheOnly; },
        getDocs: async function () { return cacheOnly; }
      }
    }
  };
  const api = build(INDEX, ['spCompletedQuests', 'spTrustScore'], stubs);
  return { api: api, warn: warn };
}

const ME2 = { addr: '0xches', wallet: '0xwallet', ches: '0xches', aliases: ['0xwallet', '0xches'] };

test('SDKが控えしか返さなくても、完走を普通の通信で数える', async () => {
  const o = offline({ restCommits: { q1: [{ id: '0xwallet', data: { approved: true, approvedAt: 5 } }] } });
  const sc = await o.api.spTrustScore('0xches', 0, ME2);
  assert.equal(sc.done, 1, '完走が0のまま');
  assert.equal(sc.failed, false, '読めているのに failed が立っている');
  assert.match(o.warn.join(''), /普通の通信で読みました/);
});

test('SDKが控えしか返さなくても、知恵カードを普通の通信で数える', async () => {
  const o = offline({ restWisdom: [{ id: 'w1', author: '0xWALLET' }, { id: 'w2', author: '0xよそ' }] });
  const sc = await o.api.spTrustScore('0xches', 0, ME2);
  assert.equal(sc.wisdom, 1, '知恵が0のまま');
});

test('普通の通信で引用も数え直す', async () => {
  const o = offline({ restWisdom: [{ id: 'w1', author: '0xches' }], restCites: 3 });
  const sc = await o.api.spTrustScore('0xches', 0, ME2);
  assert.equal(sc.cited, 3);
});

test('控えしか無くても、受けていなければ完走にはしない', async () => {
  const o = offline({ restCommits: { q1: [{ id: '0xよそ', data: { approved: true } }] } });
  const sc = await o.api.spTrustScore('0xches', 0, ME2);
  assert.equal(sc.done, 0, '他人の記録を自分の完走にしている');
});

test('認められていない記録は完走にしない（普通の通信でも）', async () => {
  const o = offline({ restCommits: { q1: [{ id: '0xwallet', data: { approved: false } }] } });
  const sc = await o.api.spTrustScore('0xches', 0, ME2);
  assert.equal(sc.done, 0);
});

test('普通の通信でも読めなければ、0ではなく「読めなかった」と言う', async () => {
  const o = offline({ restQuestsFail: true, restWisdomFail: true });
  const sc = await o.api.spTrustScore('0xches', 0, ME2);
  assert.equal(sc.failed, true);
});

test('SDKが生きていて本当に受けていないときは、余計に聞きに行かない', async () => {
  /* 控えではなくサーバーが「無い」と答えたときは REST を叩かない。 */
  let asked = 0;
  const warn = [];
  const live = { size: 0, metadata: { fromCache: false }, forEach: function () {},
                 exists: function () { return false; } };
  const stubs = {
    console: { warn: function () { warn.push([].slice.call(arguments).join(' ')); } },
    SP_TRUST_NEED: 20,
    SpQuestStore: { isFounder: function () { return false; },
                    fullLabel: function () { return '一般 #001'; } },
    SpGuildStore: { guildIdOf: function () { return ''; }, byId: function () { return null; } },
    spGuildDefs: async function () { return []; },
    _spRestQuests: async function () { asked++; return []; },
    _spRestQuestCommits: async function () { asked++; return []; },
    _spRestWisdom: async function () { asked++; return []; },
    _spRestCites: async function () { asked++; return 0; },
    window: {
      db: {}, fbLib: {
        doc: function () { return { path: '' }; },
        collection: function () { return { path: '' }; },
        getDoc: async function () { return live; },
        getDocs: async function () {
          return { size: 1, metadata: { fromCache: false },
                   forEach: function (f) { f({ id: 'q1', data: function () { return { title: 'q' }; } }); } };
        }
      }
    }
  };
  const api = build(INDEX, ['spCompletedQuests', 'spTrustScore'], stubs);
  const sc = await api.spTrustScore('0xches', 0, ME2);
  assert.equal(sc.done, 0);
  assert.equal(sc.failed, false);
  assert.equal(asked, 0, '通信が生きているのに普通の通信で聞きに行っている');
});

/* ───────── 読み込み中の覆いと、今週の広場の数字 ─────────

   画面は「おはよう、ゲスト」やクエスト0本・知恵0件のまま出ていた。
   覆い（読み込み中の画面）は8つの読み込みが「終わる」のを待っていたが、
   通信が切れていると、どの読み込みも手元の控え（空）を成功として返して
   すぐ終わる。終わったので覆いを外す。中身は空のまま表に出る。 */

test('覆いは、中身が入るまで外さない', () => {
  const i = INDEX.indexOf('const filled = function () {');
  assert.ok(i > 0, '中身が入ったかを見ていない');
  const seg = INDEX.slice(i, i + 900);
  assert.ok(seg.indexOf("st.me.name !== 'ゲスト'") >= 0, 'ゲストのままでも外してしまう');
  assert.ok(seg.indexOf("(st.quests || []).length + (st.wisdom || []).length") >= 0,
    'クエストも知恵も空のまま外してしまう');
});

test('中身が入るまで、読み込みをやり直す', () => {
  const i = INDEX.indexOf('while (Date.now() < limit && !filled())');
  assert.ok(i > 0, '読み直していない');
  const seg = INDEX.slice(i, i + 700);
  assert.ok(seg.indexOf('names.map') >= 0, '8つを走らせ直していない');
});

test('それでも上限で切り上げる（入れなくなるほうが困る）', () => {
  const i = INDEX.indexOf('while (Date.now() < limit && !filled())');
  const seg = INDEX.slice(i, i + 700);
  assert.ok(seg.indexOf('if (Date.now() >= limit) break;') >= 0, '待ち続けてしまう');
  assert.ok(INDEX.indexOf('待つのを切り上げました') >= 0, '切り上げたことを残していない');
});

test('今週の広場の知恵も、普通の通信で読み直す', () => {
  /* stats.wisdomTotal は spDaoLoadWisdom が入れた配列の長さ。
     本体の読みに逃げ道が無く、報告（logs）にだけあった。 */
  const i = INDEX.indexOf("_spWarnDenied('知恵', e);");
  assert.ok(i > 0);
  const seg = INDEX.slice(i, i + 900);
  assert.ok(seg.indexOf('_spRestWisdom()') >= 0, '知恵の本体に逃げ道が無い');
  assert.ok(seg.indexOf('知恵カードを普通の通信で読みました') >= 0);
  /* 例外で即 return していたのをやめ、逃げ道へ回す。 */
  assert.equal(seg.slice(0, seg.indexOf('if (!docs.length)')).indexOf('return;'), -1,
    '例外のときに逃げ道へ回らず、そこで終わっている');
});

/* ───────── ログインを先に待つ ─────────

   コンソールに出ていたのは、これだけだった。

     SchoolPark の中身がそろう前に、待つのを切り上げました

   逃げ道が成功したログも失敗したログも出ていない。画面は
   「おはよう、ゲスト」。つまりログインが解けていなかった。

   10/1 までは記録の決まり（canAccessSchoolPark）が「運営」か
   「公式パスの持ち主」を求める。どちらもログインの証が要る。
   証が無いあいだは SDK も普通の通信もまとめて断られるので、
   逃げ道をいくら足しても0のままになる。 */

test('8つを走らせる前に、ログインが解けるのを待つ', () => {
  const i = INDEX.indexOf('if (!app) return false;');
  assert.ok(i > 0);
  const seg = INDEX.slice(i, INDEX.indexOf('const names = [', i));
  assert.ok(seg.indexOf('emuEnsureSignedIn') >= 0, '証を待たずに走らせている');
  assert.ok(seg.indexOf('interactive: false') >= 0, '勝手にログイン画面を出してしまう');
});

test('証が無いまま走らせ直しても同じなので、やり直しの前にも待つ', () => {
  const i = INDEX.indexOf('while (Date.now() < limit && !filled())');
  const seg = INDEX.slice(i, i + 900);
  assert.ok(seg.indexOf('window.auth && window.auth.currentUser') >= 0,
    'やり直しの前に証を見ていない');
  assert.ok(seg.indexOf('emuEnsureSignedIn') >= 0);
});

test('待てないときも、上限で必ず切り上げる', () => {
  const i = INDEX.indexOf('if (!app) return false;');
  const seg = INDEX.slice(i, INDEX.indexOf('const names = [', i));
  assert.ok(seg.indexOf('Promise.race') >= 0, '証を待つところで止まりうる');
  assert.ok(seg.indexOf('limit - Date.now()') >= 0);
});

test('切り上げたときは、ログイン済みかどうかも残す', () => {
  assert.ok(INDEX.indexOf('（ログイン済み: ') >= 0, '切り分けの手がかりが無い');
});

test('証が取れないまま出すときは、0を並べて黙らない', () => {
  const i = INDEX.indexOf('_spSaidSignIn = true;');
  assert.ok(i > 0, '何も言わずに0を並べている');
  const seg = INDEX.slice(i - 400, i + 700);
  assert.ok(seg.indexOf('if (window.auth && window.auth.currentUser) return;') >= 0,
    'ログインしている人にまで出してしまう');
  assert.ok(seg.indexOf('記録が無いからではなく') >= 0, '0件の理由を伝えていない');
  assert.ok(INDEX.indexOf('let _spSaidSignIn = false;') >= 0, '毎回出てしまう');
});

/* ───────── 全部の入口（emuMyIdentity） ─────────

   計器を付けたら、こう出た。

     待つのを切り上げました（ログイン済み: true）

   ログインは通っている。なのに「おはよう、ゲスト」で全部0。
   犯人は通信でも認証でもなく、その間にある本人情報の読み取りだった。

   emuMyIdentity が null を返すと、パスポートも名前も名義も無くなる。
   画面はゲストになり、以降の読み込みが軒並み0件になる。
   ところがここは getDoc を1回投げるだけで、転んだら終わりだった。
   しかも getDoc は通信が切れても例外を投げず、控えを返す。
   控えに無ければ「記録が無い」と読めて、その先は記録を作りに行く。
   すでに有る記録を作ろうとするので、そこでも転ぶ。

   同じ不具合は管理画面（spMyAddress）で先に直してあった。
   こちらにだけ入っていなかった。 */

test('1回で転んで終わりにしない（読み直す）', () => {
  const i = INDEX.indexOf('async function emuMyIdentity');
  assert.ok(i > 0);
  const seg = INDEX.slice(i, i + 2600);
  assert.ok(seg.indexOf('for (let i = 0; i < 3 && !snap; i += 1)') >= 0, '読み直していない');
  assert.ok(seg.indexOf("e.code === 'permission-denied'") >= 0,
    '権限で断られたときまで待たせている');
});

test('控えの「無い」を、記録が無いと読まない', () => {
  const i = INDEX.indexOf('async function emuMyIdentity');
  const seg = INDEX.slice(i, i + 2600);
  assert.ok(seg.indexOf('!got.exists() && got.metadata && got.metadata.fromCache') >= 0,
    '控えの空を真に受けている');
  assert.ok(seg.indexOf('記録は作りません') >= 0, '確かめずに作りに行っている');
});

test('SDKで決められなければ、普通の通信で読む', () => {
  const i = INDEX.indexOf('async function emuMyIdentity');
  const seg = INDEX.slice(i, i + 2600);
  assert.ok(seg.indexOf("_spRestDoc('ches_accounts/'") >= 0, '逃げ道が無い');
  assert.ok(seg.indexOf('自分のアカウントを普通の通信で読みました') >= 0);
});

test('読めなかったときは、記録を作りに行かない', () => {
  const i = INDEX.indexOf('async function emuMyIdentity');
  const seg = INDEX.slice(i, i + 2600);
  const rest = seg.indexOf('_spRestDoc(');
  const made = seg.indexOf('_emuCreateAccountDoc(user)');
  assert.ok(rest > 0 && made > rest, '逃げ道より先に作りに行っている');
  const between = seg.slice(rest, made);
  assert.ok(between.indexOf('return null;') >= 0, '読めなくてもそのまま作りに行く');
});

test('管理画面と同じ直し方にそろえる', () => {
  /* membership-admin.html の spMyAddress で先に直したもの。 */
  const ADMIN = readHtml('frontend/public/membership-admin.html');
  assert.ok(ADMIN.indexOf('spRestDoc') >= 0, '管理画面の逃げ道が消えている');
  assert.ok(INDEX.indexOf("_spRestDoc('ches_accounts/'") >= 0, 'こちらに入っていない');
});
