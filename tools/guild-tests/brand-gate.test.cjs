/* 準備中のブランドに、誰が入れるかの試験。

   Camellia だけ「運営を含めて準備中」と決め打ちしてあった。
   そのため運営自身が中身を見られなかった。ほかのブランドと
   同じ規則（運営は入れる・それ以外は準備中）にそろえた。

   ここが緩むと、公開前の中身が誰にでも見えてしまう。
   ここが厳しすぎると、運営が自分のものを確かめられない。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(
  path.join(__dirname, '../../frontend/public/index.html'), 'utf8');

const maint = html.slice(html.indexOf('const BRAND_MAINTENANCE = {'),
                         html.indexOf('const BRAND_LABELS'));
const fn = html.slice(html.indexOf('function isBrandUnderMaintenance(brand) {'),
                      html.indexOf('/* 入れないことを、押す前に分かるようにする'));
assert.ok(maint && fn, '門の定義が見つかりません');

/* owner … 運営かどうか。 sp … SchoolPark に入れるか。 */
function gate(owner, sp) {
  const ctx = vm.createContext({
    _isBrandOwner: () => owner,
    _spAccess: sp === undefined ? null : { allowed: sp }
  });
  vm.runInContext(maint + '\n' + fn, ctx);
  return (brand) => ctx.isBrandUnderMaintenance(brand);
}

const OWNER = gate(true, true);
const GUEST = gate(false, true);

/* ───────── 運営 ───────── */

test('運営は Camellia に入れる', () => {
  assert.equal(OWNER('camellia'), false, '運営が自分のものを見られない');
});

test('運営は Heartoo にも入れる（前からの決まり）', () => {
  assert.equal(OWNER('heartoo'), false);
});

/* ───────── 運営でない人 ───────── */

test('運営でない人には、Camellia は準備中', () => {
  assert.equal(GUEST('camellia'), true, '公開前の中身が誰にでも見えてしまう');
});

test('運営でない人には、Heartoo も準備中', () => {
  assert.equal(GUEST('heartoo'), true);
});

/* ───────── Emu は誰でも ───────── */

test('Emu は誰でも入れる', () => {
  assert.equal(OWNER('emu'), false);
  assert.equal(GUEST('emu'), false);
});

/* ───────── SchoolPark は別の決まり ───────── */

test('SchoolPark は入場の可否そのもので決まる', () => {
  assert.equal(gate(false, true)('schoolpark'), false, '入れる人は入れる');
  assert.equal(gate(false, false)('schoolpark'), true);
  /* 運営でも、入場の答えが「不可」なら止まる。
     運営の抜け道は spEnsureSchoolParkAccess の側にある。 */
  assert.equal(gate(true, false)('schoolpark'), true);
});

test('入場の答えがまだ無いときは、止める', () => {
  const ctx = vm.createContext({ _isBrandOwner: () => true, _spAccess: null });
  vm.runInContext(maint + '\n' + fn, ctx);
  assert.equal(ctx.isBrandUnderMaintenance('schoolpark'), true,
    '答えを待たずに通してはいけない');
});

/* ───────── 決め打ちが戻っていないこと ───────── */

test('Camellia だけを名指しで閉じる書き方が残っていない', () => {
  assert.doesNotMatch(fn, /brand === 'camellia'\s*\)\s*return true/,
    '運営も入れない決め打ちが戻っています');
});

test('準備中の表は、Camellia を準備中のままにしている', () => {
  /* 運営以外に見せないのはこの表の役目。false にすると全員に開く。 */
  assert.match(maint, /camellia:\s*true/);
  assert.match(maint, /heartoo:\s*true/);
  assert.match(maint, /emu:\s*false/);
});

test('運営かどうかは、パスポートを読んだあとに塗り直している', () => {
  /* 運営かどうかは開いた時点では分からない。塗り直しが無いと、
     運営の画面にも「準備中」の灰色が残る。 */
  const paint = html.indexOf('try { paintBrandMaintenance(); } catch (e) {}');
  assert.ok(paint > 0, 'パスポートを読んだあとの塗り直しが無い');
});
