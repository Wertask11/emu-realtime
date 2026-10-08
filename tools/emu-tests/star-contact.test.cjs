/* 星空を見ているあいだは、左下のお問い合わせボタンを出さない。

   SchoolPark のサイドバーが開いていると、サイドバー用の指定
   （body.sp-dao-open.sp-dao-sidebar #emu-contact-btn { display:flex !important }）
   のほうが強く、星空の上にボタンが出ていた。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const INDEX = fs.readFileSync(path.join(__dirname, '../../frontend/public/index.html'), 'utf8');

test('星空を開いているあいだは、SchoolPark のサイドバーがあってもお問い合わせを隠す', () => {
  const show = INDEX.indexOf('body.sp-dao-open.sp-dao-sidebar #emu-contact-btn {');
  const hide = INDEX.indexOf('body.emu-sky-open.sp-dao-open.sp-dao-sidebar #emu-contact-btn { display:none !important; }');
  assert.ok(show > 0, 'サイドバー用の指定が見つかりません');
  assert.ok(hide > show, '星空のときに隠す指定が、サイドバー用の指定より弱い（または前にある）');
  assert.ok(INDEX.indexOf("document.body.classList.add('emu-sky-open');") > 0, '星空を開いたときの目印が無い');
});
