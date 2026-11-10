'use strict';
/* 冷蔵庫くんの「残高教えて」（11/10）。いまの EMUER（v2）で答え、種類ごとに分けて出す。
   前は旧コントラクトと旧台帳の「150（8）」を出していて、左下の EMUER（v2）と食い違っていた。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { grab } = require('../year-goals-tests/extract.cjs');
const html = fs.readFileSync(path.join(__dirname, '../../frontend/public/index.html'), 'utf8');

function run({ v2 = 1841, legacy = 150, app = 8, rewards = [{ amount: '2' }, { amount: '1' }], rpcFails = false } = {}) {
  const shown = [];
  const ctx = {
    window: { connectedAccount: '0xabc', ethereum: {}, emuerV2ConfigOnce: async () => ({ enabled: true, contract: '0xV2' }) },
    localStorage: { getItem: () => '' },
    ethers: { utils: { formatUnits: (v) => String(v) }, providers: { Web3Provider: function () {}, StaticJsonRpcProvider: function () {} },
      Contract: function (addr) { this.balanceOf = async () => { if (rpcFails) throw Error('rpc'); return addr === '0xV2' ? v2 : 0; }; } },
    _EMU_POLYGON_RPCS: [],
    fetch: async () => ({ ok: true, json: async () => ({ rewards }) }),
    emuAuthHeaders: async () => ({}),
    _emuOffchainBalance: async () => app, _emuIsChesWallet: () => false, _emuOnchainBalance: async () => legacy,
    _spReizoShowTyping: () => ({ remove() {} }), _spReizoAppendMsg: (t) => shown.push(t)
  };
  ctx.window.ethers = ctx.ethers;
  vm.createContext(ctx);
  vm.runInContext(grab(html, '_reizoTokenBalance') + '\n' + grab(html, '_reizoSkillEmuer') + '\nthis.go=_reizoSkillEmuer;', ctx);
  return ctx.go().then(() => shown.join('\n'));
}

test('実EMUER（v2）・受け取り前・アプリ内・旧EMUER を分けて答える', async () => {
  const text = await run();
  assert.match(text, /実EMUER（ウォレット）：1,841 EMUER/);
  assert.match(text, /受け取り前の報酬：3 EMUER/);
  assert.match(text, /アプリ内のEMUER：8 EMUER/);
  assert.match(text, /旧EMUER（前のしくみの分）：150 EMUER/);
  assert.doesNotMatch(text, /150（8）/, '旧コントラクトと旧台帳を「いまの残高」として出さない');
});

test('読めないときは、読めなかったと言う（0 と言わない）', async () => {
  const text = await run({ rpcFails: true, rewards: [], legacy: 0 });
  assert.match(text, /実EMUER（ウォレット）：いまは読み込めなかった/);
  assert.doesNotMatch(text, /受け取り前の報酬/);
  assert.doesNotMatch(text, /旧EMUER/);
});

test('「実EMUERは？」「EMUERいくら？」でも数字で答える。「EMUERってなに？」は説明に回す', () => {
  const i = html.indexOf('const REIZO_SKILLS'), j = html.indexOf('];', i);
  const ctx = {}; vm.runInNewContext(html.slice(i, j + 2).replace('const REIZO_SKILLS', 'this.R') + ';', ctx);
  const t = ctx.R.find((s) => s.id === 'emuer').test;
  for (const q of ['実EMUERは？', 'EMUERいくら？', '残高はいくら']) assert.equal(t(q), true, q);
  for (const q of ['EMUERってなに？', '実EMUERはどうやって受け取る？', 'EMUERで何ができる？']) assert.equal(t(q), false, q);
});
