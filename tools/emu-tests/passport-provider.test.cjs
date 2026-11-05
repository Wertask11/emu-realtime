'use strict';
/* パスポートの「入り方」。LINE で入った人が「不明」と出ていた（11/5）。
   LINE は custom token で入るので、記録の provider には "custom" が入っていた。uid（line:…）で見分ける。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readHtml, build } = require('../year-goals-tests/extract.cjs');

const { _sppProviderLabel: label } = build(readHtml('frontend/public/index.html'), ['_sppProviderLabel'], {});

test('LINE の uid なら、記録が custom でも空でも LINE と出す', () => {
  assert.equal(label('custom', 'line:Uabc'), 'LINE');
  assert.equal(label('', 'line:Uabc'), 'LINE');
  assert.equal(label('line', 'line:Uabc'), 'LINE');
});

test('ほかの入り方はこれまでどおり', () => {
  assert.equal(label('google.com', 'abc'), 'Google');
  assert.equal(label('password', 'abc'), 'メール');
  assert.equal(label('custom', 'wallet:0xabc'), 'ウォレット');
  assert.equal(label('', 'abc'), '不明');
});
