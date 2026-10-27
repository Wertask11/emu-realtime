'use strict';
/*
 * 投稿の「有料パス」の印。
 *
 * 2026-10-24、公式パスを持っている人の投稿が「無料利用者」と出ていた。
 * 印は投稿した瞬間の端末の判定（window.hasPaidNFT）だけで決まっていて、
 * LINE・Google で入るとログインのたびに false に戻っていたため。
 *   ・投稿するとき：サーバーが確かめた Passport の公式パス（_spIdentity.hasOfficialPass）も見る
 *   ・一覧を出すとき：書き手が paid_users に載っていれば有料パスとして出す
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { readHtml, grab } = require('../year-goals-tests/extract.cjs');
const fs = require('node:fs');
const path = require('node:path');

const html = readHtml('frontend/public/index.html');

function userTypeWith(win) {
  const src = grab(html, 'getCurrentUserType');
  return new Function('window', src + '\nreturn getCurrentUserType();')(win);
}

test('ウォレットで公式パスを確かめた人は paid', () => {
  assert.equal(userTypeWith({ hasPaidNFT: true }), 'paid');
});

test('LINE・Google で入っても、Passport に公式パスがあれば paid', () => {
  assert.equal(userTypeWith({ hasPaidNFT: false, _spIdentity: { hasOfficialPass: true } }), 'paid');
});

test('どちらも無ければ free', () => {
  assert.equal(userTypeWith({ hasPaidNFT: false, _spIdentity: { hasOfficialPass: false } }), 'free');
  assert.equal(userTypeWith({}), 'free');
});

test('知識を読むの一覧は、書き手が paid_users に載っていれば有料パスとして送る', () => {
  assert.match(html, /function knowledgePassOf\(addr\)/);
  assert.match(html, /window\.fbLib\.doc\(window\.db, 'paid_users', id\)/);
  const i = html.indexOf('await Promise.all([markKnowledgePassHolders(rows, authorAddrs), markKnowledgePlans(rows, authorAddrs)]);');
  const j = html.indexOf("type:'emu-knowledge-posts', posts:rows", i);
  assert.ok(i > 0 && j > i, '送る前に印を付けていない');
});

/* 2026-10-24 オーナー決定：「無料利用者」は出さない。公式パスとプラン名（Emu for SchoolPark light /
   plus / pro）を、あるものだけ出す（両方あれば両方）。 */
const knowledge = fs.readFileSync(path.join(__dirname, '../../frontend/public/knowledge.html'), 'utf8');
const i18n = fs.readFileSync(path.join(__dirname, '../../frontend/public/emu-i18n-pages.js'), 'utf8');
test('「無料利用者」はどこにも出さない', () => {
  assert.ok(!/k\.freeUser'\)/.test(knowledge), '知識を読むのカードが「無料利用者」を出している');
  assert.ok(!/>無料利用者<|>有料利用者</.test(html), '投稿の印に「無料利用者」「有料利用者」が残っている');
  assert.ok(html.indexOf('"有料パス" : "無料利用者"') < 0);
  assert.match(i18n, /"k\.paidPass": "公式パス"/);
});
test('公式パスとプラン名は、あるものだけ出す（両方あれば両方）', () => {
  const card = knowledge.slice(knowledge.indexOf('function card(p)'), knowledge.indexOf('function card(p)') + 1400);
  assert.match(card, /\['paid','paidNFT'\]\.includes\(p\.userType\)\?`<span class="access">/);
  assert.match(card, /\{light:'Emu for SchoolPark light',plus:'Emu for SchoolPark plus',pro:'Emu for SchoolPark pro'\}\)\[p\.authorPlan\]\?`<span class="access plan">/);
  /* プラン名はサーバーが契約と付与だけで返す。公式パスの plus 相当は入れない */
  assert.match(html, /'https:\/\/emu-realtime\.onrender\.com\/api\/billing\/public-plans'/);
  assert.match(html, /function emuPlanLabel\(plan\)/);
});
