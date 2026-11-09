"use strict";
// Local test-only provider response. Never imported by runtime or used as a live result.
module.exports = function reply(payload) {
  const p = JSON.parse(payload.contents[0].parts[0].text),
    kind = {
      quest_plan: "quest",
      guild_plan: "guild",
      city_comparison: "city_product",
    }[p.workType];
  const rows = p.sources.filter((s) => !kind || s.kind === kind).slice(0, 2),
    s = rows[0],
    n = s.title;
  const steps = [
    {
      action:
        "「" + n + "」の公開説明を開き、目的と必要な準備をノートに書き出す",
      done: "目的と必要な準備が別々の欄に残っている",
      references: [s.key],
    },
    {
      action:
        "「" + n + "」で最初に試す作業と、その作業に使う資料を一行ずつ書く",
      done: "最初の作業と使用資料の対応がノートにある",
      references: [s.key],
    },
    {
      action:
        "「" + n + "」に取り組む前後の観察項目を三つ選んで記録欄を用意する",
      done: "開始前と終了後を対比できる三つの空欄がある",
      references: [s.key],
    },
  ];
  if (p.workType === "wil_plan")
    steps[2].action =
      "コーヒーの香りと見た目を実際に観察し、飲む前後の気づきを分けて記録する";
  const result = {
    artifact: {
      title: "LOCAL検証用の具体的な準備計画",
      summary:
        rows.length > 1
          ? "候補ごとの目的を比べ、最初の資料を使って小さな実践と記録から始める提案です。"
          : "資料は単一候補です。公開説明を使い、目的の整理と小さな実践記録から始める提案です。",
      candidates: rows.map((r, i) => ({
        key: r.key,
        reason:
          "「" +
          r.title +
          "」を起点に、" +
          (i
            ? "別の活動目的との違いを整理する"
            : "必要な準備を先に揃えて取り組みを記録する") +
          "候補です。",
      })),
      recommendedKey: rows[0].key,
      steps,
      checklist: [
        "「" + n + "」の公式ページを開いて現在の公開状態を記録する",
        "「" + n + "」の条件と本人の利用資格を別々の欄で照合する",
        "「" + n + "」で読む資料と記録に使うノートを手元に用意する",
        "「" + n + "」で試した作業を開始前と終了後に分けて記録する",
        "「" + n + "」から学んだことと次に試すことを一つずつ書く",
      ].map((item) => ({ item, references: [s.key] })),
      unknowns: [
        "本人の参加資格と使える時間は未確認です。元画面の条件と自分の予定を照合する必要があります。",
      ],
      reflection: [
        "開始前の予想と実際の観察結果にはどのような違いがありましたか？",
        "今回の記録を別の状況で使うなら、どの条件を変えて試しますか？",
      ],
      draft: ["knowledge_draft", "wil_plan"].includes(p.workType)
        ? "## 状況と目的\n［本人記入：実際に経験した状況と取り組みたい問い］。この記録では、参照資料の内容と自分が観察した内容を分けて残します。\n## 試す方法\n［本人記入：使った道具と実施した手順］。始める前と終わった後を同じ項目で記録し、途中で変えた条件も併記します。\n## 結果\n［本人記入：実際に観察したことと予想との違い］。未実践の箇所は未確認と記し、成功や効果を断定しません。\n## 適用条件\n［本人記入：再現できた条件と次に検証すること］。他の状況で試す人が判断できるよう、根拠と未確認の点を区別します。"
        : "",
    },
  };
  if (!["knowledge_draft", "wil_plan"].includes(p.workType))
    delete result.artifact.draft;
  return result;
};
