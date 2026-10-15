# Emu Knowledge Lab — 実装設計

> これは初回PR #195の作業時の履歴資料です。現在の追加機能と公開状態は [completion-architecture.md](completion-architecture.md) を確認してください。

調査基点: main `412a4d8fea5928dc9ca12c2839e6e448fd8cc5aa`。既存の4ナビ、Room1、Firebase Auth、SchoolPark ID、EMUER v2を維持する。Previewは本番Firebase/Renderを共有するため、書き込み検証は `demo-emu-knowledge-lab` のAuth/Firestoreエミュレーターに限定する。

## データと権限

- 公開経験知は既存 `posts` が正本。`knowledgeLab` に分類、経験、出典、自己申告、更新履歴の版番号を追加する。
- 下書き・非公開・取り下げは `knowledge_lab_private_posts` に移し、公開 `posts` から本文・出典・経験メタデータを除去し、既に得たGood/ChangeやQuest実績を保持するため内容のない取り下げ記録を残す。本文の正本を二重に残さない。取り下げは復元可能。
- `knowledge_lab_writers`、`knowledge_lab_notes`、`knowledge_lab_saved`、`knowledge_lab_reports`、`knowledge_lab_taxonomy`、`knowledge_lab_history`、`knowledge_lab_system`、`knowledge_lab_search` はサーバー専用。包括許可から全 `knowledge_lab_.*` を除外する。運営アクセスは既存 `requireOwner`。
- 身元・所有権は検証済みFirebaseトークンからSchoolPark IDを解決。リクエストのUID/ウォレット/SchoolPark IDは信用しない。公開プロフィールは利用者が入力・公開を選んだ項目だけ。
- 月間投稿・募集・回答枠は既存Rulesと同じ `plan_usage/{uid}_r_mYYYY-M` をトランザクション更新。下書きは既存 `plan_counts/{uid}` と共有。新報酬を追加しない。
- 研究の公開は元投稿が現在公開中であることが条件。公開後も毎回再検証し、取り下げられた元知識を含む研究を他人へ配信しない。

## 検索

Firestoreを全文検索エンジンとして扱わない。公開投稿から派生した検索文書を、初回は128件ずつサーバーキャッシュに読み、NFKC正規化した部分一致を実行する。複数値は同一軸内OR、軸間AND。全検索対象で新着・更新・関連度を整列してから20件ずつ返す。上限20,000件/64MiBを超えたらエラーとし、部分検索を完全検索と表示しない。索引の初回作成・整合確認は運営の明示操作。正本の取得は画像等を考慮して25件ずつ。キャッシュは通常60秒ごとに更新分（遅延を考慮した10分の重複窓）を取得し、1時間ごとまたは索引再作成後に全体を確認する。検索文書は64KiB上限で、超過は切り捨てずエラーにする。投稿の本文の正本は増やさず、検索結果は必ず公開 `posts` を再検証する。形態素・曖昧検索は提供しない。

## 研究と既存連携

2〜3分野の候補知識を探索し、利用者が元知識を選ぶ。共通分類・異なる分類・出典を実データから比較し、人間が問い、仮説、実践案、結果を記入する。自動AI生成は利用可能なAPIがなく無効。AI利用を装わない。

募集は既存 `knowledge_requests`、回答は `knowledge_answers` を再利用。既存採用・懸賞・議論・Good/Changeは親画面の既存操作へ接続し、新しい付与処理を作らない。投稿・研究の参照IDを維持する。Passport/星空/Quest/Guildへの移動は既存画面へ渡し、人物や実績を勝手に生成しない。

## 公開ゲート

`KNOWLEDGE_LAB_ENABLED=true` を設定するまでAPIは書き込み不可。さらにサーバーが専用コレクションの匿名読み取り拒否を確認してから受け付ける。Rules手動公開→エミュレーター/Preview/回帰検証→PR確認→Render設定→本番確認の順。検証条件を満たせなければmainを変更せずNOT READYを報告する。
