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
  }, 'const _emuAccountRequests = new Map(); const _emuAccountVerified = new Map(); const _emuAccountDownAt = new Map();');
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
  }, 'const _emuAccountRequests = new Map(); const _emuAccountVerified = new Map(); const _emuAccountDownAt = new Map();');
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

test('サーバーが眠っていて返事が無いときは、1回だけ長めに待ってやり直し、確かめた uid は聞き直さない', async () => {
  const user = { uid: 'u1', getIdToken: async () => 'token' };
  const waits = [];
  let calls = 0;
  const api = build(html, ['_emuEnsureServerAccount'], {
    window: { auth: { currentUser: user } }, AbortController, clearTimeout, console: { warn() {} },
    setTimeout: (fn, ms) => { waits.push(ms); return 0; },
    fetch: async () => {
      calls++;
      if (calls === 1) { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
      return { ok: true, json: async () => ({ account: { uid: 'u1', walletAddress: '0xabc' } }) };
    },
  }, 'const _emuAccountRequests = new Map(); const _emuAccountVerified = new Map(); const _emuAccountDownAt = new Map();');
  const a = await api._emuEnsureServerAccount(user);
  assert.equal(a.walletAddress, '0xabc');
  assert.deepEqual(waits, [8000, 30000], '8秒で打ち切ったら、30秒待ってやり直す');
  await api._emuEnsureServerAccount(user);
  assert.equal(calls, 2, '確かめ済みの uid は聞き直さない');
});

test('長めに待っても返事が無かったら、すぐ後にまた待たせない', async () => {
  const user = { uid: 'u2', getIdToken: async () => 'token' };
  let calls = 0;
  const api = build(html, ['_emuEnsureServerAccount'], {
    window: { auth: { currentUser: user } }, AbortController, clearTimeout, console: { warn() {} }, Date,
    setTimeout: () => 0,
    fetch: async () => { calls++; const e = new Error('aborted'); e.name = 'AbortError'; throw e; },
  }, 'const _emuAccountRequests = new Map(); const _emuAccountVerified = new Map(); const _emuAccountDownAt = new Map();');
  await assert.rejects(api._emuEnsureServerAccount(user));
  await assert.rejects(api._emuEnsureServerAccount(user), /ACCOUNT_SERVER_UNREACHABLE/);
  assert.equal(calls, 2);
});

test('ログイン後の着地：入口の画面は行き先が決まってからしまう（待つあいだ真っ白にしない）', () => {
  const land = html.slice(html.indexOf('async function chesLandAfterLogin() {'));
  const access = land.indexOf('const access = await spEnsureSchoolParkAccess(true);');
  const tidy = land.indexOf('chesTidyEntryScreens();');
  assert.ok(access > 0 && tidy > access, '行き先を決める前に入口の画面をしまっている');
  const me = html.slice(html.indexOf('async function emuMyIdentity() {'));
  assert.ok(me.indexOf('if (_emuIdentity && _emuIdentity.uid === user.uid) return _emuIdentity;') < me.indexOf('await _emuEnsureServerAccount(user);'),
    '確かめ済みなのにサーバーへ聞き直している');
  const ensure = html.slice(html.indexOf('async function spEnsureSchoolParkAccess(force) {'));
  assert.ok(ensure.indexOf('AbortSignal.timeout(20000)') > 0, '公開状態の確認を上限なしで待っている');
});

test('ログイン後の着地が12秒で終わらなくても、覆いを外して真っ白にしない（もう少し待つ）', () => {
  const seg = html.slice(html.indexOf('const landing = Promise.resolve(chesLandAfterLogin()).catch(function () {});'));
  assert.ok(seg.indexOf('landed = await _spSoon(landing, 12000);') > 0);
  const wait = seg.indexOf('try { await _spSoon(landing, 60000); } catch (e) {}');
  const hide = seg.indexOf('_hideSpLoadingOverlay();');
  assert.ok(wait > 0 && wait < hide, '覆いを外す前に、着地を待っていない');
  assert.ok(seg.indexOf('_spLoadingHardStop = setTimeout(_cancelSpLoadingOverlay, 65000);') > 0);
});
