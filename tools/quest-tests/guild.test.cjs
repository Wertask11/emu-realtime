/* ギルドの決まりを、記録（Firestore Rules）の側から確かめる。

   画面の作りに関係なく成り立っていてほしいこと:
     ・議題はかならずどれか1つのギルドのものになる
     ・一般議題は誰でも、特殊議題は関われる人だけが投票できる（既存の思想）
     ・同じパスポートで二重に投票できない／他人の票を書き換えられない
     ・参加/応援は自分のぶんだけ。二重にはならない
     ・採択できるのは運営だけ。1回だけ。あとから変えられない
     ・ギルドの後付けは運営だけ。すでに決まっているものは動かせない
     ・クエスト化できるのは運営だけ
     ・Quest #000 はどのギルドにも属さない                              */
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const fb = require('firebase/firestore');
const guilds = require('../../frontend/public/schoolpark/guild-store.js');

const owner = '0x8ab838ebb2e3bf160bc61b7182d348a8500b35f7';
let env, db, trusted, plain;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-schoolpark-guilds',
    firestore: { host: '127.0.0.1', port: 8080, rules: fs.readFileSync('../../firestore.rules', 'utf8') }
  });
});
after(async () => { await env?.cleanup(); });

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async c => {
    const d = c.firestore();
    await fb.setDoc(fb.doc(d, 'ches_accounts', 'founder'), { walletAddress: owner, chesAddress: owner });
    await fb.setDoc(fb.doc(d, 'ches_accounts', 'trusted'), { walletAddress: 'trusted', chesAddress: 'trusted' });
    await fb.setDoc(fb.doc(d, 'ches_accounts', 'plain'), { walletAddress: 'plain', chesAddress: 'plain' });
    /* trusted は「ギルドに関われる人」として運営が認めた人 */
    await fb.setDoc(fb.doc(d, 'sp_trust', 'trusted'), { at: 1 });
  });
  db = env.authenticatedContext('founder').firestore();
  trusted = env.authenticatedContext('trusted').firestore();
  plain = env.authenticatedContext('plain').firestore();
});

const proposal = (by, extra) => Object.assign({
  title: '来月の予算を何に使うか',
  body: '判断の材料',
  options: [{ id: 'o1', label: 'A案' }, { id: 'o2', label: 'B案' }],
  kind: 'free',
  guildId: 'learn',
  createdBy: by,
  createdAt: 1,
  closesAt: 2000000000000
}, extra || {});

/* 画面に書いてある5つが、記録の決まりに通る形になっているか。
   ここがずれると、選べるのに出せない、が起きる。 */
test('公式5ギルドのIDは、記録の決まりが認める形をしている', () => {
  assert.equal(guilds.OFFICIAL.length, 5);
  assert.deepEqual(guilds.OFFICIAL.map(g => g.id), ['learn', 'work', 'play', 'connect', 'web3']);
  guilds.OFFICIAL.forEach(g => assert.ok(guilds.isValidId(g.id), g.id));
});

test('議題はギルドが決まっていないと出せない', async () => {
  await assertFails(fb.addDoc(fb.collection(trusted, 'sp_votes'), proposal('trusted', { guildId: '' })));
  const noKey = proposal('trusted');
  delete noKey.guildId;
  await assertFails(fb.addDoc(fb.collection(trusted, 'sp_votes'), noKey));
  await assertFails(fb.addDoc(fb.collection(trusted, 'sp_votes'), proposal('trusted', { guildId: 'LEARN' })));
  await assertFails(fb.addDoc(fb.collection(trusted, 'sp_votes'), proposal('trusted', { guildId: 'まなび' })));
  await assertSucceeds(fb.addDoc(fb.collection(trusted, 'sp_votes'), proposal('trusted')));
});

test('議題を出せるのは、運営・関われる人だけ（既存のまま）', async () => {
  await assertFails(fb.addDoc(fb.collection(plain, 'sp_votes'), proposal('plain')));
  await assertSucceeds(fb.addDoc(fb.collection(db, 'sp_votes'), proposal(owner)));
});

test('出すときに採択を先に書き込むことはできない', async () => {
  await assertFails(fb.addDoc(fb.collection(db, 'sp_votes'),
    proposal(owner, { adoptedOptionId: 'o1', adoptedAt: 1, adoptedBy: owner })));
});

test('一般議題は誰でも、特殊議題は関われる人だけが投票できる', async () => {
  await env.withSecurityRulesDisabled(async c => {
    const d = c.firestore();
    await fb.setDoc(fb.doc(d, 'sp_votes', 'free1'), proposal(owner));
    await fb.setDoc(fb.doc(d, 'sp_votes', 'sp1'), proposal(owner, { kind: 'special', guildId: 'web3' }));
  });
  await assertSucceeds(fb.setDoc(fb.doc(plain, 'sp_votes', 'free1', 'ballots', 'plain'), { optionId: 'o1', castAt: 1 }));
  await assertFails(fb.setDoc(fb.doc(plain, 'sp_votes', 'sp1', 'ballots', 'plain'), { optionId: 'o1', castAt: 1 }));
  await assertSucceeds(fb.setDoc(fb.doc(trusted, 'sp_votes', 'sp1', 'ballots', 'trusted'), { optionId: 'o1', castAt: 1 }));
});

test('二重投票と、他人の票の書き換えはできない', async () => {
  await env.withSecurityRulesDisabled(async c => {
    await fb.setDoc(fb.doc(c.firestore(), 'sp_votes', 'v1'), proposal(owner));
  });
  await assertSucceeds(fb.setDoc(fb.doc(plain, 'sp_votes', 'v1', 'ballots', 'plain'), { optionId: 'o1', castAt: 1 }));
  /* 同じ文書へもう一度書くのは書き換え。認めていない */
  await assertFails(fb.setDoc(fb.doc(plain, 'sp_votes', 'v1', 'ballots', 'plain'), { optionId: 'o2', castAt: 2 }));
  await assertFails(fb.deleteDoc(fb.doc(plain, 'sp_votes', 'v1', 'ballots', 'plain')));
  /* 他人の名義では入れられない */
  await assertFails(fb.setDoc(fb.doc(trusted, 'sp_votes', 'v1', 'ballots', 'plain'), { optionId: 'o2', castAt: 2 }));
});

test('採択できるのは運営だけ。1回だけ。あとから変えられない', async () => {
  await env.withSecurityRulesDisabled(async c => {
    await fb.setDoc(fb.doc(c.firestore(), 'sp_votes', 'v1'), proposal('trusted', { createdBy: 'trusted' }));
  });
  /* 出した本人でも、関われる人でも、採択はできない */
  await assertFails(fb.updateDoc(fb.doc(trusted, 'sp_votes', 'v1'),
    { adoptedOptionId: 'o1', adoptedAt: 1, adoptedBy: 'trusted' }));
  /* 題名などをまぎれ込ませることもできない */
  await assertFails(fb.updateDoc(fb.doc(db, 'sp_votes', 'v1'),
    { adoptedOptionId: 'o1', adoptedAt: 1, adoptedBy: owner, title: 'すりかえ' }));
  await assertSucceeds(fb.updateDoc(fb.doc(db, 'sp_votes', 'v1'),
    { adoptedOptionId: 'o1', adoptedAt: 1, adoptedBy: owner }));
  /* いちど採択したら、運営でも変えられない */
  await assertFails(fb.updateDoc(fb.doc(db, 'sp_votes', 'v1'),
    { adoptedOptionId: 'o2', adoptedAt: 2, adoptedBy: owner }));
});

test('締切を先に延ばすことはできない（既存のまま）', async () => {
  await env.withSecurityRulesDisabled(async c => {
    await fb.setDoc(fb.doc(c.firestore(), 'sp_votes', 'v1'),
      proposal('trusted', { createdBy: 'trusted', closesAt: 1000 }));
  });
  await assertFails(fb.updateDoc(fb.doc(trusted, 'sp_votes', 'v1'), { closesAt: 5000 }));
  await assertSucceeds(fb.updateDoc(fb.doc(trusted, 'sp_votes', 'v1'), { closesAt: 500 }));
});

test('ギルドの後付けは運営だけ。決まっているものは動かせない', async () => {
  await env.withSecurityRulesDisabled(async c => {
    const d = c.firestore();
    /* ギルドができる前に出された議題（guildId が無い） */
    const old = proposal('trusted', { createdBy: 'trusted' });
    delete old.guildId;
    await fb.setDoc(fb.doc(d, 'sp_votes', 'old1'), old);
    await fb.setDoc(fb.doc(d, 'sp_votes', 'new1'), proposal('trusted', { createdBy: 'trusted' }));
  });
  await assertFails(fb.updateDoc(fb.doc(trusted, 'sp_votes', 'old1'), { guildId: 'learn' }));
  await assertSucceeds(fb.updateDoc(fb.doc(db, 'sp_votes', 'old1'), { guildId: 'learn' }));
  /* すでに決まっているものは、運営でも動かせない */
  await assertFails(fb.updateDoc(fb.doc(db, 'sp_votes', 'new1'), { guildId: 'play' }));
});

test('参加したい・応援するは、自分のぶんだけ。二重にはならない', async () => {
  const mine = fb.doc(plain, 'sp_guild_members', 'learn', 'joins', 'plain');
  await assertSucceeds(fb.setDoc(mine, { name: 'ぷれいん', at: 1 }));
  /* もう一度書くのは書き換え。認めていない（＝二重にならない） */
  await assertFails(fb.setDoc(mine, { name: 'ぷれいん', at: 2 }));
  /* 取り消しはできる */
  await assertSucceeds(fb.deleteDoc(mine));
  /* 他人の名義では置けない・消せない */
  await assertFails(fb.setDoc(fb.doc(trusted, 'sp_guild_members', 'learn', 'joins', 'plain'), { name: 'なりすまし', at: 1 }));
  await assertSucceeds(fb.setDoc(fb.doc(plain, 'sp_guild_members', 'learn', 'supports', 'plain'), { name: 'ぷれいん', at: 1 }));
  await assertFails(fb.deleteDoc(fb.doc(trusted, 'sp_guild_members', 'learn', 'supports', 'plain')));
  /* まとめの数字を勝手に置くこともできない */
  await assertFails(fb.setDoc(fb.doc(plain, 'sp_guild_members', 'learn'), { joins: 999 }));
});

test('ログインしていないと、参加も応援も投票もできない', async () => {
  const anon = env.unauthenticatedContext().firestore();
  await assertFails(fb.setDoc(fb.doc(anon, 'sp_guild_members', 'learn', 'joins', 'plain'), { name: 'x', at: 1 }));
  await env.withSecurityRulesDisabled(async c => {
    await fb.setDoc(fb.doc(c.firestore(), 'sp_votes', 'v1'), proposal(owner));
  });
  await assertFails(fb.setDoc(fb.doc(anon, 'sp_votes', 'v1', 'ballots', 'plain'), { optionId: 'o1', castAt: 1 }));
  /* 見るのは誰でもできる */
  await assertSucceeds(fb.getDoc(fb.doc(anon, 'sp_votes', 'v1')));
});

test('ギルドそのものを増やせるのは運営だけ', async () => {
  await assertFails(fb.setDoc(fb.doc(trusted, 'sp_guilds', 'music'), { name: 'MUSIC Guild' }));
  await assertSucceeds(fb.setDoc(fb.doc(db, 'sp_guilds', 'music'),
    { name: 'MUSIC Guild', concept: '音で人をつなぐ。', body: '' }));
  /* 消せない。議題とクエストが紐づいているため */
  await assertFails(fb.deleteDoc(fb.doc(db, 'sp_guilds', 'music')));
});

const quest = (extra) => Object.assign({
  title: '議題から生まれたクエスト',
  knowledge: '', hypothesis: '予想', action: '', measure: '',
  budget: '0', budgetCurrency: 'JPY', need: 1,
  owner: owner, ownerName: '運営', status: 'OPEN',
  createdAt: 1, closesAt: 2
}, extra || {});

test('クエスト化できるのは運営だけ。元の議題とギルドを持てる', async () => {
  await assertFails(fb.addDoc(fb.collection(trusted, 'sp_quests'),
    quest({ owner: 'trusted', guildId: 'learn', fromProposalId: 'v1' })));
  await assertSucceeds(fb.addDoc(fb.collection(db, 'sp_quests'),
    quest({ guildId: 'learn', fromProposalId: 'v1', fromProposalTitle: '来月の予算' })));
  /* 元の議題があるのに、どのギルドの議題だったかが無いのは認めない */
  await assertFails(fb.addDoc(fb.collection(db, 'sp_quests'),
    quest({ guildId: '', fromProposalId: 'v1' })));
  await assertFails(fb.addDoc(fb.collection(db, 'sp_quests'),
    quest({ guildId: 'LEARN', fromProposalId: 'v1' })));
});

test('議題を通さない直接クエストも、これまでどおり出せる', async () => {
  await assertSucceeds(fb.addDoc(fb.collection(db, 'sp_quests'), quest()));
  await assertSucceeds(fb.addDoc(fb.collection(db, 'sp_quests'), quest({ guildId: 'play' })));
});

test('Quest #000 はどのギルドにも属さないまま、触れない', async () => {
  await env.withSecurityRulesDisabled(async c => {
    await fb.setDoc(fb.doc(c.firestore(), 'sp_quests', 'founder-quest-000'),
      Object.assign(quest(), { kind: 'founder', questNumber: 0, closesAt: null, founderVersion: 1, founderSections: [] }));
  });
  const f = await fb.getDoc(fb.doc(db, 'sp_quests', 'founder-quest-000'));
  assert.equal(f.data().guildId, undefined);
  await assertFails(fb.updateDoc(fb.doc(db, 'sp_quests', 'founder-quest-000'), { guildId: 'learn' }));
  await assertFails(fb.updateDoc(fb.doc(db, 'sp_quests', 'founder-quest-000'), { status: 'CLOSED', closedAt: 1 }));
});
