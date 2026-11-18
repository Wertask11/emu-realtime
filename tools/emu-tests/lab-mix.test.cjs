'use strict';
/* Knowledge Lab の掛け合わせの画面（11/18 オーナー）
   ・Knowledge Text と同じように、まず分野のカード。押すとその分野の知識
   ・「掛け合わせる」をオン → 最初の1つがメイン、あとから最大4つ。Knowledge Text の教材も枠に入れられる
   ・書き手が AI の利用に同意していない知識は入れられない
   ・混ぜる → はじける → 新しい発見。1日3回（残りを出す。0回なら押せない）
   ・行き先：自分だけに保存／公開／ギルドの議題（公開してから）／クエストに参加
   サーバーは偽物（このテストの中の決まった答え）。本物のアカウントやデータは使わない。 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '../../frontend/public');
const TERMS = require('../../backend/knowledge-lab/taxonomy.json').map((t) => ({ ...t, active: true }));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json', '.webp': 'image/webp' };
const PARENT = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><body style="margin:0">
<iframe id="f" src="/knowledge-lab.html" style="width:100vw;height:100vh;border:0"></iframe>
<script>window.emuAuthHeaders=async()=>({'Content-Type':'application/json',Authorization:'Bearer test'});window.msgs=[];window.proposals=[];window.emuSubmitGuildProposal=async(p)=>{window.proposals.push(p);return {ok:true,guildId:p.guildId};};addEventListener('message',e=>{if(e.data&&e.data.type==='emu-lab-action')msgs.push(e.data)});</script></body>`;
let server, base, browser;
before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/test/parent') { res.setHeader('content-type', TYPES['.html']); return res.end(PARENT); }
    const file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end('{}'); }
    res.setHeader('content-type', TYPES[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
});
after(async () => { await browser?.close(); server?.close(); });

const POSTS = ['髪を傷めないブローのコツ', '開業1年目の資金繰り', '接客で常連をつくる', 'SNSで予約を増やした話', 'スタッフ教育の失敗談', '同意のない知識'].map((title, i) => ({
  id: 'p' + i, title, body: '本文の例です。'.repeat(6), displayName: '書き手' + i,
  knowledgeLab: { aiUseConsent: { allowed: i !== 5 } }, facets: { field: ['field-beauty'] },
}));
async function open({ width = 390, remaining = 3, counts = { 'field-beauty': 12, 'field-business': 0 }, empty = false, feed = [] } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 844 } });
  const seen = { mix: [], notes: [], search: [] };
  let quota = { available: true, used: 3 - remaining, limit: 3, remaining };
  await context.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    if (!u.pathname.startsWith('/api/knowledge-lab')) return u.origin === base ? route.continue() : route.abort();
    const p = u.pathname.replace('/api/knowledge-lab', '');
    const json = (j, status = 200) => route.fulfill({ status, json: j });
    const method = route.request().method();
    if (p === '/config') return json({ enabled: true });
    if (p === '/taxonomy') return json(TERMS);
    if (p === '/ai/status') return json({ available: true, semanticAvailable: false, configured: true, environmentEnabled: true, stopped: false, model: 'm' });
    if (p === '/me') return json({ spid: 'sp-test', owner: false });
    if (p === '/search') { seen.search.push(Object.fromEntries(u.searchParams)); return json({ items: POSTS, next: null }); }
    if (p === '/discoveries') return json({ items: feed });
    if (p === '/field-counts') return counts ? json({ counts }) : json({ error: 'INDEX_NOT_READY' }, 503);
    if (p === '/texts') return json([{ id: 'kt_a1', title: '詐欺の見抜き方', theme: 'money', subTheme: '守り方', subSubTheme: '', excerpt: 'うまい話には理由がある' }]);
    if (p === '/texts/kt_a1') return json({ id: 'kt_a1', title: '詐欺の見抜き方', body: 'うまい話には理由がある。全文です。' });
    if (p === '/ai/mix/quota') return json(quota);
    if (p === '/ai/mix') {
      const body = JSON.parse(route.request().postData());
      seen.mix.push(body);
      quota = { ...quota, used: quota.used + 1, remaining: quota.remaining - 1 };
      const ids = [body.mainId, ...body.otherIds];
      const title = (id) => (id === 'kt_a1' ? '詐欺の見抜き方' : POSTS.find((x) => x.id === id).title);
      return json({ id: 'run-1', mode: 'mix', mainId: body.mainId, sources: ids.map((id) => ({ id, title: title(id) })),
        analysis: empty ? { hypotheses: [], connections: [], applications: [], questions: [], cautions: [] } : { hypotheses: [{ text: 'ブローの技術を予約前の動画にすると常連が生まれやすい', citations: [{ sourceId: ids[0] }] }],
          connections: ids.slice(1).map((id) => ({ text: 'つながり ' + id, citations: [{ sourceId: id }] })), cautions: [{ text: '注意', citations: [{ sourceId: ids[0] }] }] },
        quota: { used: quota.used, limit: 3, remaining: quota.remaining } });
    }
    if (p === '/notes' && method === 'PUT') { const b = JSON.parse(route.request().postData()); seen.notes.push(b); return json({ id: 'note-1', revision: seen.notes.length }); }
    return json({ items: [] });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.goto(base + '/test/parent');
  const f = page.frameLocator('#f');
  await f.locator('#mixFields .mix-card').first().waitFor();
  await page.evaluate(() => { const w = document.getElementById('f').contentWindow; try { w.ReizoTour?.skip?.(); } catch (_) {} w.document.querySelectorAll('.rk-panel,#rk-tour').forEach((e) => e.remove()); });
  return { page, f, seen, errors, close: () => context.close() };
}

test('分野のカードが並び（分類の「分野」だけ）、押すとその分野の知識が出る', async () => {
  const w = await open();
  try {
    const labels = await w.f.locator('#mixFields .mix-card b').allInnerTexts();
    const fields = TERMS.filter((t) => t.axis === 'field').map((t) => t.label);
    assert.deepEqual(labels, fields);
    assert.ok(labels.includes('美容') && labels.includes('経営・起業'));
    await w.f.locator('#mixFields [data-field="field-beauty"]').click();
    await w.f.locator('.mix-item').first().waitFor();
    assert.equal(w.seen.search[0].field, 'field-beauty');
    assert.equal(await w.f.locator('#mixListTitle').innerText(), '美容');
    assert.equal(await w.f.locator('[data-take]').count(), 0, 'オフのあいだは「枠に入れる」を出さない');
    assert.deepEqual(w.errors, []);
  } finally { await w.close(); }
});

const state = (w) => w.page.evaluate(() => document.getElementById('f').contentWindow.EmuLabMix.state());
async function openBeauty(w) {
  await w.f.locator('#mixFields [data-field="field-beauty"]').click();
  await w.f.locator('.mix-item').first().waitFor();
  await w.f.locator('.mix-switch').click();
}

test('メイン1つ＋最大4つ。教材も入る。書き手の同意の有無に関係なく入る。5つ目は入らない。同意のチェックや「AI」の言葉は出さない', async () => {
  const w = await open();
  try {
    await openBeauty(w);
    assert.equal(await w.f.locator('#mixConsent').count(), 0, '外部に送る同意のチェックは無い');
    assert.equal(await w.f.locator('[data-take="p5"]').count(), 1, '書き手が選んでいない知識も入れられる');
    for (const id of ['p5', 'p1', 'p2']) await w.f.locator(`[data-take="${id}"]`).click();
    await w.f.locator('[data-src="texts"]').click();
    await w.f.locator('[data-theme="money"]').click();
    await w.f.locator('[data-read-text="kt_a1"]').click();
    await w.f.locator('.mix-text-full').filter({ hasText: '全文です' }).waitFor();
    await w.f.locator('[data-take="kt_a1"]').click();
    await w.f.locator('#mixBack').click();
    await w.f.locator('[data-src="posts"]').click();
    await w.f.locator('#mixFields [data-field="field-beauty"]').click();
    await w.f.locator('[data-take="p3"]').waitFor();
    await w.f.locator('[data-take="p3"]').click();
    assert.deepEqual((await state(w)).slots, ['p5', 'p1', 'p2', 'kt_a1', 'p3']);
    await w.f.locator('[data-take="p4"]').click();
    assert.match(await w.f.locator('#status').innerText(), /枠がいっぱい/);
    assert.equal(await w.f.locator('#mixGo').isDisabled(), false, '同意のチェックなしで押せる');
    assert.match(await w.f.locator('#mixQuota').innerText(), /今日あと 3 回/);
    assert.doesNotMatch(await w.f.locator('#mix').innerText(), /AI/);
    assert.deepEqual(w.errors, []);
  } finally { await w.close(); }
});

test('枠を押すと、その枠に入れる知識を選び直せる（入れ替え・メインにする・外す）', async () => {
  const w = await open({ width: 1280 });
  try {
    await openBeauty(w);
    await w.f.locator('[data-take="p0"]').click();
    await w.f.locator('[data-take="p1"]').click();
    // 空いている「掛け合わせ 3」を押して選ぶ
    await w.f.locator('#mixSlots [data-slot="3"]').click();
    await w.f.locator('#mixPick [data-pick="p4"]').click();
    assert.deepEqual((await state(w)).slots, ['p0', 'p1', null, 'p4', null]);
    // 入っている枠を押して、別の知識に入れ替える
    await w.f.locator('#mixSlots [data-slot="1"]').click();
    await w.f.locator('#mixPick [data-pick="p2"]').click();
    assert.deepEqual((await state(w)).slots, ['p0', 'p2', null, 'p4', null]);
    // メインにする
    await w.f.locator('#mixSlots [data-slot="3"]').click();
    await w.f.locator('#mixPick [data-pick-main]').click();
    assert.deepEqual((await state(w)).slots, ['p4', 'p2', null, 'p0', null]);
    // 外す（メインを外すと、次の知識がメインになる）
    await w.f.locator('#mixSlots [data-slot="0"]').click();
    await w.f.locator('#mixPick [data-pick-remove]').click();
    assert.equal((await state(w)).main, 'p2');
    // Knowledge Text の教材も、この窓から選べる
    await w.f.locator('#mixSlots [data-slot="4"]').click();
    await w.f.locator('#mixPick [data-pick-tab="texts"]').click();
    await w.f.locator('#mixPick [data-pick="kt_a1"]').click();
    assert.equal((await state(w)).slots[4], 'kt_a1');
    assert.deepEqual(w.errors, []);
  } finally { await w.close(); }
});

test('パソコン：カードを枠へドラッグして入れる。枠どうしのドラッグで入れ替え', async () => {
  const w = await open({ width: 1280 });
  try {
    await openBeauty(w);
    await w.f.locator('.mix-item[data-id="p2"]').dragTo(w.f.locator('#mixSlots [data-slot="0"]'));
    await w.f.locator('.mix-item[data-id="p3"]').dragTo(w.f.locator('#mixSlots [data-slot="4"]'));
    assert.deepEqual((await state(w)).slots, ['p2', null, null, null, 'p3']);
    await w.f.locator('#mixSlots [data-slot="4"]').dragTo(w.f.locator('#mixSlots [data-slot="0"]'));
    assert.deepEqual((await state(w)).slots, ['p3', null, null, null, 'p2']);
  } finally { await w.close(); }
});

test('スマホ：右へスワイプで枠に入れ、左へスワイプで外す。長押しして動かすと、選んだ枠へ入る', async () => {
  const w = await open();
  try {
    await openBeauty(w);
    const swipe = (id, dx, hold = 0, toSlot = null) => w.page.evaluate(async ({ id, dx, hold, toSlot }) => {
      const doc = document.getElementById('f').contentDocument, win = document.getElementById('f').contentWindow;
      const el = doc.querySelector(`.mix-item[data-id="${id}"]`);
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect(), x = r.left + 40, y = r.top + 40;
      let tx = x + dx, ty = y;
      if (toSlot !== null) { const s = doc.querySelector(`#mixSlots [data-slot="${toSlot}"]`).getBoundingClientRect(); tx = s.left + s.width / 2; ty = s.top + s.height / 2; }
      const t = (cx, cy) => new win.Touch({ identifier: 1, target: el, clientX: cx, clientY: cy });
      const fire = (type, list, ch) => el.dispatchEvent(new win.TouchEvent(type, { bubbles: true, cancelable: true, touches: list, targetTouches: list, changedTouches: ch }));
      fire('touchstart', [t(x, y)], [t(x, y)]);
      if (hold) await new Promise((r) => setTimeout(r, hold));
      for (let i = 1; i <= 8; i++) { const p = t(x + (tx - x) * i / 8, y + (ty - y) * i / 8); fire('touchmove', [p], [p]); }
      fire('touchend', [], [t(tx, ty)]);
    }, { id, dx, hold, toSlot });
    await swipe('p0', 120);
    await swipe('p1', 120);
    assert.deepEqual((await state(w)).slots, ['p0', 'p1', null, null, null]);
    await swipe('p1', -120);
    assert.deepEqual((await state(w)).slots, ['p0', null, null, null, null]);
    await swipe('p3', 0, 400, 3);
    assert.deepEqual((await state(w)).slots, ['p0', null, null, 'p3', null]);
    assert.deepEqual(w.errors, []);
  } finally { await w.close(); }
});

test('混ぜる：フラスコの実験 → 光る → 新しい発見。保存・公開（みんなの発見に載る）・ギルドの議題（Lab の中で・自動でギルドを選ぶ）・クエスト', async () => {
  const w = await open();
  try {
    await openBeauty(w);
    for (const id of ['p1', 'p0', 'p2']) await w.f.locator(`[data-take="${id}"]`).click();
    await w.f.locator('#mixGo').click();
    await w.f.locator('#mixStage .lx-flask').waitFor();
    assert.match(await w.f.locator('#mixStage .lx-timer').innerText(), /混ぜ時間/);
    const hue1 = await w.f.locator('#mixStage .lx-flask').evaluate((el) => el.style.getPropertyValue('--hue'));
    await w.page.waitForTimeout(700);
    const hue2 = await w.f.locator('#mixStage .lx-flask').evaluate((el) => el.style.getPropertyValue('--hue'));
    assert.notEqual(hue1, hue2, '混ぜている時間で色が変わる');
    await w.f.locator('#mixStage .mix-result').waitFor({ timeout: 15000 });
    assert.match(await w.f.locator('#mixStage').getAttribute('class'), /glow-/, '光る');
    assert.deepEqual(w.seen.mix[0], { mainId: 'p1', otherIds: ['p0', 'p2'], externalAIConsent: true, key: w.seen.mix[0].key });
    assert.match(await w.f.locator('.mix-find').innerText(), /常連が生まれやすい/);
    assert.doesNotMatch(await w.f.locator('#mixStage').innerText(), /AI|仮説です|数十秒/);
    // 自分だけに保存
    await w.f.locator('[data-act="private"]').click();
    await w.f.locator('#mixActMsg').filter({ hasText: '保存しました' }).waitFor();
    assert.equal(w.seen.notes[0].visibility, 'private');
    assert.equal(w.seen.notes[0].mode, 'mix');
    // ギルドの議題：Lab の中で出す。中身から WORK（営業・常連）を選ぶ。やめると発見にもどる
    await w.f.locator('[data-act="guild"]').click();
    await w.f.locator('.mix-guild').waitFor();
    assert.equal(await w.f.locator('.mix-guild [data-guild="work"]').getAttribute('aria-pressed'), 'true');
    await w.f.locator('#mixGuildCancel').click();
    assert.equal(await w.f.locator('.mix-guild').count(), 0);
    assert.equal(await w.f.locator('#mixStage .mix-find').isVisible(), true, '発見はそのまま');
    await w.f.locator('[data-act="guild"]').click();
    await w.f.locator('.mix-guild [data-guild="learn"]').click();
    await w.f.locator('#mixGuildGo').click();
    await w.f.locator('.mix-guild-done').waitFor();
    assert.equal(w.seen.notes[1].visibility, 'public', '議題にする前に公開する');
    const prop = await w.page.evaluate(() => window.proposals[0]);
    assert.equal(prop.guildId, 'learn');
    assert.deepEqual(prop.options, ['クエストにして試す', 'いまはやらない']);
    assert.equal(prop.fromPostId, 'p1');
    assert.match(prop.body, /knowledge-lab\.html\?note=note-1/);
    assert.equal(await w.page.evaluate(() => window.msgs.length), 0, 'ほかの画面へ移らない');
    await w.f.locator('#mixGuildBack').click();
    // クエスト
    await w.f.locator('[data-act="quest"]').click();
    await w.page.waitForFunction(() => window.msgs.some((m) => m.action === 'quests'));
    // 公開：演出して、みんなの新しい発見に載る。終わったら結果を閉じて、Lab のトップのその発見を見せる（11/18 オーナー）
    await w.f.locator('[data-act="public"]').click();
    await w.f.locator('#mixActMsg').filter({ hasText: '公開しました' }).waitFor();
    assert.equal(w.seen.notes.at(-1).visibility, 'public');
    await w.f.locator('#mixStage').waitFor({ state: 'hidden', timeout: 6000 });
    assert.equal(await w.f.locator('#mixHome').isVisible(), true, 'Lab のトップに戻る');
    assert.equal(await w.f.locator('#mixFeedList [data-note="note-1"].fresh').count(), 1, 'いま公開した発見が光る');
    assert.match(await w.f.locator('#status').innerText(), /公開しました/);
    assert.deepEqual(w.errors, []);
  } finally { await w.close(); }
});

test('見つからなかったときは、フラスコが爆発して「見つからなかったよ」', async () => {
  const w = await open({ empty: true });
  try {
    await openBeauty(w);
    for (const id of ['p0', 'p1']) await w.f.locator(`[data-take="${id}"]`).click();
    await w.f.locator('#mixGo').click();
    await w.f.locator('#mixStage .lx-boom').waitFor({ state: 'attached', timeout: 15000 });
    assert.match(await w.f.locator('#mixStage .mix-result').innerText(), /見つからなかったよ/);
    await w.f.locator('[data-close-stage]').click();
    assert.equal(await w.f.locator('#mixStage').isVisible(), false);
    assert.deepEqual((await state(w)).slots.slice(0, 2), ['p0', 'p1'], '枠はそのまま');
  } finally { await w.close(); }
});

test('今日の3回を使い切っていたら「混ぜる」は押せない', async () => {
  const w = await open({ remaining: 0 });
  try {
    await openBeauty(w);
    await w.f.locator('[data-take="p0"]').click();
    await w.f.locator('[data-take="p1"]').click();
    await w.f.locator('#mixQuota').filter({ hasText: '今日はもう混ぜられません' }).waitFor();
    assert.equal(await w.f.locator('#mixGo').isDisabled(), true);
  } finally { await w.close(); }
});

test('みんなの新しい発見：公開された掛け合わせを並べる', async () => {
  const w = await open({ feed: [{ id: 'n9', title: '「A」×「B」', find: '朝の5分で常連が増える', sources: [{ title: 'A', main: true }, { title: 'B' }] }] });
  try {
    await w.f.locator('#mixFeedList [data-note="n9"]').waitFor();
    assert.match(await w.f.locator('#mixFeed').innerText(), /みんなの新しい発見[\s\S]*朝の5分で常連が増える/);
  } finally { await w.close(); }
});

test('プロフィールボタンのメニューから Knowledge Lab の記録・書き手プロフィール。運営管理は管理画面から', () => {
  const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(index, /onclick="emuAccountLab\('mine'\)">Knowledge Lab の記録<\/button>/);
  assert.match(index, /onclick="emuAccountLab\('writer'\)">書き手プロフィール<\/button>/);
  const admin = fs.readFileSync(path.join(ROOT, 'membership-admin.html'), 'utf8');
  assert.match(admin, /href="\/\?lab=admin"[^>]*>Knowledge Lab の運営管理/);
  const lab = fs.readFileSync(path.join(ROOT, 'knowledge-lab.html'), 'utf8');
  assert.match(lab, /<nav class="tabs"[^>]*hidden>/, 'Lab のタブは出さない');
});

test('分野のカードの右上に、その分野の知識の数を出す。数えられなかったときは出さない', async () => {
  const w = await open({ width: 1280 });
  try {
    await w.f.locator('#mixFields [data-field="field-beauty"] .mix-count').waitFor();
    assert.equal(await w.f.locator('#mixFields [data-field="field-beauty"] .mix-count').innerText(), '12件');
    assert.equal(await w.f.locator('#mixFields [data-field="field-business"] .mix-count').innerText(), '0件');
    assert.equal(await w.f.locator('#mixFields [data-field="field-money"] .mix-count').count(), 0, '数の無い分野は出さない');
    // 右上にある
    const card = await w.f.locator('#mixFields [data-field="field-beauty"]').boundingBox();
    const badge = await w.f.locator('#mixFields [data-field="field-beauty"] .mix-count').boundingBox();
    assert.ok(badge.x + badge.width > card.x + card.width - 30 && badge.y < card.y + 30, '右上');
    // Knowledge Text のテーマにも教材の数
    await w.f.locator('[data-src="texts"]').click();
    assert.equal(await w.f.locator('[data-theme="money"] .mix-count').innerText(), '1件');
    assert.deepEqual(w.errors, []);
  } finally { await w.close(); }
  const off = await open({ counts: null });
  try {
    await off.page.waitForTimeout(300);
    assert.equal(await off.f.locator('#mixFields .mix-count').count(), 0);
    assert.equal(await off.f.locator('#mixFields .mix-card').count() > 0, true, 'カードはそのまま出る');
  } finally { await off.close(); }
});

/* index.html の emuSubmitGuildProposal（Lab の中から議題を出す）：決まりは議題フォームと同じ */
test('Lab から出す議題：ギルド・選択肢・ログイン・出せる人かを確かめてから、議題フォームと同じ形で書く', async () => {
  const { readHtml, build } = require('../year-goals-tests/extract.cjs');
  const INDEX = readHtml('frontend/public/index.html');
  const added = [];
  let canGuild = true, passport = { addr: '0xabc' };
  const window = {
    fbLib: { collection: (db, name) => name, addDoc: async (col, doc) => { added.push({ col, doc }); } },
    db: {},
    spCanGuild: async () => canGuild,
    spDaoLoadVotes: async () => {},
  };
  const api = build(INDEX, ['emuSubmitGuildProposal'], {
    window,
    document: { getElementById: () => null },
    SpGuildStore: { isValidId: (id) => ['learn', 'work', 'play', 'connect', 'web3'].includes(id) },
    spPassportLoad: async () => passport,
    console: { warn() {} },
  }, 'let _spGuildOpenId = null;');
  const ok = { guildId: 'work', title: '試す', body: '説明', options: ['クエストにして試す', 'いまはやらない'], fromPostId: 'p1', fromPostTitle: '元' };
  assert.equal((await api.emuSubmitGuildProposal({ ...ok, guildId: 'nope' })).ok, false);
  assert.equal((await api.emuSubmitGuildProposal({ ...ok, options: ['ひとつ'] })).ok, false);
  assert.equal((await api.emuSubmitGuildProposal({ ...ok, title: ' ' })).ok, false);
  canGuild = false;
  assert.match((await api.emuSubmitGuildProposal(ok)).reason, /議題を出せるのは/);
  canGuild = true; passport = null;
  assert.match((await api.emuSubmitGuildProposal(ok)).reason, /ログイン/);
  passport = { addr: '0xabc' };
  assert.equal(added.length, 0);
  assert.deepEqual(await api.emuSubmitGuildProposal({ ...ok, fromPostId: 'bad id!' }), { ok: true, guildId: 'work' });
  const doc = added[0].doc;
  assert.equal(added[0].col, 'sp_votes');
  assert.deepEqual(Object.keys(doc).sort(), ['body', 'closesAt', 'createdAt', 'createdBy', 'fromPostId', 'fromPostTitle', 'guildId', 'kind', 'options', 'title'].sort(), '議題フォームと同じ欄だけ');
  assert.equal(doc.kind, 'free');
  assert.equal(doc.fromPostId, '', 'おかしな ID は入れない');
  assert.deepEqual(doc.options, [{ id: 'o1', label: 'クエストにして試す' }, { id: 'o2', label: 'いまはやらない' }]);
  assert.equal(doc.createdBy, '0xabc');
});
