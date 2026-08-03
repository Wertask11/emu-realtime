"use strict";
/**
 * Camellia 記事の初期投入スクリプト
 * ------------------------------------------------------------
 * これまで camellia-app.html にベタ書きされていた CATEGORY_DEFS の記事を、
 * 自作DB（camellia_contents）へ取り込む。運用でコード編集が不要になる。
 *
 * 使い方:
 *   CAMELLIA_DATA_DIR=/your/data/dir node camellia-seed.js
 *
 * 既に同じタイトルの記事があれば skip するため、何度実行しても重複しない。
 */

const fs = require("fs");
const path = require("path");
const { getCamelliaDB } = require("./camellia-db");

const APP_HTML = path.join(__dirname, "..", "frontend", "public", "camellia-app.html");

/** camellia-app.html から CATEGORY_DEFS を取り出して JS として評価する */
function extractCategoryDefs() {
  const src = fs.readFileSync(APP_HTML, "utf8");
  const start = src.indexOf("CATEGORY_DEFS");
  if (start < 0) throw new Error("CATEGORY_DEFS が見つかりません");
  const eq = src.indexOf("[", start);
  // 対応する ] までを括弧の深さで特定する
  let depth = 0, end = -1;
  for (let i = eq; i < src.length; i++) {
    if (src[i] === "[") depth++;
    else if (src[i] === "]") { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end < 0) throw new Error("CATEGORY_DEFS の終端が見つかりません");
  const literal = src.slice(eq, end);
  // 配列リテラルのみを評価する（外部入力ではなく自リポジトリのファイル）
  return eval(literal); // eslint-disable-line no-eval
}

/**
 * 記事を取り込む本体。CLIからもAPI(管理画面)からも呼べるよう関数として公開する。
 * 同名タイトルはスキップするため、何度実行しても重複しない。
 */
async function importLegacyContents(dbInstance) {
  const db = dbInstance || getCamelliaDB();
  const contents = db.table("camellia_contents");
  const defs = extractCategoryDefs();

  let added = 0, skipped = 0, order = 0;
  for (const cat of defs) {
    for (const item of (cat.items || [])) {
      order += 1;
      if (contents.findOne({ title: item.title })) { skipped++; continue; }
      await contents.insert({
        legacyId: item.id || "",
        title: item.title || "",
        teaser: item.teaser || "",
        body: item.body || "",
        category: cat.id || "",
        categoryTitle: cat.title || "",
        order,
        published: true,
      });
      added++;
    }
  }
  await db.flushed();

  const byCategory = {};
  contents.all().forEach((r) => {
    const key = r.categoryTitle || r.category;
    byCategory[key] = (byCategory[key] || 0) + 1;
  });

  return {
    added, skipped,
    total: contents.count(),
    published: contents.count({ published: true }),
    dir: db.stats().dir,
    byCategory,
  };
}

module.exports = { importLegacyContents, extractCategoryDefs };

// CLIとして直接実行されたときだけ動かす（requireされたときは実行しない）
if (require.main === module) {
  importLegacyContents()
    .then((r) => {
      console.log("🌸 Camellia 記事の取り込み完了");
      console.log("   追加:", r.added, "件 / スキップ(既存):", r.skipped, "件");
      console.log("   保存先:", r.dir);
      console.log("   合計:", r.total, "件（公開:", r.published, "件）");
      console.log("   カテゴリ別:", JSON.stringify(r.byCategory));
    })
    .catch((e) => { console.error("❌ 取り込み失敗:", e); process.exit(1); });
}
