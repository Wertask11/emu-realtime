(function (root, factory) {
  "use strict";
  const prepare = factory();
  if (typeof module === "object" && module.exports) module.exports = prepare;
  else root.ReizoPracticePlan = prepare;
})(typeof window === "object" ? window : globalThis, function () {
  "use strict";
  // Display-only help from the already permission-checked artifact response.
  // No model, payment, data migration or statement of the owner's experience.
  return function prepare(a) {
    const legacy = (a.formatVersion || 1) === 1;
    if (!legacy)
      return {
        legacy: false,
        invalid: !a.document?.checklist?.length,
        items: [],
      };
    const kind = {
      quest_plan: "quest",
      guild_plan: "guild",
      city_comparison: "city_product",
    }[a.artifactType];
    const refs = (a.references || [])
      .filter((r) => !kind || r.kind === kind)
      .slice(0, 3);
    const items = refs.map((r) => {
      const title = String(r.title || "公開資料").slice(0, 100);
      if (kind === "quest")
        return `「${title}」の公式ページを開き、募集状況と参加条件を読む`;
      if (kind === "guild")
        return `「${title}」の公式ページを開き、活動内容と参加条件を読む`;
      if (kind === "city_product")
        return `「${title}」の公式ページで、公開価格・交換条件・在庫・期限を確認する`;
      return `「${title}」を読み、参考にする内容と自分の経験を分けてメモする`;
    });
    if (
      ["quest_plan", "guild_plan", "city_comparison"].includes(a.artifactType)
    )
      items.push(
        "候補の条件と自分ができることを照合し、必要な準備を本人の言葉で記録する",
      );
    if (a.artifactType === "knowledge_draft")
      items.push(
        "自分が実際に経験した出来事・方法・結果を書き出す",
        "公開してよい事実と、未確認の内容・個人情報・引用を分ける",
      );
    if (a.artifactType === "wil_plan")
      items.push(
        "今回確かめたい問いと、試す方法を本人の言葉で書く",
        "実践した日時・条件・観察結果を記録する",
      );
    items.push("実際に試した方法・結果と、次に試すことを本人の記録欄に残す");
    return {
      legacy: true,
      invalid: false,
      items,
      notice:
        "以前の形式で保存した記入用の計画です。下の確認項目は公開資料の名称を使った補助です。内容を確認・編集してから実践を始められます。元の計画の再生成・変更や追加料金はありません。",
    };
  };
});
