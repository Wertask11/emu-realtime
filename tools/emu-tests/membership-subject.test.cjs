'use strict';
/* 11/1 からの利用回数・下書きの数は、パスポートID（SP-…）ごとに数える（firestore.rules の membershipCounterId）。
   番号はサーバー（/api/billing/status）から受け取る。受け取れないまま書くと、ふつうのIDの記録を作りにいって
   ルールに弾かれ、投稿ごと「権限がない」で失敗していた（11/3 点検 3）。
   今月分を受け取れていなければ1回だけ聞き直し、それでもだめなら分かる言葉で止める。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readHtml, build } = require('../year-goals-tests/extract.cjs');

const INDEX = readHtml('frontend/public/index.html');
const NOV = Date.parse('2026-11-03T12:00:00+09:00');
const EPOCH = '2026-11';

function make({ now = NOV, epoch = null, answers = [] } = {}) {
  const win = { emuEntitlementEpoch: epoch };
  const calls = [];
  const emuEnsureEntitlement = async (force) => {
    calls.push(force);
    const next = answers.shift();
    if (next) { win.emuEntitlementEpoch = EPOCH; win.emuEntitlementSchoolParkId = next; }
    return 'light';
  };
  const api = build(INDEX, ['emuEnsureMembershipSubject'],
    { window: win, emuEnsureEntitlement, Date: class extends Date { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return now; } } });
  return { api, win, calls };
}

test('今月分のパスポートIDを受け取れていれば、聞き直さずにそのまま進む', async () => {
  const t = make({ epoch: EPOCH });
  await t.api.emuEnsureMembershipSubject();
  assert.deepEqual(t.calls, []);
});

test('受け取れていなければ1回聞き直し、受け取れたら進む', async () => {
  const t = make({ answers: ['SP-AAAA-BBBB-CCCC-DDD1'] });
  await t.api.emuEnsureMembershipSubject();
  assert.deepEqual(t.calls, [true]);
  assert.equal(t.win.emuEntitlementSchoolParkId, 'SP-AAAA-BBBB-CCCC-DDD1');
});

test('聞き直してもだめなら、ふつうのIDで書きにいかず、分かる言葉で止める', async () => {
  const t = make({ answers: [] });
  await assert.rejects(t.api.emuEnsureMembershipSubject(), e => /サーバーにつながらず、利用回数を確かめられませんでした/.test(e.message) && e.emuUserMessage === true);
  assert.deepEqual(t.calls, [true]);
});

test('11/1 より前は、これまでどおり確かめない', async () => {
  const t = make({ now: Date.parse('2026-10-31T12:00:00+09:00') });
  await t.api.emuEnsureMembershipSubject();
  assert.deepEqual(t.calls, []);
});

test('投稿・募集・回答（回数）と、下書きを作る・消すときに、書く前に確かめている', () => {
  const add = INDEX.slice(INDEX.indexOf('async function _emuAddUsage(batch, kind) {'));
  assert.ok(add.slice(0, 200).includes('await emuEnsureMembershipSubject();'));
  // 11/7：Lab の下書きはサーバーが数える。前の置き場所を消す前には、今までどおり確かめる
  const del = INDEX.slice(INDEX.indexOf('async function deleteKnowledgeDraft(account, draftId, source) {'));
  assert.ok(del.slice(0, del.indexOf('batch.delete(')).includes('await emuEnsureMembershipSubject();'));
  const create = INDEX.slice(INDEX.indexOf('async function createKnowledgeDraft(account, payload) {'));
  const before = create.slice(0, create.indexOf("batch.set(_emuCountsRef(), { drafts: window.fbLib.increment(1)"));
  assert.ok(before.includes('await emuEnsureMembershipSubject();'));
});
