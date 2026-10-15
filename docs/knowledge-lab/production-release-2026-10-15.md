# Knowledge Lab 本番反映とAI有効化

実Geminiの分析・引用・保存・意味検索は [実検証報告](live-gemini-verification.md) のとおり成功した。これは実APIとローカルエミュレーターの検証であり、本番の利用条件・本人操作の確認とは区別する。

## 本番反映方針

PR #196の図書館、独立分類、検索、研究履歴、保管復元、経験知循環、活動表示、運営指標を、既存機能の回帰確認後に反映する。AIを含む全25項目のREADYは、本番設定と本人操作の確認後に判定する。Rulesとインデックスの追加変更はない。root index.htmlは2行追加・1行変更。Camellia・既存認証・EMUER額/月次上限/トレジャリー・Room1・4タブは維持する。既存投稿の一括移行、削除、過去jobの推測分類は行わない。

Previewビルドは成功しているが、実閲覧はHTTPS CONNECTプロキシ403で停止する。アプリの403とは判定しない。ユーザー指示の代替手順に従い、実FirebaseエミュレーターとネイティブUIで投稿→検索→研究→履歴→保管→再ログイン→復元→Owner操作を再検証し、375/390/412/768/1024/1366pxで確認する。Previewを閲覧済みとは報告しない。

今回の最終コードでBackend349件、Emu/ガイド174件、Lab/API/Rules109件を実行し、合計632 PASS、失敗・skip 0。この段階では追加の公開停止ガード2件を含んだ。その後の明示指示でこのガードを撤去し、同じ2件を通常の本番設定による有効化と、Owner停止・無料枠/キー/環境停止の維持を確認するテストに置き換えた。実ネイティブUIの操作フロー・6幅表示も再実行でPASS。実Geminiの成功2分析・意味検索5例は前段の実API証拠を引き継ぎ、再生成して回数を消費したとは報告しない。

## 提供条件の確認記録と最新の実装方針

2026-10-15に [Google Gemini API Additional Terms](https://ai.google.dev/gemini-api/terms) を実取得した。

> You must be 18 years of age or older to use the APIs. You also will not use the Services as part of a website, application, or other service ... that is directed towards or is likely to be accessed by individuals under the age of 18.

また、EEA・スイス・英国の利用者へ提供する場合は有料サービスのみ、無料サービスへ機微・秘密・個人情報を送信しないという条件がある。一方、Emuの現行Termsは18歳以上または法定代理人の同意がある未成年の利用を認める。この整合は未確認。保護者同意や投稿者AI同意だけでGoogleの対象年齢条件を満たしたとは扱わない。課金を有効化して解決することもユーザーは許可していない。

Founderは18歳未満も対象であることを回答し、提供条件との整合を公開の停止条件とせずAI有効化を進めるよう明示した。これに従い、こちらで追加した `GEMINI_CLIENT_ELIGIBILITY_CONFIRMED` の停止ガードを撤去した。Google条件に適合すると確認できたという意味ではない。利用可能なキー・無料枠確認・Renderスイッチ・Ownerモデル設定を通常の有効化条件とする。Ownerの明示停止は維持し、自動で解除しない。

無料枠上限、秘密キーの非公開、認証と本人性、投稿者/利用者の明示同意、公開範囲、出典検証、未検証表示は維持する。追加の有料契約・課金切替は行わない。

## Founder本人が行う操作

本番反映後の画面で行う。秘密値をチャットへ貼らない。

1. 共有済みFirebase管理鍵は交換・旧鍵削除済みとの本人回答を確認。再操作を要求しない。
2. Renderの `GEMINI_FREE_TIER_CONFIRMED=true`、`KNOWLEDGE_LAB_AI_ENABLED=true` は本人確認済み。実API状態でもキー・環境スイッチ設定済みを確認。再登録不要。追加の提供条件フラグは不要。
3. 正規ログイン後「知識を探す→Knowledge Lab→運営管理」から「初期分類を登録」を押す。不足分類だけ追加し、既存IDは上書きしない。語句索引・保存数集計も準備する。
4. 本番で実際に残したい経験知と私用研究を使い、投稿・検索・編集・履歴・保管復元・Owner管理を確認する。他人の記録や本番テストユーザーは使わない。
5. Ownerモデル設定を保存する。実分析成功モデルは `gemini-3.5-flash-lite`、埋め込みは `gemini-embedding-001`。同意済み公開知識による実分析・引用・未検証表示・保存・意味検索まで本番確認する。キー登録やコード反映だけでは完了扱いにしない。

## 確認記録と戻し方

今回の自動テスト・実ブラウザー・Vercel／Render SHA・本番configは `/workspace/outputs/knowledge-lab-release-20261015/` に分けて保存する。実応答を確認するまでProduction反映済みとは報告しない。

AI問題はOwner停止とRenderスイッチfalse、Lab全体の問題はLab停止と確認済みコードへのロールバック。保存領域・namespace拒否・本人性修正を維持し、データ初期化・報酬送金・旧包括許可への復帰は行わない。
