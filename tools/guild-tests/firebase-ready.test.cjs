/* Firebase の用意が間に合わなかった回に、SchoolPark が読み直されることを確かめる。

   window.db と window.fbLib は index.html の最後にある module で作られる。
   module は後回しで動くうえ firebase 本体を3つ取りに行くので、DAO の枠のほうが
   先に立ち上がることがある。そのとき8つの読み込みは、どれも先頭の
   「if (!window.db || !window.fbLib) return;」で黙って引き返す。

   呼び直しが無かったころは、そのまま初期値で固まった。
   名前はゲスト、ギルドは0枚、クエストは「まだクエストがありません」、
   信用スコアは「読み込んでいます…」。落ちてはいないので console にも何も出ず、
   読み込みが早すぎた回だけ起きるので、出たり出なかったりした。

   ここでは本番の index.html から実物を切り出して動かす。

   使い方: node --test tools/guild-tests/firebase-ready.test.cjs               */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PUB = path.join(__dirname, '..', '..', 'frontend', 'public');
const START = 'window.spDaoReloadAll = function () {';
const END = "window.addEventListener('ches-firebase-ready'";

/* 行番号ではなく目印で切る（前後に手が入っても、ここが壊れないように） */
function reloadSection() {
  const src = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
  const a = src.indexOf(START);
  assert.ok(a > 0, '呼び直しの始まりが見つからない: ' + START);
  const b = src.indexOf(END, a);
  assert.ok(b > a, '合図を聞く行が見つからない: ' + END);
  const eol = src.indexOf('\n', b);
  return src.slice(a, eol);
}

const LOADERS = ['spDaoWhoAmI', 'spDaoLoadTasks', 'spDaoLoadVotes', 'spDaoLoadQuests',
                 'spDaoLoadWisdom', 'spDaoLoadMembers', 'spDaoLoadTreasury', 'spDaoLoadPark'];

/* 画面のかわりに、呼ばれた名前を書き留めるだけの入れ物を用意する */
function makeWindow(opts) {
  opts = opts || {};
  const called = [];
  const listeners = {};
  const app = opts.noApp ? null : { setState() {} };
  const win = {
    db: opts.noFb ? undefined : {},
    fbLib: opts.noFb ? undefined : {},
    document: {
      getElementById(id) {
        assert.equal(id, 'spDaoFrame', '見に行く枠が違う: ' + id);
        return opts.noFrame ? null : { contentWindow: { app: app } };
      }
    },
    addEventListener(name, fn) { (listeners[name] = listeners[name] || []).push(fn); },
    /* 待ち直しは偽の時計で進める（実時間を待たない） */
    __pending: [],
    setTimeout(fn) { win.__pending.push(fn); return win.__pending.length; },
    __tick(n) {
      for (let i = 0; i < (n || 1); i++) {
        const q = win.__pending.splice(0, win.__pending.length);
        if (!q.length) return;
        q.forEach(f => f());
      }
    },
    __called: called, __listeners: listeners, __app: app
  };
  LOADERS.forEach(function (name) {
    win[name] = function (a) {
      called.push(name);
      assert.equal(a, app, name + ' に渡された画面が違う');
      return opts.reject ? Promise.reject(new Error('読めなかった')) : Promise.resolve();
    };
  });
  return win;
}

function run(win) {
  const ctx = vm.createContext(win);
  ctx.window = ctx;
  vm.runInContext(reloadSection(), ctx);
  return ctx;
}

function fire(win) {
  const fns = win.__listeners['ches-firebase-ready'] || [];
  assert.equal(fns.length, 1, '合図を聞いているのが1つではない');
  fns.forEach(function (fn) { fn(); });
}

test('用意ができた合図で、8つとも読み直す', () => {
  const win = run(makeWindow());
  fire(win);
  assert.deepEqual(win.__called, LOADERS);
});

test('枠がまだ無いときは、何もしない', () => {
  const win = run(makeWindow({ noFrame: true }));
  fire(win);
  assert.deepEqual(win.__called, []);
});

test('枠はあるが画面がまだのときは、何もしない', () => {
  const win = run(makeWindow({ noApp: true }));
  fire(win);
  assert.deepEqual(win.__called, []);
});

/* 合図が出ても用意ができていないなら、読みに行っても引き返すだけ。
   呼ばずに待つ（componentDidMount 側があとで読む） */
test('Firebase がまだのときは、読みに行かない', () => {
  const win = run(makeWindow({ noFb: true }));
  fire(win);
  assert.deepEqual(win.__called, []);
});

test('1つが転んでも、残りは読む', () => {
  const win = run(makeWindow({ reject: true }));
  fire(win);
  assert.deepEqual(win.__called, LOADERS, '途中で止まっている');
});

/* 約束の失敗を拾い忘れると、ブラウザに unhandledrejection が出る。
   出したままにすると、本当に見たいエラーが埋もれる */
test('読み込みの失敗を、拾い残さない', async () => {
  const seen = [];
  const onUnhandled = r => seen.push(r);
  process.on('unhandledRejection', onUnhandled);
  try {
    fire(run(makeWindow({ reject: true })));
    await new Promise(r => setTimeout(r, 50));
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
  assert.deepEqual(seen, [], '拾われていない失敗がある');
});

test('合図を聞く前には、勝手に読まない', () => {
  const win = run(makeWindow());
  assert.deepEqual(win.__called, [], '合図の前に読んでいる');
});

/* ───── 合図の瞬間に画面がまだ出来ていなかった場合 ─────

   合図は一度しか鳴らない。取りこぼすと、そのページでは二度と読まれない。
   前の作りはここで諦めていた。 */

test('合図のとき画面がまだでも、出てきたところで読む', () => {
  let app = null;
  const called = [];
  const listeners = {};
  const win = {
    db: {}, fbLib: {},
    document: { getElementById: () => ({ contentWindow: { get app() { return app; } } }) },
    addEventListener(n, f) { (listeners[n] = listeners[n] || []).push(f); },
    __pending: [],
    setTimeout(fn) { win.__pending.push(fn); },
    tick() { win.__pending.splice(0, win.__pending.length).forEach(f => f()); }
  };
  LOADERS.forEach(n => { win[n] = () => { called.push(n); return Promise.resolve(); }; });
  const ctx = vm.createContext(win); ctx.window = ctx;
  vm.runInContext(reloadSection(), ctx);

  listeners['ches-firebase-ready'].forEach(f => f());
  assert.deepEqual(called, [], '画面がまだなのに読んでいる');

  win.tick();                       /* まだ出来ていない */
  assert.deepEqual(called, []);

  app = { setState() {} };          /* ここで画面が出来た */
  win.tick();
  assert.deepEqual(called, LOADERS, '出てきたのに読んでいない');

  win.tick(); win.tick();
  assert.deepEqual(called, LOADERS, '読めたあとも待ち直しが止まっていない');
});

test('画面がいつまでも出てこなければ、静かにあきらめる', () => {
  const called = [];
  const listeners = {};
  const win = {
    db: {}, fbLib: {},
    document: { getElementById: () => null },
    addEventListener(n, f) { (listeners[n] = listeners[n] || []).push(f); },
    __pending: [],
    setTimeout(fn) { win.__pending.push(fn); }
  };
  LOADERS.forEach(n => { win[n] = () => { called.push(n); return Promise.resolve(); }; });
  const ctx = vm.createContext(win); ctx.window = ctx;
  vm.runInContext(reloadSection(), ctx);

  listeners['ches-firebase-ready'].forEach(f => f());
  let rounds = 0;
  while (win.__pending.length && rounds < 500) {
    win.__pending.splice(0, win.__pending.length).forEach(f => f());
    rounds++;
  }
  assert.ok(rounds < 500, '待ち直しが止まらない（無限に回っている）');
  assert.deepEqual(called, []);
});
