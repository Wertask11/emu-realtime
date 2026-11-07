"use strict";
const m = require("./model");
const CAPS = {
  analysis: 10,
  embedding: 60,
  perPassportAnalysis: 3,
  perPassportEmbedding: 15,
  totalTokens: 200000,
  concurrency: 2,
};
/* LAB-01（11/7）：1日のトークン上限を「事前の予約」で守る。

   前は「すでに使った量が上限未満か」だけを見て、使った量を終わったあとに足していた。
   上限の直前（199,999）からでも1回実行でき、上限を超えていた。失敗した呼び出しは0として数えていた。

   いまは:
   - 呼ぶ前に、その1回で使いうる最大の量（見積もり）を予約する。
     「使った量 + 予約中の量 + 今回の見積もり」が上限を超えるなら、呼ばない。
   - 終わったら、実際の量で精算する。実際の量が分からないとき（失敗・時間切れ・報告なし）は、見積もりの全額を使ったものとして数える。
   - 精算されないまま期限が切れた予約（処理が途中で止まった等）も、見積もりの全額を使ったものとして数える。
   予約と精算は同じ日の記録（ai_usage/day-YYYY-MM-DD、JST）の中で、1回の処理（トランザクション）で行う。
   日付をまたいでも、予約した日の記録で精算する。上限の数字（CAPS）は変えていない。 */
const LEASE_MS = 60000; // gemini.js の通信は25秒で打ち切る。それより長く取る
const TOKENS_PER_CHAR = 2; // 日本語・記号・絵文字でも上回りにくい控えめな見積もり
const EMBEDDING_TOKENS_PER_TEXT = 2048; // gemini-embedding-001 の1件あたりの入力上限
const ANALYSIS_OVERHEAD = 8000; // 指示文・出力の型・引用候補の一覧
const ANALYSIS_OUTPUT = 6000; // gemini.js の maxOutputTokens
const DEFAULT_ESTIMATE = { analysis: 64000, embedding: 8 * EMBEDDING_TOKENS_PER_TEXT };
function estimateAnalysis(texts) {
  const chars = (texts || []).reduce((n, t) => n + String(t || "").length, 0);
  return Math.ceil(chars * TOKENS_PER_CHAR) + ANALYSIS_OVERHEAD + ANALYSIS_OUTPUT;
}
function estimateEmbedding(texts) {
  return (texts || []).reduce(
    (n, t) => n + Math.min(EMBEDDING_TOKENS_PER_TEXT, Math.ceil(String(t || "").length * TOKENS_PER_CHAR) + 16),
    0,
  );
}
function createBudget({ db, ref, now = Date.now }) {
  const day = () => new Date(now() + 9 * 3600000).toISOString().slice(0, 10);
  /* 期限切れの予約を「全額使った」として精算し、残りの予約の合計を返す。 */
  function settleExpired(gd) {
    const reservations = { ...(gd.reservations || {}) };
    let charged = 0,
      reserved = 0;
    for (const [token, r] of Object.entries(reservations)) {
      if (!r || !(r.until > now())) {
        charged += Math.max(0, Number(r?.tokens) || 0);
        delete reservations[token];
      } else reserved += Math.max(0, Number(r.tokens) || 0);
    }
    return { reservations, charged, reserved };
  }
  async function reserve(a, kind, estimate) {
    if (!["analysis", "embedding"].includes(kind))
      m.fail("AI_INVALID_OPERATION");
    const tokens = Math.ceil(Number(estimate));
    if (!Number.isFinite(tokens) || tokens <= 0) m.fail("AI_INVALID_ESTIMATE");
    const bucket = day(),
      token = m.hash([a.spid, now(), Math.random()]);
    const global = ref("ai_usage", "day-" + bucket),
      person = ref("ai_user_usage", m.hash([bucket, a.spid])),
      slots = ref("system", "ai-slots"),
      control = ref("system", "ai-control");
    await db.runTransaction(async (tx) => {
      const [g, p, s, c] = await Promise.all([
        tx.get(global),
        tx.get(person),
        tx.get(slots),
        tx.get(control),
      ]);
      const settings = c.data() || {};
      if (settings.stopped !== false || !settings.freeTierAttested)
        m.fail("AI_STOPPED", 503);
      const gd = g.data() || {},
        pd = p.data() || {},
        active = (s.data()?.active || []).filter((v) => v.until > now());
      const limit = Math.min(
        CAPS[kind],
        settings[kind + "DailyLimit"] ?? CAPS[kind],
      );
      const { reservations, charged, reserved } = settleExpired(gd);
      const used = (gd.totalTokens || 0) + charged;
      if (
        (gd[kind] || 0) >= limit ||
        used + reserved + tokens > CAPS.totalTokens ||
        (pd[kind] || 0) >=
          CAPS[
            kind === "analysis" ? "perPassportAnalysis" : "perPassportEmbedding"
          ]
      )
        m.fail("AI_DAILY_LIMIT", 429);
      if (active.length >= CAPS.concurrency) m.fail("AI_BUSY", 429);
      reservations[token] = { tokens, until: now() + LEASE_MS, kind };
      // 予約の一覧は項目を消すので、部分上書き（merge）ではなく、読んだ記録全体を書き直す
      tx.set(
        global,
        {
          ...gd,
          [kind]: (gd[kind] || 0) + 1,
          attempts: (gd.attempts || 0) + 1,
          totalTokens: used,
          unknownTokens: (gd.unknownTokens || 0) + charged,
          reservations,
          reservedTokens: reserved + tokens,
          updatedAtMs: now(),
        },
      );
      tx.set(
        person,
        { [kind]: (pd[kind] || 0) + 1, updatedAtMs: now() },
        { merge: true },
      );
      tx.set(slots, { active: [...active, { token, until: now() + LEASE_MS }] });
    });
    return { token, bucket, kind, tokens };
  }
  async function finish(lease, outcome, usage = {}) {
    await db.runTransaction(async (tx) => {
      const global = ref("ai_usage", "day-" + lease.bucket),
        slots = ref("system", "ai-slots");
      const receipt = ref("ai_calls", lease.token);
      const [g, s, event] = await Promise.all([
          tx.get(global),
          tx.get(slots),
          tx.get(receipt),
        ]),
        data = g.data() || {};
      if (event.exists) return;
      const input = Math.max(0, Number(usage.inputTokens) || 0),
        output = Math.max(0, Number(usage.outputTokens) || 0),
        reportedTotal = Math.max(input + output, Number(usage.totalTokens) || 0);
      /* 実際の量が分かるのは、成功して、提供元が量を返したときだけ。
         それ以外（失敗・時間切れ・量の報告なし）は、予約した見積もりの全額を使ったものとする。 */
      const known =
        outcome === "success" &&
        usage.providerTokensReported !== false &&
        reportedTotal > 0;
      const charged = known ? reportedTotal : lease.tokens;
      const reservations = { ...(data.reservations || {}) };
      // 期限切れで先に精算されていたら、二重に数えない
      const stillReserved = !!reservations[lease.token];
      delete reservations[lease.token];
      const reserved = Object.values(reservations).reduce(
        (n, r) => n + (r && r.until > now() ? Math.max(0, Number(r.tokens) || 0) : 0),
        0,
      );
      tx.create(receipt, {
        kind: lease.kind,
        bucket: lease.bucket,
        outcome,
        reservedTokens: lease.tokens,
        chargedTokens: stillReserved ? charged : 0,
        tokensKnown: known,
        finishedAtMs: now(),
      });
      tx.set(
        global,
        {
          ...data,
          inputTokens: (data.inputTokens || 0) + (known ? input : 0),
          outputTokens: (data.outputTokens || 0) + (known ? output : 0),
          totalTokens: (data.totalTokens || 0) + (stillReserved ? charged : 0),
          unknownTokens:
            (data.unknownTokens || 0) + (stillReserved && !known ? charged : 0),
          reservations,
          reservedTokens: reserved,
          inputCharacters:
            (data.inputCharacters || 0) + (Number(usage.inputCharacters) || 0),
          unreportedTokens:
            (data.unreportedTokens || 0) +
            (outcome === "success" && usage.providerTokensReported === false
              ? 1
              : 0),
          [outcome === "success" ? "successes" : "errors"]:
            (data[outcome === "success" ? "successes" : "errors"] || 0) + 1,
          updatedAtMs: now(),
        },
      );
      tx.set(slots, {
        active: (s.data()?.active || []).filter(
          (v) => v.token !== lease.token && v.until > now(),
        ),
      });
    });
  }
  /* estimate：この1回で使いうる最大のトークン数。省略すると、種類ごとの控えめな既定値を使う。
     再試行は1回だけ。再試行も別の呼び出しなので、改めて予約し、上限を超えるなら呼ばない。 */
  async function call(a, kind, fn, estimate) {
    const tokens = estimate ?? DEFAULT_ESTIMATE[kind];
    for (let attempt = 0; attempt < 2; attempt++) {
      const lease = await reserve(a, kind, tokens);
      try {
        const result = await fn();
        await finish(lease, "success", result.usage);
        return result;
      } catch (e) {
        await finish(lease, "error");
        if (
          attempt === 0 &&
          ["AI_PROVIDER_UNAVAILABLE", "AI_FREE_QUOTA_EXHAUSTED"].includes(
            e.message,
          )
        ) {
          await new Promise((r) => setTimeout(r, 400));
          continue;
        }
        throw e;
      }
    }
  }
  async function cacheHit() {
    await db.runTransaction(async (tx) => {
      const r = ref("ai_usage", "day-" + day()),
        s = await tx.get(r);
      tx.set(r, { cacheHits: (s.data()?.cacheHits || 0) + 1 }, { merge: true });
    });
  }
  return { call, cacheHit, caps: CAPS, estimateAnalysis, estimateEmbedding };
}
module.exports = { createBudget, CAPS, estimateAnalysis, estimateEmbedding };
