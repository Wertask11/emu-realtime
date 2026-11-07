"use strict";
// Only predefined public concepts leave the service, never arbitrary user words.
const TOPICS = Object.freeze({
  beauty: {
    label: "美容・美容師の経験",
    re: /美容|理容|美容師|ヘア|サロン|髪|beauty|hair/i,
    related: ["publish", "learn", "work"],
  },
  web3: {
    label: "Web3・ブロックチェーン",
    re: /web\s?3|ブロックチェーン|ブロック.?チェーン|nft|dao|分散|暗号技術/i,
    related: ["learn", "practice", "passport"],
  },
  coffee: {
    label: "コーヒー・飲食",
    re: /コーヒー|珈琲|カフェ|飲食|バリスタ|coffee|cafe/i,
    related: ["learn", "practice", "shop"],
  },
  business: {
    label: "起業・仕事",
    re: /起業|経営|事業|仕事|ビジネス|開業|働|entrepreneur|business/i,
    related: ["learn", "work", "practice"],
  },
  education: {
    label: "教育・学習",
    re: /教育|授業|学習|学び|学ん|勉強|学校|教え|learn|study/i,
    related: ["learn", "practice"],
  },
  family: {
    label: "育児・暮らし",
    re: /育児|子育て|家庭|家族|暮らし|生活/i,
    related: ["learn", "publish"],
  },
  wellbeing: {
    label: "休息・生活習慣",
    re: /休息|休み|疲れ|整え|ペース|習慣|体調/i,
    related: ["learn", "play"],
  },
  science: {
    label: "科学・技術",
    re: /科学|数学|技術|実験|プログラ|開発|コード|science|program/i,
    related: ["learn", "practice"],
  },
  creative: {
    label: "制作・表現",
    re: /制作|デザイン|創作|音楽|イラスト|書く|表現|作品/i,
    related: ["publish", "work", "play"],
  },
  community: {
    label: "交流・コミュニティ",
    re: /交流|つなが|仲間|居場所|コミュニティ|孤立|出会/i,
    related: ["practice", "play"],
  },
  emuer: {
    label: "EMUERの利用",
    re: /emuer|エミュア|ポイント|残高|交換|貯め|報酬/i,
    related: ["emuer", "shop"],
  },
});
function plan(goal) {
  const q = String(goal || "")
    .normalize("NFKC")
    .toLowerCase();
  const topics = Object.entries(TOPICS)
    .filter(([, v]) => v.re.test(q))
    .map(([id]) => id)
    .slice(0, 5);
  const intents = [];
  if (/経験|知識.*残|投稿|役に立|共有|発信|書きたい/.test(q))
    intents.push("publish");
  if (/比べ|比較|どちら|違い/.test(q)) intents.push("compare");
  if (/emuer|ポイント|残高|交換|貯め|報酬/.test(q)) intents.push("emuer");
  if (/商品|チケット|買|交換|何ができ|ショップ/.test(q)) intents.push("shop");
  if (/クエスト|ギルド|挑戦|試|実践|やって|参加/.test(q))
    intents.push("practice");
  if (/passport|パスポート|星空|実績|本人確認/.test(q))
    intents.push("passport");
  if (/echo|遊び|ゲーム|りんご|林檎|神々|エレベーター/.test(q))
    intents.push("play");
  if (/プラン|料金|操作|使い方|設定/.test(q)) intents.push("navigate");
  if (!intents.length || /学|知り|勉強/.test(q)) intents.push("learn");
  const domains = new Set(["service"]);
  for (const i of intents) {
    for (const d of {
      publish: ["knowledge_lab", "knowledge_text", "guild", "quest"],
      learn: ["knowledge_lab", "knowledge_text", "guild", "quest"],
      practice: ["knowledge_lab", "knowledge_text", "guild", "quest", "city"],
      shop: ["city", "emuer"],
      emuer: ["emuer", "city"],
      passport: ["passport", "emuer"],
      play: ["activities", "guild", "city"],
      navigate: ["service", "passport"],
      compare: ["knowledge_lab", "knowledge_text", "guild", "quest", "city"],
    }[i] || [])
      domains.add(d);
  }
  return {
    intents: [...new Set(intents)].slice(0, 5),
    topics,
    domains: [...domains],
    method: "bounded-local-plan-and-gemini-semantic-comparison",
    maxRounds: 2,
    maxSources: 12,
  };
}
function features(s) {
  const q = (s.title + " " + s.summary).normalize("NFKC");
  return Object.entries(TOPICS)
    .filter(([, v]) => v.re.test(q))
    .map(([k]) => k);
}
function rank(pool, p, goal) {
  const terms = [
    ...new Set(
      (
        String(goal)
          .normalize("NFKC")
          .toLowerCase()
          .match(/[\p{L}\p{N}]{2,}/gu) || []
      ).flatMap((w) =>
        w.length > 3
          ? Array.from({ length: w.length - 1 }, (_, i) => w.slice(i, i + 2))
          : [w],
      ),
    ),
  ].slice(0, 80);
  const enriched = pool.map((s) => {
    const fs = features(s),
      lexical = terms.reduce(
        (n, t) =>
          n +
          (String(s.title + s.summary)
            .toLowerCase()
            .includes(t)
            ? 1
            : 0),
        0,
      ),
      semantic = p.topics.filter((t) => fs.includes(t)).length;
    return {
      ...s,
      relevance:
        semantic * 20 +
        Math.min(lexical, 15) +
        (p.domains.includes(s.domain) ? 3 : 0),
      semanticTopics: fs,
    };
  });
  // Second bounded pass follows shared public concepts between sources. It does
  // not fetch arbitrary URLs, run tools, or send the user's original request.
  const first = enriched
    .filter((s) => s.relevance > 3)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, 6);
  const related = new Set(first.flatMap((s) => s.semanticTopics));
  for (const s of enriched)
    if (s.semanticTopics.some((t) => related.has(t))) s.relevance += 2;
  const groups = new Map();
  for (const s of enriched.sort((a, b) => b.relevance - a.relevance)) {
    if (!groups.has(s.domain)) groups.set(s.domain, []);
    groups.get(s.domain).push(s);
  }
  const out = [];
  while (out.length < p.maxSources) {
    let added = false;
    for (const group of groups.values()) {
      if (group.length && out.length < p.maxSources) {
        out.push(group.shift());
        added = true;
      }
    }
    if (!added) break;
  }
  return out;
}
function providerPlan(p) {
  return {
    intents: p.intents
      .filter((i) =>
        [
          "publish",
          "learn",
          "practice",
          "compare",
          "shop",
          "emuer",
          "passport",
          "play",
          "navigate",
        ].includes(i),
      )
      .slice(0, 5),
    topics: p.topics.map((t) => TOPICS[t]?.label).filter(Boolean),
    scope:
      "公開資料を意味で比較し、学ぶ・残す・試す・利用条件確認の順序を提案する。参加や購入は実行しない。",
  };
}
module.exports = { TOPICS, plan, rank, providerPlan };
