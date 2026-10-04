/* 準備中のブランドに、誰が入れるかの試験と、
   Camellia を外したあとに残っているもの・消えているものの試験。

   2026-10-04、利用者側の Camellia（/camellia/control-user.html と
   その一式）を消した。画面を作り直すことになったため。

   消していないもの:
     管理画面      /camellia/control-admin.html ほか9本
     管理用の窓口  /api/billing/admin/camellia*
     入った方の記録 camellia_users ／ camellia_community ／ camellia_reports
     権限のルール   firestore.rules の Camellia の章

   ここが緩むと、消したはずの画面への入口が残る。
   ここが厳しすぎると、残すと決めた管理画面まで巻き添えで消える。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '../..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const exists = (f) => fs.existsSync(path.join(root, f));

const html = read('frontend/public/index.html');
const dao = read('frontend/public/schoolpark/dao.html');

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

/* ───────── 残したブランドの門（変えていない） ───────── */

test('運営は Heartoo に入れる', () => {
  assert.equal(OWNER('heartoo'), false);
});

test('運営でない人には、Heartoo は準備中', () => {
  assert.equal(GUEST('heartoo'), true);
});

test('Emu は誰でも入れる', () => {
  assert.equal(OWNER('emu'), false);
  assert.equal(GUEST('emu'), false);
});

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

test('止める仕組みは、消さずに残してある', () => {
  /* また止めたくなったときに、各ページへ付け直さなくて済むようにする。 */
  ['frontend/public/camellia.html', 'frontend/public/camellia-app.html',
   'frontend/public/schoolpark/tutorial.html',
   'frontend/public/schoolpark/south-elevator.html',
   'frontend/public/schoolpark/east-shopping.html'].forEach(f => {
    assert.ok(read(f).indexOf('maintenance-guard.js') > 0,
      f + ' から止める仕組みが消えています');
  });
  assert.match(read('frontend/public/maintenance-guard.js'),
    /var MAINTENANCE = false;/, 'ページの側がまだ止めています');
});

test('運営かどうかは、パスポートを読んだあとに塗り直している', () => {
  /* 運営かどうかは開いた時点では分からない。塗り直しが無いと、
     運営の画面にも「準備中」の灰色が残る。 */
  assert.ok(html.indexOf('try { paintBrandMaintenance(); } catch (e) {}') > 0,
    'パスポートを読んだあとの塗り直しが無い');
});

/* ───────── Camellia は切り替えに出さない ───────── */

test('行き先の表に Camellia が無い', () => {
  const pages = html.slice(html.indexOf('const CHES_BRAND_PAGES = {'),
                           html.indexOf('/* 外部ブランドページをアプリ内フレームで開く'));
  assert.ok(pages, '行き先の表が見つかりません');
  assert.doesNotMatch(pages, /camellia:/, '行き先が戻っています');
  assert.match(pages, /heartoo:/, 'Heartoo まで消えています');
});

test('準備中の表と名前の表に Camellia が無い', () => {
  assert.doesNotMatch(maint, /camellia:/);
  const labels = html.slice(html.indexOf('const BRAND_LABELS = {'));
  assert.doesNotMatch(labels.slice(0, 200), /camellia:/);
});

test('Emu の3つの入口から Camellia の行が消えている', () => {
  /* サイドバー・スマホのメニュー・振り分け。
     どれか1つ残ると、そこからだけ入れてしまう。 */
  assert.doesNotMatch(html, /emuBrandGo\('camellia'\)/, 'サイドバーに残っています');
  assert.doesNotMatch(html, /smmGo\('camellia'\)/, 'スマホのメニューに残っています');
  assert.doesNotMatch(html, /case 'camellia':/, '振り分けに残っています');
});

test('SchoolPark の左上の切り替えに Camellia が無い', () => {
  const brands = dao.slice(dao.indexOf('brands: ['), dao.indexOf('sidebarButtonIcon:'));
  assert.ok(brands, '切り替えの並びが見つかりません');
  assert.doesNotMatch(brands, /'camellia'/, '並びに残っています');
  assert.match(brands, /'emu'/);
  assert.match(brands, /'schoolpark'/);
});

test('dao.html に Camellia だけを名指しで閉じる書き方が残っていない', () => {
  const b = dao.slice(dao.indexOf('  brandClosed(id){'), dao.indexOf('  goBrand(id){'));
  assert.ok(b, 'brandClosed が見つかりません');
  assert.doesNotMatch(b, /id === 'camellia'/, '名指しの決め打ちが戻っています');
});

/* ───────── 消した画面が、どこからも呼ばれていない ───────── */

const DELETED = [
  'control-user.html', 'control-enhance.js', 'managed-settings.js',
  'home-calendar.js', 'restore-location.js', 'user-db-sync.js',
  'camellia-auth.js', 'camellia-gate.js', 'camellia-sidebar.js',
  'camellia-store.js', 'camellia-nudge.js', 'camellia-community.js',
  'camellia-home.js', 'camellia-reply.js', 'camellia-model.js',
  'camellia-composer.js'
];

test('消した16本が、本当に消えている', () => {
  DELETED.forEach(f => {
    assert.equal(exists('frontend/public/camellia/' + f), false,
      f + ' が残っています');
  });
  assert.equal(exists('backend/camellia.js'), false,
    'backend/camellia.js が残っています');
});

test('消した画面への行き先が、どこにも残っていない', () => {
  /* 説明のコメントに名前が出るのはよい。行き先として書いてあるのが困る。
     引用符の中に入っているものだけを見る（src= / href= / url: ）。 */
  const asTarget = /["'][^"'\n]*\/camellia\/control-user\.html[^"'\n]*["']/;
  [['index.html', html], ['dao.html', dao],
   ['membership-admin.html', read('frontend/public/membership-admin.html')]]
    .forEach(([name, t]) => {
      assert.doesNotMatch(t, asTarget, name + ' に消した画面への行き先が残っています');
    });
});

test('管理画面が、消したファイルを読み込んでいない', () => {
  ['control-admin.html', 'control-admin-previous.html'].forEach(f => {
    const t = read('frontend/public/camellia/' + f);
    DELETED.forEach(d => {
      assert.ok(t.indexOf('"' + d + '"') < 0, f + ' が ' + d + ' を読もうとしています');
    });
    assert.ok(t.indexOf('/control-user') < 0, f + ' に消した画面へのリンクが残っています');
  });
});

test('利用者向けのサーバー窓口（/api/camellia）が外れている', () => {
  const server = read('backend/server.js');
  assert.doesNotMatch(server, /camellia/i, 'server.js に組み込みが残っています');
  assert.ok(html.indexOf('/api/camellia/') < 0, '画面から呼ぶ所が残っています');
});

/* ───────── 残すと決めたものが、巻き添えで消えていない ───────── */

const ADMIN_FILES = [
  'control-admin.html', 'control-admin-previous.html', 'camellia-admin-bridge.js',
  'admin-enhance.js', 'admin-settings.js', 'admin-calendar.js',
  'admin-menstrual.js', 'personality-charts.js', 'daily-history-admin.js'
];

test('管理画面の9本は残っている', () => {
  ADMIN_FILES.forEach(f => {
    assert.ok(exists('frontend/public/camellia/' + f), f + ' が消えています');
  });
});

test('管理画面が、必要なものを読み込めている', () => {
  const a = read('frontend/public/camellia/control-admin.html');
  assert.match(a, /src="camellia-admin-bridge\.js"/);
  const b = read('frontend/public/camellia/control-admin-previous.html');
  ['camellia-admin-bridge.js', 'admin-enhance.js', 'admin-settings.js',
   'personality-charts.js', 'daily-history-admin.js', 'admin-menstrual.js',
   'admin-calendar.js'].forEach(f => {
    assert.ok(b.indexOf('src="' + f + '"') > 0, f + ' を読み込んでいません');
  });
});

test('運営の管理画面に Camellia のタブが残っている', () => {
  const m = read('frontend/public/membership-admin.html');
  assert.match(m, /data-tab="camellia"/, 'タブが消えています');
  assert.match(m, /id="tab-camellia"/);
  assert.match(m, /\/api\/billing\/admin\/camellia/, '一覧を読む所が消えています');
  /* 枠の中に出す管理画面は、消していないほうを指していること。 */
  assert.match(m, /src="\/camellia\/control-admin\.html"/);
});

test('管理用の窓口が、サーバーに残っている', () => {
  const billing = read('backend/billing.js');
  ['/admin/camellia"', '/admin/camellia/control"', '/admin/camellia/issue-ids"',
   '/admin/camellia/reply"', '/admin/camellia/reports"',
   '/admin/camellia/post/delete"', '/admin/camellia/rules"'].forEach(r => {
    assert.ok(billing.indexOf(r) > 0, r + ' が消えています');
  });
});

test('入った方の記録と、その権限のルールは消していない', () => {
  const rules = read('firestore.rules');
  assert.match(rules, /match \/camellia_users\/\{uid\}/, '記録のルールが消えています');
  assert.match(rules, /match \/camellia_community\/\{postId\}/);
  assert.match(rules, /match \/camellia_reports\/\{reportId\}/);
  /* いちばん下の受け皿へ落とさないこと。落ちると誰でも読み書きできる。 */
  ["coll != 'camellia_users'", "coll != 'camellia_community'",
   "coll != 'camellia_reports'"].forEach(line => {
    assert.ok(rules.indexOf(line) > 0, line + ' が受け皿の除外から消えています');
  });
});

/* ───────── 案内の文 ───────── */

test('案内は、Camellia へ行けるとは言っていない', () => {
  const tutorial = read('frontend/public/schoolpark/tutorial.html');
  [html, tutorial].forEach(t => {
    assert.ok(t.indexOf('🌸 Camellia — 準備中') > 0,
      'Camellia を開いていることにしたままです');
  });
  assert.ok(tutorial.indexOf('<td><strong>Camellia</strong></td><td>準備中</td>') > 0);
});

test('Heartoo の準備中は、消さずに残してある', () => {
  const tutorial = read('frontend/public/schoolpark/tutorial.html');
  assert.ok(tutorial.indexOf('<td><strong>Heartoo</strong></td><td>準備中</td>') > 0);
  assert.match(tutorial, /💍 Heartoo — 準備中/);
  assert.match(html, /💍 Heartoo — 準備中/);
});
