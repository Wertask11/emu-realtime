/* 11/27 オーナー：「冷蔵庫くんに頼む」を分かりやすく。
   「文で指示する → 5 EMUER かかる → 承認 → 実行 → 結果提示」。「今の頼むの画面、文字多すぎるし、そんなのいらん」。
   「これしてほしい」「あれ持ってきて」に、もっとスピーディーにシンプルに、エージェントとして動いて。

   画面（frontend/public/economy/）は1画面にした。料金・返却・台帳・AI送信の決まり（backend/economy）は変えていない。
   やることは本人が選ばなくてよい（頼んだ文から選ぶ）。確認の札で選び直せる。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '../../frontend/public/economy');
const APP = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const pickTask = eval('(' + APP.slice(APP.indexOf('  function pickTask('), APP.indexOf('  function availableTasks(')).trim()
  .replace(/^function pickTask/, 'function') + ')');
const ALL = ['knowledge_draft', 'quest_plan', 'guild_plan', 'city_comparison', 'wil_plan'];

test('頼んだ文から、やることを選ぶ。「持ってきて・探して」は探して持ってくる。「作って・準備・計画」は話題に合う作業', () => {
  const cases = {
    'いま受けられるクエストを持ってきて': '',
    'LEARNギルドってどこ？': '',
    'コーヒーを学びたい': '',
    '今のEMUERで何ができる？Cityで使えるものを持ってきて': '',
    '気づいたことを知識の投稿にしたいので、下書きを作って': 'knowledge_draft',
    'クエスト#003の準備をして': 'quest_plan',
    'WEB3ギルドの活動計画を作って': 'guild_plan',
    'Cityで交換できるものを比べてまとめて': 'city_comparison',
    '探究の計画を作りたい': 'wil_plan'
  };
  for (const [goal, want] of Object.entries(cases)) assert.equal(pickTask(goal, ALL), want, goal);
  assert.equal(pickTask('クエスト#003の準備をして', ['guild_plan']), '', '使えない作業は選ばない（探して持ってくる）');
});

test('1画面：頼む → 確認（5 EMUER）→ 承認して実行 → 結果。同意のチェック欄は置かず、押すボタンと、その上の一文で伝える', () => {
  const order = ['id="requestForm"', 'id="goal"', 'id="quoteButton"', 'id="approval"', 'id="pay"', 'id="historySection"'];
  const at = order.map((s) => HTML.indexOf(s));
  assert.ok(at.every((x, i) => x > 0 && (i === 0 || x > at[i - 1])), '上から順に並ぶ');
  assert.match(HTML, /頼む（5 EMUER）/);
  assert.match(HTML, /承認して実行（5 EMUER）/);
  assert.ok(!/id="paymentConsent"|id="aiConsent"/.test(HTML), '同意のチェック欄は無い');
  assert.ok(!/\$\("paymentConsent"\)|\$\("aiConsent"\)/.test(APP));
  const approval = HTML.slice(HTML.indexOf('id="approval"'), HTML.indexOf('id="historySection"'));
  assert.match(approval, /5 EMUERを払い/, '払う額を札に書く');
  assert.match(approval, /id="aiConsentText"/, 'AIへ送るものを札に書く');
  assert.match(approval, /privacy\.html/);
  assert.ok(APP.includes('paymentConsent: true,') && APP.includes('aiConsent: true,'), 'サーバーへは今までどおり同意を送る');
  /* 長い条件・内訳・保存した計画は「くわしく」にたたむ */
  const more = HTML.slice(HTML.indexOf('class="agent-more agent-footer"'));
  for (const id of ['loadArtifacts', 'wallet', 'paymentMethod', 'balanceConsent', 'simulate', 'workLimit'])
    assert.ok(more.includes('id="' + id + '"'), id + ' は「くわしく」の中');
});

test('自動で選んだ作業が使えないときは、まだ払う前に「探して持ってくる」で確かめ直す。本人が選んだときは選び直さない', () => {
  const submit = APP.slice(APP.indexOf('if (!kindChosen) $("taskType").value = pickTask('), APP.indexOf('$("paymentMethod").addEventListener("change"'));
  assert.ok(submit.includes('kindChosen ||'));
  for (const code of ['WORK_MATERIAL_UNAVAILABLE', 'WORK_SOURCE_DISABLED', 'WORKFLOW_DISABLED', 'INVALID_WORK_TYPE']) assert.ok(submit.includes('"' + code + '"'));
  assert.ok(submit.includes('d = await ask("");'));
  assert.ok(!submit.includes('/jobs'), '確かめるだけ（支払いは「承認して実行」だけ）');
});
