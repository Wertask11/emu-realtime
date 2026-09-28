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
    /* 読むところを1つにまとめたので、偽物もそこに合わせる。
       返すのは配列。読めなかったときは null（0件とは違う）。 */
    _spReadAll: async function (path) {
      if (path === 'sp_wisdom') return opts.wisdomFails ? null : (opts.wisdom || []);
      if (path === 'sp_quests') return opts.questsFail ? null : (opts.quests || []);
      let m = /^sp_quests\/(.*)\/commits$/.exec(path);
      if (m) return (opts.commits || {})[decodeURIComponent(m[1])] || [];
      m = /^sp_wisdom\/(.*)\/cites$/.exec(path);
      if (m) return opts.cites || [];
      return [];
    },
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

test('認められていない人は「参加中」として並ぶ。完走にはならない', async () => {
  /* 前はここで「並ばないこと」を確かめていた。だが受けた人を消すと、
     別の名義でクエストを受けた自分すらメンバーに出てこない。
     コードのコメントも「受けた人は、認められていなくても一覧には出す
     （参加中として）」と書いてあり、絞り込みと食い違っていた。
     受けた人は出す。完走に数えないのは、これまでどおり。 */
  const l = loader({ quests: [CLOSED_QUEST], commits: { q1: [{ id: YOU, name: 'あなた', approved: false }] } });
  await l.api.spDaoLoadMembers(l.app);
  assert.equal(l.state.members.length, 1, '受けた人が消えている');
  assert.equal(l.state.members[0].done, 0, '認めていないのに完走に入っている');
  assert.equal(l.state.members[0].role, '参加中');
  assert.equal(l.state.members[0].share, '—', '認めていないのに分配が出ている');
});

test('誰も受けていなければ、やはり並ばない', async () => {
  const l = loader({ quests: [CLOSED_QUEST], commits: { q1: [] } });
  await l.api.spDaoLoadMembers(l.app);
  assert.equal(l.state.members.length, 0);
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
    /* 在籍の数え方は別に試す（この下の「在籍の月数」）。ここでは固定。 */
    spMonthsSince: function () { return 0; },
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
    spMonthsSince: function () { return 0; },
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
    spMonthsSince: function () { return 0; },
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

/* ───────── 戻ってこない読み取り ─────────

   コンソールで測って分かったこと。

     ■ uid: wallet:0xdcc687…
     Promise {<pending>}        ← ここから先が一生出てこない

   通信が切れているとき、getDoc は例外を投げないし、値も返さない。
   そのまま pending で止まる。

   ここまでに書いた対策は、どれも「例外を投げる」か「控えを返す」前提
   だった。try/catch も metadata.fromCache の判定も、戻ってこない相手には
   一度も届かない。await がそこで止まるので、読み直しも逃げ道も動かない。
   待つのではなく、見切る必要がある。 */

function soonApi() {
  return build(INDEX, ['_spSoon'], { setTimeout: setTimeout, clearTimeout: clearTimeout });
}

test('返ってきたら、包んで返す', async () => {
  const { _spSoon } = soonApi();
  const r = await _spSoon(Promise.resolve('中身'), 1000);
  assert.deepEqual(r, { ok: true, value: '中身' });
});

test('返ってこなければ、見切る', async () => {
  const { _spSoon } = soonApi();
  const r = await _spSoon(new Promise(function () {}), 30);   /* 永遠に pending */
  assert.deepEqual(r, { ok: false });
});

test('undefined が返ってきたのと、返ってこないのを取り違えない', async () => {
  const { _spSoon } = soonApi();
  const got = await _spSoon(Promise.resolve(undefined), 1000);
  assert.equal(got.ok, true, 'undefined を「返ってこなかった」と読んでいる');
  const none = await _spSoon(new Promise(function () {}), 30);
  assert.equal(none.ok, false);
});

test('例外はそのまま投げる（呼ぶ側の catch を殺さない）', async () => {
  const { _spSoon } = soonApi();
  await assert.rejects(function () {
    return _spSoon(Promise.reject(new Error('だめ')), 1000);
  }, /だめ/);
});

test('本人情報の読み取りは、返ってこなければ見切る', () => {
  const i = INDEX.indexOf('async function emuMyIdentity');
  const seg = INDEX.slice(i, i + 2800);
  assert.ok(seg.indexOf('_spSoon(') >= 0, '見切らずに待っている');
  assert.ok(seg.indexOf('読み取りが返ってきません') >= 0, '見切ったことを残していない');
  assert.ok(seg.indexOf('if (!r.ok)') >= 0);
  /* 見切ったあとは、読み直し → 普通の通信、という順に進むこと。 */
  const to = seg.indexOf('読み取りが返ってきません');
  assert.ok(seg.slice(to, to + 200).indexOf('continue;') >= 0, '見切ったあと先へ進めていない');
});

/* ───────── 左下の数字は、本人のもの ─────────

   前はここに DAO のトレジャリー（使える額＝ある − 約束済み）を出していた。
   誰が開いても同じ数字で、本人の持ち物ではない。しかもクエストの予算が
   残高を超えていると、本人のところに「-1,250,000 EMUER」と出る。
   自分が借金しているように見える。 */

test('左下は、DAOのトレジャリーではなく本人の数字を出す', () => {
  assert.equal(DAO.indexOf('{{ treasury.total }}'), -1, 'まだDAOの額を出している');
  assert.ok(DAO.indexOf('{{ mine.balance }}') >= 0, '本人の数字になっていない');
  assert.ok(DAO.indexOf('{{ mine.label }}') >= 0, '見出しが TREASURY のまま');
});

test('数え終わるまでは、0ではなく空で待つ', () => {
  const i = DAO.indexOf("mine: Object.assign({");
  assert.ok(i > 0, '既定値が無い');
  const seg = DAO.slice(i, i + 220);
  assert.ok(seg.indexOf("balance:'—'") >= 0, '0を出してしまう');
  assert.ok(seg.indexOf('数えています') >= 0);
});

test('本人の分配は、パスポートの名義で引く', () => {
  const i = INDEX.indexOf('左下に出す数字は、本人のもの');
  assert.ok(i > 0, '本人の数字を作っていない');
  const seg = INDEX.slice(i, i + 1400);
  assert.ok(seg.indexOf('p2.aliases') >= 0, '片方の名義しか見ていない');
  assert.ok(seg.indexOf('names.map(function (k) { return M[k]; })') >= 0);
  assert.ok(seg.indexOf('mine:') >= 0);
});

test('渡していないお金を、持っているように書かない', () => {
  const i = INDEX.indexOf('左下に出す数字は、本人のもの');
  const seg = INDEX.slice(i, i + 1400);
  assert.ok(seg.indexOf('あなたの分配（計算額）') >= 0, '計算額だと名乗っていない');
  assert.ok(seg.indexOf('まだ計算される分配はありません') >= 0, '0件のときに黙っている');
});

/* ───────── 2回目の知恵カード ─────────

   一般 #001 を2回やって知恵カードを置こうとすると、札に1回目の投稿が
   出ていた。並べ方が「報告の多い順」だったため。

     1回目 … 報告3件  ← 先頭に来て、自動で選ばれる
     2回目 … 報告1件

   画面にも「（3件の報告）」と出ていた。やり終えた順に並べる。 */

test('元の投稿は、新しい順に並べる', () => {
  const i = INDEX.indexOf('async function _spQuestCited');
  assert.ok(i > 0);
  const seg = INDEX.slice(i, i + 1600);
  assert.ok(seg.indexOf('(b.at - a.at)') >= 0, 'まだ報告の多い順で並べている');
  assert.equal(seg.indexOf('out.sort(function (a, b) { return b.count - a.count; });'), -1,
    '古い並べ方が残っている');
});

test('同じ投稿の報告が増えたら、いちばん新しい時刻を持つ', () => {
  const i = INDEX.indexOf('async function _spQuestCited');
  const seg = INDEX.slice(i, i + 1600);
  assert.ok(seg.indexOf('if (at > seen[pid].at) seen[pid].at = at;') >= 0,
    '2件目以降の時刻を捨てている');
});

test('時刻が同じときは、報告の多いほうが先', () => {
  const i = INDEX.indexOf('async function _spQuestCited');
  const seg = INDEX.slice(i, i + 1600);
  assert.ok(seg.indexOf('|| (b.count - a.count)') >= 0, '並びが決まらない');
});

/* ───────── 右の列が切れる ───────── */

test('狭い列の長い値は、切らずに折り返す', () => {
  const i = DAO.indexOf('配分予算');
  assert.ok(i > 0);
  const seg = DAO.slice(i - 500, i + 900);
  assert.ok(seg.indexOf('flex-wrap:wrap') >= 0, '折り返せない');
  assert.ok(seg.indexOf('min-width:0') >= 0, 'flex が縮まずはみ出す');
  assert.ok(seg.indexOf('overflow-wrap:anywhere') >= 0, '長い語が切れる');
});

test('値は右に寄せたまま', () => {
  const i = DAO.indexOf('完走1人あたりの目安');
  const seg = DAO.slice(i, i + 400);
  assert.ok(seg.indexOf('text-align:right') >= 0, '折り返したとき左に寄ってしまう');
});

/* ───────── ギルドに、クエストとボタンを戻す ───────── */

test('ギルドが見るクエストにも、普通の通信の逃げ道がある', () => {
  /* クエスト一覧とは別に、ギルドはもう一度読んでいる。
     こちらにだけ逃げ道が無く「LEARN のクエスト 0」になっていた。 */
  const i = INDEX.indexOf('ギルドは、クエスト一覧とは別に');
  assert.ok(i > 0, '逃げ道が無い');
  const seg = INDEX.slice(i, i + 1400);
  assert.ok(seg.indexOf('_spSoon(') >= 0, '返ってこないときに見切れない');
  assert.ok(seg.indexOf('_spRestQuests()') >= 0, '普通の通信へ回していない');
  assert.ok(seg.indexOf('ギルドのクエストを普通の通信で読みました') >= 0);
});

test('読めなかったら、前に出ていたクエストを消さない', () => {
  assert.ok(INDEX.indexOf('if (questList.length || !_spGuildQuestDocs.length) _spGuildQuestDocs = questList;') >= 0,
    '読めないたびに空で塗りつぶしてしまう');
});

test('参加したい・応援するは、返ってこなくても固まらない', () => {
  const i = INDEX.indexOf('window.spGuildToggle = async function');
  assert.ok(i > 0);
  const seg = INDEX.slice(i, i + 1800);
  assert.ok(seg.indexOf('_spSoon(fb.getDoc(ref)') >= 0, 'いまの状態の読み取りを見切れない');
  assert.ok(seg.indexOf('_spSoon(write') >= 0, '保存を見切れない');
  assert.ok(seg.indexOf('} finally {') >= 0, '途中で抜けると次から押せなくなる');
  /* finally の中で必ず戻すこと。ここが無いと _spGuildBusy が居座る。 */
  const fin = seg.indexOf('} finally {');
  assert.ok(seg.slice(fin, fin + 220).indexOf('_spGuildBusy = false;') >= 0,
    '押せない状態のまま残る');
});

test('押しても黙って終わらない', () => {
  const i = INDEX.indexOf('window.spGuildToggle = async function');
  const seg = INDEX.slice(i, i + 1800);
  assert.ok(seg.indexOf('うまくいきませんでした') >= 0, '失敗を伝えていない');
  assert.ok(seg.indexOf('ギルドの参加・応援を保存できませんでした') >= 0, '記録に残していない');
});

/* ───────── 知恵ライブラリのカード ───────── */

test('知恵カードは、同じ行で同じ高さになる', () => {
  const i = DAO.indexOf('段組み（columns）だと');
  assert.ok(i > 0, 'まだ段組みのまま');
  const seg = DAO.slice(i, i + 700);
  assert.ok(seg.indexOf('display:grid') >= 0, 'グリッドになっていない');
  assert.ok(seg.indexOf('align-items:stretch') >= 0, '引き伸ばしていない');
  assert.ok(seg.indexOf('height:100%') >= 0, 'カードが伸びない');
  assert.equal(seg.indexOf('break-inside:avoid'), -1, '段組みの名残が残っている');
});

test('署名は、カードの下端に寄せる', () => {
  /* by {{ w.author }} は広場側にもある。ライブラリのグリッドから探す。 */
  const from = DAO.indexOf('段組み（columns）だと');
  const i = DAO.indexOf('by {{ w.author }}', from);
  assert.ok(i > from, 'ライブラリのカードが見つからない');
  const seg = DAO.slice(i - 300, i + 100);
  assert.ok(seg.indexOf('margin-top:auto') >= 0, '引き伸ばすと中途半端な位置に浮く');
});

/* ───────── 受けた人を、メンバーから捨てない ─────────

   クエストを受けた別アカウント（知恵0・完走0・引用0）が
   メンバー・貢献に出てこなかった。コードの中で矛盾していた。

     took.forEach(t => pick(t.addr, t.name));            ← 一覧に入れて
     .filter(m => m.wisdom || m.done || m.cited)         ← すぐ捨てる

   すぐ上のコメントには「受けた人は、認められていなくても一覧には出す
   （参加中として）」と書いてある。 */

test('クエストを受けただけの人も、メンバーに出る', () => {
  const i = INDEX.indexOf('受けた人は残す。');
  assert.ok(i > 0, 'まだ捨てている');
  const seg = INDEX.slice(i, i + 700);
  assert.ok(seg.indexOf('m.wisdom || m.done || m.cited || m.took') >= 0,
    '受けただけの人が残らない');
});

test('受けたことを数えている', () => {
  assert.ok(INDEX.indexOf('const m = pick(t.addr, t.name); if (m) m.took++;') >= 0,
    '受けた回数を数えていない');
  assert.ok(INDEX.indexOf('cited: 0, took: 0, share: {}') >= 0, '入れ物に欄が無い');
});

test('並び順の最後に、受けた数を使う', () => {
  /* 全部0の人が先頭に来ないように。 */
  assert.ok(INDEX.indexOf('(b.took - a.took)') >= 0, '並びが決まらない');
});

/* ───────── 管理画面で変えたものを、すぐ持ってくる ─────────

   管理画面は別のタブで開く。あちらで承認したりクエストを出したりしても、
   SchoolPark は開いたときに読んだきりで、古いままだった。 */

test('タブに戻ったら、読み直す', () => {
  const i = INDEX.indexOf('async function spDaoRefreshNow');
  assert.ok(i > 0, '読み直す道が無い');
  assert.ok(INDEX.indexOf("document.addEventListener('visibilitychange'") >= 0,
    'タブに戻ったことを見ていない');
  assert.ok(INDEX.indexOf("window.addEventListener('focus'") >= 0, '画面に戻ったことを見ていない');
});

test('開いているあいだは、定期でも読み直す', () => {
  const i = INDEX.indexOf('_spRefreshTimer = setInterval');
  assert.ok(i > 0, '定期の読み直しが無い');
  const seg = INDEX.slice(i, i + 300);
  assert.ok(seg.indexOf("document.visibilityState === 'visible'") >= 0,
    '見ていないタブでも投げてしまう');
  assert.ok(seg.indexOf('60000') >= 0);
});

test('行き来のたびに何往復も投げない（間引き）', () => {
  const i = INDEX.indexOf('async function spDaoRefreshNow');
  const seg = INDEX.slice(i, i + 700);
  assert.ok(seg.indexOf('now - _spRefreshAt < 8000') >= 0, '間引きが無い');
});

test('SchoolPark を開いていないときは、何もしない', () => {
  const i = INDEX.indexOf('async function spDaoRefreshNow');
  const seg = INDEX.slice(i, i + 400);
  assert.ok(seg.indexOf("document.body.classList.contains('sp-dao-open')") >= 0,
    '閉じているのに読みに行く');
});

test('資格（Emu light など）も取り直す', () => {
  /* 管理画面で付けた期限付きの資格が、すぐ効くように。 */
  const i = INDEX.indexOf('async function spDaoRefreshNow');
  const seg = INDEX.slice(i, i + 1400);
  assert.ok(seg.indexOf('emuEnsureEntitlement(true)') >= 0, '資格を取り直していない');
});

test('onSnapshot には頼らない', () => {
  /* Listen が切れている環境では一度も届かない。 */
  const i = INDEX.indexOf('async function spDaoRefreshNow');
  const seg = INDEX.slice(i - 1200, i + 1400);
  assert.equal(seg.indexOf('onSnapshot('), -1, '切れている通信路に頼っている');
  assert.ok(seg.indexOf('いまその通信路が切れている') >= 0, '理由を残していない');
});

/* ───────── 読むところを1つにまとめる ─────────

   この形の読み取りが SchoolPark の中に20以上あり、逃げ道を1つずつ
   足していた。足した先だけ直って、足していない先は空のまま。実際に

     ギルド・クエスト・知恵カード  → 出る（逃げ道あり）
     メンバー・トレジャリー・公園  → 空（逃げ道なし）

   という形で残っていた。読むところを1つにする。 */

function reader(opts) {
  opts = opts || {};
  const warn = [];
  const cacheOnly = { size: 0, metadata: { fromCache: true }, forEach: function () {} };
  const live = function (rows) {
    return { size: rows.length, metadata: { fromCache: false },
             forEach: function (f) { rows.forEach(function (r) { f({ id: r.id, data: function () { return r; } }); }); } };
  };
  const stubs = {
    console: { warn: function () { warn.push([].slice.call(arguments).join(' ')); } },
    _spSoon: async function (pr, ms) {
      if (opts.hangs) return { ok: false };
      try { return { ok: true, value: await pr }; } catch (e) { throw e; }
    },
    _spRestGet: async function () {
      if (opts.restFails) throw new Error('HTTP 403');
      return { documents: (opts.rest || []).map(function (r) {
        return { name: 'projects/x/databases/(default)/documents/c/' + r.id, fields: r };
      }) };
    },
    _spRestFields: function (f) { const o = {}; Object.keys(f).forEach(function (k) { o[k] = f[k]; }); return o; },
    window: {
      db: {}, fbLib: {
        collection: function () { return { path: [].slice.call(arguments, 1).join('/') }; },
        getDocs: async function () {
          if (opts.throws) throw new Error('offline');
          return opts.sdk ? live(opts.sdk) : cacheOnly;
        }
      }
    }
  };
  const api = build(INDEX, ['_spReadAll'], stubs);
  return { read: api._spReadAll, warn: warn };
}

test('SDKで読めたら、それを配列で返す', async () => {
  const r = reader({ sdk: [{ id: 'a', name: '甲' }] });
  assert.deepEqual(await r.read('sp_quests'), [{ id: 'a', name: '甲' }]);
});

test('控えの空は0件と信じず、普通の通信へ回す', async () => {
  const r = reader({ rest: [{ id: 'b', name: '乙' }] });   /* SDK は控えの空 */
  const rows = await r.read('sp_quests');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'b');
});

test('返ってこないときも、普通の通信へ回す', async () => {
  const r = reader({ hangs: true, rest: [{ id: 'c' }] });
  const rows = await r.read('sp_treasury');
  assert.equal(rows.length, 1);
});

test('例外でも、普通の通信へ回す', async () => {
  const r = reader({ throws: true, rest: [{ id: 'd' }] });
  const rows = await r.read('sp_park');
  assert.equal(rows.length, 1);
});

test('どちらも読めなければ null（0件とは違う）', async () => {
  const r = reader({ hangs: true, restFails: true });
  assert.equal(await r.read('sp_quests'), null);
  assert.match(r.warn.join(''), /読めませんでした/);
});

test('サーバーが本当に0件と答えたら、0件として返す', async () => {
  const r = reader({ sdk: [] });   /* fromCache:false の空 */
  assert.deepEqual(await r.read('sp_quests'), []);
});

test('メンバー・トレジャリー・公園・名前が、その道具を通る', () => {
  [['sp_wisdom', "const ws = await _spReadAll('sp_wisdom')"],
   ['sp_quests（メンバー）', "const qsRows = await _spReadAll('sp_quests')"],
   ['受けた記録', "_spReadAll('sp_quests/' + encodeURIComponent(q.id) + '/commits')"],
   ['入出金', "const es = await _spReadAll('sp_treasury')"],
   ['公園', "const snap = await _spReadAll('sp_park')"],
   ['乗った人', "_spReadAll('sp_park/' + encodeURIComponent(i.id) + '/joins')"],
   ['議題', "const snap = await _spReadAll('sp_votes')"]].forEach(function (x) {
    assert.ok(INDEX.indexOf(x[1]) >= 0, x[0] + ' が共通の読み取りを通っていない');
  });
});

test('配列に替えたのに .data() を呼び残していない', () => {
  /* 呼び残すと、その場で落ちて画面が空になる。 */
  ['cs.forEach(function (c) {\n          const d = c.data()',
   'es.forEach(function (s) { entries.push({ id: s.id, ...(s.data()',
   "snap.forEach(function (s) { items.push({ id: s.id, ...(s.data()"].forEach(function (bad) {
    assert.equal(INDEX.indexOf(bad), -1, '古い書き方が残っている: ' + bad.slice(0, 30));
  });
});

/* ───────── 証（IDトークン）が古いとき ─────────

   コンソールに、これがまとめて並んでいた。

     sp_wisdom を読めませんでした: ログインの証が取れない
     sp_quests を読めませんでした: ログインの証が取れない
     sp_park   を読めませんでした: ログインの証が取れない
     完走したクエストを SDK で読めませんでした: Missing or insufficient permissions.

   証は期限切れになる。そのときの getIdToken() は裏で取り直そうとして
   失敗し、空や例外で返ってくることがある。前はそこで投げて終わりだった。 */

test('証が取れなければ、取り直してから読む', () => {
  const i = INDEX.indexOf('async function _spRestGet');
  assert.ok(i > 0);
  const seg = INDEX.slice(i, i + 1800);
  assert.ok(seg.indexOf('token = await ask(false);') >= 0, '普通に取っていない');
  assert.ok(seg.indexOf('if (!token) token = await ask(true);') >= 0, '取り直していない');
  assert.ok(seg.indexOf('getIdToken(force)') >= 0, '取り直しを頼めない形になっている');
});

test('断られたときも、証を取り直して1回だけやり直す', () => {
  const i = INDEX.indexOf('async function _spRestGet');
  const seg = INDEX.slice(i, i + 2400);
  assert.ok(seg.indexOf('r.status === 401 || r.status === 403') >= 0, '断られたまま終わる');
  assert.ok(seg.indexOf("fresh !== token") >= 0, '同じ証で投げ直してしまう');
});

test('取り直してもだめなときは、はじめてあきらめる', () => {
  const i = INDEX.indexOf('async function _spRestGet');
  const seg = INDEX.slice(i, i + 1800);
  const give = seg.indexOf("throw new Error('ログインの証が取れない')");
  const retry = seg.indexOf('if (!token) token = await ask(true);');
  assert.ok(retry > 0 && give > retry, '取り直す前にあきらめている');
});

/* ───────── 完走は「認めた周回」の合計 ───────── */

test('2周認めた人は、完走2本', () => {
  const i = INDEX.indexOf('完走は「認めた周回」の合計');
  assert.ok(i > 0, 'まだクエストの本数で数えている');
  const seg = INDEX.slice(i, i + 400);
  assert.ok(/Number\(q\.rounds\)/.test(seg), '周回を足していない');
  assert.equal(INDEX.indexOf("done = list.filter(function (q) { return !q.isFounder; }).length;"), -1,
    '古い数え方が残っている');
});

test('パスポートの記録も、周回を持つ', () => {
  const i = INDEX.indexOf('認めた周回の数。1周しかしていない人は1');
  assert.ok(i > 0, '記録に周回が無い');
  assert.ok(/rounds \+= Math\.max\(1, Number\(d\.approvedRounds\)/.test(INDEX),
    'SDK で読んだときに周回を足していない');
  assert.ok(/rounds \+= Math\.max\(1, Number\(r\.data\.approvedRounds\)/.test(INDEX),
    '普通の通信で読んだときに周回を足していない');
});

test('メンバーの完走も、周回を足す', () => {
  assert.ok(/m\.done \+= Math\.max\(1, Number\(t\.rounds\)/.test(INDEX),
    'メンバーが周回を足していない');
  assert.ok(/rounds: Math\.max\(1, Number\(c\.approvedRounds\)/.test(INDEX),
    '受けた記録から周回を持ってきていない');
});

/* 書き方を文字で当てるのではなく、実際に動かして確かめる。

   前はここで古い書き方をそのまま探していたので、
   Math.max(1, Number(x || 1)) を Math.max(1, Number(x) || 0) に直した
   ときに落ちた。中身は良くなっている（前者は壊れた値で NaN になる）のに、
   文字が変わっただけで落ちるのでは、試験が直すのを邪魔してしまう。 */
test('周回の数え方は、欠けた値・壊れた値でも1周になる', () => {
  const found = INDEX.match(/Math\.max\(1, Number\([A-Za-z.]*(?:rounds|approvedRounds)\)[^;)]*\)/g) || [];
  assert.ok(found.length >= 5, '周回を数えているところが足りません: ' + found.length);
  found.forEach(function (expr) {
    /* 式のなかの「x」を差し替えて、そのまま評価する。 */
    const body = expr.replace(/Number\([A-Za-z.]*(?:rounds|approvedRounds)\)/, 'Number(v)');
    const f = new Function('v', 'return ' + body + ';');
    [undefined, null, 0, '', 'x', NaN, -2].forEach(function (v) {
      assert.equal(f(v), 1, expr + ' が ' + String(v) + ' で1周になりません');
    });
    assert.equal(f(2), 2, expr + ' が2周を数えません');
    assert.equal(f('3'), 3, expr + ' が2周を数えません');
  });
});

test('古い記録（周回の欄が無い）は1周として数える', () => {
  /* サーバーが書く前の記録を0本にしてしまうと、完走が消える。 */
  [/Math\.max\(1, Number\(d\.approvedRounds\)/,
   /Math\.max\(1, Number\(q\.rounds\)/,
   /Math\.max\(1, Number\(c\.approvedRounds\)/].forEach(function (x) {
    assert.ok(x.test(INDEX), '古い記録が0本になる: ' + x);
  });
});

test('認めた日は、いちばん新しい周回のもの', () => {
  assert.ok(INDEX.indexOf('Number(d.lastApprovedAt || d.approvedAt || 0)') >= 0,
    '2周目を認めても日付が動かない');
});

/* ───────── ギルドの人数とパスポートの参加ギルド ─────────

   ギルド一覧は「参加したい 0」、詳細は「✓参加したい 1」。
   パスポートの参加ギルドも「まだありません」。同じ押した結果なのに
   場所によって違う。人数を読むところにだけ逃げ道が無かった。 */

test('ギルド一覧の人数も、普通の通信で読む', () => {
  assert.ok(INDEX.indexOf("_spReadAll('sp_guild_members/' + encodeURIComponent(g.id) + '/joins')") >= 0,
    '一覧の参加が逃げ道を通っていない');
  assert.ok(INDEX.indexOf("_spReadAll('sp_guild_members/' + encodeURIComponent(g.id) + '/supports')") >= 0,
    '一覧の応援が逃げ道を通っていない');
  assert.equal(INDEX.indexOf("fb.getDocs(fb.collection(window.db, 'sp_guild_members'"), -1,
    '古い読み方が残っている');
});

test('パスポートの参加ギルドも、普通の通信で確かめる', () => {
  const i = INDEX.indexOf('async function _spHasDoc');
  assert.ok(i > 0, '1件を確かめる道具が無い');
  const seg = INDEX.slice(i, i + 800);
  assert.ok(seg.indexOf('_spSoon(') >= 0, '返ってこないときに見切れない');
  assert.ok(seg.indexOf('_spRestDoc(path, true)') >= 0, '普通の通信へ回していない');
  assert.ok(seg.indexOf('fromCache') >= 0, '控えの「無い」を信じてしまう');
  assert.ok(INDEX.indexOf("_spHasDoc('sp_guild_members/' + encodeURIComponent(g.id) + '/joins/'") >= 0,
    'パスポートが使っていない');
});

test('_spHasDoc は真偽を返す（呼ぶ側が exists() を呼ばない）', () => {
  assert.ok(INDEX.indexOf('if (pairs[i][0]) joined.push(g.short);') >= 0,
    '真偽前提になっていない');
  assert.equal(INDEX.indexOf('if (j && j.exists()) joined.push(g.short);'), -1,
    '古い書き方が残っている');
});

/* ───────── 在籍の月数 ─────────

   パスポートを発行した日から、暦の月で数える。始めた月が1か月目。
   前は日数を30で割っていたので、1月1日から9月27日でも8か月にしかならず、
   数えた月の数（1月〜9月＝9か月）と合わなかった。

   運営は SchoolPark を1月から動かしているので、パスポートをあとから
   発行していても、そこから数える。 */

function months(opts) {
  /* SP_OWNER_SINCE は関数の外にある定数なので、取り出しに入らない。
     本体と同じ値を渡す（ずれたら下の試験が落ちる）。 */
  const owner = Date.parse('2026-01-01T00:00:00+09:00');
  const api = build(INDEX, ['spMonthsSince'], { Date: Date, window: {}, SP_OWNER_SINCE: owner });
  return api.spMonthsSince(opts);
}

test('運営の起点は、本体もここも 2026-01-01', () => {
  assert.ok(INDEX.indexOf("const SP_OWNER_SINCE = Date.parse('2026-01-01T00:00:00+09:00');") >= 0,
    '起点が変わっている');
});

const AT_SEP27 = function (fn) {
  const now = Date.now;
  Date.now = function () { return Date.parse('2026-09-27T12:00:00+09:00'); };
  try { return fn(); } finally { Date.now = now; }
};

test('1月に始めた運営は、9月の時点で9か月', () => {
  AT_SEP27(function () {
    assert.equal(months({ isOwner: true, spSince: Date.parse('2026-08-01T00:00:00+09:00') }), 9,
      '運営は1月から数える');
  });
});

test('パスポートを発行した月が、1か月目', () => {
  AT_SEP27(function () {
    assert.equal(months({ spSince: Date.parse('2026-09-27T00:00:00+09:00') }), 1, '発行した当月が0になる');
    assert.equal(months({ spSince: Date.parse('2026-09-01T00:00:00+09:00') }), 1);
    assert.equal(months({ spSince: Date.parse('2026-08-31T23:59:00+09:00') }), 2, '月をまたいだら2');
  });
});

test('暦の月で数える（日数で割らない）', () => {
  AT_SEP27(function () {
    /* 1月1日から9月27日は269日。30で割ると8にしかならない。 */
    assert.equal(months({ spSince: Date.parse('2026-01-01T00:00:00+09:00') }), 9);
    assert.equal(months({ spSince: Date.parse('2026-01-31T00:00:00+09:00') }), 9, '月末でも同じ月は同じ');
  });
});

test('上限は12か月のまま', () => {
  AT_SEP27(function () {
    assert.equal(months({ spSince: Date.parse('2024-01-01T00:00:00+09:00') }), 12);
  });
});

test('発行した日が分からなければ0', () => {
  AT_SEP27(function () {
    assert.equal(months({ spSince: 0 }), 0);
    assert.equal(months(null), 0);
  });
});

test('先の日付では増えない', () => {
  AT_SEP27(function () {
    assert.equal(months({ spSince: Date.parse('2027-01-01T00:00:00+09:00') }), 0);
  });
});

test('パスポートが発行日を持っている', () => {
  const i = INDEX.indexOf('パスポートを発行した日。信用スコアの「在籍」');
  assert.ok(i > 0, '発行日を持っていない');
  const seg = INDEX.slice(i, i + 500);
  assert.ok(seg.indexOf('identityNow && identityNow.createdAt') >= 0, 'sp_identities を見ていない');
  assert.ok(seg.indexOf('d.spidLinkedAt') >= 0, 'ches_accounts の控えを見ていない');
  assert.ok(seg.indexOf('d.createdAt') >= 0, '古いアカウントの代わりが無い');
});

test('信用スコアが、その数え方を使っている', () => {
  assert.ok(INDEX.indexOf('const months = spMonthsSince(p || { spSince: createdAt });') >= 0,
    '古い数え方が残っている');
  assert.equal(INDEX.indexOf('Math.floor((Date.now() - Number(createdAt)) / (30 * 86400000))'), -1,
    '日数で割る書き方が残っている');
});
