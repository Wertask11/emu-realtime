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
  assert.ok(submit.indexOf("const allImages = _spLogKind === 'やってみた' ? _spLogImages.slice(0, SP_LOG_IMAGE_PICK_MAX) : [];") > 0);
  assert.ok(submit.indexOf("const images = chunks[0] || [];") > 0, '1件目には最初の束だけ');
  assert.ok(submit.indexOf("...(images.length ? { images: images, imageCount: images.length } : {})") > 0);
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

function saveHarness(setDoc, existsSeq) {
  const calls = { creates: [], reads: [], drops: [] };
  const seq = existsSeq.slice();
  const window = { db: {}, fbLib: {
    collection: (...a) => a.slice(1).join('/'),
    doc: (coll) => ({ id: 'LOG1', coll }),
    setDoc
  } };
  const api = build(INDEX, ['_spSoon', '_spLogSave'], {
    window,
    setTimeout: (fn) => { setImmediate(fn); return 1; },   /* 10秒を待たず、次の番で見切る */
    clearTimeout: () => {},
    _spRestDoc: async (path) => { calls.reads.push(path); return seq.shift() ? { author: '0xabc' } : null; },
    _spRestCreate: async (coll, id, data) => { calls.creates.push([coll, id, data]); return true; },
    _spRestDrop: (p) => calls.drops.push(p)
  }, 'const SP_LOG_SDK_WAIT_MS = 10000;\n');
  return { api, calls };
}

test('報告：SDK がすぐ返事をすれば、普通の通信は使わない', async () => {
  const { api, calls } = saveHarness(async () => {}, []);
  assert.deepEqual(await api._spLogSave('q1', { body: 'x' }), { id: 'LOG1' });
  assert.equal(calls.reads.length + calls.creates.length, 0);
});

test('報告：SDK が返事をしないとき、届いていなければ同じ番号で普通の通信で書いて確かめる', async () => {
  const never = () => new Promise(() => {});
  const { api, calls } = saveHarness(never, [false, true]);
  const data = { body: '（画像で提出）', images: ['data:image/jpeg;base64,AAAA'] };
  assert.deepEqual(await api._spLogSave('q1', data), { id: 'LOG1' });
  assert.equal(calls.creates.length, 1);
  assert.deepEqual(calls.creates[0], ['sp_quests/q1/logs', 'LOG1', data], '同じ番号で書くので二重にならない');
  assert.equal(calls.reads[0], 'sp_quests/q1/logs/LOG1?mask.fieldPaths=author', '画像まで読み直さない');
  assert.equal(calls.reads.length, 2);
});

test('報告：SDK が返事をしなくても、もう届いていれば書き直さない', async () => {
  const never = () => new Promise(() => {});
  const { api, calls } = saveHarness(never, [true]);
  assert.deepEqual(await api._spLogSave('q1', { body: 'x' }), { id: 'LOG1' });
  assert.equal(calls.creates.length, 0);
});

test('報告：普通の通信でも確かめられなければ、出せなかったと知らせる（例外）', async () => {
  const never = () => new Promise(() => {});
  const { api } = saveHarness(never, [false, false]);
  await assert.rejects(api._spLogSave('q1', { body: 'x' }));
});

test('報告：SDK が断ったら（決まりで拒否など）、そのまま知らせる', async () => {
  const { api, calls } = saveHarness(async () => { const e = new Error('no'); e.code = 'permission-denied'; throw e; }, []);
  await assert.rejects(api._spLogSave('q1', { body: 'x' }), (e) => e.code === 'permission-denied');
  assert.equal(calls.creates.length, 0);
});

test('画像は10枚まで選べ、記録1件に入る束（3枚・約90万字まで）に順番どおり分ける', () => {
  const api = build(INDEX, ['_spLogImageChunks'], {}, 'const SP_LOG_IMAGE_MAX = 3; const SP_LOG_IMAGE_TOTAL = 900000;\n');
  const img = (n, len) => 'i' + n + ':' + 'A'.repeat(len);
  const five = [1, 2, 3, 4, 5].map(n => img(n, 100));
  assert.deepEqual(api._spLogImageChunks(five).map(c => c.length), [3, 2], '提案資料5枚 → 3枚＋2枚');
  assert.deepEqual([].concat(...api._spLogImageChunks(five)), five, '順番は変えない');
  const big = [1, 2, 3].map(n => img(n, 400000));
  assert.deepEqual(api._spLogImageChunks(big).map(c => c.length), [2, 1], '合わせて90万字を超えないように分ける');
  assert.deepEqual(api._spLogImageChunks([]), []);
  assert.ok(INDEX.indexOf('const SP_LOG_IMAGE_PICK_MAX = 10;') > 0);
  assert.ok(INDEX.indexOf('<span class="spv-label">画像（任意・10枚まで）</span>') > 0);
});

test('4枚目からは「画像の続き」として、1件目につないだ報告にする（1件目のすぐ下に並ぶ時刻）', () => {
  const submit = INDEX.slice(INDEX.indexOf('async function spLogSubmit() {'));
  assert.ok(submit.indexOf("const more = { ...data, body: '（画像の続き ' + (k + 1) + '/' + chunks.length + '）',") > 0);
  assert.ok(submit.indexOf("at: data.at - k, sourceLogId: saved.id, images: chunks[k], imageCount: chunks[k].length };") > 0);
  assert.ok(submit.indexOf("if (lost) alert(") > 0, '続きが残せなかったら知らせる');
});

test('報告の一覧は画像を読まない（欄を絞った問い合わせ）。画像があり得る報告だけ控える', async () => {
  const calls = [];
  const memo = new Map();
  const api = build(INDEX, ['_spLogMayHaveImages', '_spReadLogs'], {
    _spRestGet: async (path, needAuth, fresh, post) => { calls.push([path, post]); return [
      { document: { name: 'p/sp_quests/q1/logs/A', fields: { kind: { stringValue: 'やってみた' }, at: { integerValue: '1791698978030' } } } },
      { document: { name: 'p/sp_quests/q1/logs/B', fields: { kind: { stringValue: 'やってみた' }, imageCount: { integerValue: '0' }, at: { integerValue: '1791698978030' } } } },
      { document: { name: 'p/sp_quests/q1/logs/C', fields: { kind: { stringValue: '気づいた' }, at: { integerValue: '1791698978030' } } } },
      { document: { name: 'p/sp_quests/q1/logs/D', fields: { kind: { stringValue: 'やってみた' }, at: { integerValue: '1700000000000' } } } },
      { readTime: 'x' }
    ]; },
    _spRestFields: (f) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.stringValue !== undefined ? v.stringValue : Number(v.integerValue)])),
    _spMemo: (k, ms, run) => { if (!memo.has(k)) memo.set(k, Promise.resolve().then(run)); return memo.get(k); },
    _spMemoDrop: (k) => memo.delete(k),
    _spReadAllOnce: async () => { throw new Error('丸ごと読んではいけない'); },
    console
  }, "const SP_READ_TTL_MS = 25000; const SP_LOG_FIELDS = ['author','kind','body','at','imageCount']; const SP_LOG_IMAGES_SINCE = 1791644400000;"
    + " const _spLogImageCache = new Map(); const _spLogImageWant = new Map(); globalThis.__want = _spLogImageWant;\n");
  const rows = await api._spReadLogs('q1');
  assert.deepEqual(rows.map(r => r.id), ['A', 'B', 'C', 'D']);
  assert.equal(calls[0][0], 'sp_quests/q1:runQuery');
  const fields = calls[0][1].structuredQuery.select.fields.map(f => f.fieldPath);
  assert.ok(fields.indexOf('images') < 0, '画像は一覧で読まない');
  assert.deepEqual([...globalThis.__want.keys()], ['A'], '画像があり得るのは、imageCount の無い今日以降の「やってみた」だけ');
  assert.ok(INDEX.indexOf("_spReadAll('sp_quests/' + encodeURIComponent(q.id) + '/logs')") < 0, 'クエストの報告は丸ごと読まない');
});

test('画像はあとから1件ずつ読み、クエストの報告と知恵カードの報告に足す', async () => {
  const states = [];
  const app = { state: {
    quests: [{ id: 'q1', logs: [{ id: 'A', images: [], imagesShow: 'none' }, { id: 'B' }] }],
    wisdom: [{ id: 'w', reports: [{ logId: 'A', images: [] }] }] },
    setState(fn) { const next = typeof fn === 'function' ? fn(this.state) : fn; states.push(next); Object.assign(this.state, next); } };
  const jpeg = 'data:image/jpeg;base64,AAAA';
  const reads = [];
  const api = build(INDEX, ['_spLogImagesFill'], {
    _spRestDoc: async (path) => { reads.push(path); return { images: [jpeg] }; },
    _spLogImageViews: (l) => (l.images || []).map(src => ({ src }))
  }, "const _spLogImageCache = new Map(); const _spLogImageWant = new Map([['A', 'sp_quests/q1/logs/A']]); let _spLogImagesBusy = false;\n");
  await api._spLogImagesFill(app);
  assert.deepEqual(reads, ['sp_quests/q1/logs/A?mask.fieldPaths=images'], '画像の欄だけを読む');
  assert.deepEqual(app.state.quests[0].logs[0].images, [{ src: jpeg }]);
  assert.equal(app.state.quests[0].logs[0].imagesShow, 'flex');
  assert.equal(app.state.quests[0].logs[1].images, undefined, 'ほかの報告は触らない');
  assert.deepEqual(app.state.wisdom[0].reports[0].images, [{ src: jpeg }]);
  await api._spLogImagesFill(app);
  assert.equal(reads.length, 1, '一度読んだ画像は読み直さない');
});

test('知恵ライブラリのカードは長いとたたみ、「詳細を見る」で全文と報告を出す', () => {
  const fold = DAO.slice(DAO.indexOf('  foldWisdom(w, s){'));
  const api = { foldWisdom: new Function('return function ' + fold.slice(2, fold.indexOf('\n  }\n') + 4))() };
  const self = { setState() {} };
  const short = api.foldWisdom.call(self, { id: 's', insight: '短い', from: 'a', experiment: 'b', reports: [] }, {});
  assert.equal(short.moreShow, 'none', '短いカードにはボタンを出さない');
  assert.equal(short.clampInsight, 'none');
  const long = { id: 'l', insight: 'あ'.repeat(80), from: 'x', experiment: 'y', hasReports: true, reports: [{}, {}] };
  const closed = api.foldWisdom.call(self, long, { wOpen: {} });
  assert.equal(closed.moreShow, 'block');
  assert.equal(closed.moreLabel, '詳細を見る（報告2件）');
  assert.equal(closed.clampInsight, '4');
  assert.equal(closed.clampMeta, '3');
  assert.equal(closed.reportsOn, false, 'たたんでいるあいだは報告を出さない');
  const opened = api.foldWisdom.call(self, long, { wOpen: { l: true } });
  assert.equal(opened.moreLabel, '閉じる');
  assert.equal(opened.clampInsight, 'none');
  assert.equal(opened.reportsOn, true);
  assert.ok(DAO.indexOf('-webkit-line-clamp:{{ w.clampInsight }}') > 0);
  assert.ok(DAO.indexOf('<sc-if value="{{ w.reportsOn }}">') > 0);
  assert.ok(DAO.indexOf('.map(w => this.foldWisdom(w, s))') > 0);
});
