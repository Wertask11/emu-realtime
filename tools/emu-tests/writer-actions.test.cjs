/* 11/23 オーナー：「書き手キーは使えるって管理画面になってるのに、入れるときと入れないときがある。
   書き手キーでログイン後、投稿したり、みんなで決めるの投票をしたり、利用者と同じことができるように」。

   原因は3つあった。
   1. ログインの回数制限が「同じ回線から10分に10回」で、Muse・ChatGPT の書き手が同じ回線から入り直すと断られた（サーバー側。backend/writer-accounts.test.js）
   2. サーバーの入れ替え中（1〜2分）に1回失敗すると、そのまま「ログインできませんでした」になった
   3. 「はじめまして、でよろしいですか？」と、投票などの確かめが、道具に「キャンセル」されて先へ進めなかった
      （confirm() は道具が自動でキャンセルすることが多い。「はじめまして」で「前に使ったことがある」を押すとログアウトになる） */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const INDEX = fs.readFileSync(path.join(__dirname, '../../frontend/public/index.html'), 'utf8');
const between = (a, b) => {
  const i = INDEX.indexOf(a);
  assert.ok(i >= 0, a + ' が見つからない');
  const j = INDEX.indexOf(b, i);
  assert.ok(j > i, b + ' が見つからない');
  return INDEX.slice(i, j);
};

function voteCtx(answer) {
  const src = between('async function spVoteCast(', '/* 議題を出す。枠の外の入力欄を使う。');
  const seen = { asked: [], wrote: [], reloaded: 0 };
  const ctx = vm.createContext({
    spPassportLoad: async () => ({ addr: '0xabc', uid: 'writer:0123456789ab' }),
    emuAsk: async (msg, opts) => { seen.asked.push({ msg, opts }); return answer; },
    confirm: () => { throw new Error('confirm() は使わない'); },
    alert: (m) => { seen.alert = m; },
    window: {
      db: {},
      fbLib: { doc: (...p) => p.slice(1).join('/'), setDoc: async (ref, data) => { seen.wrote.push({ ref, data }); } },
      spDaoLoadVotes: async () => { seen.reloaded++; }
    },
    Date
  });
  vm.runInContext('let _spVoteBusy = false;\n' + src + '\nthis.spVoteCast = spVoteCast; this.busy = () => _spVoteBusy;', ctx);
  return { ctx, seen };
}

test('投票の確かめは画面の中の窓（emuAsk）。「投票する」を押せば票が入り、「やめる」なら入らない', async () => {
  const yes = voteCtx(true);
  await yes.ctx.spVoteCast('vote1', 'o2', {});
  assert.equal(yes.seen.asked.length, 1);
  assert.equal(yes.seen.asked[0].opts.ok, '投票する');
  assert.deepEqual(yes.seen.wrote.map(w => w.ref), ['sp_votes/vote1/ballots/0xabc']);
  assert.equal(yes.seen.wrote[0].data.optionId, 'o2');
  assert.equal(yes.seen.reloaded, 1, '入れたら表示を読み直す');
  assert.equal(yes.ctx.busy(), false);

  const no = voteCtx(false);
  await no.ctx.spVoteCast('vote1', 'o2', {});
  assert.equal(no.seen.wrote.length, 0);
  assert.equal(no.ctx.busy(), false, 'やめたあと、もう一度押せる');
});

test('確かめの窓が出ているあいだは、ほかの選択肢を押しても2つ目の窓・2票目は出ない', async () => {
  const src = between('async function spVoteCast(', '/* 議題を出す。枠の外の入力欄を使う。');
  let release;
  const wrote = [];
  let asked = 0;
  const ctx = vm.createContext({
    spPassportLoad: async () => ({ addr: '0xabc' }),
    emuAsk: () => { asked++; return new Promise(r => { release = r; }); },
    alert: () => {},
    window: { db: {}, fbLib: { doc: (...p) => p.slice(1).join('/'), setDoc: async (ref) => { wrote.push(ref); } }, spDaoLoadVotes: async () => {} }
  });
  vm.runInContext('let _spVoteBusy = false;\n' + src + '\nthis.spVoteCast = spVoteCast;', ctx);
  const first = ctx.spVoteCast('v', 'o1', {});
  await new Promise(r => setImmediate(r));
  await ctx.spVoteCast('v', 'o2', {});
  release(true);
  await first;
  assert.equal(asked, 1);
  assert.deepEqual(wrote, ['sp_votes/v/ballots/0xabc']);
});

test('利用者の確かめ（投票・知識の採用・Change の採用・無料NFT・クエストから降りる・宿題を消す・引用の取り消し・完走証明の公開をやめる・予約投稿のキャンセル）に confirm() を使わない', () => {
  for (const msg of ['この選択で投票します', 'この知識を採用しますか', 'この提案を採用し、変更履歴として残しますか', '無料NFTを受け取りますか',
    'このクエストから降りますか', "「' + (title || 'この宿題')", '引用を取り消しますか', '公開をやめますか', 'この予約投稿をキャンセルしますか']) {
    const i = INDEX.indexOf(msg);
    assert.ok(i > 0, msg);
    const head = INDEX.slice(Math.max(0, i - 60), i);
    assert.ok(!/[^.\w]confirm\(\s*["']$/.test(head), msg + ' が confirm() のまま');
    assert.match(head, /emuAsk\(\s*["']$/, msg + ' は emuAsk で聞く');
  }
});

test('emuAsk：画面の中にボタン2つの窓を出し、押したほうを返して窓を消す', async () => {
  const src = between('function emuAsk(message, opts) {', 'window.emuAsk = emuAsk;');
  const made = [];
  const el = (tag) => {
    const e = { tag, children: [], style: {}, attrs: {}, listeners: {}, removed: false,
      appendChild(c) { this.children.push(c); return c; }, setAttribute(k, v) { this.attrs[k] = v; },
      addEventListener(k, f) { this.listeners[k] = f; }, remove() { this.removed = true; }, focus() {} };
    made.push(e);
    return e;
  };
  const body = el('body');
  const ctx = vm.createContext({ document: { createElement: el, body }, window: { confirm: () => { throw new Error('使わない'); } } });
  vm.runInContext(src + '\nthis.emuAsk = emuAsk;', ctx);
  const p = ctx.emuAsk('この選択で投票します。', { ok: '投票する' });
  const box = body.children[0];
  assert.equal(box.attrs.role, 'dialog');
  const yes = made.find(e => e.className === 'emu-ask-yes');
  const no = made.find(e => e.className === 'emu-ask-no');
  assert.equal(yes.textContent, '投票する');
  assert.equal(no.textContent, 'やめる');
  yes.onclick();
  assert.equal(await p, true);
  assert.equal(box.removed, true);
});

function spidCtx(uid, status) {
  const src = between('SPID.ensure = async function () {', '/* ───── ログイン方法を足す ───── */');
  const seen = { asked: 0, resolved: [] };
  const SPID = {
    status: async () => status,
    askFirstTime: async () => { seen.asked++; return false; },
    resolve: async (v) => { seen.resolved.push(v); return { schoolParkId: 'SP-1' }; }
  };
  const ctx = vm.createContext({ SPID, remember: (s) => s, window: { auth: { currentUser: { uid } } }, setTimeout, Promise });
  vm.runInContext(src, ctx);
  return { SPID, seen };
}

test('書き手（writer:…）には「はじめまして、でよろしいですか？」を聞かず、そのまま番号を作る。利用者にはこれまでどおり聞く', async () => {
  const w = spidCtx('writer:0123456789ab', { exists: false, looksNew: true });
  await w.SPID.ensure();
  assert.equal(w.seen.asked, 0);
  assert.deepEqual(w.seen.resolved, [true]);
  assert.notEqual(w.SPID.declined, true, '書き手がログアウトさせられない');

  const u = spidCtx('line:abc', { exists: false, looksNew: true });
  await u.SPID.ensure();
  assert.equal(u.seen.asked, 1, '利用者には聞く');
  assert.equal(u.SPID.declined, true);
});

function loginCtx(responses) {
  const src = between('CHES.writerLogin = async function (key) {', '// ───── 再訪時の自動サインイン');
  const seen = { fetches: 0, done: null, restored: null, status: [] };
  let run;
  const ctx = vm.createContext({
    CHES: { config: { writerTokenEndpoint: 'https://example.invalid/api/auth/writer', writerRetryWaitsMs: [1, 1, 1, 1] } },
    statusMsg: (m) => { seen.status.push(m); },
    showLoading: () => {},
    document: { getElementById: () => null },
    whenFirebaseReady: (ok) => { run = ok(); },
    fetch: async () => {
      const r = responses[Math.min(seen.fetches, responses.length - 1)];
      seen.fetches++;
      if (r === 'net') throw new TypeError('Failed to fetch');
      return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body || {} };
    },
    window: { fbAuth: { signInWithCustomToken: async () => ({ user: { uid: 'writer:0123456789ab' } }) }, auth: {} },
    completeCommonFlow: async (user, provider) => { seen.done = { uid: user.uid, provider }; },
    restoreLoginScreen: (m) => { seen.restored = m; },
    console: { error() {}, warn() {}, log() {} },
    setTimeout, Promise, Math, Number, String, JSON, Error, TypeError
  });
  vm.runInContext(src, ctx);
  return { go: async (key) => { await ctx.CHES.writerLogin(key); await run; }, seen };
}
const KEY = 'emw_' + 'a'.repeat(32);

test('書き手のログイン：サーバーの入れ替え中（つながらない・502）は間をあけて聞き直し、つながったら入る', async () => {
  const t = loginCtx(['net', { status: 502 }, { status: 503 }, { status: 200, body: { firebaseToken: 't', profile: { name: 'Muse 1' } } }]);
  await t.go(KEY);
  assert.equal(t.seen.fetches, 4);
  assert.deepEqual(t.seen.done, { uid: 'writer:0123456789ab', provider: 'writer' });
  assert.equal(t.seen.restored, null);
});

test('書き手のログイン：キー違いは聞き直さない。回数の上限は「何分待つか」を出す。ずっと落ちているときは「起動中」と出す', async () => {
  const bad = loginCtx([{ status: 401, body: { error: 'INVALID_WRITER_KEY' } }]);
  await bad.go('emw_' + 'a'.repeat(28) + 'Xy9_');
  assert.equal(bad.seen.fetches, 1);
  assert.match(bad.seen.restored, /書き手キーが違います（入れたキーの末尾：…Xy9_）/, '入れたキーの末尾を見せて、運営画面と見比べられるようにする');
  assert.match(bad.seen.restored, /コピーしたまま貼り付けて/);
  assert.ok(!bad.seen.restored.includes('a'.repeat(8)), 'キーの中身は見せない');

  const stopped = loginCtx([{ status: 403, body: { error: 'WRITER_DISABLED' } }]);
  await stopped.go(KEY);
  assert.equal(stopped.seen.fetches, 1);
  assert.match(stopped.seen.restored, /運営画面で止められています/);

  const many = loginCtx([{ status: 429, body: { error: 'RATE_LIMITED', retryAfterMs: 4 * 60000 } }]);
  await many.go(KEY);
  assert.equal(many.seen.fetches, 1);
  assert.match(many.seen.restored, /4分ほど待って/);

  const down = loginCtx([{ status: 502 }]);
  await down.go(KEY);
  assert.equal(down.seen.fetches, 5, '最初の1回＋聞き直し4回');
  assert.match(down.seen.restored, /起動中/);
  assert.equal(down.seen.done, null);
});
