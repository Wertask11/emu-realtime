"use strict";
const crypto = require("node:crypto");
const VERSION = "reizo-cross-20261107-v1";
const PURPOSE = "explorer-cross-20261107-v1";
const SCOPE =
  "有効な連携先の許諾済み公開資料から、知識・教材・活動・商品・使い方を意味で比較し、出典と次の行動を提案します。対象資料がない領域や取得できなかった領域は結果に表示します。購入・投稿・参加・交換・送金は実行しません。正常に探索を終えた場合は候補0件も料金対象です。";
const DOMAINS = Object.freeze({
  knowledge_lab: "Knowledge Lab",
  knowledge_text: "Knowledge Text",
  guild: "ギルド",
  quest: "クエスト",
  city: "SchoolPark City",
  emuer: "EMUER",
  passport: "Passport・星空",
  activities: "遊び・体験",
  service: "使い方・プラン",
});
function profile(env = {}) {
  if (env.ECONOMY_CROSS_DOMAIN_ENABLED !== "true") return null;
  const domains = Object.keys(DOMAINS).filter(
    (k) => env["ECONOMY_SOURCE_" + k.toUpperCase()] === "true",
  );
  if (!domains.length) return null;
  const balanceAvailable =
    domains.includes("city") && env.ECONOMY_PRIVATE_BALANCE_ENABLED === "true";
  const achievementsAvailable =
    domains.includes("passport") &&
    env.ECONOMY_PRIVATE_ACHIEVEMENTS_ENABLED === "true";
  return {
    version: VERSION,
    domains,
    fingerprint: crypto
      .createHash("sha256")
      .update(
        JSON.stringify([
          VERSION,
          SCOPE,
          domains,
          balanceAvailable,
          achievementsAvailable,
        ]),
      )
      .digest("hex"),
    balanceAvailable,
    achievementsAvailable,
  };
}
module.exports = { VERSION, PURPOSE, SCOPE, DOMAINS, profile };
