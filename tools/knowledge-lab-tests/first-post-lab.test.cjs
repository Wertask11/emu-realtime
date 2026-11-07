'use strict';
/* 初投稿キャンペーン（11/7）：Knowledge Lab で初めて公開した投稿も、通常投稿と同じく 100 EMUER の対象になる。
   画面（lab.js → integration.js）は、公開できたら通常投稿と同じ知らせ（emu-post-published）を出す。
   サーバーの判定（本人の投稿か・初めてか・期間内か・二重でないか）は変えていない。隔離エミュレーターだけを使う。 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createFixture } = require('./fixture.cjs');
const root = path.join(__dirname, '../..');
let f;
const actor = (role) => ({ ...f.users[role], walletAddress: f.users[role].account.walletAddress.toLowerCase(), owner: role === 'owner' });
const START = Date.parse('2026-10-29T00:00:00+09:00'), END = Date.parse('2026-11-29T00:00:00+09:00');
const inCampaign = Date.now() >= START && Date.now() < END;

before(async () => {
  f = await createFixture();
  const express = require('../../backend/node_modules/express');
  f.app.use('/test-rewards', express.json(), require('../../backend/emuer-v2/router').createEmuerV2Router({
    db: f.db, identity: f.identity, entitlement: f.entitlement, requireFirebaseUser: f.middleware.requireFirebaseUser,
    requireOwnAddress: (req, res, next) => next(),
    env: { EMUER_V2_ENABLED: 'true', EMUER_V2_LAUNCH_HOLD: 'false' },
  }).router);
});
after(async () => { await f?.close(); });

async function claim(role, postId) {
  const r = await fetch(f.base + '/test-rewards/activity/first-post', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + f.users[role].token },
    body: JSON.stringify({ postId, address: actor(role).walletAddress }),
  });
  return { status: r.status, body: await r.json() };
}

test('Knowledge Lab での初めての公開は、初投稿キャンペーンの対象になる。二度目は二重に付かない', { skip: !inCampaign && 'キャンペーン期間外' }, async () => {
  const alice = actor('alice');
  const saved = await f.api.service.savePost(alice, { key: 'first-lab', title: 'はじめての経験知', body: 'Knowledge Lab から初めて公開した経験です。', visibility: 'public', facets: { field: ['field-education'] } });
  const first = await claim('alice', saved.id);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.ok(first.body.rewardId);
  const again = await claim('alice', saved.id);
  assert.equal(again.status, 200);
  assert.equal(again.body.alreadyRecorded, true);
  // そのあと通常の形で投稿しても、二重には付かない
  await f.db.collection('posts').doc('later-normal').set({ title: '次の投稿', body: '通常の投稿', address: alice.walletAddress, createdAt: new Date(), goodCount: 0, changeCount: 0 });
  const later = await claim('alice', 'later-normal');
  assert.equal(later.body.alreadyRecorded, true);
  assert.equal((await f.db.collection('emuer_v2_rewards').where('kind', '==', 'first-post').get()).size, 1);
});

test('下書きのまま（公開していない）Lab の投稿は、対象にならない', { skip: !inCampaign && 'キャンペーン期間外' }, async () => {
  const bob = actor('bob');
  const draft = await f.api.service.savePost(bob, { key: 'draft-lab', title: '下書き', body: 'まだ公開していない経験です。', visibility: 'draft', facets: {} });
  const r = await claim('bob', draft.id);
  assert.equal(r.status, 404);
  assert.equal(r.body.error, 'POST_NOT_FOUND');
});

test('画面：Lab で初めて公開したら、親の画面が通常投稿と同じ知らせを出す（本人の名義で）。ほかの窓からの偽の知らせは無視する', async () => {
  const lab = fs.readFileSync(path.join(root, 'frontend/public/knowledge-lab/lab.js'), 'utf8');
  assert.match(lab, /action: "published", postId: result\.id/);
  const src = fs.readFileSync(path.join(root, 'frontend/public/knowledge-lab/integration.js'), 'utf8');
  const events = [], handlers = [];
  const labWindow = {};
  const frame = { contentWindow: labWindow, getAttribute: () => '/knowledge-lab.html?view=library' };
  const window = {
    addEventListener: (type, fn) => { if (type === 'message') handlers.push(fn); },
    dispatchEvent: (e) => events.push(e),
    _emuAddress: () => '0xabc0000000000000000000000000000000000001',
    auth: { currentUser: null },
  };
  const context = {
    window, location: new URL('https://emu.example/?x=1'), URLSearchParams, URL,
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o.detail; } },
    document: { getElementById: (id) => (id === 'spRoomFrame' ? frame : null), querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, readyState: 'complete', documentElement: { classList: { contains: () => false } } },
    console, setTimeout, clearTimeout, fetch: async () => ({ ok: false, json: async () => ({}) }), history: { replaceState() {} },
  };
  vm.createContext(context);
  vm.runInContext(src, context);
  assert.ok(handlers.length, '受け口がない');
  const send = (source, origin, data) => Promise.all(handlers.map((h) => h({ source, origin, data })));
  await send({}, 'https://emu.example', { type: 'emu-lab-action', action: 'published', postId: 'kl-forged' });
  await send(labWindow, 'https://evil.example', { type: 'emu-lab-action', action: 'published', postId: 'kl-forged2' });
  await send(labWindow, 'https://emu.example', { type: 'emu-lab-action', action: 'published', postId: 'bad id!' });
  assert.equal(events.length, 0, '偽の知らせで動いた');
  await send(labWindow, 'https://emu.example', { type: 'emu-lab-action', action: 'published', postId: 'kl-abc123' });
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'emu-post-published');
  assert.deepEqual({ ...events[0].detail }, { postId: 'kl-abc123', address: '0xabc0000000000000000000000000000000000001', surface: 'lab' });
});
