'use strict';
/* Knowledge Lab の掛け合わせ（11/18 オーナー）：メイン1つ＋最大4つ・AI は1人1日3回・Knowledge Text の教材も材料にできる。
   本物の Firestore と Gemini は使わない（小さな記録置き場と、決まった答えを返す偽物）。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createAI } = require('../../backend/knowledge-lab/ai-service');

function store(seed = {}) {
  const docs = new Map(Object.entries(seed).map(([k, v]) => [k, JSON.parse(JSON.stringify(v))]));
  const snap = (path) => ({ exists: docs.has(path), id: path.split('/').pop(), data: () => (docs.has(path) ? JSON.parse(JSON.stringify(docs.get(path))) : undefined) });
  const ref = (col, id) => ({ path: 'kl_' + col + '/' + id, get: async () => snap('kl_' + col + '/' + id) });
  let chain = Promise.resolve();
  const db = {
    collection: (name) => ({
      doc: (id) => ({ path: name + '/' + id, get: async () => snap(name + '/' + id) }),
      get: async () => ({ docs: [...docs.keys()].filter((k) => k.startsWith(name + '/')).map(snap) }),
    }),
    runTransaction(fn) {
      const run = chain.then(async () => {
        const writes = [];
        const tx = {
          get: async (r) => snap(r.path),
          set: (r, v, o) => writes.push(() => docs.set(r.path, o && o.merge ? { ...(docs.get(r.path) || {}), ...v } : v)),
          create: (r, v) => writes.push(() => { if (docs.has(r.path)) throw new Error('ALREADY_EXISTS'); docs.set(r.path, v); }),
          delete: (r) => writes.push(() => docs.delete(r.path)),
        };
        const out = await fn(tx);
        writes.forEach((w) => w());
        return out;
      });
      chain = run.catch(() => {});
      return run;
    },
  };
  return { db, ref, docs };
}
const consent = { aiUseConsent: { allowed: true } };
const POSTS = {
  main: { title: 'ブローのコツ', body: '髪を傷めずに乾かす順番を、お客さんに毎回伝えている。', displayName: 'A', knowledgeLab: consent, updatedAt: 1 },
  b: { title: '開業1年目の資金繰り', body: '最初の半年は家賃を3か月分よけておいた。', displayName: 'B', knowledgeLab: consent, updatedAt: 1 },
  c: { title: '常連のつくり方', body: '2回目の来店で名前を覚えて呼ぶ。', displayName: 'C', knowledgeLab: consent, updatedAt: 1 },
  d: { title: 'SNSで予約', body: '施術前後の写真を毎日1枚投稿した。', displayName: 'D', knowledgeLab: consent, updatedAt: 1 },
  e: { title: '値上げの伝え方', body: '1か月前に紙で知らせた。', displayName: 'E', knowledgeLab: consent, updatedAt: 1 },
  f: { title: 'スタッフ教育', body: '最初の1週間は見学だけにした。', displayName: 'F', knowledgeLab: consent, updatedAt: 1 },
  nope: { title: '同意のない知識', body: 'AIに使ってほしくない経験。', displayName: 'G', knowledgeLab: { aiUseConsent: { allowed: false } }, updatedAt: 1 },
};
function setup() {
  const s = store({
    'kl_system/ai-control': { stopped: false, freeTierAttested: true, model: 'gemini-listed-flash' },
    'room1_contents/t1': { theme: 'money', subTheme: '守り方', summary: '詐欺の見抜き方', body: '<p>うまい話には<b>理由</b>がある。</p>', createdAt: '2026-10-01' },
    'room1_contents/t2': { theme: 'net', subTheme: 'SNS', summary: '空の教材', body: '   ', createdAt: '2026-10-02' },
  });
  const service = {
    ref: s.ref,
    rawPost: async (id) => { if (!POSTS[id]) { const e = new Error('NOT_FOUND'); e.status = 404; throw e; } return JSON.parse(JSON.stringify(POSTS[id])); },
    taxonomy: async () => [],
  };
  const ai = createAI({
    db: s.db, service,
    env: { GEMINI_API_KEY: 'k', GEMINI_FREE_TIER_CONFIRMED: 'true', KNOWLEDGE_LAB_AI_ENABLED: 'true' },
    fetcher: () => { throw new Error('PROVIDER_MUST_NOT_BE_CONTACTED'); },
  });
  const calls = [];
  let fail = [];
  ai.provider.analyze = async (model, fields, sources, options) => {
    calls.push({ model, fields, sources, options });
    if (fail.length) { const e = new Error(fail.shift()); throw e; }
    const cite = (s) => [{ sourceId: s.id, quote: s.body.slice(0, 5) }];
    return {
      analysis: {
        summaries: sources.map((x) => ({ text: '要点', citations: cite(x) })),
        hypotheses: [{ text: '新しい発見', citations: cite(sources[0]) }],
        connections: sources.slice(1).map((x) => ({ text: 'つながり', citations: cite(x) })),
        cautions: [{ text: '注意', citations: cite(sources[0]) }],
      },
      model, usage: { providerTokensReported: true, totalTokens: 1000, inputTokens: 900, outputTokens: 100 },
    };
  };
  return { ai, s, calls, failNext: (...codes) => { fail = codes; } };
}
const me = { spid: 'SP-TEST' };
const go = (ai, mainId, otherIds, extra = {}) => ai.mix(me, { mainId, otherIds, externalAIConsent: true, ...extra });

test('メイン1つ＋知識2つ＋Knowledge Text の教材1つを混ぜる。メインを軸として AI に渡し、1回として数える', async () => {
  const { ai, calls } = setup();
  const run = await go(ai, 'main', ['b', 'c', 'kt_t1']);
  assert.equal(run.mode, 'mix');
  assert.equal(run.mainId, 'main');
  assert.deepEqual(run.sources.map((x) => x.id), ['main', 'b', 'c', 'kt_t1']);
  assert.equal(run.sources[3].kind, 'knowledge-text');
  assert.equal(run.sources[3].title, '詐欺の見抜き方');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.mainSourceId, 'main');
  assert.equal(calls[0].sources[3].body, 'うまい話には 理由 がある。', 'HTML の印は外して送る');
  assert.ok(!('body' in run.sources[0]), '本文は結果に残さない');
  assert.deepEqual(run.quota, { used: 1, limit: 3, remaining: 2 });
  assert.deepEqual(await ai.mixQuota(me), { available: true, used: 1, limit: 3, remaining: 2 });
});

test('同じ組み合わせの2回目は AI を呼ばず、回数にも数えない', async () => {
  const { ai, calls } = setup();
  await go(ai, 'main', ['b']);
  const again = await go(ai, 'main', ['b']);
  assert.equal(again.cacheHit, true);
  assert.equal(calls.length, 1);
  assert.equal((await ai.mixQuota(me)).used, 1);
});

test('1人1日3回まで。4回目は AI を呼ばずに断る', async () => {
  const { ai, calls } = setup();
  await go(ai, 'main', ['b']);
  await go(ai, 'main', ['c']);
  await go(ai, 'main', ['d']);
  await assert.rejects(go(ai, 'main', ['e']), /AI_DAILY_LIMIT/);
  assert.equal(calls.length, 3);
  assert.deepEqual(await ai.mixQuota(me), { available: true, used: 3, limit: 3, remaining: 0 });
});

test('AI が一時的にだめで自動でやり直したときも、本人の回数は1回だけ', async () => {
  const { ai, calls, failNext } = setup();
  failNext('AI_PROVIDER_UNAVAILABLE');
  await go(ai, 'main', ['b']);
  assert.equal(calls.length, 2);
  assert.equal((await ai.mixQuota(me)).used, 1);
});

test('掛け合わせは最大4つ。0こ・5こは断る。書き手が同意していない知識・外部AIへの同意が無いときも断る', async () => {
  const { ai, calls } = setup();
  await assert.rejects(go(ai, 'main', []), /AI_SOURCE_COUNT/);
  await assert.rejects(go(ai, 'main', ['main']), /AI_SOURCE_COUNT/, 'メインと同じものだけ');
  await assert.rejects(go(ai, 'main', ['b', 'c', 'd', 'e', 'f']), /INVALID_LIST/);
  await assert.rejects(go(ai, 'main', ['nope']), /AI_SOURCE_CONSENT_REQUIRED/);
  await assert.rejects(go(ai, 'main', ['b'], { externalAIConsent: false }), /AI_REQUEST_CONSENT_REQUIRED/);
  await assert.rejects(go(ai, 'main', ['kt_missing']), /NOT_FOUND/);
  await assert.rejects(go(ai, 'main', ['kt_t2']), /NOT_FOUND/, '本文の無い教材');
  assert.equal(calls.length, 0);
  assert.equal((await ai.mixQuota(me)).used, 0);
  // メイン＋4つ（合計5つ）は通る
  const run = await go(ai, 'main', ['b', 'c', 'd', 'e']);
  assert.equal(run.sources.length, 5);
});

test('材料にできる Knowledge Text の教材の一覧（本文の頭だけ。本文の無い教材は出さない）', async () => {
  const { ai } = setup();
  const list = await ai.texts();
  assert.deepEqual(list.map((t) => t.id), ['kt_t1']);
  assert.equal(list[0].title, '詐欺の見抜き方');
  assert.equal(list[0].theme, 'money');
  assert.equal(list[0].excerpt, 'うまい話には 理由 がある。');
});

test('保存した掛け合わせの結果を読み直すと、材料が書き換えられていないか確かめる', async () => {
  const { ai } = setup();
  const run = await go(ai, 'main', ['b', 'kt_t1']);
  assert.equal((await ai.get(me, run.id)).mode, 'mix');
  POSTS.b.body += '（追記）';
  try {
    await assert.rejects(ai.get(me, run.id), /AI_SOURCES_CHANGED/);
  } finally { POSTS.b.body = POSTS.b.body.replace('（追記）', ''); }
});
