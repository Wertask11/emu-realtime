/* 管理画面の「いまの人数」。

   会員一覧は有料の契約（emu_subscriptions）しか数えないので、
   無料で使っている人が一人も入らない。「何人が使っているか」を
   出す場所が無かった。

   ここが緩むと、人数が取れなかっただけで会員一覧まで見られなくなる。
   月の表示を間違えると、数字は正しいのに嘘の月が付く。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '../..');
const ADMIN = fs.readFileSync(path.join(root, 'frontend/public/membership-admin.html'), 'utf8');
const SRC = ADMIN.slice(ADMIN.indexOf('function headcountCard(h)'),
                        ADMIN.indexOf('async function renderMembers()'));
assert.ok(SRC.length > 600, '人数の札が見つかりません');

const OCT = Date.parse('2026-09-30T15:00:00.000Z');   /* 10/1 00:00 JST */

function card(h) {
  const ctx = vm.createContext({ Number, String, Date, esc: (v) => String(v) });
  vm.runInContext(SRC, ctx);
  return ctx.headcountCard(h);
}

test('人数をそのまま出す', () => {
  const html = card({ accounts: 120, passports: 87, passportsThisMonth: 31,
    invited: 12, invitedThisMonth: 9, since: OCT });
  ['120', '87', '31', '12', '9'].forEach(n =>
    assert.ok(html.indexOf(n) >= 0, n + ' が出ていません'));
});

test('桁区切りを付ける', () => {
  const html = card({ accounts: 12345, passports: 1000, since: OCT });
  assert.ok(html.indexOf('12,345') >= 0, '桁区切りがありません');
  assert.ok(html.indexOf('1,000') >= 0, '桁区切りがありません');
});

test('月は日本時間で出す', () => {
  /* since は日本時間の月初を UTC のミリ秒で持っている。
     そのまま UTC で読むと前月の末日になり、1か月ずれる。 */
  const html = card({ accounts: 1, passports: 1, since: OCT });
  assert.ok(html.indexOf('10月1日 0:00') >= 0, '月がずれています：' + html.slice(html.indexOf('「今月」'), html.indexOf('「今月」') + 60));
});

test('月をまたいでも、正しい月が出る', () => {
  const nov = Date.parse('2026-10-31T15:00:00.000Z');   /* 11/1 00:00 JST */
  assert.ok(card({ since: nov }).indexOf('11月1日') >= 0, '11月になっていません');
  const jan = Date.parse('2026-12-31T15:00:00.000Z');   /* 1/1 00:00 JST */
  assert.ok(card({ since: jan }).indexOf('1月1日') >= 0, '年をまたぐとずれます');
});

test('0人でも、ちゃんと0と出す', () => {
  const html = card({ accounts: 0, passports: 0, passportsThisMonth: 0,
    invited: 0, invitedThisMonth: 0, since: OCT });
  assert.ok(html.indexOf('0 人') >= 0, '0 が出ていません');
  assert.equal(html.indexOf('undefined'), -1, '欄が抜けています');
  assert.equal(html.indexOf('NaN'), -1, '数でないものが出ています');
});

test('数えられなかったときは、そう出す', () => {
  const html = card(null);
  assert.ok(html.indexOf('数えられませんでした') >= 0, '理由が出ていません');
  assert.ok(html.indexOf('会員一覧は、そのまま見られます') >= 0,
    'ほかが見られることを言っていません');
  assert.equal(html.indexOf('NaN'), -1);
});

test('何の数字なのかを書いてある', () => {
  const html = card({ since: OCT });
  assert.ok(html.indexOf('実際に使っている人の数') >= 0, 'パスポートの意味がありません');
  assert.ok(html.indexOf('500〜1,000件発行') >= 0, '年内目標との関係がありません');
  assert.ok(html.indexOf('#005') >= 0, 'クエストとの関係がありません');
});

/* 人数が取れなくても、会員一覧は出すこと。 */
test('人数が取れなくても、会員一覧は止めない', () => {
  const i = ADMIN.indexOf('async function renderMembers()');
  const seg = ADMIN.slice(i, i + 900);
  assert.ok(seg.indexOf('/api/identity/admin/headcount') > 0, '人数を聞いていません');
  assert.ok(seg.indexOf('.catch(function (e)') > 0, '取れないと会員一覧まで止まります');
  assert.ok(seg.indexOf('return null;') > 0, '取れないときの返しがありません');
  assert.ok(seg.indexOf('Promise.all') > 0, '順番に待つと、そのぶん遅くなります');
});

test('札は、会員一覧の上に出す', () => {
  const i = ADMIN.indexOf('const head = headcountCard(counted)');
  assert.ok(i > 0, '札を会員一覧の頭に付けていません');
  const seg = ADMIN.slice(i, i + 200);
  assert.ok(seg.indexOf('いまの会員') > 0, '会員一覧より先に出ていません');
});
