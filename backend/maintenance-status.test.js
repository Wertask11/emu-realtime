'use strict';
/* 11/8：Firestore の1日の上限に達したら、ログイン（/api/auth/account）は
   SERVICE_MAINTENANCE と再開の時刻を返し、/api/auth/status も「メンテナンス中」を返す。
   ほかの失敗では、今までどおり ACCOUNT_UNAVAILABLE（メンテナンス表示は出さない）。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { accountRouter, nextQuotaReset } = require('./verified-platform');

function failingDb(error) {
  return { collection: () => ({ doc: () => ({}) }), runTransaction: async () => { throw error; } };
}
const admin = { auth: () => ({ verifyIdToken: async () => ({ uid: 'u1', firebase: { sign_in_provider: 'google.com' } }) }) };

async function serve(db) {
  const app = express();
  app.use('/api/auth', accountRouter({ db, firebaseAdmin: admin }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const base = 'http://127.0.0.1:' + server.address().port + '/api/auth';
  return { base, close: () => new Promise(r => server.close(r)) };
}
const post = base => fetch(base + '/account', { method: 'POST', headers: { Authorization: 'Bearer x' } });

test('上限に達していないときの失敗は、メンテナンスにしない', async () => {
  const s = await serve(failingDb(new Error('deadline exceeded')));
  try {
    const r = await post(s.base);
    assert.equal(r.status, 503);
    assert.equal((await r.json()).error, 'ACCOUNT_UNAVAILABLE');
    const st = await (await fetch(s.base + '/status')).json();
    assert.equal(st.maintenance, false);
  } finally { await s.close(); }
});

test('RESOURCE_EXHAUSTED なら SERVICE_MAINTENANCE と再開の時刻を返し、status もメンテナンス中になる', async () => {
  const quota = Object.assign(new Error('8 RESOURCE_EXHAUSTED: Quota exceeded.'), { code: 8 });
  const s = await serve(failingDb(quota));
  try {
    const r = await post(s.base);
    assert.equal(r.status, 503);
    const body = await r.json();
    assert.equal(body.error, 'SERVICE_MAINTENANCE');
    assert.ok(body.retryAt > Date.now());
    const status = await fetch(s.base + '/status');
    assert.equal(status.headers.get('cache-control'), 'no-store');
    const st = await status.json();
    assert.equal(st.maintenance, true);
    assert.equal(st.retryAt, body.retryAt);
  } finally { await s.close(); }
});

test('再開の時刻は、米国太平洋時間の0時（11月は日本時間17時）', () => {
  const at = nextQuotaReset(Date.UTC(2026, 10, 8, 1, 44)); // 日本時間 11/8 10:44
  assert.equal(at, Date.UTC(2026, 10, 8, 8, 0));             // 日本時間 11/8 17:00
  const late = nextQuotaReset(Date.UTC(2026, 10, 8, 9, 0)); // 日本時間 11/8 18:00（もう戻った後）
  assert.equal(late, Date.UTC(2026, 10, 9, 8, 0));
});
