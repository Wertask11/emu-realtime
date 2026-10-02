/* 受け取りの入り口。

   10/2、完走を2回認めて EMUER を引き当てたのに、受け取れなかった。
   報酬の一覧も受け取りも walletSuccessOverlay の中にあるのに、
   showWalletSuccessModal を呼ぶところがどこにも無かった。
   置いてあるのに、たどり着けない。

   ここが無くなると、また同じことが起きる。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '../..');
const SRC = fs.readFileSync(path.join(root, 'frontend/public/wallet-success-ui.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(root, 'frontend/public/index.html'), 'utf8');

const ENTRY = SRC.slice(SRC.indexOf('function closeWalletSuccessAndStart(){'),
                        SRC.indexOf('/* 未請求の報酬。'));
assert.ok(ENTRY.indexOf('wsOpenRewards') > 0, '受け取りの入り口が見つかりません');

/* 置き場所。index.html の札が動いたら、ボタンはどこにも出ない。 */
test('ウォレットの札に、ボタンの置き場所がある', () => {
  assert.ok(INDEX.indexOf('eth-wallet-actions') > 0, '置き場所が index.html にありません');
  assert.ok(INDEX.indexOf('id="emuValueProfile"') > 0, '札の囲みが index.html にありません');
  assert.ok(ENTRY.indexOf('#emuValueProfile .eth-wallet-actions') > 0,
    'ボタンを入れる先が、札の中を指していません');
});

function stage(opts) {
  const o = opts || {};
  const seen = { appended: [], opened: [], alerts: [], main: 0, removed: [], texts: {} };
  const node = (id) => ({
    id: id || '',
    set textContent(v) { seen.texts[id || 'x'] = v; },
    get textContent() { return seen.texts[id || 'x']; },
    classList: { remove: (c) => seen.removed.push(c), add: () => {} }
  });
  const box = { appendChild: (b) => seen.appended.push(b) };
  const ctx = vm.createContext({
    String, Number, Boolean,
    wsAccount: () => o.account === undefined ? '0xme' : o.account,
    showWalletSuccessModal: (a) => { seen.opened.push(a); },
    alert: (m) => seen.alerts.push(String(m)),
    window: { goTomainapp: () => { seen.main += 1; } },
    document: {
      getElementById: (id) => {
        if (id === 'wsOpenRewardsBtn') return o.already ? node(id) : null;
        return node(id);
      },
      querySelector: (sel) => {
        if (sel === '#emuValueProfile .eth-wallet-actions') return o.noBox ? null : box;
        return node(sel);
      },
      createElement: () => ({ type: '', id: '', className: '', textContent: '', onclick: null })
    }
  });
  vm.runInContext(ENTRY, ctx);
  return { ctx, seen, box };
}

test('ウォレットの札に、受け取りのボタンを足す', () => {
  const s = stage({});
  s.ctx.wsAddWalletButton();
  assert.equal(s.seen.appended.length, 1, 'ボタンが足されていません');
  const b = s.seen.appended[0];
  assert.equal(b.id, 'wsOpenRewardsBtn');
  assert.equal(b.textContent, '報酬を受け取る');
  assert.equal(typeof b.onclick, 'function', '押せません');
});

test('二度呼んでも、ボタンは増やさない', () => {
  const s = stage({ already: true });
  s.ctx.wsAddWalletButton();
  assert.equal(s.seen.appended.length, 0, 'ボタンが二つになります');
});

test('置き場所が無ければ、黙って何もしない', () => {
  const s = stage({ noBox: true });
  s.ctx.wsAddWalletButton();
  assert.equal(s.seen.appended.length, 0);
});

/* 本題。押したら開くこと。 */
test('押すと、受け取りの画面が開く', () => {
  const s = stage({});
  s.ctx.wsOpenRewards();
  assert.deepEqual(Array.from(s.seen.opened), ['0xme'], '開いていません');
  assert.equal(s.seen.alerts.length, 0);
});

test('ウォレットが繋がっていなければ、理由を出して開かない', () => {
  const s = stage({ account: '' });
  s.ctx.wsOpenRewards();
  assert.equal(s.seen.opened.length, 0, '繋がっていないのに開いています');
  assert.equal(s.seen.alerts.length, 1, '理由を出していません');
  assert.ok(s.seen.alerts[0].indexOf('ウォレット') >= 0);
});

test('札から開いたときは、閉じるボタンの文字を変える', () => {
  const s = stage({});
  s.ctx.wsOpenRewards();
  assert.equal(s.seen.texts['#walletSuccessCard .ws-close'], '閉じる');
  assert.equal(s.seen.texts['#walletSuccessCard h2'], 'EMUERの受け取り');
});

/* 閉じたあと。札から開いたのに本編へ飛ばされると、見ていた場所を失う。 */
test('札から開いて閉じたら、その場に戻す', () => {
  const s = stage({});
  s.ctx.wsOpenRewards();
  s.ctx.closeWalletSuccessAndStart();
  assert.equal(s.seen.main, 0, '本編へ飛ばしています');
  assert.ok(s.seen.removed.indexOf('active') >= 0, '閉じていません');
});

test('ログインから開いて閉じたら、これまでどおり本編へ送る', () => {
  const s = stage({});
  s.ctx.closeWalletSuccessAndStart();
  assert.equal(s.seen.main, 1, '本編へ送っていません');
});

test('札から閉じた次にログインから閉じたら、本編へ送る', () => {
  const s = stage({});
  s.ctx.wsOpenRewards();
  s.ctx.closeWalletSuccessAndStart();
  s.ctx.closeWalletSuccessAndStart();
  assert.equal(s.seen.main, 1, '一度きりの印が残っています');
});

/* 外から呼べること。札が描き直されたときに押し直せる。 */
test('入り口は、外からも呼べる形で置く', () => {
  assert.ok(SRC.indexOf('window.wsOpenRewards=wsOpenRewards;') >= 0,
    '外から呼べません');
});

/* v2 が動いているときに、ボタンを足すこと。 */
test('EMUER v2 が動いていたら、読み込みのときにボタンを足す', () => {
  const load = SRC.slice(SRC.indexOf('window.addEventListener("load"'));
  const i = load.indexOf('emuerV2Config=c;');
  assert.ok(i > 0, '設定を読むところが見つかりません');
  assert.ok(load.slice(i, i + 120).indexOf('wsAddWalletButton()') >= 0,
    '設定を読んだあとにボタンを足していません');
  assert.ok(load.slice(0, i).indexOf('!c.enabled') >= 0,
    'v2 が止まっていてもボタンを足しています');
});

/* 何も出ないのは、壊れているのと見分けがつかない。 */
const REWARDS = SRC.slice(SRC.indexOf('async function wsRewards(){'),
                          SRC.indexOf('async function wsClaim(row){'));

function rewards(opts) {
  const o = opts || {};
  const seen = { hidden: false, why: null, label: null };
  const ctx = vm.createContext({
    EMUER_V2_API: 'https://x', Number, Array, String, encodeURIComponent,
    wsAccount: () => '0xme',
    wsHeaders: async () => { if (o.throws) throw new Error(o.throws); return {}; },
    wsBtn: () => ({ set hidden(v) { seen.hidden = v; } }),
    wsHideClaim: (why) => { seen.hidden = true; seen.why = why; },
    wsClaimLabel: (t) => { seen.label = t; },
    wsClaim: () => {},
    document: { getElementById: () => null },
    fetch: async () => ({ ok: o.ok !== false, status: o.status || 200,
      json: async () => o.body === undefined ? { rewards: o.rows || [] } : o.body })
  });
  vm.runInContext(REWARDS, ctx);
  return { run: () => ctx.wsRewards(), seen };
}

test('受け取るものが無ければ、そう出す', async () => {
  const s = rewards({ rows: [] });
  await s.run();
  assert.equal(s.seen.hidden, true);
  assert.ok(String(s.seen.why).indexOf('ありません') >= 0, '理由を出していません：' + s.seen.why);
});

test('読めなければ、理由を出す', async () => {
  const s = rewards({ ok: false, status: 409, body: { error: 'EMUER_V2_NOT_ACTIVE' } });
  await s.run();
  assert.equal(s.seen.hidden, true);
  assert.ok(String(s.seen.why).indexOf('EMUER_V2_NOT_ACTIVE') >= 0,
    'サーバーの理由を出していません：' + s.seen.why);
});

test('途中で転んでも、理由を出す', async () => {
  const s = rewards({ throws: '再ログインしてください。' });
  await s.run();
  assert.equal(s.seen.hidden, true);
  assert.ok(String(s.seen.why).indexOf('再ログイン') >= 0, '理由を出していません');
});

test('受け取るものがあれば、これまでどおり額を出す', async () => {
  const s = rewards({ rows: [{ claimId: 'a', amount: 100 }, { claimId: 'b', amount: 100 }] });
  await s.run();
  assert.ok(String(s.seen.label).indexOf('200 EMUER') >= 0, '額が出ていません：' + s.seen.label);
  assert.ok(String(s.seen.label).indexOf('2件') >= 0, '件数が出ていません');
});
