"use strict";
// Operator-authored public explanations derived from the existing routes and
// policy. Every snippet still needs a separate exact-content AI review record.
const membership = require("../../membership-policy");
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const hashes = new Map();
function originHash(id) {
  const files = {
    posting: ["frontend/public/knowledge-lab-guide.html"],
    research: ["frontend/public/knowledge-lab-guide.html"],
    navigation: ["frontend/public/unified-navigation.js"],
    plans: ["backend/membership-policy.js"],
    emuer_earn: ["backend/emuer-v2/router.js"],
    emuer_use: ["backend/mitemiru.js", "backend/emuer-v2/policy.js"],
    passport: ["frontend/public/schoolpark/tutorial.html"],
    stars: [
      "frontend/public/schoolpark/tutorial.html",
      "backend/quest-completion.js",
    ],
  }[id] || ["frontend/public/schoolpark/city-bridge.js"];
  return crypto
    .createHash("sha256")
    .update(
      files
        .map((f) => {
          if (!hashes.has(f))
            hashes.set(
              f,
              crypto
                .createHash("sha256")
                .update(fs.readFileSync(path.resolve(__dirname, "../../..", f)))
                .digest("hex"),
            );
          return f + ":" + hashes.get(f);
        })
        .join("|"),
    )
    .digest("hex");
}
const { row } = require("./contracts");
function guides(now = Date.now()) {
  const prices = membership
    .catalog(now)
    .plans.map(
      (p) =>
        (p.key === "guest" ? "Free" : p.key) +
        " " +
        p.amount +
        "円/月・公開投稿" +
        (p.post >= 1000000 ? "件数制限なし" : p.post + "件/月"),
    )
    .join("。");
  const defs = [
    [
      "service",
      "service_guide",
      "posting",
      "経験を知識として残す",
      "タイトルと本文を書き、分野・業種・経験を選び、下書き・自分用・公開で保存できます。文章の型は「こんな状況でした→これを試しました→こうなりました→この条件では別のやり方が必要かもしれません」。個人情報・職場の秘密・無断引用を公開しないでください。",
    ],
    [
      "service",
      "service_guide",
      "research",
      "知識を比較して研究を残す",
      "Knowledge Labで2〜3分野・2〜6件の知識を選び、共通点・違いを比較します。問い・未検証の仮説・実践案を記入し、自分用または公開の研究ノートに保存できます。元の知識が取り下げられると公開研究の表示は止まります。",
    ],
    [
      "service",
      "service_guide",
      "navigation",
      "Emu for SchoolParkの使い方",
      "知識を読む、知識を探す、知識を試す、知恵ライブラリ、Cityから利用します。知識を試すにはギルドとクエストの入口があります。閲覧だけでは参加・投稿・購入になりません。",
    ],
    [
      "service",
      "service_guide",
      "plans",
      "プランと投稿枠",
      prices +
        "。保存・研究・公式パスの条件はプラン画面の最新表示で確認します。",
    ],
    [
      "emuer",
      "emuer_guide",
      "emuer_earn",
      "EMUERを受け取る条件",
      "日々のログイン、条件を満たすGood、採用されたChange、クエストの完了などに既存の付与条件があります。クエストの報酬は公開条件と確認を満たした場合だけ受け取れます。EMUERは換金や収益を保証するものではありません。",
    ],
    [
      "emuer",
      "emuer_guide",
      "emuer_use",
      "EMUERの利用と交換",
      "City公式ショップで、受付中の商品・体験・チケットをEMUERで交換できます。交換はLight・Plus・Proが対象。商品交換枠はLight月1回・Plus週1回・Pro件数制限なしです。AI依頼の5 EMUER・日次枠とは別です。残高・価格・在庫・期限は交換前に確認します。",
    ],
    [
      "passport",
      "passport_guide",
      "passport",
      "SchoolPark Passportとログイン",
      "SchoolPark IDはLINE・Googleログインやウォレット連携と結び付く既存の本人用基盤です。ログイン済み・アカウント所有確認・公的本人確認は別の状態です。ログインや会員プランだけで、公的本人確認済み・出店資格確認済みとは扱いません。",
    ],
    [
      "passport",
      "passport_guide",
      "stars",
      "星空と実際の活動",
      "星空はSchoolParkでの実際の活動・クエストの完了などを示す仕組みです。星や証明書の保有を、年齢条件や公的本人確認の代わりにしません。自分の記録はプロフィールからPassport・星空を開いて確認します。",
    ],
    [
      "activities",
      "activity_guide",
      "echo",
      "ECHO FIELDを知る",
      "ECHO FIELDはCityの遊び・体験の入口から開ける既存のゲームです。利用資格や回数は既存の入口で確認します。案内を読むだけではゲームを開始しません。",
    ],
    [
      "activities",
      "activity_guide",
      "ringo",
      "林檎の方程式を知る",
      "林檎の方程式はCityから開ける既存の遊びです。遊び方と利用条件を入口で確認し、自分の操作で開始します。",
    ],
    [
      "activities",
      "activity_guide",
      "gods",
      "日常の神々を知る",
      "日常の神々はCityから開ける既存の遊びです。利用条件を確認し、自分の操作で開始します。",
    ],
    [
      "activities",
      "activity_guide",
      "elevator",
      "エレベーターを知る",
      "既存のエレベーターはCityの入口から開けます。案内の確認と、実際に体験を始める操作は別です。",
    ],
  ];
  return defs
    .map(([domain, kind, id, title, summary]) =>
      row(domain, kind, id, title, summary, {
        authorAIConsent: true,
        origin: "SchoolPark公式案内",
        originHash: originHash(id),
      }),
    )
    .filter(Boolean);
}
module.exports = { guides };
