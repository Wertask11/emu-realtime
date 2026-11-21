/* 11/21 オーナー「またこれになってる」：「Emu for SchoolParkを開けませんでした」の画面。
   サーバーは main に入るたびに入れ替わり（1〜2分）、そのあいだ公開状態の確認に返事が無い・502 になる。
   確認の中身（spEnsureSchoolParkAccess）はツアーのテストで固定なので変えない。
   画面を出しても出しっぱなしにせず、覚えた答えを使わずに（force）聞き直し、つながったら画面を閉じて SchoolPark を開く */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const INDEX = fs.readFileSync(path.join(__dirname, '../../frontend/public/index.html'), 'utf8');
const between = (a, b) => INDEX.slice(INDEX.indexOf(a), INDEX.indexOf(b, INDEX.indexOf(a)));

test('「開けませんでした」の画面：「もう一度つなぐ」でつながったら、画面を閉じて SchoolPark を開く', async () => {
  const src = between('async function spShowSchoolParkUnavailable(access) {', 'function spCloseAccessScreen() {');
  const els = {};
  ['spAccessScreen', 'spAccessLead', 'spAccessTitle', 'spAccessEyebrow', 'spAccessRetry', 'spAccessRetryNote']
    .forEach(id => { els[id] = { style: {}, textContent: '' }; });
  let answer = { allowed: false, unavailable: true }, opened = 0; const forced = [];
  const ctx = vm.createContext({
    document: { getElementById: id => els[id] || null },
    window: { emuCheckMaintenance: async () => false, _spQuotaProbe: async () => false },
    spEnsureSchoolParkAccess: async (force) => { forced.push(force); return answer; },
    spDaoOpenWhenReady: () => { opened++; },
    Date
  });
  vm.runInContext(src, ctx);
  await ctx.spShowSchoolParkUnavailable({ allowed: false, unavailable: true });
  assert.equal(els.spAccessScreen.style.display, 'flex');
  assert.equal(els.spAccessRetry.style.display, '', '「もう一度つなぐ」を出す');
  await ctx.spAccessRetryNow();
  assert.equal(els.spAccessScreen.style.display, 'flex', 'まだつながらないあいだは出したまま');
  assert.match(els.spAccessRetryNote.textContent, /自動でつなぎ直します/);
  answer = { allowed: true, phase: 'public' };
  await ctx.spAccessRetryNow();
  assert.equal(els.spAccessScreen.style.display, 'none', 'つながったら閉じる');
  assert.equal(opened, 1, 'そのまま SchoolPark を開く');
  assert.deepEqual(forced, [true, true], '覚えた「確認できなかった」答えを使わずに聞き直す');
  assert.ok(INDEX.indexOf('id="spAccessRetry"') > 0 && INDEX.indexOf('id="spAccessRetryNote"') > 0);
});
