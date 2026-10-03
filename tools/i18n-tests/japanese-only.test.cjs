/* 日本語だけにした。

   もとは日英中韓の4か国語を持ち、画面右上と SchoolPark の設定に
   切替を置いていた。2026-10-02 に外した。

   辞書そのものは残している。画面のあちこちが emuT() で引いていて、
   同じ言い回しを一か所に置く値はそのまま要るため。
   だから「訳が消えた」ではなく「日本語だけになった」ことと、
   引いているキーが全部そろっていることを確かめる。

   キーが足りないと、画面にキー名（today.step.title など）が
   そのまま出る。見てすぐ分かるが、出てからでは遅い。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../..');
const pub = (f) => fs.readFileSync(path.join(root, 'frontend/public', f), 'utf8');

const I18N = pub('emu-i18n.js');
const PAGES = pub('emu-i18n-pages.js');
const PAGE_FILES = ['index.html', 'knowledge.html', 'ichinichi.html', 'discussion.html', 'play.html'];

/* 実際に動かして辞書を作る。文字列の検査だけだと、
   読み込めない形になっていても気づけない。 */
function load() {
  const win = { addEventListener() { } };
  const doc = {
    readyState: 'complete',
    documentElement: { setAttribute(k, v) { doc.lang = v; } },
    querySelectorAll: () => [],
    addEventListener() { }
  };
  new Function('window', 'document', I18N)(win, doc);
  new Function('window', 'document', 'console', PAGES)(win, doc, { warn() { } });
  return { win, doc };
}

test('引けば日本語が返る', () => {
  const { win } = load();
  assert.equal(win.emuT('tab.today'), '今日のEmu');
  assert.equal(win.emuT('k.title'), '知識を読む');
});

test('{name} の置き換えは、これまでどおり効く', () => {
  const { win } = load();
  assert.equal(win.emuT('today.greetingName', { name: '俺たちの青春' }),
    '俺たちの青春さん、今日はどこから始める？');
});

test('知らないキーは、キー名をそのまま返す', () => {
  const { win } = load();
  assert.equal(win.emuT('no.such.key'), 'no.such.key');
});

test('言語は日本語で固定', () => {
  const { win, doc } = load();
  assert.equal(win.getEmuLang(), 'ja');
  assert.equal(win.emuLocaleTag(), 'ja-JP');
  win.initEmuI18n();
  assert.equal(doc.lang, 'ja-JP');
});

test('切替を呼んでも、何も変わらない', () => {
  const { win } = load();
  win.setEmuLang('en');
  win.setEmuLang('ko');
  assert.equal(win.getEmuLang(), 'ja');
  assert.equal(win.emuT('tab.today'), '今日のEmu');
});

test('言語の一覧は、もう持っていない', () => {
  const { win } = load();
  assert.equal(win.EMU_LANGS, undefined, '言語の一覧が残っています');
});

test('辞書に英語・中国語・韓国語の棚が無い', () => {
  [I18N, PAGES].forEach(src => {
    ['en:', 'zh:', 'ko:', 'id:'].forEach(key => {
      assert.ok(src.indexOf('\n    ' + key) < 0 && src.indexOf('\n  ' + key) < 0,
        key + ' の棚が残っています');
    });
  });
});

test('お題の訳の表は、もう持っていない', () => {
  assert.ok(PAGES.indexOf('emuRegisterTopics({') < 0, 'お題の訳が残っています');
  const { win } = load();
  assert.equal(win.emuTopic('  なぜ空は青いのか？  '), 'なぜ空は青いのか？');
});

/* 画面から切替が消えていること。 */
test('言語の切替は、どの画面にも無い', () => {
  PAGE_FILES.forEach(f => {
    const s = pub(f);
    assert.ok(s.indexOf('setEmuLang(') < 0, f + ' に切替が残っています');
    assert.ok(s.indexOf('LangSelect') < 0, f + ' に切替の欄が残っています');
  });
});

test('ページの言語の記載も日本語だけ', () => {
  const s = pub('index.html');
  assert.ok(s.indexOf('"inLanguage": "ja"') > 0, '対応言語の記載が直っていません');
  assert.ok(s.indexOf('"inLanguage": ["ja"') < 0, '多言語の記載が残っています');
  PAGE_FILES.forEach(f => {
    assert.ok(pub(f).indexOf('<html lang="ja">') >= 0, f + ' の lang が日本語ではありません');
  });
});

/* ここからが本題。使っているキーが、全部そろっているか。 */
function keysOf(src) {
  const out = new Set();
  /* data-i18n="k" / data-i18n-placeholder="k" / -title / -aria */
  const attr = /data-i18n(?:-placeholder|-title|-aria)?="([^"]+)"/g;
  let m;
  while ((m = attr.exec(src))) out.add(m[1]);
  return out;
}
function calledKeys(src) {
  const out = new Set();
  /* emuT('k') / emuT("k")。閉じ括弧か読点までを1つの鍵とする。
     emuT("i.cat." + name) のように継ぎ足して作るものは、
     ここでは鍵が決まらないので見ない（下で別に確かめる）。 */
  const call = /emuT\(\s*['"]([A-Za-z0-9_.]+)['"]\s*[,)]/g;
  let m;
  while ((m = call.exec(src))) out.add(m[1]);
  return out;
}

test('画面の data-i18n のキーは、すべて辞書にある', () => {
  const { win } = load();
  const missing = [];
  PAGE_FILES.forEach(f => {
    keysOf(pub(f)).forEach(k => {
      if (win.emuT(k) === k) missing.push(f + ' → ' + k);
    });
  });
  assert.deepEqual(missing, [], '辞書に無いキーがあります（画面にキー名が出ます）');
});

test('JS から emuT で引いているキーも、すべて辞書にある', () => {
  const { win } = load();
  const missing = [];
  PAGE_FILES.forEach(f => {
    calledKeys(pub(f)).forEach(k => {
      if (win.emuT(k) === k) missing.push(f + ' → ' + k);
    });
  });
  assert.deepEqual(missing, [], '辞書に無いキーがあります（画面にキー名が出ます）');
});

test('辞書の値は、すべて文字列', () => {
  const { win } = load();
  /* 値が undefined だと、キー名がそのまま出る。 */
  const keys = new Set();
  PAGE_FILES.forEach(f => { keysOf(pub(f)).forEach(k => keys.add(k)); });
  keys.forEach(k => assert.equal(typeof win.emuT(k), 'string', k + ' が文字列ではありません'));
});

test('辞書を足す口は、日本語だけ受け取る', () => {
  const { win } = load();
  win.emuRegisterI18n({ ja: { 'test.only': 'にほんご' }, en: { 'test.only': 'English' } });
  assert.equal(win.emuT('test.only'), 'にほんご');
});

/* 継ぎ足して作る鍵（emuT("i.cat." + name)）。
   棚ごと消えていないことだけ確かめる。 */
test('継ぎ足して引く鍵の棚も、残っている', () => {
  const { win } = load();
  assert.equal(win.emuT('i.cat.all'), 'すべて');
  ['i.cat.', 'i.focus.col.'].forEach(prefix => {
    assert.ok(PAGES.indexOf('"' + prefix) > 0, prefix + ' の棚が消えています');
  });
});
