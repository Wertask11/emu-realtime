# 冷蔵庫くんに頼む：正式継続提供

2026年11月17日。Founderの正式継続提供承認に基づく。Polygon Phase 5とは独立した、既存のアプリ内EMUER決済の再開。

## 提供条件

Plus・Proかつ既存の成人・提供地域・プロバイダー利用資格が確認済みの本人のみ。1依頼5 EMUER、全5作業、本人3件/JST日、全体20件/JST日、同時2件、100,000予約tokens/JST日・5,000/依頼を維持する。無料実践・記録は追加0 EMUER。既存商品交換枠は消費しない。

Gemini 3.5 Flash Lite、プロジェクト `emusch-2a111`、Freeのみ。有料モデルへの切替・Billing有効化・新規カード登録は行わない。無料枠の継続や24時間の受付は保証しない。共有プロジェクトの429、予約上限、モデル障害、Firestore障害、worker異常時は既存の受付停止・返却処理を維持する。

## 試験履歴と正式提供の分離

元の `ECONOMY_EXPLORER_TRIAL_START` と試験終了2026年11月14日15:48:46.671 JSTを保持する。`validUntilMs`、過去の資料審査・提供資格確認・注文・台帳・成果物は改変しない。

正式提供は次の独立設定で指定する。未設定時は従来の試験モード。未知のmode、承認参照・開始日時・商品設定の不一致は受付不可。

| 設定 | 正式提供 |
| --- | --- |
| `ECONOMY_SERVICE_MODE` | `continuous` |
| `ECONOMY_CONTINUOUS_START` | 承認記録と一致するISO日時 |
| `ECONOMY_CONTINUOUS_APPROVAL_REF` | `founder_continuous_20261117` |
| `ECONOMY_INTAKE_ENABLED` | 準備中false、確認後true |
| `ECONOMY_POLYGON_ENABLED` | false |

既存商品 `emuer_v2_agent_products/agent_schoolpark-explorer-v1` に、`offering={version:1,mode:"continuous",approvalRef,startedAtMs,intakeEnabled}` を追加する。従来の5 EMUER・live・条件版も毎回検証する。新規ジョブ作成トランザクションでも商品offeringを照合する。

## 既存審査の継続登録

試験期間と同日に終了した承認を、一律に有効と見なさない。純粋なレビュー補助 `tools/economy-tests/continuous-registration.cjs` で次を検証してから、新しい `continuousAuthorization` のみ追加する。

- 既存の公開・権利・AI利用・個人情報確認、目的、内容ハッシュと現資料の一致。
- Guildはリポジトリ内の公式名称・説明と一致。Questは公式seed、Cityは公式商品カタログとの一致も確認。
- 案内は現行ソース由来のoriginHashが一致。変更された案内は自動再承認しない。
- 本来の受付期限・在庫・公開撤回・AI許諾拒否・削除状態は引き続き毎回確認。
- 第三者投稿・Knowledge Textは公式資料の継続承認へ含めない。投稿者の同意を書き換えない。
- 提供資格は、既に成人・地域等を確認済みの同一SchoolPark IDだけ。Plus/Proだけで年齢等を推定せず、新しい利用者は既存の運営確認が必要。

新しい承認は旧審査のハッシュ・対象・正式提供承認に束縛する。旧審査変更、許諾撤回、内容変更、実際の資料期限到達、資格撤回は拒否する。`emuer_v2_agent_system/founder_continuous_20261117` に決定・旧設定のハッシュ・件数・登録日時を保持する。個人情報・キー・入力全文を公開監査記録へ出さない。

本番照合：既存50件中46件を継続対象とした。Guild5・Quest20・City11・使い方4・EMUER1・Passport1・遊び4。期限切れ第三者投稿2件とoriginHash不一致の案内2件を除外。これは過去50件を一律延長したものではない。未承認のLab投稿検索は停止し、公式の投稿・研究案内による知識投稿準備は維持する。全5作業で必要資料があることを課金なしで確認する。

## 停止・再開・復旧

新規受付のみ止めるには、商品 `offering.intakeEnabled=false` を更新する。新しい注文の作成時にも確認するため、見積もり後の停止も反映される。さらに `ECONOMY_INTAKE_ENABLED=false` を設定してRenderを再デプロイする。

**worker、商品live、返却能力は維持する。** 既払・受付済みジョブはintake停止のみを無視し、価格・資料・資格・提供条件など他の安全検証を継続する。失敗時は元の経路で返却し、未確定は返却待ちのままにする。新規決済を伴わない既存記録閲覧も、所有権・プラン・30日保存・許諾再検証を維持する。

同じ依頼の再送はサーバー内で進行中処理へまとめる。別サーバー・再起動後は従来の永続注文ID、fingerprint、Firestoreトランザクションで一注文・一引落を保証する。異なる内容で同じrequestIdは拒否する。

再開前にworker healthy、未処理注文/返却、Firestore読み書き、無料枠・予算・商品・資料・資格を確認する。商品offeringを有効化し、環境のintakeをtrueへ変更して再デプロイ。公開statusが `serviceMode=continuous,enabled=true,blockers=[],walletPaymentEnabled=false` となり、両Production aliasとRenderのreleaseCommitが一致することを確認する。安全フラグを一括でtrueにしない。

## 負荷・観測と検証の限界

公開 `/api/economy/status` 自体はFirestore読書き・モデル実行を行わない。既存の空キュー間隔は最大5分、readinessは1分、quota backoff・受付後wake・永続復旧は維持する。正式提供ではreadinessで商品・provider-safety・当日枠の3文書を読む（常時稼働換算4,320 reads/日）。新規注文は停止競合検証のため商品1readを追加する（最大20件なら20 reads/日、SDK再試行分別）。同時再送のまとめで重複読取を削減し、毎heartbeatの資料全件走査は追加しない。

Google Service Usageの上限はread50,000・write20,000/日。APIが返す上限と現在使用量・残量を混同しない。Founderのread4,453・write1,642は11月16日の申告スナップショットで、翌日のライブ残量ではない。再開準備では実読取・設定登録トランザクション成功とquotaエラー不在を確認する。正確な利用実数はFirebase Consoleで確認する。

本番の新規5 EMUER消費・付与・返却試験は行わない。全5作業・決済・返却・同時再送・再起動・権限は分離エミュレーターで検証し、Geminiはmockであると明示する。本番は既存実Gemini受入履歴の原本、資料・商品・worker・実API・画面を課金せず確認する。利用者のログインを偽装しない。
