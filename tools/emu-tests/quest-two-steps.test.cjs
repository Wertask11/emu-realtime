/* 11/27 オーナー：「クエストって毎回報告を三回もしてなおかつ知恵カードおかないと行けないの？
   何をやるかを先に書いて、後でつまずいた所と経験から得た学び（知恵カード）を出せばいい。三回も報告はめんどい」。

   報告は2回にした。
     ① はじめに「何をやるか」（記録の種類は「やってみた」）
     ② 終わったら「つまずいたところと学び」… 1枚で「つまずいた」「気づいた」の報告と知恵カードを一度に残す
   残る記録（報告3種＋知恵カード1枚）は今までと同じなので、完走の確かめ方（サーバーとルール）は変えない。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readHtml, build } = require('../year-goals-tests/extract.cjs');

const INDEX = readHtml('frontend/public/index.html');
const DAO = readHtml('frontend/public/schoolpark/dao.html');

const LISTED = { id: 'q3', title: 'ゴミを拾う', series: 'general', questNumber: 3,
  deliverable: '・やってみた（＝開始宣言）どこで・何回拾うか\n・つまずいた（＝中間）止まったところ\n・気づいた（＝最終）分かったこと\n【知恵カード】1枚。拾って分かったことを一文で' };
const CASE = { id: 'q2', title: '案件', series: 'general', questNumber: 2, deliverable: '3案を出す' };
const TRIAL = { id: 'q1', title: '試す', series: 'general', questNumber: 1 };

function el() { return { value: '', textContent: '', innerHTML: '', hidden: false, disabled: false, tagName: 'TEXTAREA', id: '',
  addEventListener(type, fn) { this.on = fn; } }; }
function world(opts) {
  const els = {};
  const seen = { alerts: [], logs: [], posts: [], opened: false, celebrated: null };
  let wisdomFails = opts.wisdomFails || 0;
  const doc = {
    getElementById: (id) => { if (!els[id]) { els[id] = el(); els[id].id = id; if (/Guide$|^sfQuest$|^sfDid$/.test(id)) els[id].tagName = 'P'; } return els[id]; },
    body: { classList: { add: (c) => { if (c === 'sp-finish-open') seen.opened = true; }, remove: (c) => { if (c === 'sp-finish-open') seen.opened = false; } } }
  };
  const stubs = {
    document: doc,
    window: { spDaoLoadQuests: async () => {}, spDaoLoadWisdom: async () => {}, EmuAnalytics: null },
    alert: (m) => seen.alerts.push(m),
    SpQuestStore: { FOUNDER_ID: 'founder-quest-000' },
    spPassportLoad: async () => ({ addr: '0xabc', name: 'わたし', spid: 'SP-1' }),
    _spRestDoc: async (path) => path.includes('/commits/') ? (opts.took === false ? null : { approved: false })
      : Object.assign({}, opts.quest),
    _spReadLogs: async () => opts.logs || [],
    _spAllWisdom: async () => opts.wisdom || [],
    _spLogSave: async (questId, data) => { seen.logs.push(data); return { id: 'log' + seen.logs.length }; },
    _spMemoDrop: () => {},
    _spPendingQuestLogs: new Map(),
    fetch: async (url, init) => {
      seen.posts.push({ url, body: JSON.parse(init.body) });
      if (wisdomFails > 0) { wisdomFails--; return { ok: false, json: async () => ({ error: 'REPORTS_MISSING' }) }; }
      return { ok: true, json: async () => ({ ok: true }) };
    },
    emuAuthHeaders: async () => ({}),
    _spWisdomErrorText: (d) => String(d.error || ''),
    _spTryFirstSentence: (t, n) => String(t).split('。')[0].slice(0, n),
    spWisdomCelebrate: (insight) => { seen.celebrated = insight; },
    _emuEsc: (t) => String(t),
    _spLogFetchPosts: async () => (opts.posts || []).map((x) => Object.assign({ tags: '', name: 'わたし', body: '', at: 1 }, x))
  };
  const api = build(INDEX, ['spQuestReportGuide', 'spQuestFirstStep', 'spQuestFinish', 'spFinishSubmit',
    '_spFinishShowPosts', '_spFinishRenderPosts', '_spFinishRenderPick', '_spFinishClearPick'], stubs,
    "const SP_LOG_KINDS = ['やってみた', 'つまずいた', '気づいた']; let _spFinish = null, _spFinishBusy = false, _spLogPosts = null;");
  return { api, els, seen };
}
const DID = { id: 'd1', kind: 'やってみた', author: '0xABC', body: '近所の公園で3回拾う。袋は2つ。', at: 1, fromPostId: '', fromPostTitle: '' };

test('② で、つまずいた・気づいた の報告と知恵カードが一度に残る（学びが知恵カードの一文になる）', async () => {
  const w = world({ quest: LISTED, logs: [DID] });
  await w.api.spQuestFinish('q3', null);
  assert.equal(w.seen.opened, true, '② の画面が開く');
  assert.match(w.els.sfDid.textContent, /はじめに書いたこと：近所の公園で3回拾う/);
  assert.equal(w.els.sfStuckGuide.textContent, '止まったところ', 'このクエストの「つまずいた」の書き方を出す');
  w.els.sfStuck.value = '雨で1回できなかった';
  w.els.sfInsight.value = '朝のほうがゴミが多い';
  await w.api.spFinishSubmit();
  assert.deepEqual(w.seen.logs.map(l => [l.kind, l.body, l.sourceLogId]),
    [['つまずいた', '雨で1回できなかった', 'd1'], ['気づいた', '朝のほうがゴミが多い', 'd1']]);
  assert.equal(w.seen.posts.length, 1);
  assert.match(w.seen.posts[0].url, /\/quest-completions\/q3\/wisdom$/);
  assert.equal(w.seen.posts[0].body.insight, '朝のほうがゴミが多い');
  assert.equal(w.seen.posts[0].body.experiment, '近所の公園で3回拾う', '通した経験は ① から入る');
  assert.equal(w.seen.celebrated, '朝のほうがゴミが多い');
  assert.equal(w.seen.opened, false, '出したら閉じる');
});

test('つまずいたところは空でも出せる（「特になし」で残る）。学びが空なら出さない', async () => {
  const w = world({ quest: LISTED, logs: [DID] });
  await w.api.spQuestFinish('q3', null);
  await w.api.spFinishSubmit();
  assert.equal(w.seen.logs.length, 0);
  assert.match(w.seen.alerts[0], /学びを書いてください/);
  w.els.sfInsight.value = '学び';
  await w.api.spFinishSubmit();
  assert.deepEqual(w.seen.logs.map(l => l.body), ['（特になし）', '学び']);
});

test('① をまだ出していなければ、② は開かず「先に①」と出す（種類ごとの呼び名で）', async () => {
  for (const [quest, name] of [[LISTED, '① 何をやるか'], [CASE, '① 提出物を出す'], [TRIAL, '① やったこと']]) {
    const w = world({ quest, logs: [] });
    await w.api.spQuestFinish(quest.id, null);
    assert.equal(w.seen.opened, false);
    assert.ok(w.seen.alerts[0].includes('先に「' + name + '」を出してください'), w.seen.alerts[0]);
  }
});

test('知恵カードで断られたら、出し直しで報告を二重に書かない（知恵カードだけ置き直す）', async () => {
  const w = world({ quest: LISTED, logs: [DID], wisdomFails: 1 });
  await w.api.spQuestFinish('q3', null);
  w.els.sfInsight.value = '学び';
  await w.api.spFinishSubmit();
  assert.equal(w.seen.logs.length, 2);
  assert.match(w.seen.alerts.at(-1), /記録に残しました/);
  assert.equal(w.seen.opened, true, '画面は開いたまま');
  await w.api.spFinishSubmit();
  assert.equal(w.seen.logs.length, 2, '報告は増えない');
  assert.equal(w.seen.posts.length, 2);
  assert.equal(w.seen.opened, false);
});

test('前の周を運営がまだ確かめていなければ、② は開かない', async () => {
  const w = world({ quest: LISTED, logs: [DID], wisdom: [{ questId: 'q3', author: '0xabc' }] });
  await w.api.spQuestFinish('q3', null);
  assert.equal(w.seen.opened, false);
  assert.match(w.seen.alerts[0], /運営が確かめているところ/);
});

test('完走までの手順は ① と ② の2つ。クエストの詳細のボタンも2つで、知恵カードだけを置くボタンは出さない', () => {
  const steps = INDEX.slice(INDEX.indexOf('    reportSteps: (function () {'), INDEX.indexOf('    /* やってみた記録（1枚）で出してよいクエストか'));
  assert.ok(steps.includes("{ no: '2', head: spQuestFirstStep(q)"));
  assert.ok(steps.includes("{ no: '3', head: '② '"));
  assert.equal((steps.match(/\{ no: '/g) || []).length, 2, '手順は2つ');
  assert.ok(DAO.includes('onClick="{{ cur.logDid }}"') && DAO.includes('>{{ cur.firstLabel }}</div>'));
  assert.ok(DAO.includes('onClick="{{ cur.finish }}"') && DAO.includes('>② つまずいたところと学び</div>'));
  assert.ok(DAO.includes("finish: () => { try { window.parent.spQuestFinish(e.id, this); } catch (err) {} },"));
  assert.ok(!DAO.includes('{{ cur.logStuck }}') && !DAO.includes('{{ cur.logFound }}'), '3回に分けるボタンは出さない');
  assert.ok(!DAO.includes('onClick="{{ cur.wisdom }}"'), '知恵カードだけを置くボタンは出さない（② で置く）');
  assert.ok(DAO.includes('value="{{ cur.canFinishLate }}"'), '締め切ったあとも ② を出せる');
  assert.ok(DAO.includes('>4</div>') && DAO.includes('運営が確認して完走'));
});

/* 11/27 ② で Emu の投稿を紐づける（#003 PLAY・特殊）。① で選んでいれば引き継ぎ、選んでいなければ ② で選べる */
const POSTQ = { id: 'qs2', title: '解剖フェス', series: 'special', questNumber: 2,
  deliverable: '【Emu への投稿】\n・会場で書いたもの\n\n' + LISTED.deliverable };
const tick = () => new Promise((r) => setTimeout(r, 0));

test('② で投稿を選べる：① で選んでいなければ、選んだ投稿が報告2つと知恵カードに付く', async () => {
  const w = world({ quest: POSTQ, logs: [DID], posts: [{ id: 'p9', title: '会場の写真' }] });
  await w.api.spQuestFinish('qs2', null);
  await tick();
  assert.equal(w.els.sfPostBox.hidden, false, '投稿を紐づけるクエストでは出す');
  assert.match(w.els.sfResults.innerHTML, /data-pid="p9"/);
  w.els.sfResults.on({ target: { closest: () => ({ dataset: { pid: 'p9' } }) } });
  assert.match(w.els.sfPicked.innerHTML, /会場の写真/);
  w.els.sfInsight.value = '学び';
  await w.api.spFinishSubmit();
  assert.deepEqual(w.seen.logs.map((l) => l.fromPostId), ['p9', 'p9']);
  assert.equal(w.seen.posts[0].body.fromPostId, 'p9');
  assert.equal(w.seen.posts[0].body.knowledge, '会場の写真');
});

test('② の投稿：① で選んだ投稿は引き継ぎ、外せない。紐づけないクエストでは欄を出さない', async () => {
  const w = world({ quest: POSTQ, logs: [Object.assign({}, DID, { fromPostId: 'p1', fromPostTitle: '拾う前' })] });
  await w.api.spQuestFinish('qs2', null);
  assert.equal(w.els.sfPostBox.hidden, false);
  assert.match(w.els.sfPicked.innerHTML, /拾う前/);
  assert.doesNotMatch(w.els.sfPicked.innerHTML, /外す/);
  w.els.sfInsight.value = '学び';
  await w.api.spFinishSubmit();
  assert.deepEqual(w.seen.logs.map((l) => l.fromPostId), ['p1', 'p1']);
  const plain = world({ quest: LISTED, logs: [DID] });
  await plain.api.spQuestFinish('q3', null);
  assert.equal(plain.els.sfPostBox.hidden, true);
});

/* 11/27 オーナー：「クエストの説明文も今にあわせて」。出したクエストの記録は書き換えられないので、画面に出すときに言い方を合わせる */
test('クエストの説明文は ①・② の言い方で見せる。記録の文は変えず、報告の読み取りは記録のままの文から', () => {
  const fs = require('node:fs'), path = require('node:path');
  const text = build(INDEX, ['spQuestTextNow'], {},
    INDEX.slice(INDEX.indexOf('const SP_QUEST_TEXT_NOW'), INDEX.indexOf('function spQuestTextNow')));
  const dir = path.join(__dirname, '../quest-seeds');
  let changed = 0;
  for (const f of fs.readdirSync(dir)) for (const q of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) {
    for (const k of ['brief', 'deliverable', 'criteria']) {
      const now = text.spQuestTextNow(q[k]);
      if (now !== String(q[k] || '')) changed++;
      assert.doesNotMatch(now, /3種類|報告3回|【SchoolPark の報告】3回|^・(やってみた|つまずいた|気づいた)（＝|→\s*(やってみた|つまずいた|気づいた)\s*$|報告が3種類|最初の報告/m, q.title + ' ' + k);
    }
  }
  assert.ok(changed >= 15, '日を分けるクエストの説明文が変わる');
  const shape = INDEX.slice(INDEX.indexOf('async function _spShapeQuest('), INDEX.indexOf('    reportSteps: (function () {'));
  assert.ok(shape.includes('brief: spQuestTextNow(q.brief)') && shape.includes('deliverable: spQuestTextNow(q.deliverable), criteria: spQuestTextNow(q.criteria)'));
  const w = world({ quest: LISTED, logs: [DID] });
  assert.equal(w.api.spQuestReportGuide(LISTED).kind, 'listed', '読み取りは記録の文のまま');
});
