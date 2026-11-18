'use strict';
/* 知識を試す（SchoolPark）を引っぱって読み直したとき（11/18 オーナー「読み直したんならちゃんと表示して」）

   見ること
     ・ギルドの5枚は、パスポート・信用・議題の読み込みが返ってこなくても先に出る（前は見出しと決まりだけで空だった）
     ・引っぱったときは8秒の間引きを飛ばして、必ず読み直す
     ・読み直せなかった（画面が無い・時間内に終わらない・全部転んだ・ギルドが出ていない）ときは false を返す
     ・Emu の emuInAppRefresh は、そのとき失敗を返す（引っぱった画面に「読み直せませんでした」と出る）
   本物のサーバーやアカウントは使わない。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readHtml, grab, build } = require('../year-goals-tests/extract.cjs');

const INDEX = readHtml('frontend/public/index.html');
const never = () => new Promise(() => {});
/* 見切りの時間だけ短くした _spSoon（中身は本物） */
const realSoon = build(INDEX, ['_spSoon'], {})._spSoon;
const fastSoon = (p, ms) => realSoon(p, Math.min(Number(ms) || 4000, 60));

function fakeApp() {
  const app = { state: {}, calls: [], setState(s) { this.calls.push(s); Object.assign(this.state, s); } };
  return app;
}
const DEFS = [
  { id: 'learn', code: 'G-01', short: 'LEARN', name: '学び', concept: '学ぶ', accent: '#0F5C3F' },
  { id: 'make', code: 'G-02', short: 'MAKE', name: 'つくる', concept: 'つくる', accent: '#333' }];

function loadVotes(over = {}) {
  const window = Object.assign({ db: {}, fbLib: { query() {}, collection() {}, orderBy() {}, limit() {}, getDocs: never }, spCanGuild: never, spTrustScore: async () => null }, over.window || {});
  return build(INDEX, ['spDaoLoadVotes', '_spGuildCard'], {
    window,
    spGuildDefs: async () => DEFS,
    spPassportLoad: over.spPassportLoad || never,
    _spSoon: fastSoon,
    _spWarnDenied() {},
    _spAllQuests: async () => [],
    _spReadAll: async () => null,
    _spVoteClosed: () => false,
    _spCountLabel: (n) => (n == null ? '—' : String(n)),
    SpGuildStore: { guildIdOf: () => null },
    SpQuestStore: { isFounder: () => false },
    SP_TRUST_NEED: 30
  }, 'let _spVoteDocs = [], _spGuildQuestDocs = [], _spGuildOpenId = null;').spDaoLoadVotes;
}

test('ギルドの5枚は、読み込みが返ってこなくても先に出る（人数は「—」）。読み終えたら数を入れて出し直す', async () => {
  const app = fakeApp();
  const run = loadVotes()(app);
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(app.state.guilds.map(g => g.short), ['LEARN', 'MAKE'], 'パスポートを待たずに出す');
  assert.equal(app.state.guildCount, 2);
  assert.equal(app.state.guilds[0].joinCount, '—');
  await run;   // パスポート・信用・議題がずっと返ってこなくても、見切って最後まで進む
  assert.equal(app.state.guilds.length, 2);
  assert.equal(app.state.trust.detail, 'ログインすると出ます。');
});

test('Firebase がまだ無いときも、ギルドの5枚は出る', async () => {
  const app = fakeApp();
  await loadVotes({ window: { db: null, fbLib: null } })(app);
  assert.equal(app.state.guilds.length, 2);
});

test('もう出ているギルドは、先に「—」で出し直さない（読み直しのたびに数が消えない）', async () => {
  const app = fakeApp();
  app.state.guilds = [{ short: 'LEARN', joinCount: '3' }];
  await loadVotes({ window: { db: null, fbLib: null } })(app);
  assert.equal(app.calls.length, 0);
});

function refresher({ app, loaders = {}, frameApp = true, rest = null } = {}) {
  const classes = new Set(['sp-dao-open']);
  const frame = { contentWindow: frameApp ? { app } : {} };
  const window = Object.assign({}, loaders);
  const api = build(INDEX, ['spDaoRefreshNow'], {
    window,
    document: { body: { classList: { contains: c => classes.has(c) } }, getElementById: id => (id === 'spDaoFrame' ? frame : null) },
    console: { warn() {} },
    _spRestState: () => rest,
    _spSoon: fastSoon,
    SP_RETURN_MIN_MS: 300000
  }, 'let _spRefreshAt = 0;');
  return { refresh: api.spDaoRefreshNow, frame };
}
const okLoaders = (app) => ({ spDaoLoadVotes: async (a) => { a.setState({ guilds: [{}] }); } });

test('引っぱったときは8秒の間引きを飛ばして、毎回読み直す。読めたら true', async () => {
  const app = fakeApp();
  let n = 0;
  const { refresh } = refresher({ app, loaders: { spDaoLoadVotes: async (a) => { n++; a.setState({ guilds: [{}] }); } } });
  assert.equal(await refresh('引っぱって読み直し'), true);
  assert.equal(await refresh('引っぱって読み直し'), true);
  assert.equal(n, 2);
  // ほかの呼び方は今までどおり間引く
  assert.equal(await refresh('定期'), false);
  assert.equal(n, 2);
});

test('読み直せなかったときは false：画面が無い・枠を使い切った・終わらない・ギルドが出ていない', async () => {
  const app = fakeApp();
  assert.equal(await refresher({ app, frameApp: false, loaders: okLoaders(app) }).refresh('引っぱって読み直し'), false, '画面が無い');
  assert.equal(await refresher({ app, rest: { reason: 'quota', blockedUntil: Date.now() + 60000 }, loaders: okLoaders(app) }).refresh('引っぱって読み直し'), false, '枠切れ');
  assert.equal(await refresher({ app: fakeApp(), loaders: { spDaoLoadVotes: never } }).refresh('引っぱって読み直し'), false, '返ってこない');
  assert.equal(await refresher({ app: fakeApp(), loaders: { spDaoLoadVotes: async () => {} } }).refresh('引っぱって読み直し'), false, 'ギルドが出ていない');
});

test('小部屋（City など）に開いた SchoolPark は、その枠を読み直す', async () => {
  const app = fakeApp();
  const own = { contentWindow: { app } };
  const { refresh } = refresher({ app: fakeApp(), frameApp: false, loaders: okLoaders(app) });
  assert.equal(await refresh('引っぱって読み直し', { frame: own }), true);
  assert.equal(app.state.guilds.length, 1);
});

test('emuInAppRefresh：SchoolPark が読み直せなかったときは失敗を返す（「読み直しました」と出さない）', async () => {
  const start = INDEX.indexOf('window.emuInAppRefresh = async function');
  const code = INDEX.slice(start, INDEX.indexOf('\n};\n', start) + 3);
  let answer = false;
  const frames = { spDaoFrame: { contentWindow: { d: 1 } }, spRoomFrame: { contentWindow: { r: 1 } } };
  const seen = [];
  const window = { spDaoRefreshNow: async (why, o) => { seen.push(o && o.frame); return answer; } };
  const document = { getElementById: id => frames[id] || null, body: { classList: { contains: c => c === 'sp-dao-open' } } };
  vm.runInNewContext(code, { window, document });
  await assert.rejects(window.emuInAppRefresh(frames.spDaoFrame.contentWindow), /REFRESH_FAILED/);
  await assert.rejects(window.emuInAppRefresh(null), /REFRESH_FAILED/);
  answer = true;
  assert.equal(await window.emuInAppRefresh(frames.spRoomFrame.contentWindow), 'schoolpark');
  assert.equal(seen[2], frames.spRoomFrame, '引っぱった枠を渡す');
});
