/* 知恵カードを置けるのは誰か。

   完走条件は「報告3回＋知恵カード1枚＋運営の確認」。
   前は、知恵カードの決まりが

     get(sp_quests/{id}).data.status == 'CLOSED'

   だった。CLOSED にできるのは出した人（運営）だけなので、
   受けた人は自分の知恵カードを置けなかった。まん中の1枚を
   自分で満たす道が無い、という状態だった。

   いまは「そのクエストを受けていること」を見る。途中報告（logs）と
   同じ確かめ方。ここでは、その決まりをエミュレータに読ませて、
   本当に置けるようになったか・置けてはいけない人が弾かれるかを見る。 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { initializeTestEnvironment, assertFails, assertSucceeds } =
  require('../quest-tests/node_modules/@firebase/rules-unit-testing');
const fb = require('../quest-tests/node_modules/firebase/firestore');

const OWNER  = '0x8ab838ebb2e3bf160bc61b7182d348a8500b35f7';  // 運営
const TAKER  = '0xaaaa000000000000000000000000000000000001';  // 受けた人
const OTHER  = '0xbbbb000000000000000000000000000000000002';  // 受けていない人
const QUEST  = 'quest-learn-001';

let env, owner, taker, other;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-sp',
    firestore: {
      host: '127.0.0.1', port: 8080,
      rules: fs.readFileSync(path.join(__dirname, '..', '..', 'firestore.rules'), 'utf8')
    }
  });
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const d = c.firestore();
    /* 3人とも公式パスを持っている（先行公開のあいだ入れるように） */
    for (const [uid, addr] of [['owner', OWNER], ['taker', TAKER], ['other', OTHER]]) {
      await fb.setDoc(fb.doc(d, 'ches_accounts', uid), { walletAddress: addr, chesAddress: addr });
      await fb.setDoc(fb.doc(d, 'paid_users', addr), { plan: 'official' });
    }
    /* 走っているクエスト（まだ閉じていない）と、受けた記録 */
    await fb.setDoc(fb.doc(d, 'sp_quests', QUEST), {
      title: 'Emuの知識を、やってみる', series: 'general', questNumber: 1, branch: 0, stage: '',
      owner: OWNER, ownerName: '運営', status: 'OPEN', createdAt: 1, closesAt: 2, need: 10
    });
    await fb.setDoc(fb.doc(d, 'sp_quests', QUEST, 'commits', TAKER), { name: '受けた人', tookAt: 1 });
  });
  owner = env.authenticatedContext('owner').firestore();
  taker = env.authenticatedContext('taker').firestore();
  other = env.authenticatedContext('other').firestore();
});
after(async () => { await env?.cleanup(); });

const card = (addr, extra) => Object.assign({
  questId: QUEST, questTitle: 'Emuの知識を、やってみる',
  knowledge: 'Emuの投稿', experiment: 'やってみた', insight: '効かなかったが、理由が分かった',
  tag: 'Emu', author: addr, authorName: '名前', createdAt: 1,
  fromPostId: '', fromPostTitle: ''
}, extra || {});

test('受けた人は、走っているクエストに知恵カードを置ける', async () => {
  await assertSucceeds(fb.addDoc(fb.collection(taker, 'sp_wisdom'), card(TAKER)));
});

test('受けていない人は置けない', async () => {
  await assertFails(fb.addDoc(fb.collection(other, 'sp_wisdom'), card(OTHER)));
});

test('出した本人でも、受けていなければ置けない（やった人が置くものなので）', async () => {
  await assertFails(fb.addDoc(fb.collection(owner, 'sp_wisdom'), card(OWNER)));
});

test('出した本人も、受ければ置ける', async () => {
  await env.withSecurityRulesDisabled(async (c) => {
    await fb.setDoc(fb.doc(c.firestore(), 'sp_quests', QUEST, 'commits', OWNER), { name: '運営', tookAt: 1 });
  });
  await assertSucceeds(fb.addDoc(fb.collection(owner, 'sp_wisdom'), card(OWNER)));
});

test('他人の名義では置けない', async () => {
  await assertFails(fb.addDoc(fb.collection(other, 'sp_wisdom'), card(TAKER)));
});

test('ありもしないクエストには置けない（受けた記録だけ作っても）', async () => {
  await env.withSecurityRulesDisabled(async (c) => {
    await fb.setDoc(fb.doc(c.firestore(), 'sp_quests', 'nowhere', 'commits', OTHER), { name: 'x', tookAt: 1 });
  });
  await assertFails(fb.addDoc(fb.collection(other, 'sp_wisdom'), card(OTHER, { questId: 'nowhere' })));
});

test('残った一文が空では置けない', async () => {
  await assertFails(fb.addDoc(fb.collection(taker, 'sp_wisdom'), card(TAKER, { insight: '' })));
});

test('残った一文が200字を超えると置けない', async () => {
  await assertFails(fb.addDoc(fb.collection(taker, 'sp_wisdom'), card(TAKER, { insight: 'あ'.repeat(201) })));
});

test('閉じたあとでも置ける（締切のあとに書き上げる人がいるため）', async () => {
  await env.withSecurityRulesDisabled(async (c) => {
    await fb.setDoc(fb.doc(c.firestore(), 'sp_quests', QUEST), { status: 'CLOSED' }, { merge: true });
  });
  await assertSucceeds(fb.addDoc(fb.collection(taker, 'sp_wisdom'), card(TAKER)));
});

test('いちど置いた知恵は、書き換えも削除もできない', async () => {
  let id;
  await env.withSecurityRulesDisabled(async (c) => {
    const r = await fb.addDoc(fb.collection(c.firestore(), 'sp_wisdom'), card(TAKER));
    id = r.id;
  });
  await assertFails(fb.updateDoc(fb.doc(taker, 'sp_wisdom', id), { insight: '書き換え' }));
  await assertFails(fb.deleteDoc(fb.doc(taker, 'sp_wisdom', id)));
});

test('途中報告は、受けた人だけが出せる（前からの決まりが壊れていないこと）', async () => {
  const log = (addr) => ({ author: addr, authorName: '名前', kind: 'やってみた',
    body: '実際にやってみた', at: 1, fromPostId: '', fromPostTitle: '' });
  await assertSucceeds(fb.addDoc(fb.collection(taker, 'sp_quests', QUEST, 'logs'), log(TAKER)));
  await assertFails(fb.addDoc(fb.collection(other, 'sp_quests', QUEST, 'logs'), log(OTHER)));
});

/* ───────── 画面側 ─────────

   決まりが通っても、画面に置く道が無ければ意味がない。
   前は道が「完了にして知恵カードを置く」の1つきりで、
   完了にできるのは出した人だけだった。
   ここでは、受けた人の道（spQuestWisdom）がクエストの状態を
   動かさないこと、受けていない人を先に止めることを見る。 */
const { build, readHtml } = require('../year-goals-tests/extract.cjs');
const INDEX = readHtml('frontend/public/index.html');
const DAO = readHtml('frontend/public/schoolpark/dao.html');

function app(opts) {
  opts = opts || {};
  const said = [], wrote = [], opened = [];
  const stubs = {
    alert: function (m) { said.push(m); },
    confirm: function () { return true; },
    console: { warn: function () {} },
    spPassportLoad: async function () { return opts.me === null ? null : (opts.me || { addr: '0xtaker', name: '受けた人', isOwner: false }); },
    openSpWisdomForm: function (q) { opened.push(q); },
    SpQuestStore: { FOUNDER_ID: 'founder-quest-000' },
    window: {
      db: {},
      fbLib: {
        doc: function () { return { path: [].slice.call(arguments, 1).join('/') }; },
        collection: function () { return { path: [].slice.call(arguments, 1).join('/') }; },
        getDoc: async function (ref) {
          const p = ref.path;
          if (p.indexOf('commits/') >= 0) return { exists: function () { return !!opts.took; } };
          return { exists: function () { return !opts.missing; },
                   id: 'q1', data: function () { return opts.quest || { title: 'クエスト', owner: '0xowner', status: 'OPEN' }; } };
        },
        getDocs: async function () {
          const rows = opts.logs || [];
          return { forEach: function (f) { rows.forEach(function (r) { f({ data: function () { return r; } }); }); } };
        },
        updateDoc: async function (ref, v) { wrote.push([ref.path, v]); }
      },
      spDaoLoadQuests: async function () {}
    }
  };
  const api = build(INDEX, ['_spQuestCited', 'spQuestWisdom', 'spQuestClose'], stubs);
  return { api: api, said: said, wrote: wrote, opened: opened };
}

test('受けた人は、知恵カードの札を開ける。クエストの状態は動かない', async () => {
  const a = app({ took: true });
  await a.api.spQuestWisdom('q1', null);
  assert.equal(a.opened.length, 1, '札が開いていない');
  assert.deepEqual(a.wrote, [], 'クエストの状態を書き換えている');
});

test('受けていない人は、書く前に止める（書いたあとに断られて消えないように）', async () => {
  const a = app({ took: false });
  await a.api.spQuestWisdom('q1', null);
  assert.equal(a.opened.length, 0);
  assert.match(a.said.join(''), /受けた人だけ/);
});

test('ログインしていなければ開かない', async () => {
  const a = app({ me: null });
  await a.api.spQuestWisdom('q1', null);
  assert.equal(a.opened.length, 0);
  assert.match(a.said.join(''), /ログイン/);
});

test('Quest #000 では何も起きない', async () => {
  const a = app({ took: true });
  await a.api.spQuestWisdom('founder-quest-000', null);
  assert.equal(a.opened.length, 0);
  assert.deepEqual(a.said, []);
});

test('元にする投稿は、自分が報告で選んだものが先に出る', async () => {
  const a = app({ took: true, logs: [
    { author: '0xOTHER', fromPostId: 'p-other', fromPostTitle: 'ほかの人の' },
    { author: '0xOTHER', fromPostId: 'p-other', fromPostTitle: 'ほかの人の' },
    { author: '0xTAKER', fromPostId: 'p-mine',  fromPostTitle: '自分の' }
  ] });
  const mine = await a.api._spQuestCited('q1', '0xtaker');
  assert.equal(mine[0].id, 'p-mine', '件数の多いほうに引っぱられている');
  assert.equal(mine.length, 1);
});

test('自分が1つも選んでいなければ、クエスト全体から拾う', async () => {
  const a = app({ took: true, logs: [
    { author: '0xOTHER', fromPostId: 'p-a', fromPostTitle: 'A' },
    { author: '0xOTHER', fromPostId: 'p-b', fromPostTitle: 'B' },
    { author: '0xOTHER', fromPostId: 'p-b', fromPostTitle: 'B' }
  ] });
  const got = await a.api._spQuestCited('q1', '0xtaker');
  assert.deepEqual(got.map(function (x) { return x.id; }), ['p-b', 'p-a'], '多い順になっていない');
});

test('完了にするのは、出した人だけ（前からの決まりが残っている）', async () => {
  const a = app({ took: false, me: { addr: '0xtaker', name: 'x', isOwner: false } });
  await a.api.spQuestClose('q1', null);
  assert.deepEqual(a.wrote, []);
  assert.match(a.said.join(''), /出した人だけ/);
});

test('出した人が受けていなければ、完了にするだけで札は開かない', async () => {
  const a = app({ took: false, me: { addr: '0xowner', name: '運営', isOwner: true } });
  await a.api.spQuestClose('q1', null);
  assert.equal(a.wrote.length, 1, '完了にできていない');
  assert.equal(a.wrote[0][1].status, 'CLOSED');
  assert.equal(a.opened.length, 0, '受けていないのに札が開いた');
  assert.match(a.said.join(''), /受けた人が置きます/);
});

test('出した人が受けていれば、完了のあとそのまま置ける', async () => {
  const a = app({ took: true, me: { addr: '0xowner', name: '運営', isOwner: true } });
  await a.api.spQuestClose('q1', null);
  assert.equal(a.wrote.length, 1);
  assert.equal(a.opened.length, 1);
});

test('画面に、受けた人ぶんの入口がある', () => {
  assert.ok(DAO.indexOf('canWisdom:') >= 0, '結び付けが無い');
  assert.ok(DAO.indexOf('spQuestWisdom(e.id') >= 0, '呼び出しが無い');
  assert.ok(DAO.indexOf('>知恵カードを置く<') >= 0, 'ボタンが無い');
  /* 受けたかどうかだけを見る（閉じたあとも置ける） */
  assert.ok(DAO.indexOf("canWisdom: !e.isFounder && !!e.iTook,") >= 0,
    'canWisdom が status を見てしまっている');
});
