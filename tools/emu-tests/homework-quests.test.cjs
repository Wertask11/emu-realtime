/* 受けているクエストを「自分の宿題」に並べる。どこにあったか探さなくていいように。
   あわせて、パソコンで SDK が返事をしないときに読み込みが止まらないようにした分。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readHtml, build } = require('../year-goals-tests/extract.cjs');

const INDEX = readHtml('frontend/public/index.html');
const DAO = readHtml('frontend/public/schoolpark/dao.html');

test('受けているクエスト（#000 以外）を宿題に並べ、次に出す報告と締切を添え、押すと詳細が開く', () => {
  assert.ok(DAO.indexOf("const myQuests = (s.quests || []).filter(q => q.iTook && !q.iDone && !q.isFounder).map(q => {") > 0);
  assert.ok(DAO.indexOf("next: next ? ('次：' + next.head + ' を出す')") > 0);
  assert.ok(DAO.indexOf(": '次：知恵カードを置く（報告は3つそろっています）',") > 0);
  assert.ok(DAO.indexOf('open: this.openExp(q.id)') > 0);
  /* ホームの「自分の宿題」とタスク管理の両方 */
  assert.equal(DAO.split('<sc-for list="{{ myQuests }}" as="mq">').length - 1, 2);
  assert.ok(DAO.indexOf('<sc-if value="{{ noHomework }}">') > 0, '受けているクエストがあるのに「何も残っていません」と出る');
  /* 「受けているクエスト」の数も、実際に受けた記録から数える */
  assert.ok(DAO.indexOf('myCommit:myQuests.length,') > 0);
  assert.equal(DAO.indexOf('myCommit:Object.values(s.committed)'), -1);
});

test('自分の宿題・ギルドの定義は共有の読み口で読む（SDK が止まっても待ち続けない）', () => {
  const tasks = INDEX.slice(INDEX.indexOf('window.spDaoLoadTasks = async function (app) {'));
  assert.ok(tasks.slice(0, 1200).indexOf("_spReadAll('sp_tasks/' + encodeURIComponent(p.uid) + '/items', 4000, true)") > 0);
  const guild = INDEX.slice(INDEX.indexOf('async function spGuildDefs(force) {'));
  assert.ok(guild.slice(0, 1200).indexOf("await _spReadAll('sp_guilds');") > 0);
  assert.equal(guild.slice(0, 1200).indexOf("getDocs(window.fbLib.collection(window.db, 'sp_guilds'))"), -1);
});

test('SDK が一度返事をしなかったら、しばらく（60秒）は SDK を待たずに普通の通信で読む', () => {
  const now = { t: 1000 };
  const api = build(INDEX, ['_spSdkStalled', '_spSdkNoted'], { Date: { now: () => now.t } },
    'var SP_SDK_STALL_MS = 60000; var _spSdkStallUntil = 0;\n');
  assert.equal(api._spSdkStalled(), false);
  api._spSdkNoted({ ok: true });
  assert.equal(api._spSdkStalled(), false, '返事があったときは止めない');
  api._spSdkNoted({ ok: null });
  assert.equal(api._spSdkStalled(), false, '転んだ（オフライン）だけでは止めない');
  api._spSdkNoted({ ok: false });
  assert.equal(api._spSdkStalled(), true, '待ちきれなかったら止める');
  now.t += 60001;
  assert.equal(api._spSdkStalled(), false, '60秒たったら、また SDK に聞く');
  const once = INDEX.slice(INDEX.indexOf('async function _spReadAllOnce(path, ms) {'));
  assert.ok(once.slice(0, 600).indexOf('!_spSdkStalled()') > 0);
});

test('完走した（運営が認めた）クエストは宿題から外し、「終わったこと」に並べる', () => {
  /* 自分の受けた記録に approved が立っていれば完走 */
  assert.ok(INDEX.indexOf("if (c.approved === true) { iDone = true; iDoneAt = Number(c.approvedAt) || 0; }") > 0);
  assert.ok(INDEX.indexOf('iTook: iTook, iDone: iDone, iDoneAt: iDoneAt,') > 0);
  assert.ok(DAO.indexOf("const myQuests = (s.quests || []).filter(q => q.iTook && !q.iDone && !q.isFounder).map(q => {") > 0, '完走したものまで宿題に残る');
  assert.ok(DAO.indexOf("const doneQuests = (s.quests || []).filter(q => q.iTook && q.iDone && !q.isFounder)") > 0);
  assert.ok(DAO.indexOf('<sc-for list="{{ doneQuests }}" as="dq">') > 0, '終わったことに出ていない');
  assert.ok(DAO.indexOf('noDoneTasks: doneTasks.length === 0 && doneQuests.length === 0,') > 0);
});

test('知恵カードを置いたら、すぐに「運営の確認を待つ」になる（取り置きを捨て、その場で印を立てる）', () => {
  /* この周回のぶんを置いたか：置いた枚数が、認められた周回より多いか */
  assert.ok(INDEX.indexOf('iWisdom = placed > myRounds;') > 0);
  assert.ok(INDEX.indexOf("mark: iWisdom ? '✓ 置いた' : '', markShow: iWisdom ? 'inline' : 'none' }]);") > 0);
  assert.ok(DAO.indexOf("q.iWisdom ? '次：運営の確認を待つ（報告3つと知恵カードはそろっています）'") > 0);
  /* 置いた直後：取り置いている知恵カードの一覧を捨て、読み直しを待たずに印を立て、クエストも読み直す */
  const sub = INDEX.slice(INDEX.indexOf('async function spWisdomSubmit'));
  const body = sub.slice(0, sub.indexOf('\n}\n'));
  assert.ok(body.indexOf("_spMemoDrop('readall:sp_wisdom');") > 0, '置く前の一覧が返る');
  assert.ok(body.indexOf('return Object.assign({}, q, { iWisdom: true, reportSteps: steps });') > 0);
  assert.ok(body.indexOf('window.spDaoLoadQuests(_spWisdomApp)') > 0);
  /* 報告を出した直後も、報告の取り置きを捨てる */
  assert.ok(INDEX.indexOf("_spMemoDrop('readall:sp_quests/' + encodeURIComponent(questId) + '/logs');") > 0);
});
