/* クエストの「やってみた」に画像を添える分と、自分の宿題のチェックが効かなかった分。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readHtml, build } = require('../year-goals-tests/extract.cjs');

const INDEX = readHtml('frontend/public/index.html');
const DAO = readHtml('frontend/public/schoolpark/dao.html');
const RULES = readHtml('firestore.rules');

const CONSTS = "const SP_LOG_IMAGE_MAX = 3; const SP_LOG_IMAGE_EACH = 600000;"
  + " const SP_LOG_IMAGE_RE = /^data:image\\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;\n";

test('報告の画像は、画像の data URL だけを3枚まで出し、それ以外の文字列は捨てる', () => {
  const api = build(INDEX, ['_spLogImageViews'], { _spLogOpenImage: () => {} }, CONSTS);
  const jpeg = 'data:image/jpeg;base64,' + 'A'.repeat(40);
  const views = api._spLogImageViews({ images: [jpeg, 'javascript:alert(1)', 'https://example.com/x.jpg', jpeg, jpeg, jpeg] });
  assert.equal(views.length, 3);
  assert.ok(views.every(v => v.src === jpeg && typeof v.open === 'function'));
  assert.deepEqual(api._spLogImageViews({}), [], '画像の無い報告（これまでの報告）は空');
  assert.deepEqual(api._spLogImageViews({ images: 'data:image/jpeg;base64,AAAA' }), [], '配列でなければ出さない');
});

test('「やってみた」の札に画像を選ぶ欄があり、出すときに images として残す（ほかの種類では出さない）', () => {
  assert.ok(INDEX.indexOf('<div id="slImageWrap" hidden>') > 0);
  assert.ok(INDEX.indexOf('accept="image/*" multiple hidden onchange="_spLogAddImages(this)"') > 0);
  assert.ok(INDEX.indexOf("if (imgWrap) imgWrap.hidden = kind !== 'やってみた';") > 0);
  const submit = INDEX.slice(INDEX.indexOf('async function spLogSubmit() {'));
  assert.ok(submit.indexOf("const images = _spLogKind === 'やってみた' ? _spLogImages.slice(0, SP_LOG_IMAGE_MAX) : [];") > 0);
  assert.ok(submit.indexOf("...(images.length ? { images: images } : {})") > 0);
  assert.ok(submit.indexOf("body: (text || '（画像で提出）').slice(0, 2000)") > 0, '画像だけでも本文を空にしない');
  /* 圧縮は JPEG。決まり（rules）が JPEG だけを通すので揃える */
  assert.ok(INDEX.indexOf("out = canvas.toDataURL('image/jpeg', tries[i][1]);") > 0);
});

test('クエストの報告一覧と知恵カードの報告に、添えた画像を出す', () => {
  assert.ok(DAO.indexOf('<div style="display:{{ l.imagesShow }}; flex-wrap:wrap; gap:8px; min-width:0"><sc-for list="{{ l.images }}" as="im">') > 0);
  assert.ok(DAO.indexOf('<sc-for list="{{ r.images }}" as="im">') > 0);
  assert.ok(INDEX.indexOf("images:_spLogImageViews(l), imagesShow:_spLogImageViews(l).length ? 'flex' : 'none',") > 0);
});

test('決まり：画像は「やってみた」だけ、JPEG の data URL を3枚まで、1枚60万字まで', () => {
  const logs = RULES.slice(RULES.indexOf('match /logs/{logId} {'));
  const block = logs.slice(0, logs.indexOf('allow update, delete: if false;'));
  assert.ok(block.indexOf("request.resource.data.get('images', []).size() <= 3") > 0);
  assert.ok(block.indexOf("|| request.resource.data.get('kind', '') == 'やってみた')") > 0);
  for (const i of [0, 1, 2]) {
    assert.ok(block.indexOf("request.resource.data.images[" + i + "].matches('data:image/jpeg;base64,[A-Za-z0-9+/=]+')") > 0);
    assert.ok(block.indexOf("request.resource.data.images[" + i + "].size() <= 600000") > 0);
  }
});

function taskHarness(updateDoc, saved) {
  const calls = { patch: [], alerts: [], states: [], loaded: 0 };
  const app = { state: { tasks: [{ id: 't1', title: 'まとめた企画書をXに乗せる', done: false }] },
    setState(s) { calls.states.push(s); Object.assign(this.state, s); } };
  const window = {
    fbLib: { updateDoc, doc: (...a) => a.slice(1).join('/') },
    db: {},
    spDaoLoadTasks: async () => { calls.loaded++; }
  };
  const api = build(INDEX, ['_spSoon', 'spTaskToggle'], {
    window,
    setTimeout: (fn) => { setImmediate(fn); return 1; },   /* 8秒を待たず、次の番で見切る */
    clearTimeout: () => {},
    spPassportLoad: async () => ({ uid: 'uid-1' }),
    _spRestPatch: async (path, fields) => { calls.patch.push([path, fields]); },
    _spRestDoc: async () => saved,
    _spRestDrop: () => {},
    alert: (m) => calls.alerts.push(m),
    console: { warn: () => {} }
  });
  return { api, app, calls };
}

test('宿題のチェック：SDK が返事をしなくても、普通の通信で書いて確かめ、チェックが付く', async () => {
  const never = () => new Promise(() => {});
  const { api, app, calls } = taskHarness(never, { done: true });
  await api.spTaskToggle(app, 't1', true);
  assert.equal(calls.patch.length, 1, 'SDK を待ちきれなかったら普通の通信で書く');
  assert.equal(calls.patch[0][0], 'sp_tasks/uid-1/items/t1');
  assert.equal(calls.patch[0][1].done, true);
  assert.equal(app.state.tasks[0].done, true, '押した見た目がすぐ変わる');
  assert.deepEqual(calls.alerts, []);
  assert.equal(calls.loaded, 1);
});

test('宿題のチェック：SDK がすぐ返事をすれば、普通の通信は使わない', async () => {
  const { api, app, calls } = taskHarness(async () => {}, null);
  await api.spTaskToggle(app, 't1', true);
  assert.equal(calls.patch.length, 0);
  assert.equal(app.state.tasks[0].done, true);
});

test('宿題のチェック：書けたと確かめられなければ、見た目を元に戻して知らせる', async () => {
  const never = () => new Promise(() => {});
  const { api, app, calls } = taskHarness(never, { done: false });
  await api.spTaskToggle(app, 't1', true);
  assert.equal(app.state.tasks[0].done, false);
  assert.equal(calls.alerts.length, 1);
  assert.equal(calls.loaded, 0);
});

test('完走したクエストは「✓ 完走した」（2周以上なら周回も）。押しても降りる確認は出さず、詳細を開く', () => {
  const dec = DAO.slice(DAO.indexOf('  decorate(e){'));
  assert.ok(dec.indexOf("const done = on && !!e.iDone;") > 0);
  assert.ok(dec.indexOf("const doneLabel = '✓ 完走した' + (rounds > 1 ? '（' + rounds + '周）' : '');") > 0);
  assert.ok(dec.indexOf("commit: done ? this.openExp(e.id) : this.commit(e.id),") > 0);
  assert.ok(dec.indexOf("btnLabel: done ? doneLabel : on ? '✓ 受けている' : 'このクエストを受ける',") > 0);
  assert.ok(INDEX.indexOf('iTook: iTook, iDone: iDone, iDoneAt: iDoneAt, myRounds: myRounds,') > 0);
});

test('完走を認められた記録からは降りられない（降りると完走の記録が消えるため）', () => {
  const t = INDEX.slice(INDEX.indexOf('const cur = await _spRestDoc(path, true, true);'));
  const guard = t.indexOf("if (cur && (cur.approved === true || Number(cur.approvedRounds) > 0)) {");
  assert.ok(guard > 0 && guard < t.indexOf("if (!confirm('このクエストから降りますか？')) return;"));
});

function approvalHarness(commit) {
  const calls = { reads: [], changed: 0, timers: [] };
  const api = build(INDEX, ['_spWatchApprovals', '_spCheckApprovals'], {
    setTimeout: (fn) => { calls.timers.push(fn); return calls.timers.length; },
    clearTimeout: () => {},
    document: { visibilityState: 'visible' },
    _spLastTouch: Date.now(), SP_IDLE_STOP_MS: 60000,
    _spRestDoc: async (path) => { calls.reads.push(path); return commit(); },
    _spOnQuestChanged: () => { calls.changed++; },
    Date
  }, 'const SP_APPROVAL_POLL_MS = 20000; let _spApprovalTimer = null; let _spApprovalWaiting = [];\n');
  return { api, calls };
}

test('承認待ち（知恵カードを置いた）のクエストだけを見張り、運営が認めたらすぐ読み直す', async () => {
  let approved = false;
  const { api, calls } = approvalHarness(() => (approved ? { approved: true, approvedRounds: 1 } : { approved: false }));
  api._spWatchApprovals([
    { id: 'wait', iTook: true, iWisdom: true, myRounds: 0 },
    { id: 'notyet', iTook: true, iWisdom: false, myRounds: 0 },
    { id: 'founder', iTook: true, iWisdom: true, isFounder: true },
    { id: 'other', iTook: false, iWisdom: false }
  ], '0xabc');
  assert.equal(calls.timers.length, 1, '見張りを1つ張る');
  await calls.timers.shift()();
  assert.deepEqual(calls.reads, ['sp_quests/wait/commits/0xabc'], '承認待ちの1本だけを読む');
  assert.equal(calls.changed, 0);
  assert.equal(calls.timers.length, 1, 'まだなら次の回を予約する');
  approved = true;
  await calls.timers.shift()();
  assert.equal(calls.changed, 1, '認められたらすぐ読み直す（完走したに変わる）');
  assert.equal(calls.timers.length, 0);
});

test('2周目の承認も見分ける（認めた周回が増えたときだけ読み直す）', async () => {
  let rounds = 1;
  const { api, calls } = approvalHarness(() => ({ approved: true, approvedRounds: rounds }));
  api._spWatchApprovals([{ id: 'q', iTook: true, iDone: true, iWisdom: true, myRounds: 1 }], '0xabc');
  await calls.timers.shift()();
  assert.equal(calls.changed, 0, '1周目の承認のままなら何もしない');
  rounds = 2;
  await calls.timers.shift()();
  assert.equal(calls.changed, 1);
});

test('承認待ちが無ければ見張らない（読み取りを使わない）', () => {
  const { api, calls } = approvalHarness(() => null);
  api._spWatchApprovals([{ id: 'q', iTook: true, iDone: true, iWisdom: false, myRounds: 1 }], '0xabc');
  api._spWatchApprovals([{ id: 'q', iTook: true, iWisdom: true }], '');
  assert.equal(calls.timers.length, 0);
});
