# 冷蔵庫くんに頼む：統合実装・公開準備報告

2026年11月7日（日本時間）。最新main `05d4e3dd8273844694b35ea70ab5b9b52f258be2` を取得。クリーンな既存作業ブランチと未マージPR #280の成果を確認し、専用ブランチ `feat/reizo-request-economy-20261107` に引き継いだ。元のPassport作業とLab監査は変更していない。

**判定：コード実装・分離検証を完了した統合候補。有料受付は本番OFFのまま。今回mainマージ・Production配備・実EMUER試験は行っていない。** PR/Previewの結果は末尾に記録する。

## 1. 完了した実装

- 既存の冷蔵庫くんのメニューに「この画面のガイドを見る」「冷蔵庫くんに聞く」「冷蔵庫くんに頼む」をこの順に表示。「頼む」は「聞く」の直下。選択メニューから開くだけで注文/決済しない。
- 画面ガイドの既存進捗を維持。ガイドを開くと依頼ボタンを隠し、通常の次へ/戻る/完了操作を維持する。「聞く」は従来のチャット、FAQ、操作案内を使い、既存の課金条件を変えない。
- 「頼む」は同じログイン/Passportを使う既存共通EMUER画面へ遷移する。仕事と5 EMUERの料金→目的入力→残高→料金・AI送信の同意→支払→結果・根拠・参照先→履歴の流れにした。
- 提供する仕事は、公開知識/Lab/Textを探す、Guild/Questから実践候補を探す、Cityの商品・体験・チケット等の公開情報を比較/案内する範囲。任意の文章制作等を実行できるとは表示しない。購入・参加・送金・契約は実行しない。
- **正常に探索完了した場合、候補が見つからなくても5 EMUER**を入力画面と決済確認で明示。失敗は元の未受取EMUERへ全額返却、未確定は返却待ちを維持。
- 見出し・案内・エラー・料金説明・プライバシー・Cityの旧coming-soon表示・サービス名を「冷蔵庫くんに頼む」へ統一。FAQにも条件・同意・返却・従来チャットとの違いを追加。
- 過去の注文名はユーザー/運営への読取時に新名称で返す。保存済み注文・金額・台帳は書き換えない。正規商品IDに限って旧商品名も認識し、表示名だけの変更で既存商品を停止させない。未知の名称・価格不一致は従来どおり拒否。
- キーボード操作、44px以上の操作領域、戻る、アカウント切替時の入力/履歴/同意の消去を検証。

## 2. 再利用した処理と維持した仕様

第1〜第3工程とPR #280の決済・ジョブ・返却・権限・Free制御を再利用。第二の残高、独立AIサービス、別ログインは作っていない。

|項目|維持した値/処理|
|---|---|
|料金|1依頼5 EMUER。サーバー商品設定と一致を検査|
|受付上限|JST全体20件/日、本人3件/日、同時2件|
|token予約|最大5,000/件、100,000/日|
|試験期間|設定した開始から7日。開始日を今回勝手に設定しない|
|追加Free保護|rolling60秒受付2、生成2、countTokensを含むHTTP10。PT日でも20件/100,000予約tokens|
|支払経路|現行Mitemiruの未受取EMUER台帳。server残高/本人SPID/冪等keyを検証|
|ジョブ|決済とqueuedを不可分で保存、永続lease/worker、再起動後照合、未知の生成を再実行しない|
|失敗/返却|429/モデル不可/認証/通信/worker障害を安全停止。返却は実確定までpending。復旧時一度だけ返す|
|商品交換枠|AI用枠は別。Cityの既存交換回数を消費しない|
|ウォレット/外部交換|直接wallet払は無効、外部交換はmock/TRANSFER_RESTRICTED。送金/DEX/架空レートなし|
|資料|新用途のaiUseApproved、piiReviewed、purpose v3、hash、期限、公開範囲/投稿者AI同意を再検査|
|外部送信|入力文や内部IDを送らず、固定の目的種別+承認済みタイトル/要約/関連順のみ。AIが選んだ仮番号を実ID/リンクへサーバーで復元|
|既存機能|Chat/画面ガイド、Lab/Text、Guild/Quest、City11商品、EMUER/公式パス/Passport/課金/Rules/コントラクトを維持|

内部の `ECONOMY_EXPLORER_*`、`schoolpark-explorer-v1`、商品ID、`emuer_v2_agent_*`、既存URL/クエリ名/条件版v3は互換性のため維持する。削除・名称変更のデータ移行なし。機械識別子にあるExplorerをユーザー向けブランドの残存と混同しない。

## 3. テスト・実ブラウザ

[件数](reizo-request-evidence/tests.json)：**783件合格、失敗0、skip0**。backend495、実Auth/Firestore/Rules16、City/Guild/ナビ/既存チャット/ガイド/analytics243、Lab29。単体の再実行を重複して合計していない。

- 実Firebase Auth検証とFirestoreはローカル専用demo project。既存台帳で5 EMUER支払→queued→worker→provider mock→保存→引渡し→本人履歴を検証。
- 二重送信/同じキーで異なる本文、残高不足/別人/許諾なし/非公開資料、上限到達後の無請求、429/各API障害/timeout/未知使用量停止、返却失敗→pending→一度だけ全額返却、OS worker停止/別プロセス復旧を検証。
- 旧商品名での受付互換、新名称の履歴投影、保存済み取引が不変、未知商品名や価格違いの拒否を確認。
- City公式ショップ11商品・3D/商品選択・RPC/既存交換の回帰、既存無料チャット/FAQ、ガイド進捗、Labの同意/出典/意味検索関連の拒否検査を実行。
- [統合ブラウザ](reizo-request-evidence/reizo-browser.json)：375/390/412/768/1280/1440/1920px。三つの順序、ガイド完了後の状態保持、チャットとの分離、Tab/Enter、44px、開くだけ無請求、戻る、横はみ出しなし、pageerrorなし。
- 390pxで同意なし支払を拒否、同意後の連打で一度だけ5 EMUER、結果/根拠/実ID/遷移先、Alice→Bobの入力/履歴分離を実際に操作。providerはmock、本番AI品質・実資金試験ではない。
- [既存画面のブラウザ](reizo-request-evidence/baseline-browser.json)も全7幅。返却待ち画像はHTTP fixtureでの表示確認で、返却実行の証拠とは別。
- Native統合用fixtureは本体の冷蔵庫くんmarkup/ハンドラ/選択controller/adapter/entryを使用し、ローカル発行Auth tokenでサーバー認証する。legacy背景agentはfixtureでは無動作。Production本人ログインの検証ではない。全外部ブラウザ通信は拒否。
- JS構文12ファイルを確認。静的フロントに共通build/lint/typecheck scriptはない。City生成物は再ビルドしない。初回の回帰試験はPlaywright既定ブラウザ未配置で失敗したため、既設Chromiumを指定して全243件を再実行・合格。セキュリティ検査やテストをskipして通していない。

スクリーンショット： [スマホメニュー](reizo-request-evidence/reizo-menu-390.png)、[PC依頼画面](reizo-request-evidence/reizo-request-1280.png)、[同意・料金](reizo-request-evidence/reizo-approval-390.png)、[結果](reizo-request-evidence/reizo-result-390.png)、[返却待ち表示](reizo-request-evidence/baseline-refund-pending-390.png)。実Android/iPhone、支援技術での操作は未検証。

## 4. Gemini無料枠・既存AIとの共用

[2026-11-07公式資料取得/metadata](reizo-request-evidence/provider-checks.json)：[規約](https://ai.google.dev/gemini-api/terms)、[料金](https://ai.google.dev/gemini-api/docs/pricing)、[レート](https://ai.google.dev/gemini-api/docs/rate-limits)はHTTP200。3.5 Flash-LiteのFree Tier入力/出力は無料と記載。実行環境キーでモデルmetadata200・generateContent/countTokens対応を確認した。推論やCloud Billing変更を行っていない。

- 前回Founder確認：CHES-SchoolPark / `emusch-2a111`、Free、RPM15、入力TPM250,000、RPD500、画面確認時0、Renderキーと一致の申告。
- **今回の指示はキー所属を未確認として再照合を求めている。** 過去の申告は履歴として維持しつつ、今回管理APIで再確認したとは扱わない。Render/GCP管理identityがなく、実Renderキーと請求先の直接照会は未実施。metadata成功はその代用にならない。
- Lab・既存チャット・有料依頼は同じRenderの `process.env.GEMINI_API_KEY`。Labの運営設定モデルは前回公開statusで3.5 Flash-Lite、既存チャットは `REIZO_GEMINI_MODEL`→`GEMINI_MODEL`→3.1 Flash-Lite。チャット実設定の上書きモデルは公開configから分からない。既存のチャットmodelや枠を変更していない。
- 依頼用は3.5 Flash-Liteに固定し、有料model/別providerへのfallbackをしない。GoogleのTierをupgradeするAPI/契約操作なし。**新しいカードなしで動かす技術構成はあるが、公開条件成立とは別。**
- provider枠はkeyではなくproject単位。RPDはPT深夜リセット。依頼専用のJST/PT/分間制御は実装済みだが、Owner画面は依頼分だけの記録でGoogle全体のライブ残量ではない。既存チャット等の急増で共有枠が不足すれば429で新規受付を止め、既払失敗分を返す。既存AIと絶対に競合しないとは断定しない。
- 前回画面の使用量0は当該時点の値。今の残量やモデルごとの全割当枠を確認した数値ではない。AI Studioの監視と停止/照合の担当・頻度を決める必要がある。

## 5. 本番公開を妨げる未解決条件

1. **Google規約とAPI Clientの提供条件**：18歳以上、18歳未満が対象/利用が見込まれるAPI Clientへの制約、professional/business用途、提供地域、EEA/CH/UKではPaid Servicesのみの条項が現行資料にある。「成人allowlistを付けたからEmu全体も適合済み」とはしない。有料提供それ自体が無料枠で禁止だと断定することもしない。既存未成年ユーザーを排除せず、提供者/法務へ利用形態を確認する。
2. **実キー/Free/共有監視の再照合**：過去のFounder申告と今回の直接確認を分離。新たなカード/契約なし、Free-only/支出0円の運用根拠と共用枠監視を確定する。
3. **実資料・実利用者**：aiUseApproved/piiReviewed/対象purpose/hash/期限、投稿者の元同意、成人等のserver-owned資格確認を実際に行う。fixtureやサンプルをコピーして全資料/全ユーザーを承認しない。対象plan/試験開始日時も未設定のまま。
4. **本番最終承認と受入**：今回の実装/PR作成承認は受付ON・実EMUER試験の承認ではない。対象アカウント/金額/操作の個別承認前に本番5 EMUERを消費しない。

コードで満たせる拒否検査・保存・復旧・UIは実装/検証した。外部規約の判断・管理画面の事実・実資料/対象者の承認を勝手にtrueへ置き換えない。

## 6. Founderの残操作・有効化手順

今は環境変数/DBを書き換えず、PRレビューと以下の事実確認を行う。

1. Google AI Studio「API keys/Projects」で、実際のRender既存キーが `emusch-2a111` / Freeかを管理画面で再照合。「Rate limits」で3.5 Flash-Liteの割当/使用量と共有機能を確認。**キー値や支払情報は送らない。Billing upgrade/カード追加はしない。**
2. Google規約のAPI Client/年齢/用途/地域の適合を確認し、記録へ残す。Emuの未成年利用と成人限定の依頼機能を同じサービス内で提供する形が対象。未確認のまま提供条件フラグを立てない。
3. 対象plan・実利用者・実資料・7日開始日時・監視担当を承認する。残高/商品交換/公式パスの既存権利は変えない。
4. 条件成立後、統合PRを通常手順でmain/Render/Vercelへ反映する段階を判断する。今回は未マージ・未配備。Vercelには既存 `/api/economy/*` rewriteを使い、APIキーをフロントへ渡さない。
5. Renderは既存 `GEMINI_API_KEY` を維持し、以下を**根拠成立後だけ**設定する。詳しい変数・復旧手順はoperations.md、Free制御はfree-tier-readiness-20261107.mdも参照。

|設定|必要な値/条件|
|---|---|
|ECONOMY_EXPLORER_ENABLED|最終承認までfalse。条件成立後のみtrue|
|ECONOMY_WORKER_ENABLED|配備/運用確認後true。停止時も既払分の照合・返却を続ける|
|ECONOMY_GEMINI_PROJECT_ID / BILLING_TIER|emusch-2a111 / free（再照合済みの事実を記録）|
|ECONOMY_EXPLORER_MODEL|gemini-3.5-flash-lite|
|ECONOMY_EXPLORER_DAILY_TOKEN_BUDGET|100000。1依頼予約5000はコードで固定|
|ECONOMY_EXPLORER_TRIAL_START / PLANS|承認したISO開始日時 / 対象planのCSV。未設定ならOFF|
|ECONOMY_AI_PROJECT_ATTESTED / BILLING_ATTESTED|実キー所属・Free-only/支出0円の確認後true|
|ECONOMY_AI_BUDGET_ATTESTED / BUDGET_APPROVAL_REF|共用枠監視・停止手順を確認後true / 実承認記録参照|
|ECONOMY_AI_TERMS_ATTESTED / AUDIENCE_ATTESTED|規約・用途・年齢・地域適合の確認後true|
|ECONOMY_AI_SOURCE_USE_ATTESTED|実資料の新用途許諾の確認後true|

Firestoreは既存private領域を利用し、Rules変更/公開不要。商品 `emuer_v2_agent_products/agent_schoolpark-explorer-v1` は5 EMUER・条件版 `explorer-20261107-v3`。正式表示名は「冷蔵庫くんに頼む」だが、過去の正規商品表示名も互換で受け入れるので名前だけの移行は不要。statusは最終条件成立までdraft。有資格者は `emuer_v2_agent_eligibility/{hash(spid)}`、資料は `emuer_v2_agent_source_approvals/{hash(sourceKey)}` の既存形式（operations.md）。本人確認済み・公開済み・AI同意・用途許諾を混同しない。

6. 条件が揃ったら本番試験案を提示し個別承認を受ける。例：Founderが指定するSchoolPark IDで成功依頼1回5 EMUER。別途承認した失敗/返却試験1回5 EMUER。計10 EMUERが一時引落、成功分5 EMUERのみ消費予定。障害の作り方も先に特定し、既存AIを止める試験はしない。**現時点で対象アカウントを指定/使用していない。**
7. worker heartbeat/予約量/実使用/未知usage/返却待ちを監視し、承認済み対象への限定公開へ進める。7日終了後も既払分の処理/返却を継続。

停止は新規受付false。job/order/usageを削除しない。未解決分の返却・照合が終わるまでworkerを停止しない。旧版へ戻した後の無検証ONは不可。

## 7. Productionで使えるもの・まだ使えないもの

[読取専用status](reizo-request-evidence/economy-status.json)：HTTP200、既存backend `3a3a6286d402796df443d1c7e25b035f5d66943b`、受付false、worker disabled。新名称/三択UIは今回未配備なのでProductionではまだ旧表示。公開configは既存チャットenabled=true（実会話成功の証拠ではない）。[公式商品一覧](reizo-request-evidence/city-products.json)はHTTP200・11品、購入なし。Lab APIは内部Rules-probeの副作用を避け今回Productionへ呼ばず、隔離テストだけ。

|区分|実際の状態|
|---|---|
|Production|既存の冷蔵庫くん/案内・共通EMUER画面・公式ショップ等。今回の統合コードは未反映|
|今回の開発候補|三択→頼む→ローカル5 EMUER支払→mock AI→結果/根拠/履歴・失敗返却まで検証済み|
|Production有料依頼|受付OFF。規約/実設定/許諾/利用資格/最終承認/本番受入が残る|
|Polygon直接決済・外部換金・汎用自動作業|今回提供しない。移転制限を維持|

## 8. PR・Preview・変更ファイル

PR/Preview・commitを作成後にここへ実結果を追記する。PR #280を含む統合候補であり、重複した新しい経済基盤を作っていない。main/本番へ自動反映しない。
