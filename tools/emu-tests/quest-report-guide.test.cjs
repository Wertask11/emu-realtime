/* クエストごとの「報告の仕方」。

   完走の決まり（やってみた・つまずいた・気づいた の3つの報告と知恵カード → 運営が確認）は
   どのクエストも同じ。ところが #002 WORK（案件もの15本）には、提出物（3案など）を
   どの報告に書けばいいのかがどこにも無く、報告の画面には #001 向けの
   「試したEmuの投稿を選び…」が出ていた。
   クエストの「提出するもの」から読み、無ければ案件ものの決まった読み方を出す。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { readHtml, build } = require('../year-goals-tests/extract.cjs');

const INDEX = readHtml('frontend/public/index.html');
const DAO = readHtml('frontend/public/schoolpark/dao.html');
const SEEDS = path.join(__dirname, '..', 'quest-seeds');
const seeds = (f) => JSON.parse(fs.readFileSync(path.join(SEEDS, f), 'utf8'));
assert.ok(INDEX.indexOf("const SP_LOG_KINDS = ['やってみた', 'つまずいた', '気づいた'];") > 0);
const { spQuestReportGuide } = build(INDEX, ['spQuestReportGuide'], { SP_LOG_KINDS: ['やってみた', 'つまずいた', '気づいた'] });

test('#002 WORK の15本は、提出物を「やってみた」で出す読み方になる', () => {
  const work = seeds('general-002-work.json');
  assert.equal(work.length, 15);
  for (const q of work) {
    const g = spQuestReportGuide(q);
    assert.equal(g.kind, 'case', q.title);
    assert.equal(g.steps['やってみた'].as, '提出');
    assert.ok(g.steps['やってみた'].ask.indexOf('提出するもの') >= 0);
    assert.ok(g.steps['つまずいた'].ask && g.steps['気づいた'].ask && g.wisdom);
    assert.equal(g.wantsPost, false, 'WORK に Emu への投稿は無い');
  }
});

test('「提出するもの」に報告の意味が書いてあるクエストは、そこから読む（#003・#004・#005・特殊）', () => {
  const play = spQuestReportGuide(seeds('general-003-play.json')[0]);
  assert.equal(play.kind, 'listed');
  assert.deepEqual(play.steps['やってみた'], { as: '開始宣言', ask: 'どこで・何回拾うか' });
  assert.deepEqual(play.steps['気づいた'], { as: '最終報告', ask: '拾い終わって分かったこと' });
  assert.equal(play.wantsPost, true, '#003 は Emu の投稿を報告に紐づける');

  const [connect, web3] = seeds('general-004-005.json');
  const c = spQuestReportGuide(connect);
  assert.equal(c.steps['つまずいた'].as, '会に参加');
  assert.equal(c.wantsPost, false);
  assert.equal(c.wisdom, '会で得たことと、次に誰とつながりたいか。');
  /* 次の行に続く書き方（全角の字下げ）もつなげて読む */
  assert.equal(spQuestReportGuide(web3).steps['気づいた'].ask,
    '発信の場合：投稿のURL／招待の場合：招待した人の Passport の名前');

  for (const q of seeds('special-001-002.json')) {
    const g = spQuestReportGuide(q);
    assert.equal(g.kind, 'listed', q.title);
    assert.equal(g.wantsPost, true, q.title);
  }
  const stuck = spQuestReportGuide(seeds('special-001-002.json')[0]).steps['つまずいた'].ask;
  assert.equal(stuck, '調べて分かったこと／分からなかったこと、自分の足で取った一次ファクト（どこで・誰に・何を）、AI をどこで使ったか');
});

test('仮説検証の形（#001 LEARN など、提出物の欄が無い）は今までの文のまま', () => {
  const g = spQuestReportGuide({ series: 'general', questNumber: 1, hypothesis: '…', action: '…' });
  assert.equal(g.kind, 'trial');
  /* #001 は試した投稿を選ばないと報告を出せない。手順にもそう書く */
  assert.ok(g.steps['やってみた'].ask.indexOf('（必須）') > 0);
  const other = spQuestReportGuide({ series: 'general', questNumber: 7, hypothesis: '…' });
  assert.equal(other.kind, 'trial');
  assert.equal(other.steps['やってみた'].ask.indexOf('（必須）'), -1);
  assert.equal(spQuestReportGuide(null).kind, 'trial');
});

test('報告の画面：#001 以外は、その報告がこのクエストで何を指すかを出す', () => {
  const i = INDEX.indexOf('window.spQuestLog = async function (questId, kind, app) {');
  const body = INDEX.slice(i, INDEX.indexOf('\n};\n', i));
  assert.ok(body.indexOf("if (rg && rg.kind !== 'trial' && !_spLogRequiresPost) {") > 0, '#001 の文を上書きしてしまう');
  assert.ok(body.indexOf("postLabel.textContent = rg.wantsPost ? 'このクエストで出したEmuの投稿' : '関係するEmuの投稿（任意）';") > 0);
  /* 完走の決まりは変えない：つまずいた・気づいた は、やってみた のあと */
  assert.ok(body.indexOf("alert('先に「やってみた」で最初の報告を出してください。')") > 0);
});

test('クエストの詳細に「完走までの手順」が出る（#000 には出さない）', () => {
  assert.ok(DAO.indexOf('<sc-if value="{{ cur.showSteps }}">') > 0);
  assert.ok(DAO.indexOf('<sc-for list="{{ cur.reportSteps }}" as="s"') > 0);
  assert.ok(DAO.indexOf("showSteps: !e.isFounder && !!(e.reportSteps && e.reportSteps.length),") > 0);
  assert.ok(DAO.indexOf('{{ cur.logLead }}') > 0);
  assert.ok(INDEX.indexOf("? '提出物は「やってみた」で出します'") > 0);
});

test('知恵カードの札に、このクエストで何を書くかを出す', () => {
  assert.ok(INDEX.indexOf('<p class="spp-note" id="swGuide" hidden style="margin:0 0 6px"></p>') > 0);
  assert.ok(INDEX.indexOf("wg.textContent = g.kind !== 'trial' && g.wisdom ? 'このクエストでは：' + g.wisdom : '';") > 0);
});
