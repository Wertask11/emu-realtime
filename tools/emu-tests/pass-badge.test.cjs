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
  const i = html.indexOf('await markKnowledgePassHolders(rows, authorAddrs);');
  const j = html.indexOf("type:'emu-knowledge-posts', posts:rows", i);
  assert.ok(i > 0 && j > i, '送る前に印を付けていない');
});
