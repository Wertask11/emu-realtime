const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readHtml, build } = require('../year-goals-tests/extract.cjs');
const html = readHtml('frontend/public/index.html');

test('account creation uses the authenticated server route and deduplicates simultaneous requests', async () => {
  const user = { uid: 'real-user', getIdToken: async () => 'verified-token' };
  let calls = 0;
  const api = build(html, ['_emuEnsureServerAccount'], {
    window: { auth: { currentUser: user } }, AbortController, setTimeout, clearTimeout,
    fetch: async (url, options) => {
      calls++;
      assert.equal(url, 'https://emu-realtime.onrender.com/api/auth/account');
      assert.equal(options.headers.Authorization, 'Bearer verified-token');
      assert.deepEqual(JSON.parse(options.body), {});
      return { ok: true, json: async () => ({ account: { uid: user.uid, walletAddress: 'server-address' } }) };
    },
  }, 'const _emuAccountRequests = new Map();');
  const [a, b] = await Promise.all([api._emuEnsureServerAccount(user), api._emuEnsureServerAccount(user)]);
  assert.equal(calls, 1); assert.equal(a.walletAddress, 'server-address');assert.equal(a, b);
});

test('account API errors stop login and a changed Firebase user cannot apply the old response', async () => {
  const user = { uid: 'original', getIdToken: async () => 'token' };
  const window = { auth: { currentUser: user } };
  let changed = false;
  const api = build(html, ['_emuEnsureServerAccount'], {
    window, AbortController, setTimeout, clearTimeout,
    fetch: async () => {
      if (changed) window.auth.currentUser = { uid: 'other' };
      return { ok: changed, json: async () => changed ? { account: { uid: 'original' } } : { error: 'ACCOUNT_UNAVAILABLE' } };
    },
  }, 'const _emuAccountRequests = new Map();');
  await assert.rejects(api._emuEnsureServerAccount(user), /ACCOUNT_UNAVAILABLE/);
  changed = true;
  await assert.rejects(api._emuEnsureServerAccount(user), /ACCOUNT_CHANGED/);
});

test('tracking sends the Firebase token and never lets the browser choose the credited address', async () => {
  let payload;
  const api = build(html, ['spTrack', '_emuTrackActivity'], {
    window: { auth: { currentUser: { getIdToken: async () => 'token' } } },
    fetch: async (url, options) => {
      assert.equal(url, 'https://emu-realtime.onrender.com/api/activity/entry');
      assert.equal(options.headers.Authorization, 'Bearer token');
      payload = JSON.parse(options.body);
      return { ok: true };
    },
  });
  await api.spTrack('paid', 'another-wallet');
  assert.deepEqual(payload, { type: 'paid' });
});
