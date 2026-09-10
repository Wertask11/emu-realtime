/* ギルドの一連の流れを、本番の index.html の中身そのままで確かめる。

   Firestore の決まり（Rules）は tools/quest-tests/guild.test.cjs で確かめている。
   こちらは「画面と読み書きの流れ」を見る:

     ギルド一覧 → LEARN を開く → 参加したい → 議題を出す → 投票
     → 採択 → Questにする → Quest から元の議題へ戻れる
     → ギルドから生まれた Quest を確認 → 別パスポート → ログアウト

   index.html からギルドの部分だけを切り出し、記録のかわりに
   その場かぎりの入れ物をつなぐ。切り出しは行番号ではなく目印で行う
   （前後に手が入っても、ここが壊れないように）。

   使い方:
     npm ci --prefix tools/guild-tests
     npx playwright install chromium
     node --test tools/guild-tests/flow.test.cjs                             */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const ROOT = path.join(__dirname, '..', '..');
const PUB = path.join(ROOT, 'frontend', 'public');
const START = 'let _spVoteBusy = false;';
const END = '   自分の宿題';

function guildSection() {
  const src = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
  const a = src.indexOf(START);
  const b = src.indexOf(END, a);
  assert.ok(a > 0, 'ギルドの部分の始まりが見つからない: ' + START);
  assert.ok(b > a, 'ギルドの部分の終わりが見つからない: ' + END);
  /* 終わりの目印は次の見出しの中にあるので、その見出しの手前で切る */
  const cut = src.lastIndexOf('/* ═', b);
  const code = src.slice(a, cut);
  assert.ok(code.includes('window.spDaoLoadVotes'), 'ギルドの読み込みが範囲に入っていない');
  assert.ok(code.includes('window.spVoteToQuest'), 'Quest化が範囲に入っていない');
  assert.ok(code.includes('async function spQuestSubmit'), 'クエストを出す処理が範囲に入っていない');
  return code;
}

const STUBS = String.raw`
const SP_CURRENCIES = ['JPY','JPYC','EMUER'];
window.__store = new Map();
const S = window.__store;
function _spShortAddr(a){ a=String(a||''); return a.slice(0,6)+'…'+a.slice(-4); }
function _spIsOwnerAddr(a){ return String(a||'').toLowerCase()==='0xowner'; }
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
window.__me = null;
function spPassportLoad(){ return Promise.resolve(window.__me); }
window.alert = m => { (window.__alerts=window.__alerts||[]).push(String(m)); };
window.confirm = () => window.__confirm !== false;
window.prompt = () => window.__prompt;
window.db = {};
let _id = 0;
window.fbLib = {
  collection: (db, ...s) => ({ __coll:true, path: s.join('/') }),
  doc: (a, ...s) => a && a.__coll ? ({ __doc:true, path: a.path + '/auto' + (++_id) })
                                  : ({ __doc:true, path: s.join('/') }),
  query: (coll, ...cons) => ({ __query:true, coll, cons }),
  orderBy: (f, d) => ({ t:'order', f, d }), limit: n => ({ t:'limit', n }),
  getDocs: async (target) => {
    const coll = target.__query ? target.coll : target;
    const depth = coll.path.split('/').length + 1;
    let out = [];
    for (const [p, v] of S) {
      const sp = p.split('/');
      if (sp.length === depth && p.startsWith(coll.path + '/')) out.push({ id: sp[sp.length-1], data: () => v });
    }
    if (target.__query) for (const c of target.cons) {
      if (c.t === 'order') out = out.filter(x => x.data()[c.f] !== undefined)
        .sort((a,b) => (c.d === 'desc' ? 1 : -1) * ((a.data()[c.f]||0) - (b.data()[c.f]||0)));
      if (c.t === 'limit') out = out.slice(0, c.n);
    }
    return { forEach: f => out.forEach(f), size: out.length };
  },
  getDoc: async ref => ({ exists: () => S.has(ref.path), id: ref.path.split('/').pop(), data: () => S.get(ref.path) }),
  setDoc: async (ref, d) => { S.set(ref.path, JSON.parse(JSON.stringify(d))); },
  addDoc: async (coll, d) => { const p = coll.path + '/auto' + (++_id); S.set(p, JSON.parse(JSON.stringify(d))); return { id: p.split('/').pop() }; },
  updateDoc: async (ref, patch) => { if(!S.has(ref.path)) throw new Error('not found'); S.set(ref.path, Object.assign({}, S.get(ref.path), patch)); },
  deleteDoc: async ref => { S.delete(ref.path); },
  runTransaction: async (db, fn) => fn({
    get: async ref => ({ exists: () => S.has(ref.path), data: () => S.get(ref.path) }),
    set: (ref, d) => S.set(ref.path, JSON.parse(JSON.stringify(d))),
    update: (ref, d) => S.set(ref.path, Object.assign({}, S.get(ref.path), d))
  })
};
window.__app = {
  state: { screen:'home', quests:[], votes:[] },
  setState(u){ const n = typeof u === 'function' ? u(this.state) : u; this.state = Object.assign({}, this.state, n); },
  toTop(){}
};
`;

const PAGE = `<!doctype html><meta charset="utf-8"><title>guild flow</title>
<body>
<div id="spVoteSheet"><select id="spvGuild"></select>
  <select id="spvKind"><option value="free">free</option><option value="special">special</option></select>
  <input id="spvTitle"><textarea id="spvBody"></textarea>
  <input id="spvOpt1"><input id="spvOpt2"><input id="spvOpt3"><input id="spvOpt4"><input id="spvDays"></div>
<div id="spQuestSheet"><div id="sqFromRow"><input id="sqFrom"></div><select id="sqGuild"></select>
  <input id="sqTitle"><input id="sqKnowledge"><textarea id="sqHypothesis"></textarea>
  <textarea id="sqAction"></textarea><textarea id="sqMeasure"></textarea>
  <input id="sqBudget"><select id="sqCurrency"><option value="JPY">円</option></select>
  <input id="sqNeed"><input id="sqDays"></div>
<script src="/schoolpark/quest-store.js"></script>
<script src="/schoolpark/guild-store.js"></script>
<script src="/guild-section.js"></script>
<script src="/stubs.js"></script>
</body>`;

let browser, page, server, dir, pageErrors = [];

before(async () => {
  const { chromium } = require('playwright');
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guild-flow-'));
  fs.writeFileSync(path.join(dir, 'guild-section.js'), guildSection());
  fs.writeFileSync(path.join(dir, 'stubs.js'), STUBS);
  fs.writeFileSync(path.join(dir, 'flow.html'), PAGE);
  server = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
    const p = u.startsWith('/schoolpark/') ? path.join(PUB, u) : path.join(dir, u);
    fs.readFile(p, (e, d) => {
      if (e) { res.writeHead(404); res.end('nf'); return; }
      res.writeHead(200, { 'Content-Type': u.endsWith('.html') ? 'text/html' : 'text/javascript' });
      res.end(d);
    });
  });
  await new Promise(r => server.listen(0, r));
  browser = await chromium.launch();
  page = await browser.newPage();
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') pageErrors.push('console: ' + m.text()); });
  await page.goto('http://127.0.0.1:' + server.address().port + '/flow.html', { waitUntil: 'load' });
});
after(async () => { await browser?.close(); server?.close(); if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

/* 画面の押しごたえは戻り値を返さないので、少し待ってから確かめる */
const RUN = String.raw`
const tick = () => new Promise(r => setTimeout(r, 40));
const app = window.__app, S = window.__store, out = [];
const ok = (n, c) => out.push({ n, c: !!c });
`;

async function run(body) {
  const r = await page.evaluate(new Function('return (async () => {' + RUN + body + '\nreturn out; })()'));
  return r;
}
function check(results) {
  const bad = results.filter(r => !r.c).map(r => r.n);
  assert.deepEqual(bad, [], '通らなかった項目: ' + bad.join(' / '));
}

test('ギルド一覧・参加したい・応援する', async () => {
  check(await run(String.raw`
    window.__owner = {uid:'u-owner',addr:'0xowner',name:'運営',initial:'運',createdAt:0,provider:'wallet',tier:'plus',hasPass:true,isOwner:true,ownerAddr:'0xowner'};
    window.__alice = {uid:'u-a',addr:'0xalice',name:'あやか',initial:'あ',createdAt:0,provider:'line',tier:'free',hasPass:false,isOwner:false,ownerAddr:'0xalice'};
    window.__bob   = {uid:'u-b',addr:'0xbob',name:'みお',initial:'み',createdAt:0,provider:'google',tier:'free',hasPass:false,isOwner:false,ownerAddr:'0xbob'};
    /* ギルドができる前に出された議題（guildId が無い） */
    S.set('sp_votes/old1',{title:'古い議題',body:'',options:[{id:'o1',label:'A'},{id:'o2',label:'B'}],kind:'free',createdBy:'0xowner',createdAt:1,closesAt:Date.now()+86400000});
    window.__me = window.__alice;
    await window.spDaoLoadVotes(app);
    ok('5つのギルドが出る', app.state.guilds.length === 5);
    ok('guildIdの無い古い議題は未分類になる', app.state.hasUnsorted === true && app.state.guildUnsorted.count === 1);
    ok('数は0から始まる', app.state.guilds[0].joinCount === '0' && app.state.guilds[0].proposalCount === '0');

    await window.spGuildOpen('learn', app);
    ok('LEARNの詳細に入れる', app.state.screen === 'guild' && app.state.curGuild.id === 'learn');
    await window.spGuildToggle('learn','join',app); await tick();
    ok('参加したいが1件入る', S.has('sp_guild_members/learn/joins/0xalice'));
    await window.spGuildOpen('learn', app);
    ok('本人に選択済みが出る', app.state.curGuild.joinLabel.indexOf('✓') === 0 && app.state.curGuild.joinCount === '1');
    await window.spGuildToggle('learn','join',app); await tick();
    ok('もう一度押すと取り消せる', !S.has('sp_guild_members/learn/joins/0xalice'));
    await window.spGuildToggle('learn','join',app); await tick();
  `));
});

test('議題を出す → 投票 → 採択 → Questにする', async () => {
  check(await run(String.raw`
    window.__me = window.__owner;
    await window.openSpVoteForm(app, 'learn');
    ok('議題フォームのギルドが LEARN に合っている', document.getElementById('spvGuild').value === 'learn');
    document.getElementById('spvTitle').value = 'テンプレートを何本つくるか';
    document.getElementById('spvBody').value = '来月にむけて';
    document.getElementById('spvOpt1').value = '3本';
    document.getElementById('spvOpt2').value = '5本';
    document.getElementById('spvDays').value = '7';
    await spVoteSubmit(); await tick();
    const vid = [...S.keys()].find(k => /^sp_votes\/auto/.test(k));
    window.__vid = vid;
    ok('議題が LEARN に付いて作られる', !!vid && S.get(vid).guildId === 'learn');

    await window.spGuildOpen('learn', app);
    ok('LEARNの議題として並ぶ', app.state.curGuild.votes.length === 1);
    ok('入れる前は票数を見せない', app.state.curGuild.votes[0].options[0].countLabel === '');
    await app.state.curGuild.votes[0].options[0].go(); await tick();
    ok('票が自分のパスポート番号で入る', S.has(vid + '/ballots/0xowner'));

    window.__me = window.__bob;
    await window.spGuildOpen('learn', app);
    await app.state.curGuild.votes[0].options[1].go(); await tick();
    ok('別パスポートも投票できる（一般議題）', S.has(vid + '/ballots/0xbob'));
    await window.spGuildOpen('learn', app);
    ok('入れたあとに結果が見える', app.state.curGuild.votes[0].options[0].countLabel.indexOf('1票') === 0);
    ok('入れたあとは押せない', app.state.curGuild.votes[0].options[0].cursor === 'default');
    await window.spGuildToggle('learn','support',app); await tick();
    ok('別パスポートの応援が入る', S.has('sp_guild_members/learn/supports/0xbob'));
    await window.spGuildOpen('learn', app);
    ok('一般の人に採択ボタンは出ない', app.state.curGuild.votes[0].canAdopt === false);
    ok('一般の人にQuest化ボタンは出ない', app.state.curGuild.votes[0].canQuest === false);

    window.__me = window.__owner; window.__prompt = '1';
    await window.spGuildOpen('learn', app);
    ok('運営には採択ボタンが出る', app.state.curGuild.votes[0].canAdopt === true);
    await app.state.curGuild.votes[0].adopt(); await tick();
    ok('採択が記録される', S.get(vid).adoptedOptionId === 'o1');
    await window.spGuildOpen('learn', app);
    ok('採択の表示が出る', app.state.curGuild.votes[0].isAdopted === true && app.state.curGuild.votes[0].stateLabel === 'ADOPTED');
    ok('採択後にQuest化ボタンが出る', app.state.curGuild.votes[0].canQuest === true);

    await app.state.curGuild.votes[0].toQuest(); await tick();
    ok('元の議題がフォームに入る', document.getElementById('sqFrom').value === 'テンプレートを何本つくるか');
    ok('ギルドは動かせない', document.getElementById('sqGuild').disabled === true && document.getElementById('sqGuild').value === 'learn');
    document.getElementById('sqTitle').value = 'テンプレートを3本つくる';
    document.getElementById('sqHypothesis').value = '3本あれば回る';
    document.getElementById('sqBudget').value = '30000';
    document.getElementById('sqNeed').value = '2';
    document.getElementById('sqDays').value = '14';
    await spQuestSubmit(); await tick();
    const qid = [...S.keys()].find(k => /^sp_quests\/auto/.test(k));
    window.__qid = qid && qid.split('/')[1];
    ok('クエストが元のギルドと議題を覚えている',
       !!qid && S.get(qid).guildId === 'learn' && S.get(qid).fromProposalId === vid.split('/')[1]);
  `));
});

test('Guild → Proposal → Quest を相互に辿れる', async () => {
  check(await run(String.raw`
    window.__me = window.__owner;
    await window.spDaoLoadQuests(app);
    const q = app.state.quests.find(x => x.id === window.__qid);
    ok('クエストに元の議題への案内が出る', q.hasFrom === true && q.fromLabel.indexOf('LEARN Guild') >= 0);
    ok('クエストにギルドの印が出る', q.hasGuild === true && q.guildLabel === 'LEARN');
    await window.spGuildOpen('learn', app);
    ok('ギルドから生まれたクエストが並ぶ', app.state.curGuild.quests.length === 1 && app.state.curGuild.quests[0].fromLabel === '議題から生まれた');
    ok('議題からもクエストへ辿れる', app.state.curGuild.votes[0].hasQuest === true);
    ok('Quest化ずみの議題に、もう一度Quest化は出ない', app.state.curGuild.votes[0].canQuest === false);
    app.state.screen = 'logs';
    await app.state.curGuild.quests[0].open(); await tick();
    ok('ギルドからクエスト詳細へ行ける', app.state.screen === 'detail' && app.state.expId === window.__qid);
    await q.goFrom(); await tick();
    ok('クエストからギルドへ戻れる', app.state.screen === 'guild' && app.state.curGuild.id === 'learn');
  `));
});

test('議題を通さない直接クエストと、Quest #000', async () => {
  check(await run(String.raw`
    window.__me = window.__owner;
    await window.openSpQuestForm(app);
    ok('直接のときは元の議題の欄が出ない',
       document.getElementById('sqFromRow').style.display === 'none' && document.getElementById('sqGuild').disabled === false);
    document.getElementById('sqGuild').value = '';
    document.getElementById('sqTitle').value = 'ひとりで試す';
    document.getElementById('sqHypothesis').value = 'やってみる';
    document.getElementById('sqBudget').value = '0';
    document.getElementById('sqNeed').value = '1';
    document.getElementById('sqDays').value = '7';
    await spQuestSubmit(); await tick();
    const direct = [...S.entries()].find(([k,v]) => k.startsWith('sp_quests/') && v.title === 'ひとりで試す');
    ok('議題を通さないクエストも出せる', !!direct && direct[1].guildId === '' && direct[1].fromProposalId === '');

    S.set('sp_quests/founder-quest-000', {title:'SchoolPark Quest #000', kind:'founder', questNumber:0,
      founderVersion:1, founderSections:[], owner:'0xowner', ownerName:'運営', status:'OPEN',
      budget:'0', need:1, createdAt:0, closesAt:null});
    await window.spDaoLoadQuests(app);
    const f = app.state.quests.find(x => x.id === 'founder-quest-000');
    ok('#000 はどのギルドにも属さない', f && f.hasGuild === false && f.hasFrom === false && f.isFounder === true);
    await window.spDaoLoadVotes(app);
    const learn = app.state.guilds.find(g => g.id === 'learn');
    ok('#000 はギルドのクエスト数に入らない', learn.questCount === '1');
    ok('ギルドの数が数えられている', learn.joinCount === '1' && learn.supportCount === '1' && learn.proposalCount === '1');
  `));
});

test('guildIdの無い古い議題（後方互換）', async () => {
  check(await run(String.raw`
    window.__me = window.__bob;
    await window.spGuildOpen('', app);
    ok('未分類の議題が開ける', app.state.curGuild.isUnsorted === true && app.state.curGuild.votes.length === 1);
    ok('未分類には参加/応援を出さない', app.state.curGuild.canAct === false);
    await app.state.curGuild.votes[0].options[0].go(); await tick();
    ok('未分類の古い議題にも投票できる', S.has('sp_votes/old1/ballots/0xbob'));
    window.__me = window.__owner; window.__prompt = '2';
    await window.spGuildOpen('', app);
    ok('運営にはギルド割り当てが出る', app.state.curGuild.votes[0].canSetGuild === true);
    await app.state.curGuild.votes[0].setGuild(); await tick();
    ok('割り当てるとWORKの議題になる', S.get('sp_votes/old1').guildId === 'work');
    await window.spDaoLoadVotes(app);
    ok('未分類は空になる', app.state.hasUnsorted === false);
  `));
});

test('ログアウト・一般ユーザーの権限', async () => {
  check(await run(String.raw`
    window.__me = null; window.__alerts = [];
    await window.spDaoLoadVotes(app);
    ok('ログアウトでもギルドは見える', app.state.guilds.length === 5);
    await window.spGuildToggle('learn','join',app); await tick();
    ok('ログアウトでは参加できない', window.__alerts.length === 1);
    window.__alerts = [];
    await window.openSpVoteForm(app, 'learn');
    ok('ログアウトでは議題を出せない', window.__alerts.length === 1 && !document.body.classList.contains('sp-vote-open'));
    window.__alerts = [];
    await window.openSpQuestForm(app);
    ok('ログアウトではクエストも出せない', window.__alerts.length === 1);
    window.__alerts = [];
    await window.spVoteAdopt(window.__vid.split('/')[1], app); await tick();
    ok('ログアウトでは採択できない', window.__alerts.length === 1);

    window.__me = window.__alice; window.__alerts = [];
    await window.spVoteAdopt(window.__vid.split('/')[1], app); await tick();
    ok('一般ユーザーの採択は弾かれる', window.__alerts.length === 1);
    window.__alerts = [];
    await window.spVoteToQuest(window.__vid.split('/')[1], app); await tick();
    ok('一般ユーザーのQuest化は弾かれる', window.__alerts.length === 1);
  `));
});

test('console error が出ていない', () => {
  assert.deepEqual(pageErrors, []);
});
