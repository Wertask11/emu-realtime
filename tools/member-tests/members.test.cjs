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
