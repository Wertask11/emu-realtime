/* 招待の画面まわり（一般クエスト #005）。

   #005 の年末目標は「SP Passport 500〜1,000件発行」。招待での完走は
   1人1件なので、100人が完走しても100件しか積み上がらない。
   届かせるには、招待された人が次の招待者になる連鎖が要る。

   その連鎖の起点が「パスポートができた直後の画面」。
   ここが出なくなる・出る相手を間違えると、連鎖そのものが止まる。

   文面にも決まりがある。#005 の参加のルールで、EMUER を
   「儲かる」「値上がりする」のように投資として書いてはいけない。
   ここで配る文面が、そのまま参加者の投稿になる。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '../..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const WELCOME = read('frontend/public/schoolpark/passport-welcome.js');
const SHARE = read('frontend/public/schoolpark/share-invite.js');
const LANDING = read('frontend/public/invite.html');
const INDEX = read('frontend/public/index.html');

/* 投資として読める言い回し。文面にもページにも出してはいけない。 */
const MONEY_WORDS = ['儲か', '値上がり', '値上り', '稼げ', '不労', '利回り', '配当', '必ず増え'];

/* ───────── 発行直後の画面（C） ───────── */

function stageWelcome() {
  const seen = { added: [], removed: 0, storage: {}, opened: 0, mounted: [] };
  const node = () => {
    const n = {
      id: '', innerHTML: '', style: {}, children: [],
      setAttribute() { }, focus() { }, remove() { seen.removed += 1; },
      addEventListener() { },
      querySelector: (sel) => n.innerHTML.indexOf(String(sel).replace('#', 'id="')) >= 0
        ? { onclick: null, focus() { } } : null
    };
    return n;
  };
  const body = { appendChild: (n) => seen.added.push(n) };
  const listeners = {};
  const ctx = vm.createContext({
    String, Number, Boolean, Date, JSON,
    localStorage: {
      getItem: (k) => (k in seen.storage ? seen.storage[k] : null),
      setItem: (k, v) => { seen.storage[k] = String(v); }
    },
    document: {
      body,
      createElement: () => node(),
      getElementById: (id) => (id === 'spPassportWelcome' && seen.added.length)
        ? seen.added[seen.added.length - 1] : null
    },
    location: { href: '' },
    window: {
      addEventListener: (name, fn) => { listeners[name] = fn; },
      openSpDao: () => { seen.opened += 1; },
      SpShareInvite: { mount: (el, o) => seen.mounted.push(o && o.from) }
    }
  });
  ctx.window.document = ctx.document;
  vm.runInContext(WELCOME, ctx);
  return { ctx, seen, fire: (detail) => listeners['schoolpark-id']({ detail }) };
}

test('初めて番号ができた人にだけ出す', () => {
  const s = stageWelcome();
  s.fire({ schoolParkId: 'SP-AAAA-BBBB-CCCC-DDDD', isNew: true });
  assert.equal(s.seen.added.length, 1, '出ていません');
});

test('前から番号がある人には出さない', () => {
  const s = stageWelcome();
  s.fire({ schoolParkId: 'SP-AAAA-BBBB-CCCC-DDDD', isNew: false });
  assert.equal(s.seen.added.length, 0, '毎回出ると、ただの邪魔になります');
});

test('同じ番号には二度出さない', () => {
  const s = stageWelcome();
  const d = { schoolParkId: 'SP-AAAA-BBBB-CCCC-DDDD', isNew: true };
  s.fire(d); s.fire(d);
  assert.equal(s.seen.added.length, 1, '二度出ています');
});

test('番号が無い催しでは出さない', () => {
  const s = stageWelcome();
  s.fire({ isNew: true });
  s.fire(null);
  assert.equal(s.seen.added.length, 0);
});

test('出した画面に #005 の話が入っている', () => {
  const s = stageWelcome();
  s.fire({ schoolParkId: 'SP-AAAA-BBBB-CCCC-DDDD', isNew: true });
  const html = s.seen.added[0].innerHTML;
  assert.ok(html.indexOf('次は、あなたが誰かに届ける番') >= 0, '連鎖の誘いがありません');
  assert.ok(html.indexOf('#005') >= 0, 'どのクエストか書いてありません');
  assert.ok(html.indexOf('SP-AAAA-BBBB-CCCC-DDDD') >= 0, '番号が出ていません');
});

test('出した画面に共有の口がある', () => {
  const s = stageWelcome();
  s.fire({ schoolParkId: 'SP-AAAA-BBBB-CCCC-DDDD', isNew: true });
  assert.ok(s.seen.added[0].innerHTML.indexOf('id="spwShare"') >= 0, '共有の受け皿がありません');
  assert.deepEqual(Array.from(s.seen.mounted), ['welcome'], '共有ボタンを入れていません');
});

test('出した画面は、投資の言い方をしない', () => {
  const s = stageWelcome();
  s.fire({ schoolParkId: 'SP-AAAA-BBBB-CCCC-DDDD', isNew: true });
  const html = s.seen.added[0].innerHTML;
  MONEY_WORDS.forEach(w => assert.ok(html.indexOf(w) < 0, '「' + w + '」が入っています'));
});

test('ウォレットが要るのは報酬のほうだと書いてある', () => {
  /* パスポートの発行にウォレットは要らない。ここを取り違えると、
     招待された人が「財布が要るのか」と離脱する。 */
  const s = stageWelcome();
  s.fire({ schoolParkId: 'SP-AAAA-BBBB-CCCC-DDDD', isNew: true });
  assert.ok(s.seen.added[0].innerHTML.indexOf('EMUER の受け取りにはウォレットが要ります') >= 0,
    'ウォレットが要る範囲が書いてありません');
});

test('index.html が、共有を先に読み込む', () => {
  const i = INDEX.indexOf('/schoolpark/share-invite.js');
  const j = INDEX.indexOf('/schoolpark/passport-welcome.js');
  assert.ok(i > 0 && j > 0, '読み込まれていません');
  assert.ok(i < j, '共有が後だと、発行直後の画面にボタンが入りません');
});

/* ───────── 共有ボタン（B） ───────── */

function stageShare(opts) {
  const o = opts || {};
  const seen = { fetched: [], opened: [], copied: null, html: '' };
  const el = {
    innerHTML: '',
    querySelectorAll: () => seen.buttons || []
  };
  const ctx = vm.createContext({
    String, Number, Boolean, Date, JSON, Promise, encodeURIComponent,
    navigator: o.native ? { share: async () => true, clipboard: { writeText: async () => { } } } : {},
    document: { createElement: () => ({ style: {}, setAttribute() { } }), body: { appendChild() { } }, getElementById: () => null },
    location: { href: '' },
    setTimeout,
    fetch: async (url) => {
      seen.fetched.push(url);
      if (o.fail) return { ok: false, status: 404, json: async () => ({ error: o.fail }) };
      return { ok: true, status: 200, json: async () => ({ ok: true, code: 'ABCDEFGHJK', total: o.total || 0 }) };
    },
    window: {
      addEventListener() { }, dispatchEvent() { },
      emuAuthHeaders: async () => ({}),
      open: (u) => seen.opened.push(u)
    }
  });
  ctx.window.document = ctx.document;
  ctx.window.navigator = ctx.navigator;
  vm.runInContext(SHARE, ctx);
  return { ctx, seen, el };
}

test('招待リンクは、招待用のページを指す', () => {
  const s = stageShare();
  const url = s.ctx.window.SpShareInvite.linkFor('ABCDEFGHJK');
  assert.equal(url, 'https://schoolpark-emu.vercel.app/invite.html?ref=ABCDEFGHJK');
});

test('配る文面は、投資の言い方をしない', () => {
  const s = stageShare();
  const text = String(s.ctx.window.SpShareInvite.text);
  MONEY_WORDS.forEach(w => assert.ok(text.indexOf(w) < 0, '「' + w + '」が入っています'));
  assert.ok(text.indexOf('EMUER') < 0, '文面で EMUER に触れています（投資と読まれます）');
});

test('配る文面は、残ることと3分であることを言う', () => {
  const s = stageShare();
  const text = String(s.ctx.window.SpShareInvite.text);
  assert.ok(text.indexOf('記録') >= 0, '何が残るのか書いてありません');
  assert.ok(text.indexOf('3分') >= 0, '手間の見当が書いてありません');
  assert.ok(text.indexOf('ウォレットは要りません') >= 0, 'ウォレット不要が書いてありません');
});

test('合言葉は、一度取れば使い回す', async () => {
  const s = stageShare();
  const a = await s.ctx.window.SpShareInvite.code();
  const b = await s.ctx.window.SpShareInvite.code();
  assert.equal(a.code, 'ABCDEFGHJK');
  assert.equal(b.code, 'ABCDEFGHJK');
  assert.equal(s.seen.fetched.length, 1, '毎回サーバーに聞いています');
});

test('合言葉の口は /invite', async () => {
  const s = stageShare();
  await s.ctx.window.SpShareInvite.code();
  assert.ok(String(s.seen.fetched[0]).indexOf('/invite') > 0, s.seen.fetched[0]);
});

test('取れなかったら、理由が分かる形で落ちる', async () => {
  const s = stageShare({ fail: 'NO_PASSPORT' });
  await assert.rejects(() => s.ctx.window.SpShareInvite.code(), /NO_PASSPORT/);
});

/* ───────── 招待用のページ（B） ───────── */

test('招待用のページに、招待用の見た目（OGP）がある', () => {
  assert.ok(LANDING.indexOf('og:title') > 0, 'og:title がありません');
  assert.ok(LANDING.indexOf('og:description') > 0, 'og:description がありません');
  assert.ok(LANDING.indexOf('og:image') > 0, 'og:image がありません');
  assert.ok(LANDING.indexOf('twitter:card') > 0, 'twitter:card がありません');
  assert.ok(LANDING.indexOf('SchoolPark に招待されました') > 0, '題が招待の文面になっていません');
});

test('招待用のページは、投資の言い方をしない', () => {
  MONEY_WORDS.forEach(w => assert.ok(LANDING.indexOf(w) < 0, '「' + w + '」が入っています'));
});

test('招待用のページは、ウォレットが要らないことを言い切る', () => {
  assert.ok(LANDING.indexOf('ウォレット（暗号資産の財布）は要りません') > 0,
    '一番の離脱点に答えていません');
  assert.ok(LANDING.indexOf('お金はかかりません') > 0 || LANDING.indexOf('かかりません') > 0,
    '費用の話がありません');
});

test('招待用のページは、合言葉を本体と同じ置き場所に渡す', () => {
  assert.ok(LANDING.indexOf('sp_invite_ref') > 0, '置き場所が違います');
  const i = INDEX.indexOf('var REF_KEY = "sp_invite_ref";');
  assert.ok(i > 0, '本体側の置き場所が変わっています');
});

test('招待用のページは、形の違う合言葉を渡さない', () => {
  const RE = /\[0-9A-HJKMNP-TV-Z\]\{10\}/;
  assert.ok(RE.test(LANDING), '合言葉の形を確かめていません');
  assert.ok(LANDING.indexOf('ref = ""') > 0, '形が違うときに捨てていません');
});

test('招待用のページは、検索に載せない', () => {
  /* 一人ひとりのリンクなので、検索に出す意味がない。 */
  assert.ok(LANDING.indexOf('name="robots" content="noindex"') > 0, 'noindex がありません');
});

/* ───────── 本体側で合言葉を拾う（A） ───────── */

test('本体は ?ref= を拾って覚える', () => {
  const SEG = INDEX.slice(INDEX.indexOf('var REF_KEY = "sp_invite_ref";'),
                          INDEX.indexOf('SPID.resolve = function (force)'));
  assert.ok(SEG.indexOf('SPID.captureRef') > 0, '拾うところがありません');
  assert.ok(SEG.indexOf('SPID.ref =') > 0, '読み出すところがありません');
  assert.ok(SEG.indexOf('SPID.clearRef') > 0, '消すところがありません');
  assert.ok(SEG.indexOf('localStorage') > 0, 'ログインの行き来で消えてしまいます');
});

test('本体は合言葉を本文で送り、Content-Type を付ける', () => {
  const SEG = INDEX.slice(INDEX.indexOf('SPID.resolve = function (force)'),
                          INDEX.indexOf('SPID.now = function ()'));
  assert.ok(SEG.indexOf('authHeaders(true)') > 0, 'Content-Type が無いと本文が読まれません');
  assert.ok(SEG.indexOf('ref: ref') > 0, '合言葉を送っていません');
  assert.ok(SEG.indexOf('if (data.isNew) SPID.clearRef();') > 0,
    '使い終わった合言葉が残ります');
});

test('設定パネルから招待リンクを出せる', () => {
  assert.ok(INDEX.indexOf('SpShareInvite.open()') > 0, '出す口がありません');
  assert.ok(INDEX.indexOf('🔗 招待リンク') > 0, '見出しがありません');
});
