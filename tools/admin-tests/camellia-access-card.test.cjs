/* 管理画面の「招待と利用停止」。

   招待制の切り替え・招待コードを作る・取り消す・利用を止める・戻す。
   ボタンを押したときに、正しい中身で正しい場所へ送るかを見る。
   ここを間違えると、営業で配るリンクが作れない、止めたはずの人が使える、が起きる。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.join(__dirname, '../..');
const ADMIN = fs.readFileSync(path.join(root, 'frontend/public/membership-admin.html'), 'utf8');
const CARD = ADMIN.slice(ADMIN.indexOf('  const access = document.createElement("div");'), ADMIN.indexOf('  el.replaceChildren(dashboard, access'));
const SRC = ADMIN.slice(ADMIN.indexOf('const CAM_INVITE_MESSAGE'), ADMIN.indexOf('async function paintCamReports()'));
assert.ok(CARD.length > 500 && SRC.length > 1500, '招待と利用停止の欄が見つかりません');

const STATE = {
  config: { inviteRequired: false, requiredSince: 0 },
  invites: [
    { code: 'K7QM2XPA', kind: 'operator', label: 'instagram_1027', uses: 3, maxUses: 30, expiresAt: null, revoked: false, url: 'https://camellia-beta.vercel.app/?invite=K7QM2XPA&utm_source=invite&utm_campaign=instagram_1027' },
    { code: 'ZZZZ2222', kind: 'operator', label: 'old<b>', uses: 1, maxUses: 1, expiresAt: null, revoked: false, url: 'https://camellia-beta.vercel.app/?invite=ZZZZ2222' },
    { code: 'MMMM3333', kind: 'member', label: '', uses: 2, maxUses: 3, url: 'x' }
  ],
  suspended: [{ uid: 'camellia:x', camelliaId: 'CAM-ABCD-EFGH-JKLM', reason: 'not_eligible', suspendedAt: 1 }]
};

async function open() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('dialog', (d) => d.accept());
  await page.setContent('<div id="tab"></div>');
  await page.evaluate(({ card, src, state }) => {
    window.calls = [];
    window.$ = (s) => document.querySelector(s);
    window.esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    window.fmt = (v) => (v ? 'T' + v : '—');
    window.api = async (p, o) => { window.calls.push([p, o && o.method, o && o.body]); return p.endsWith('/') ? JSON.parse(JSON.stringify(state)) : { ok: true }; };
    (0, eval)(src);
    const el = document.getElementById('tab');
    new Function('el', 'paintCamAccess', card)(el, window.paintCamAccess);
  }, { card: CARD + '\n  el.appendChild(access);\n  paintCamAccess();\n', src: SRC + '\nwindow.paintCamAccess = paintCamAccess;', state: STATE });
  await page.waitForFunction(() => document.querySelector('#camAccessToggle') && !document.querySelector('#camAccessToggle').disabled, null, { timeout: 5000 });
  return { browser, page };
}

test('招待コードの一覧・作る・取り消す・招待制の切り替え', async () => {
  const { browser, page } = await open();
  try {
    assert.equal(await page.textContent('#camAccessState'), 'いまは誰でも入れます');
    assert.equal(await page.textContent('#camAccessToggle'), '招待制にする');
    const list = await page.textContent('#camInvites');
    assert.ok(list.includes('instagram_1027') && list.includes('K7QM-2XPA') && list.includes('3 / 30 人'));
    assert.ok(list.includes('終了'), '使い切ったコードは終了と出す');
    assert.ok(list.includes('2 人が使いました'), '利用者が配ったコードは数だけ出す');
    assert.equal(await page.locator('#camInvites b').filter({ hasText: 'old<b>' }).count(), 1, '配り先の名前は文字のまま出す');
    assert.equal(await page.locator('[data-invcopy]').count(), 2, '終わったコードにはコピーを出さない');
    assert.equal(await page.getAttribute('[data-invcopy]:has-text("案内文をコピー")', 'data-invcopy'),
      'Camelliaに招待します 🌸https://camellia-beta.vercel.app/?invite=K7QM2XPA&utm_source=invite&utm_campaign=instagram_1027', 'LINE などにそのまま貼れる文');
    assert.equal(await page.getAttribute('[data-invcopy]:has-text("リンクだけコピー")', 'data-invcopy'),
      'https://camellia-beta.vercel.app/?invite=K7QM2XPA&utm_source=invite&utm_campaign=instagram_1027', 'プロフィール欄などに貼るリンク');

    await page.fill('#camInvLabel', 'LINE 営業');
    await page.click('#camInvCreate');
    assert.equal((await page.evaluate(() => window.calls)).some((c) => c[0].endsWith('/invites')), false, '書けない名前は送らない');
    await page.fill('#camInvLabel', 'Line_1101');
    await page.fill('#camInvUses', '50');
    await page.fill('#camInvDays', '14');
    await page.click('#camInvCreate');
    await page.waitForFunction(() => window.calls.some((c) => c[0].endsWith('/invites')));
    const create = (await page.evaluate(() => window.calls)).find((c) => c[0].endsWith('/invites'));
    assert.deepEqual(create, ['/api/billing/admin/camellia-access/invites', 'POST', { label: 'line_1101', maxUses: 50, expiresInDays: 14 }]);

    await page.click('[data-invrevoke="K7QM2XPA"]');
    await page.waitForFunction(() => window.calls.some((c) => c[0].endsWith('/invites/revoke')));
    assert.deepEqual((await page.evaluate(() => window.calls)).find((c) => c[0].endsWith('/revoke')).slice(1), ['POST', { code: 'K7QM2XPA' }]);

    await page.click('#camAccessToggle');
    await page.waitForFunction(() => window.calls.some((c) => c[0].endsWith('/config')));
    assert.deepEqual((await page.evaluate(() => window.calls)).find((c) => c[0].endsWith('/config')).slice(1), ['POST', { inviteRequired: true }]);
  } finally { await browser.close(); }
});

test('利用を止める・戻す', async () => {
  const { browser, page } = await open();
  try {
    const stopped = await page.textContent('#camStopped');
    assert.ok(stopped.includes('CAM-ABCD-EFGH-JKLM') && stopped.includes('対象外（女性ではない）'));
    await page.fill('#camStopUser', 'CAM-ZZZZ-YYYY-XXXX');
    await page.selectOption('#camStopReason', 'terms');
    await page.click('#camStop');
    await page.waitForFunction(() => window.calls.some((c) => c[0].endsWith('/suspend')));
    assert.deepEqual((await page.evaluate(() => window.calls)).find((c) => c[0].endsWith('/suspend')).slice(1), ['POST', { user: 'CAM-ZZZZ-YYYY-XXXX', reason: 'terms' }]);
    await page.click('[data-restore="camellia:x"]');
    await page.waitForFunction(() => window.calls.some((c) => c[0].endsWith('/restore')));
    assert.deepEqual((await page.evaluate(() => window.calls)).find((c) => c[0].endsWith('/restore')).slice(1), ['POST', { user: 'camellia:x' }]);
  } finally { await browser.close(); }
});
