'use strict';
/* LAB-01（11/7）：1日のトークン上限（200,000）を、呼ぶ前の予約で守る。
   本物の Firestore の代わりに、1件ずつ順番に処理する小さな記録置き場を使う（トランザクションの直列化と同じ）。
   提供元（Gemini）は呼ばない。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createBudget, CAPS, estimateAnalysis, estimateEmbedding } = require('../../backend/knowledge-lab/ai-budget');

function store(seed = {}) {
  const docs = new Map(Object.entries(seed).map(([k, v]) => [k, JSON.parse(JSON.stringify(v))]));
  let chain = Promise.resolve();
  const ref = (col, id) => ({ path: col + '/' + id });
  const db = {
    runTransaction(fn) {
      const run = chain.then(async () => {
        const writes = [];
        const tx = {
          get: async (r) => ({ exists: docs.has(r.path), data: () => (docs.has(r.path) ? JSON.parse(JSON.stringify(docs.get(r.path))) : undefined) }),
          set: (r, v, o) => writes.push(() => docs.set(r.path, o && o.merge ? { ...(docs.get(r.path) || {}), ...v } : v)),
          create: (r, v) => writes.push(() => { if (docs.has(r.path)) throw new Error('ALREADY_EXISTS'); docs.set(r.path, v); }),
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
const DAY = '2026-11-07';
const NOON_JST = Date.parse('2026-11-07T12:00:00+09:00');
const open = { 'system/ai-control': { stopped: false, freeTierAttested: true } };
const a = { spid: 'SP-TEST' };
function setup(used, opts = {}) {
  const s = store({ ...open, ['ai_usage/day-' + DAY]: { totalTokens: used } });
  let t = opts.now ?? NOON_JST;
  const clock = { now: () => t, advance: (ms) => { t += ms; } };
  return { ...s, clock, budget: createBudget({ db: s.db, ref: s.ref, now: clock.now }) };
}
const day = (s, d = DAY) => s.docs.get('ai_usage/day-' + d) || {};
const reported = (n) => async () => ({ usage: { providerTokensReported: true, totalTokens: n, inputTokens: n - 10, outputTokens: 10 } });

test('残り1トークン：見積もりが入らないので、呼ばずに断る', async () => {
  const s = setup(CAPS.totalTokens - 1);
  let called = 0;
  await assert.rejects(s.budget.call(a, 'embedding', async () => { called++; return { usage: {} }; }, 100), /AI_DAILY_LIMIT/);
  assert.equal(called, 0);
  assert.equal(day(s).totalTokens, CAPS.totalTokens - 1);
});

test('残り5,000：5,000以下の見積もりは通り、実際の量で精算する。5,001は断る', async () => {
  const s = setup(CAPS.totalTokens - 5000);
  await assert.rejects(s.budget.call(a, 'analysis', reported(10), 5001), /AI_DAILY_LIMIT/);
  await s.budget.call(a, 'analysis', reported(3000), 5000);
  assert.equal(day(s).totalTokens, CAPS.totalTokens - 2000);
  assert.equal(day(s).reservedTokens, 0);
  assert.deepEqual(day(s).reservations, {});
});

test('上限ちょうど：使った量 + 見積もり = 200,000 は通る。上限ちょうど使った後は、1でも断る', async () => {
  const s = setup(CAPS.totalTokens - 1000);
  await s.budget.call(a, 'analysis', reported(1000), 1000);
  assert.equal(day(s).totalTokens, CAPS.totalTokens);
  await assert.rejects(s.budget.call(a, 'analysis', reported(1), 1), /AI_DAILY_LIMIT/);
});

test('上限超過：前の実装では 199,999 から5,000使えて 204,999 になった。いまは呼ばない', async () => {
  const s = setup(199999);
  let called = 0;
  await assert.rejects(s.budget.call(a, 'analysis', async () => { called++; return { usage: { totalTokens: 5000 } }; }, 5000), /AI_DAILY_LIMIT/);
  assert.equal(called, 0);
  assert.ok(day(s).totalTokens <= CAPS.totalTokens);
});

test('2つ同時：予約の合計が上限を超えるほうは、呼ぶ前に断る', async () => {
  const s = setup(CAPS.totalTokens - 6000);
  let release;
  const held = new Promise((r) => (release = r));
  let started = 0;
  const slow = async () => { started++; await held; return { usage: { providerTokensReported: true, totalTokens: 4000 } }; };
  const first = s.budget.call(a, 'analysis', slow, 4000);
  await new Promise((r) => setTimeout(r, 20));
  await assert.rejects(s.budget.call({ spid: 'SP-OTHER' }, 'analysis', slow, 4000), /AI_DAILY_LIMIT/);
  release();
  await first;
  assert.equal(started, 1);
  assert.equal(day(s).totalTokens, CAPS.totalTokens - 2000);
});

test('時間切れ・失敗：使った量が分からないので、見積もりの全額を数える（0にしない）', async () => {
  const s = setup(0);
  await assert.rejects(s.budget.call(a, 'analysis', async () => { throw new Error('AI_TIMEOUT'); }, 7000), /AI_TIMEOUT/);
  assert.equal(day(s).totalTokens, 7000);
  assert.equal(day(s).unknownTokens, 7000);
  assert.equal(day(s).errors, 1);
});

test('失敗のあとの再試行：1回ごとに予約し直し、両方を数える。上限を超える再試行はしない', async () => {
  const s = setup(CAPS.totalTokens - 9000);
  let calls = 0;
  const flaky = async () => { calls++; throw new Error('AI_PROVIDER_UNAVAILABLE'); };
  // 1回目 5,000 を全額で数えると残りは 4,000。再試行の 5,000 は入らないので、呼ばずに断る
  await assert.rejects(s.budget.call(a, 'analysis', flaky, 5000), /AI_DAILY_LIMIT/);
  assert.equal(calls, 1);
  assert.equal(day(s).totalTokens, CAPS.totalTokens - 4000);
});

test('使用量の報告なし（埋め込み）：見積もりの全額を数える', async () => {
  const s = setup(0);
  const texts = ['短い問い', 'x'.repeat(5000)];
  const est = estimateEmbedding(texts);
  await s.budget.call(a, 'embedding', async () => ({ usage: { providerTokensReported: false, totalTokens: 0 } }), est);
  assert.equal(day(s).totalTokens, est);
  assert.equal(est, Math.ceil('短い問い'.length * 2) + 16 + 2048);
});

test('途中で止まって精算されなかった予約：期限が切れたら全額を数え、二重には数えない', async () => {
  const s = setup(0);
  let release;
  const held = new Promise((r) => (release = r));
  const pending = s.budget.call(a, 'analysis', async () => { await held; return { usage: { providerTokensReported: true, totalTokens: 100 } }; }, 3000);
  await new Promise((r) => setTimeout(r, 20));
  s.clock.advance(61000); // 予約の期限（60秒）を過ぎる
  await s.budget.call({ spid: 'SP-OTHER' }, 'analysis', reported(500), 1000);
  assert.equal(day(s).totalTokens, 3000 + 500);
  release();
  await pending; // 遅れて終わっても、すでに全額で精算済みなので足さない
  assert.equal(day(s).totalTokens, 3500);
});

test('JSTの日付の切り替え：予約した日の記録で精算し、次の日の記録は0から', async () => {
  const before = Date.parse('2026-11-07T23:59:50+09:00');
  const s = setup(CAPS.totalTokens - 1000, { now: before });
  let release;
  const held = new Promise((r) => (release = r));
  const pending = s.budget.call(a, 'analysis', async () => { await held; return { usage: { providerTokensReported: true, totalTokens: 800 } }; }, 1000);
  await new Promise((r) => setTimeout(r, 20));
  s.clock.advance(20000); // 11/8 0:00:10 JST
  await s.budget.call({ spid: 'SP-OTHER' }, 'analysis', reported(50), 100);
  release();
  await pending;
  assert.equal(day(s, '2026-11-07').totalTokens, CAPS.totalTokens - 200);
  assert.equal(day(s, '2026-11-08').totalTokens, 50);
});

test('分析の見積もりは、本文の長さ×2 ＋ 指示文と出力の分', () => {
  assert.equal(estimateAnalysis(['あいう', 'abcd']), 7 * 2 + 8000 + 6000);
});
