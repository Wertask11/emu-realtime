'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { makeFirestore } = require('./fake-firestore');
const { deriveAddress, ensureVerifiedAccount, accountRouter, activityRouter, awardRankingBadge } = require('./verified-platform');
const decoded = uid => ({ uid, firebase: { sign_in_provider: 'google.com' }, name: 'Verified user' });
const victim = '0x1111111111111111111111111111111111111111';

test('bootstrap repairs a forged legacy wallet and persists only the token-derived identity', async () => {
  const db = makeFirestore();
  await db.collection('ches_accounts').doc('attacker').set({ walletAddress: victim, chesAddress: victim, displayName: 'My name' });
  const account = await ensureVerifiedAccount(db, decoded('attacker'));
  assert.equal(account.walletAddress, deriveAddress('attacker'));
  assert.equal(account.chesAddress, deriveAddress('attacker'));
  assert.equal(account.displayName, 'My name');
  const trusted = (await db.collection('ches_verified_accounts').doc('attacker').get()).data();
  assert.equal(trusted.walletAddress, account.walletAddress);
  const again = await ensureVerifiedAccount(db, decoded('attacker'));
  assert.equal(again.createdAt, account.createdAt);
});

test('wallet identities require server-issued signature claims that match the token UID', async () => {
  const db = makeFirestore();
  const uid = 'wallet:' + victim;
  await assert.rejects(ensureVerifiedAccount(db, decoded(uid)), /WALLET_LOGIN_REQUIRED/);
  await assert.rejects(ensureVerifiedAccount(db, { uid, provider: 'wallet', address: deriveAddress('other'), firebase: { sign_in_provider: 'custom' } }), /ADDRESS_MISMATCH/);
  const a = await ensureVerifiedAccount(db, { uid, provider: 'wallet', address: victim, firebase: { sign_in_provider: 'custom' } });
  assert.equal(a.walletAddress.toLowerCase(), victim);
  assert.equal(a.chesAddress, deriveAddress(uid));
  const linked = await ensureVerifiedAccount(db, decoded(uid));
  assert.equal(linked.walletAddress, a.walletAddress);
});

async function serve(app, fn) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try { await fn(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test('account API rejects missing/invalid credentials and ignores body identity fields', async () => {
  const db = makeFirestore(), app = express(); app.use(express.json());
  app.use(accountRouter({ db, firebaseAdmin: { auth: () => ({ verifyIdToken: async t => { if (t !== 'good') throw new Error('bad token'); return decoded('real-user'); } }) } }));
  await serve(app, async base => {
    for (const auth of ['', 'Bearer bad']) {
      const r = await fetch(base + '/account', { method: 'POST', headers: { Authorization: auth } }); assert.equal(r.status, 401);
    }
    const r = await fetch(base + '/account', { method: 'POST', headers: { Authorization: 'Bearer good', 'Content-Type': 'application/json' }, body: JSON.stringify({ uid: 'victim', walletAddress: victim, chesAddress: victim, provider: 'wallet' }) });
    assert.equal(r.status, 200); const a = (await r.json()).account;
    assert.equal(a.uid, 'real-user'); assert.equal(a.walletAddress, deriveAddress('real-user'));
    assert.equal((await db.collection('ches_accounts').doc('victim').get()).exists, false);
  });
});

test('entry/brand API derives address and paid status, deduplicates concurrent events, rejects unknown brands', async () => {
  const db = makeFirestore(), account = await ensureVerifiedAccount(db, decoded('real-user'));
  const app = express();app.use(express.json());
  app.use(activityRouter({ db, requireFirebaseUser: (req, res, next) => { if (req.headers.authorization !== 'Bearer good') return res.status(401).end(); req.identity = { uid: 'real-user', walletAddress: account.walletAddress.toLowerCase(), account }; next(); } }));
  await serve(app, async base => {
    const call = (path, body, auth = 'Bearer good') => fetch(base + path, { method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await call('/entry', { type: 'free' }, '')).status, 401);
    const entries = await Promise.all([call('/entry', { type: 'paid', address: victim }), call('/entry', { type: 'paid', address: victim })]);
    entries.forEach(r => assert.equal(r.status, 200));
    const stats = (await db.collection('sp_stats').doc('global').get()).data();
    assert.equal(stats.free_count, 1);assert.equal(stats.paid_count, undefined);assert.equal(stats.entrants, 1);
    assert.equal((await db.collection('sp_entrants').doc(victim).get()).exists, false);
    assert.equal((await call('/brand', { brand: 'invented' })).status, 400);
    await Promise.all([call('/brand', { brand: 'emu' }), call('/brand', { brand: 'emu' })]);
    assert.equal((await db.collection('sp_stats').doc('global').get()).data().emu_entrants, 1);
    assert.equal((await db.collection('sp_pass_logs').get()).size, 1);
  });
});

test('ranking badge grant is idempotent and only accepts server ranking types', async () => {
  const db = makeFirestore();
  await Promise.all([awardRankingBadge(db, 'good_post', victim), awardRankingBadge(db, 'good_post', victim)]);
  assert.deepEqual((await db.collection('rank_badges').doc(victim).get()).data().badges, ['王将']);
  await awardRankingBadge(db, 'invented', victim);
  assert.deepEqual((await db.collection('rank_badges').doc(victim).get()).data().badges, ['王将']);
});
