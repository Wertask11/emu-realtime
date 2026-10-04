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

const root = path.join(__dirname, '../..');
const html = fs.readFileSync(
  path.join(root, 'frontend/public/index.html'), 'utf8');

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

test('Camellia は、誰でも入れる（2026-10-04 に開いた）', () => {
  /* SchoolPark の開幕に合わせて開けた。入ってからの年齢と同意の
     確認（camellia-gate.js）は、これまでどおり効く。 */
  assert.equal(GUEST('camellia'), false, '開いたはずなのに準備中のままです');
  assert.equal(OWNER('camellia'), false);
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

test('準備中の表と、止める仕組みがそろっている', () => {
  /* 画面の側（この表）と、ページの側（maintenance-guard.js）は
     必ず同じにすること。片方だけ開けると、押せるのに開いた先が
     「準備中」になる。2026-10-04、そろえて開けた。 */
  assert.match(maint, /camellia:\s*false/);
  assert.match(maint, /emu:\s*false/);
  /* Heartoo は外のサイト。こちらでは開けないので止めたまま。 */
  assert.match(maint, /heartoo:\s*true/);

  const guard = fs.readFileSync(path.join(root, 'frontend/public/maintenance-guard.js'), 'utf8');
  assert.match(guard, /var MAINTENANCE = false;/, 'ページの側がまだ止めています');
});

test('止める仕組みは、消さずに残してある', () => {
  /* もう一度止めるときに、各ページへ付け直さなくて済むようにする。 */
  ['frontend/public/camellia.html', 'frontend/public/camellia-app.html',
   'frontend/public/schoolpark/tutorial.html',
   'frontend/public/schoolpark/south-elevator.html',
   'frontend/public/schoolpark/east-shopping.html'].forEach(f => {
    const t = fs.readFileSync(path.join(root, f), 'utf8');
    assert.ok(t.indexOf('maintenance-guard.js') > 0, f + ' から止める仕組みが消えています');
  });
});

test('運営かどうかは、パスポートを読んだあとに塗り直している', () => {
  /* 運営かどうかは開いた時点では分からない。塗り直しが無いと、
     運営の画面にも「準備中」の灰色が残る。 */
  const paint = html.indexOf('try { paintBrandMaintenance(); } catch (e) {}');
  assert.ok(paint > 0, 'パスポートを読んだあとの塗り直しが無い');
});

/* ───────── SchoolPark の左上の切り替え（dao.html） ─────────

   門は index.html に1つだけ置いてあるのに、SchoolPark の
   サイドバーだけが Camellia を名指しで閉じていた。
   そのため Emu 側では開いているのに、SchoolPark のタブからは
   「Camellia（準備中）」と出て、押しても何も起きなかった。
   判定は親（index.html）の1か所に戻した。 */
const dao = fs.readFileSync(
  path.join(root, 'frontend/public/schoolpark/dao.html'), 'utf8');

const brandClosedSrc = dao.slice(dao.indexOf('  brandClosed(id){'),
                                 dao.indexOf('  goBrand(id){'));
assert.ok(brandClosedSrc, 'dao.html の brandClosed が見つかりません');

/* parentClosed … 親（index.html）が「準備中」と答えるかどうか。 */
function daoGate(parentClosed) {
  const ctx = vm.createContext({
    window: { parent: { isBrandUnderMaintenance: (id) => parentClosed[id] } }
  });
  vm.runInContext('globalThis.__o = { ' + brandClosedSrc + ' };', ctx);
  return (id) => ctx.__o.brandClosed(id);
}

test('SchoolPark の切り替えでも、Camellia は開いている', () => {
  const closed = daoGate({ camellia: false, emu: false, heartoo: true });
  assert.equal(closed('camellia'), false, 'SchoolPark 側だけ準備中のままです');
  assert.equal(closed('emu'), false);
});

test('SchoolPark の切り替えは、親の答えにそのまま従う', () => {
  /* もう一度止めるときは index.html の BRAND_MAINTENANCE だけを
     直せば、ここも一緒に閉まること。 */
  const closed = daoGate({ camellia: true, emu: false, heartoo: true });
  assert.equal(closed('camellia'), true, '親が閉じても開いたままです');
});

test('いま居る場所（SchoolPark）は、準備中にしない', () => {
  const closed = daoGate({ schoolpark: true });
  assert.equal(closed('schoolpark'), false);
});

test('dao.html に Camellia だけを名指しで閉じる書き方が残っていない', () => {
  assert.doesNotMatch(brandClosedSrc, /id === 'camellia'\s*\)\s*return true/,
    '名指しの決め打ちが戻っています');
});

test('「（準備中）」の札は、閉じているときだけ付く', () => {
  const label = dao.slice(dao.indexOf("brands: [['camellia'"),
                          dao.indexOf('sidebarButtonIcon:'));
  assert.match(label, /soon \? label \+ '（準備中）' : label/,
    '札の付け方が変わっています');
  /* 札の判定は brandClosed から来ること（別の決め打ちに差し替わっていないか）。 */
  assert.match(label, /const soon = this\.brandClosed\(id\);/);
});
