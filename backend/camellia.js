/* ══════════════════════════════════════════════════════════════
   Camellia AI

   これまで画面は「LLM未接続のため、接続後に回答を生成します」と
   返すだけだった。実際に答えるようにする。

   鍵はここには書かない。Render の環境変数に入れる。
     ANTHROPIC_API_KEY   … 必須。無ければ、そのことを画面に返す
     CAMELLIA_AI_MODEL   … 任意。既定は claude-sonnet-5

   送る中身は、本人が設定で選んだぶんだけ。
     LLMへの外部送信 が切られていたら、そもそも送らない
     取り込んだ履歴をAIの文脈に使う が切られていたら、記録を添えない

   会話は本人の記録として camellia_users/{uid}/profile/chat に残る
   （画面側が localStorage 経由でサーバーへ写している）。
   ここでは保存しない。二重に持つと食い違う。
   ══════════════════════════════════════════════════════════════ */

/* 選べる相手。名前は Camellia のもの、中身はモデル。
   ホームページで Camellia を「種・芽・葉・花」で表しているので、そこに乗せる。

   使う人には名前だけを見せる。中身のモデル名は画面に出さない。
   差し替えたときに、画面の言葉を直さずに済む。 */
const MODELS = {
  mebae: { label: "Camellia 芽", model: "claude-haiku-4-5-20251001", note: "軽くて速い" },
  ha:    { label: "Camellia 葉", model: "claude-sonnet-5",           note: "ふだん使い" },
  hana:  { label: "Camellia 花", model: "claude-opus-5",             note: "じっくり考える" }
};
const DEFAULT_KEY = process.env.CAMELLIA_AI_DEFAULT || "ha";
const MODEL = process.env.CAMELLIA_AI_MODEL || "claude-sonnet-5";
const MAX_TOKENS = 700;
const MAX_TURNS = 12;        /* 送る往復の数。増やすほど費用が上がる */
const MAX_CHARS = 2000;      /* 1回の発言の長さ */

/* つらさが強く出ている言葉。ここに当たったら、答えの前に相談先を出す。
   医療の判断はしない。窓口へつなぐだけ。 */
const CRISIS = /死にたい|消えたい|いなくなりたい|自殺|首を|リストカット|OD|殺して|生きていたくない/;

const CRISIS_REPLY =
  "つらいことを書いてくれて、ありがとうございます。\n"
  + "ここでは、いのちに関わることに十分に応えられません。"
  + "いまの気持ちを、話を聞いてくれるところへ届けてほしいです。\n\n"
  + "・まもろうよ こころ（厚生労働省）https://www.mhlw.go.jp/mamorouyokokoro/\n"
  + "・よりそいホットライン 0120-279-338（24時間・通話無料）\n\n"
  + "急を要するときは 119 番も使えます。\n"
  + "落ち着いたら、またここで続きを書いてください。待っています。";

const SYSTEM =
  "あなたは Camellia の対話相手です。女性のウェルネスとウェルビーイングを支える場所にいます。\n"
  + "・相手の言葉をそのまま受け止めてください。急いで整理したり、結論を出そうとしないでください。\n"
  + "・診断や治療の判断はしません。薬の増減や中止も勧めません。\n"
  + "  体や心の不調が続くときは、医療機関や公的な相談窓口にかかることをすすめてください。\n"
  + "・励ましで気持ちを打ち消さないでください。「大丈夫」と言い切らないでください。\n"
  + "・短く、やわらかい日本語で。2〜4文を目安にしてください。\n"
  + "・相手が求めていないアドバイスは足さないでください。";

function createCamelliaRouter(deps) {
  const express = require("express");
  const router = express.Router();
  const { db, requireFirebaseUser, rateLimit } = deps;

  /* 1人あたり1分に10回まで。費用がかかるので、ここは締めておく。 */
  const chatRateLimit = rateLimit({ windowMs: 60_000, max: 10, key: "camellia-ai" });

  /* Camellia に入った人だけ（生年月日と同意を済ませた人）。 */
  async function requireMember(req, res, next) {
    try {
      const uid = req.identity && req.identity.uid;
      if (!uid) return res.status(401).json({ error: "NO_AUTH" });
      const s = await db.collection("camellia_users").doc(uid).get();
      if (!s.exists) return res.status(403).json({ error: "NOT_MEMBER" });
      req.camellia = s.data() || {};
      next();
    } catch (e) {
      return res.status(500).json({ error: "MEMBER_CHECK_FAILED" });
    }
  }

  /* 選べる相手の一覧。画面はこれを見て選択肢を作る。
     中身のモデル名は返さない。使う人には関係がなく、
     差し替えたときに画面を直さずに済む。 */
  router.get("/models", requireFirebaseUser, requireMember, function (req, res) {
    return res.json({
      ok: true, defaultKey: DEFAULT_KEY,
      models: Object.keys(MODELS).map(function (k) {
        return { key: k, label: MODELS[k].label, note: MODELS[k].note };
      })
    });
  });

  router.post("/chat", requireFirebaseUser, chatRateLimit, requireMember, async (req, res) => {
    const b = req.body || {};
    const text = String(b.message || "").trim();
    if (!text) return res.status(400).json({ error: "NO_MESSAGE" });
    if (text.length > MAX_CHARS) return res.status(400).json({ error: "TOO_LONG" });

    /* いのちに関わる言葉が出たときは、モデルに渡す前に窓口を返す。
       ここは機構の入り切りに関係なく、常に働く。 */
    if (CRISIS.test(text)) {
      return res.json({ ok: true, reply: CRISIS_REPLY, crisis: true, model: null });
    }

    /* 鍵が無いあいだは、運営が手で返す。
       ここでエラーを返して終わりにすると、書いた人は突き放される。
       受け取ったことを伝えて、あとは管理画面から返事が届くのを待ってもらう。

       書いた内容は、この時点ですでに本人の記録として残り
       （camellia-store.js が profile/chat へ写す）、管理画面から読める。 */
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) {
      return res.json({
        ok: true, manual: true, reply: "",
        /* 受付の言い方（「受け取りました」）だと、窓口に用件を出したように読める。
           ここは対話の相手なので、読んでいることが伝わる言い方にする。 */
        message: "いま、ゆっくり読んでいます。少しだけ待っていてね。"
      });
    }

    /* 送るのは、本人が許したぶんだけ。 */
    const allowExternal = b.allowExternal !== false;
    if (!allowExternal) {
      return res.status(400).json({
        error: "EXTERNAL_OFF",
        message: "設定で「LLMへの外部送信」が切られています。設定から入れてください。"
      });
    }

    /* 選ばれた相手。知らない名前が来たら、既定のものにする。
       画面から来た値をそのままモデル名として使うと、任意のモデルを呼べてしまう。 */
    const chosen = MODELS[String(b.model || "")] || MODELS[DEFAULT_KEY] || MODELS.ha;

    const history = Array.isArray(b.history) ? b.history.slice(-MAX_TURNS) : [];
    const messages = history
      .filter(function (m) { return m && m.text && (m.role === "user" || m.role === "assistant"); })
      .map(function (m) {
        return { role: m.role, content: String(m.text).slice(0, MAX_CHARS) };
      });
    messages.push({ role: "user", content: text });

    /* 今日の記録を添えるかどうかも、本人の設定にしたがう。 */
    let system = SYSTEM;
    if (b.useContext && b.today && typeof b.today === "object") {
      const t = b.today;
      const parts = [];
      const put = function (label, v) { if (v !== undefined && v !== null && v !== "") parts.push(label + v); };
      put("気分", t.mood); put("睡眠", t.sleep); put("不安", t.anxiety);
      put("ストレス", t.stress); put("孤独感", t.loneliness); put("疲れ", t.fatigue);
      if (parts.length) {
        system += "\n\n今日その人が書いた記録です。触れられたときだけ使ってください。"
          + "こちらから読み上げたり、指摘したりしないでください。\n" + parts.join("・");
      }
    }

    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: chosen.model, max_tokens: MAX_TOKENS, system: system, messages: messages
        })
      });
      const data = await r.json().catch(function () { return {}; });
      if (!r.ok) {
        console.error("camellia ai error:", r.status, data && data.error && data.error.message);
        return res.status(502).json({
          error: "AI_FAILED",
          message: "うまくお返事できませんでした。少し時間をおいてからお試しください。"
        });
      }
      const reply = (data.content || [])
        .filter(function (c) { return c.type === "text"; })
        .map(function (c) { return c.text; }).join("\n").trim();
      return res.json({ ok: true, reply: reply || "…うまく言葉にできませんでした。もう一度お願いします。",
        model: chosen.label });
    } catch (e) {
      console.error("camellia ai exception:", e.message);
      return res.status(502).json({
        error: "AI_FAILED",
        message: "うまくお返事できませんでした。少し時間をおいてからお試しください。"
      });
    }
  });

  return { router };
}

module.exports = { createCamelliaRouter };
