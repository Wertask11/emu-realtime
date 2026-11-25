/* 承認待ちを「まとめて認める」、ギルドに「まとめて参加OKにする」（11/25）。

   1人ずつ押すと、8人で8回、確かめの窓も8回出る。
   まとめても、1人ぶんの道（spApproveCompletion / spTrustAdd）は
   ボタン1つのときと同じものを通す。ここではそれを動かして確かめる。

   - 印を付けた人だけを、1人ずつ同じ道で認める
   - 条件が足りない人に印があれば、もう一度聞く（断れば何もしない）
   - サーバーが使えないときは、1人ずつのときと同じく Firestore に承認だけ書く
   - 途中で1人転んでも、残りは続ける。最後に誰が転んだかを出す
   - 1人ずつの「認める」「参加OKにする」は、前と同じに動く */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '../..');
const ADMIN = fs.readFileSync(path.join(root, 'frontend/public/membership-admin.html'), 'utf8');

function slice(start, end) {
  const i = ADMIN.indexOf(start);
  const j = ADMIN.indexOf(end, i);
  assert.ok(i > 0 && j > i, start + ' が見つかりません');
  return ADMIN.slice(i, j);
}
const APPROVE_SRC = slice('const spApproveCompletion = async', 'const qbAllBtn = $("#qbAll");');
const TRUST_SRC = slice('const spTrustAdd = ', 'el.querySelectorAll("[data-tdel]")');

/* 画面の代わり。選び手ごとに、置いた部品を返す。 */
function page(parts) {
  const byId = {};
  const all = [];
  parts.forEach(p => { all.push(p); if (p.id) byId['#' + p.id] = p; });
  const attr = sel => (String(sel).match(/^\[([a-z-]+)\]$/) || [])[1];
  const camel = a => a.replace(/^data-/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  return {
    el: { querySelectorAll: sel => all.filter(p => p.dataset && camel(attr(sel) || '-') in p.dataset) },
    $: sel => byId[sel] || null,
    byId
  };
}
const box = (dataset, checked) => ({ dataset, checked: !!checked });

function stage(opts) {
  const o = opts || {};
  const seen = { api: [], writes: [], alerts: [], confirms: [], notified: [], rendered: 0 };
  const answers = (o.confirms || []).slice();
  const pg = page(o.parts || []);
  const ctx = vm.createContext({
    Number, String, Math, Array, Object, Error, JSON, Date,
    console: { warn() {} },
    el: pg.el, $: pg.$,
    confirm: msg => { seen.confirms.push(String(msg)); return answers.length ? answers.shift() : true; },
    alert: msg => { seen.alerts.push(String(msg)); },
    renderSchoolPark: () => { seen.rendered += 1; },
    spNotifyQuestChanged: (q, a) => { seen.notified.push(q + '/' + a); },
    encodeURIComponent,
    spWrite: async fn => fn(),
    ownerAddr: '0xowner', addr: '0xowner',
    quests: o.quests || [],
    f: {
      db: {},
      doc: (_db, ...p) => p.join('/'),
      updateDoc: async (ref, data) => { seen.writes.push({ op: 'update', ref, data: JSON.parse(JSON.stringify(data)) }); },
      setDoc: async (ref, data) => {
        if (o.trustFail && ref.indexOf(o.trustFail) >= 0) throw Object.assign(new Error('x'), { code: 'permission-denied' });
        seen.writes.push({ op: 'set', ref, data: JSON.parse(JSON.stringify(data)) });
      }
    },
    api: async p => {
      seen.api.push(p);
      const hit = Object.keys(o.apiFail || {}).find(k => p.indexOf(k) >= 0);
      if (hit) throw Object.assign(new Error(o.apiFail[hit]), { code: o.apiFail[hit] });
      return { ok: true, amountEmuer: o.emuer || 0 };
    }
  });
  vm.runInContext(o.trust ? TRUST_SRC : APPROVE_SRC, ctx);
  return { seen, pg };
}

/* ───────── 画面 ───────── */

test('承認待ちの行に印の箱があり、条件を満たした人だけ最初から印が付く', () => {
  const i = ADMIN.indexOf('data-qpick="');
  assert.ok(i > 0, '印の箱が無い');
  const seg = ADMIN.slice(i - 100, i + 400);
  assert.ok(seg.indexOf("(r.ready ? ' checked' : '')") >= 0, '条件で印を決めていない');
  assert.ok(ADMIN.indexOf('id="qApproveBulk"') > 0, 'まとめて認めるボタンが無い');
});

test('1人ずつの「認める」ボタンは、承認待ちの行に残っている', () => {
  const i = ADMIN.indexOf('data-qpick="');
  const seg = ADMIN.slice(i, ADMIN.indexOf("'</span></div>';", i));
  assert.ok(seg.indexOf('data-qapprove="') > 0, '1人ずつの認めるが消えた');
});

test('ギルドの行に印の箱があり、目安の点に届いた人だけ最初から印が付く', () => {
  const i = ADMIN.indexOf('data-tpick="');
  assert.ok(i > 0, '印の箱が無い');
  const seg = ADMIN.slice(i, i + 300);
  assert.ok(seg.indexOf("(m.score >= TRUST_NEED ? ' checked' : '')") >= 0);
  assert.ok(ADMIN.indexOf('id="tAddBulk"') > 0, 'まとめて参加OKにするボタンが無い');
  assert.ok(ADMIN.indexOf('参加OKにする</button>') > 0, '1人ずつの参加OKにするが消えた');
});

/* ───────── まとめて認める ───────── */

const QUESTS = [
  { id: 'q1', tookList: [{ addr: '0xa', rounds: 0, approved: false }, { addr: '0xb', rounds: 0 }] },
  { id: 'q2', tookList: [{ addr: '0xc', rounds: 1, approved: true }] }
];
function approveParts(extra) {
  return [
    { id: 'qApproveBulk', dataset: {} },
    { id: 'qPickN', dataset: {}, textContent: '' },
    box({ qpick: 'q1', addr: '0xa', qready: '1', qname: 'むー' }, true),
    box({ qpick: 'q1', addr: '0xb', qready: '1', qname: 'ミルクティー' }, true),
    box({ qpick: 'q2', addr: '0xc', qready: '0', qname: '単3電池' }, false)
  ].concat(extra || []);
}

test('印を付けた人だけを、1人ずつ同じ道で認める', async () => {
  const s = stage({ quests: QUESTS, parts: approveParts(), emuer: 50 });
  await s.pg.byId['#qApproveBulk'].onclick();
  assert.deepEqual(s.seen.api, [
    '/api/schoolpark/quest-completions/q1/0xa/approve',
    '/api/schoolpark/quest-completions/q1/0xb/approve'
  ]);
  assert.equal(s.seen.confirms.length, 1, '条件を満たした人だけなら、聞くのは1回');
  assert.deepEqual(s.seen.notified, ['q1/0xa', 'q1/0xb']);
  assert.equal(s.seen.rendered, 1, '描き直しは最後に1回');
  assert.match(s.seen.alerts[0], /2人を完走として認めました/);
  assert.match(s.seen.alerts[0], /合わせて 100/);
});

test('条件が足りない人に印があれば、もう一度聞く。断れば誰も認めない', async () => {
  const parts = approveParts();
  parts[4].checked = true;
  const s = stage({ quests: QUESTS, parts, confirms: [true, false] });
  await s.pg.byId['#qApproveBulk'].onclick();
  assert.equal(s.seen.confirms.length, 2);
  assert.match(s.seen.confirms[1], /1人は、まだ完走条件を満たしていません/);
  assert.match(s.seen.confirms[1], /単3電池/);
  assert.equal(s.seen.api.length, 0, '断ったのに認めた');
  assert.equal(s.seen.rendered, 0);
});

test('最初の確かめで断れば、何もしない', async () => {
  const s = stage({ quests: QUESTS, parts: approveParts(), confirms: [false] });
  await s.pg.byId['#qApproveBulk'].onclick();
  assert.equal(s.seen.api.length, 0);
});

test('誰にも印が無ければ、そう言って止まる', async () => {
  const parts = approveParts();
  parts.forEach(p => { if (p.dataset.qpick) p.checked = false; });
  const s = stage({ quests: QUESTS, parts });
  await s.pg.byId['#qApproveBulk'].onclick();
  assert.equal(s.seen.api.length, 0);
  assert.equal(s.seen.confirms.length, 0);
  assert.match(s.seen.alerts[0], /印を付けてください/);
});

test('サーバーが使えないときは、1人ずつのときと同じく承認だけ Firestore に書く', async () => {
  const parts = approveParts();
  parts[4].checked = true;
  const s = stage({ quests: QUESTS, parts, apiFail: { '/q2/': 'NOT_STARTED' } });
  await s.pg.byId['#qApproveBulk'].onclick();
  assert.equal(s.seen.writes.length, 1);
  assert.equal(s.seen.writes[0].ref, 'sp_quests/q2/commits/0xc');
  assert.equal(s.seen.writes[0].data.approved, true);
  assert.equal(s.seen.writes[0].data.approvedRounds, 2, '2周目として書いていない');
  assert.match(s.seen.alerts[0], /3人を完走として認めました/);
  assert.match(s.seen.alerts[0], /EMUER をまだ渡せていません/);
});

test('途中で1人転んでも、残りは続ける。誰が転んだかを出す', async () => {
  const s = stage({ quests: QUESTS, parts: approveParts(), apiFail: { '/0xa/': 'FORBIDDEN' } });
  await s.pg.byId['#qApproveBulk'].onclick();
  assert.equal(s.seen.api.length, 2, '転んだところで止まった');
  assert.deepEqual(s.seen.notified, ['q1/0xb'], '転んだ人まで知らせた');
  assert.equal(s.seen.writes.length, 0, '断られたのに Firestore に書いた');
  assert.match(s.seen.alerts[0], /1人を完走として認めました/);
  assert.match(s.seen.alerts[0], /むー（FORBIDDEN）/);
});

test('「条件を満たした人だけ選ぶ」「全員選ぶ」「全部外す」', () => {
  const sets = ['ready', 'all', 'none'].map(m => ({ dataset: { qpickset: m } }));
  const s = stage({ quests: QUESTS, parts: approveParts(sets) });
  const picks = () => s.pg.el.querySelectorAll('[data-qpick]').map(x => x.checked);
  sets[1].onclick();
  assert.deepEqual(picks(), [true, true, true]);
  assert.equal(s.pg.byId['#qPickN'].textContent, '3');
  sets[2].onclick();
  assert.deepEqual(picks(), [false, false, false]);
  sets[0].onclick();
  assert.deepEqual(picks(), [true, true, false]);
  assert.equal(s.pg.byId['#qPickN'].textContent, '2');
});

/* ───────── 1人ずつの「認める」は前と同じ ───────── */

test('1人ずつの「認める」は、前と同じくサーバーで認めて知らせる', async () => {
  const btn = { dataset: { qapprove: 'q1', addr: '0xa' } };
  const s = stage({ quests: QUESTS, parts: [btn], emuer: 50 });
  await btn.onclick();
  assert.deepEqual(s.seen.api, ['/api/schoolpark/quest-completions/q1/0xa/approve']);
  assert.match(s.seen.alerts[0], /50 EMUER を引き当てました/);
  assert.deepEqual(s.seen.notified, ['q1/0xa']);
  assert.equal(s.seen.rendered, 1);
});

test('1人ずつの「認める」で、サーバーが使えなければ承認だけ書いて伝える', async () => {
  const btn = { dataset: { qapprove: 'q1', addr: '0xa' } };
  const s = stage({ quests: QUESTS, parts: [btn], apiFail: { approve: 'Failed to fetch' } });
  await btn.onclick();
  assert.equal(s.seen.writes.length, 1);
  assert.equal(s.seen.writes[0].data.approvedRounds, 1);
  assert.match(s.seen.alerts[0], /完走として認めました。\n\nただし EMUER は渡せていません/);
});

test('1人ずつの「認める」で断られたら、Firestore に書かずに止まる', async () => {
  const btn = { dataset: { qapprove: 'q1', addr: '0xa' } };
  const s = stage({ quests: QUESTS, parts: [btn], apiFail: { approve: 'FORBIDDEN' } });
  await btn.onclick();
  assert.equal(s.seen.writes.length, 0);
  assert.equal(s.seen.alerts[0], '認められませんでした（FORBIDDEN）');
  assert.equal(s.seen.rendered, 0);
});

test('「EMUERを渡す」で渡し終えていたら、そう伝える', async () => {
  const btn = { dataset: { qapprove: 'q2', addr: '0xc', qtopup: '1' } };
  const s = stage({ quests: QUESTS, parts: [btn], apiFail: { approve: 'NO_NEW_ROUND' } });
  await btn.onclick();
  assert.match(s.seen.alerts[0], /すべて EMUER を渡してあります/);
  assert.equal(s.seen.writes.length, 0);
});

/* ───────── まとめて参加OKにする ───────── */

function trustParts() {
  return [
    { id: 'tAddBulk', dataset: {} },
    { id: 'tPickN', dataset: {}, textContent: '' },
    box({ tpick: '0xa', tname: '俺たちの青春', tneed: '1' }, true),
    box({ tpick: '0xb', tname: '天輝', tneed: '1' }, true),
    box({ tpick: '0xc', tname: 'やこたけ', tneed: '0' }, false)
  ];
}

test('印を付けた人だけを、1人ずつ参加OKにする', async () => {
  const s = stage({ trust: true, parts: trustParts() });
  await s.pg.byId['#tAddBulk'].onclick();
  assert.deepEqual(s.seen.writes.map(w => w.ref), ['sp_trust/0xa', 'sp_trust/0xb']);
  assert.equal(s.seen.writes[0].data.name, '俺たちの青春');
  assert.equal(s.seen.writes[0].data.by, '0xowner');
  assert.equal(s.seen.confirms.length, 1);
  assert.match(s.seen.alerts[0], /2人を参加OKにしました/);
  assert.equal(s.seen.rendered, 1);
});

test('目安に届かない人に印があれば、もう一度聞く。断れば誰も書かない', async () => {
  const parts = trustParts();
  parts[4].checked = true;
  const s = stage({ trust: true, parts, confirms: [true, false] });
  await s.pg.byId['#tAddBulk'].onclick();
  assert.match(s.seen.confirms[1], /やこたけ/);
  assert.equal(s.seen.writes.length, 0);
});

test('参加OKで1人転んでも、残りは続ける', async () => {
  const s = stage({ trust: true, parts: trustParts(), trustFail: '0xa' });
  await s.pg.byId['#tAddBulk'].onclick();
  assert.deepEqual(s.seen.writes.map(w => w.ref), ['sp_trust/0xb']);
  assert.match(s.seen.alerts[0], /1人を参加OKにしました/);
  assert.match(s.seen.alerts[0], /俺たちの青春（permission-denied）/);
});

test('1人ずつの「参加OKにする」は、前と同じに書く', async () => {
  const btn = { dataset: { tadd: '0xa', tname: '店長' } };
  const s = stage({ trust: true, parts: [btn] });
  await btn.onclick();
  assert.deepEqual(s.seen.writes.map(w => w.ref), ['sp_trust/0xa']);
  assert.equal(s.seen.writes[0].data.name, '店長');
  assert.equal(s.seen.rendered, 1);
});
