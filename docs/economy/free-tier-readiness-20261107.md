# SchoolPark Explorer：Free Tier 本番稼働準備

2026年11月7日（日本時間）。基点main `05d4e3dd8273844694b35ea70ab5b9b52f258be2`。ブランチ`feat/explorer-free-tier-readiness-20261107`。

**開発・分離検証を進めた候補版。Productionの受付OFFを維持し、本番有効化・本番EMUER消費・新しいカード/契約を実施していない。** PR/Previewの実結果は末尾に記録する。mainへは今回マージしない。

## 1. 実際のproject/modelと費用条件

Founder確認：Google AI StudioのCHES-SchoolPark、project ID **`emusch-2a111`**、既存Render GEMINI_API_KEYと一致。モデル**`gemini-3.5-flash-lite`**、Billing Tier **Free**、RPM15、入力TPM250,000、RPD500、当該画面確認時の使用量0。秘密値は取得/表示/記録していない。[確認記録](free-tier-evidence/founder-project-confirmation.json)。

この対応はFounderが管理画面で確認した情報として採用する。CodexがGCPの管理APIでkey/projectを照会したわけではない。APIキーlookupのためにキーをURLへ含める操作はしない。モデルmetadata GETは200（今回推論なし）。前工程には公開Guild定義だけの実Gemini成功233 tokensの記録があるが、今回の新規実推論・Free Tier請求確認と混同しない。

無料枠で技術的に動かせる構成であり、**新しいカード・Paid Tier契約は不要**。Emu側の既存キーを再利用し、有料モデル/別providerへの自動fallback、Google Billingのupgrade/支払操作を実装しない。ECONOMY_AI_BILLING_ATTESTEDは無料枠のみ・金銭支出0円を確認した記録として扱え、Paid契約の成立を要求しない。

## 2. 実装した変更

- 通常価格5 EMUER、JST全体20件/本人3件/同時2、100,000予約tokens/日・1件5,000、初期試験7日を維持。
- Free-only modeを追加。`ECONOMY_GEMINI_BILLING_TIER=free`が未確認なら受付OFF。modelは3.5 Flash-Liteだけ許可。有料モデルへの切替を許可しない。
- Explorerだけの追加制限：rolling60秒で受付2件、推論2回、countTokensを含むHTTP10回。米国太平洋時間の日付でも全体20件/100,000予約tokens。IANA America/Los_AngelesでPST/PDTを処理する。
- JST日替わりだけでGoogle RPDを2日分消費できないよう、PT予約を作成。元のJST枠と別に**同じ冪等トランザクション**で確保し、上限到達後は新規注文/引落なし。再送では追加予約しない。
- 内部の短時間枠による待ちは永続queuedへ戻し、再課金せず再開。期限/日付失効は処理せず返却。provider call直前にもlease/state/予約日を照合する。
- 429、404モデル不可、401/403認証拒否、400要求拒否、503等の障害、通信timeoutでは新規受付を停止する。未知の推論結果を再生成しない。返却停止からの復旧はAI停止中でも進める。
- 成功未確認を返却済みとしない。実際に既存Mitemiruの元台帳へ戻るまでrefund_pending。
- 外部へ送る本文は従来のfixed目的種別+確認済み公開資料のtitle/summary/関連順のみ。自由入力文・内部ID・非公開資料・参加者情報を送らない。実ID/リンク/根拠はサーバーで復元する。
- 新用途の資料承認に`aiUseApproved:true`を追加し、個人情報確認だけを利用許諾に代用できなくした。`piiReviewed:true`・purpose `explorer-20261107-v3`・内容hash・有効期限も必要。公開知識には投稿者の元のAI利用同意も必要。編集・撤回は送信直前/結果閲覧時にも検査する。
- 料金確認/利用条件/Owner運用画面に追加枠、停止原因、PT予約/直近HTTPを表示。料金や権利を変更しない。**同意版をv3へ更新し、旧資料承認を自動移行しない。**

## 3. 共用quotaへの影響と監視の限界

Lab・冷蔵庫くん・ExplorerはRenderの同じprocess.env.GEMINI_API_KEYを参照する。Labの稼働modelは3.5 Flash-Lite、冷蔵庫くんの実model上書きはpublic configから確認できず、既定は3.1 Flash-Lite。Camelliaは別Vercel環境で、Renderと同projectかは未確認。

Explorerの生成上限2/分・20/PT日は、確認済み15 RPM・500 RPDを小さく使う設計。ただし、他サービスの全負荷・model単位のquota・countTokensの扱いはAI Studioの実表示で照合する必要がある。使用量0は画面確認時のsnapshotで、将来も0という意味ではない。

Owner画面が表示するのは**Explorerの実保存カウンター**。Google project全体のライブ残量やGoogle Billingを自動取得する実装ではない。管理API用のOAuth/IAM情報はこの環境にない。Project全体を自動監視したと偽装しない。既存AIの使用枠や停止設定は変更していない。Labの既存token集計の課題は別監査で扱い、このPRに混在させない。

## 4. 結合テスト・安全性

[件数](free-tier-evidence/tests.json)。自動テストは合計756件：backend494、実Firestore/Auth/Rules15、既存City/Guild/統合nav/analytics225、Knowledge Lab/出典/安全性22。失敗0、skip0。暗号資産送信・本番残高を使っていない。

- 実隔離Firestore：認証、5 EMUER台帳支払、実保存した公開知識/Text/Quest/商品からの結果、履歴、並行再送一請求、別人拒否。
- 同じFirestoreで429を返すprovider mock→新規受付停止→返却失敗でrefund_pending→停止中に復旧→元台帳100 EMUERへ一度だけ返却、City交換枠0消費。
- OS worker SIGTERM停止・別Nodeプロセス再起動、未知の推論を再生成せず返却。
- PST/PDT、JST日替わり、PT上限/分間上限時の引落なし、内部待機後の一注文での完了。20件目の予約で新規受付が閉じても、その予約済み依頼は支払・実行できる境界も検証。
- 400/401/403/404/429/503、事前計数/推論timeout、不明usage、偽出典、資料撤回、明示許諾のない資料を拒否。
- 新しいfree_usageを含め、匿名/本人/Ownerクライアントからの制御collection直接読書きを現行Rulesで拒否。Rules変更・公開なし。
- 既存Cityの11商品の画面・操作・RPC/交換回帰テスト、既存Labのmock AI/同意/出典/保存テストを実施。既存の無料AIを有料化しない。
- 375/390/412/768/1280/1440/1920px：共通画面、料金確認、同意、実ローカル決済/結果、本人切替、戻る、返却待ち表示、横はみ出し/console errorを検証。端末実機や本番決済の確認ではない。
- 一律build/lint/typecheckスクリプトのない静的フロントなのでJS構文・既存テスト・実Chromiumで確認。Cityの生成コードを再ビルドしていない。

providerは分離結合テストではmock。これを新コードによる本番Gemini推論成功と扱わない。新しい課金/有料APIテストは行っていない。

## 5. Render / Vercelの設定と公開手順

**今は設定変更せず、PRレビュー・公開条件の成立・Founder承認を待つ。**

Renderの既存バックエンドで既存GEMINI_API_KEYを維持する。秘密値をVercelクライアントへ渡さず、キーを新規作成/交換しない。Vercelは既存`/api/economy/* → Render` rewriteを使い、フロント用のAPIキーは不要。

|Render設定|値/条件|
|---|---|
|ECONOMY_EXPLORER_ENABLED|最終承認まではfalse|
|ECONOMY_WORKER_ENABLED|配備・運用確認後true。受付OFFでも既払分の照合/返却を続ける|
|ECONOMY_GEMINI_PROJECT_ID|emusch-2a111（Founder確認済み）|
|ECONOMY_GEMINI_BILLING_TIER|free|
|ECONOMY_EXPLORER_MODEL|gemini-3.5-flash-lite|
|ECONOMY_EXPLORER_DAILY_TOKEN_BUDGET|100000|
|ECONOMY_EXPLORER_TRIAL_START|承認した試験開始のISO日時。勝手に今日を設定しない|
|ECONOMY_EXPLORER_PLANS|承認した対象planのCSV。未設定なら受付不可|
|ECONOMY_AI_PROJECT_ATTESTED|今回の管理画面での一致確認を運用記録へ残した後true|
|ECONOMY_AI_BILLING_ATTESTED|Free・新規課金なし・金銭支出0円運用の確認後true|
|ECONOMY_BUDGET_APPROVAL_REF|無料枠/支出0円/回数配分の承認記録への参照名|
|ECONOMY_AI_BUDGET_ATTESTED|既存AIの共用枠と監視/停止手順確認後true|
|ECONOMY_AI_TERMS_ATTESTED / AUDIENCE_ATTESTED|規約・年齢・用途・提供地域の適合を実際に確認するまでfalse|
|ECONOMY_AI_SOURCE_USE_ATTESTED|新用途の資料許諾を実際に確認するまでfalse|

Firestore（現行private領域。Rules公開不要）：

1. `emuer_v2_agent_products/agent_schoolpark-explorer-v1`：既存例JSONを確認し、5 EMUER・termsVersion=explorer-20261107-v3。最終条件成立までdraft。
2. `emuer_v2_agent_eligibility/{sha256(JSON.stringify(spid))}`：adultVerified/providerAllowed/validUntilMsは実確認済みの人のみ。自己申告、ログイン済み、公的本人確認済みを混同しない。
3. `emuer_v2_agent_source_approvals/{sha256(JSON.stringify(sourceKey))}`：aiUseApproved/piiReviewed、purpose v3、title/summaryのhash、validUntilMsを確認して登録。全資料への一括承認やtestデータのコピーはしない。
4. private worker heartbeat、JST/PT usage・provider-safetyはコードが管理する。初期値0を捏造して本番履歴を消さない。
5. 429後は受付OFF維持→AI Studio実枠/使用量を確認→既払分/返却待ち/不明usageを照合→Ownerが停止を解除。再発を無視して自動でflagsをtrueにしない。

本番へのコード反映、worker設定確認、対象者/資料/料金条件の確認を終え、Founderが有効化を承認した後だけ新規受付をONにする。

## 6. 未解決の公開条件

- **規約/年齢/用途/提供地域**：Googleの現行追加規約は、18歳未満の利用が見込まれるAPI Clientへの提供を制限し、professional/business用途、EEA/CH/UKでのPaid Servicesにも言及する。Emu全体は未成年利用の案内がある。Explorerだけの成人allowlistを実装したことを、API Client全体の適合確認の代わりにしない。適用範囲の提供者/法務確認が必要。
- **資料と利用者の実確認**：コードの拒否検査は実装・テスト済み。実ユーザー・実資料を確認して承認したという事実はまだない。対象plan/7日開始日時も実運用として決定・設定する。
- **共用projectの監視運用**：Explorerの安全停止はテスト済み。Google全体のライブ監視は取得権限なし。AI Studio確認を誰が/いつ行い、枯渇時に誰が停止/照合するかを運用記録へ反映する。既存AIと干渉しない絶対保証とはしない。
- **Previewの実接続**：末尾の実測結果を参照。Previewが本番Firebase/Renderと共有の場合、認証・支払・許諾設定等の書込みを試さない。
- **Founder本番最終承認・実EMUER試験**：未実施。今回の開発/PR承認と本番受付ONを分ける。

準備する本番試験案：Founderが指定するテスト用SchoolPark IDで、確認済み公開Guild等を探索する成功依頼を1回5 EMUER。別に承認した障害/返却試験を1回5 EMUER（全額返却）。一時引落計10 EMUER、成功分5 EMUERのみ消費予定。**アカウント・操作・金額の個別承認前に実行しない。** 本番に障害を注入する方法は先に具体化してレビューする。勝手にAPI全体を停止しない。

## 7. 変更ファイルとロールバック

backend/economyのconfig・service・agent・sources・router、専用free-tier制御・テスト、既存fixture/境界テスト。共通画面app.js/index.html、tools/economy-testsのfixture/結合/Rulesテスト、operations・商品例・本報告/証拠。認証/Passport/Wallet/City・EMUERコントラクト/既存課金/Rulesを変更しない。

新規受付はECONOMY_EXPLORER_ENABLED=falseで停止。既払分の照合・返却を終えるまでworkerを止めず、job/order/usageを削除しない。旧版へ戻す場合は新規受付OFFのまま未解決注文を照合する。旧版は新しいPT制御を持たないため、ロールバック後にそのまま受付ONにしない。

## 8. PR / Preview / 本番状態

PR作成・Previewの確認結果を反映後に記録する。Production受付はOFFのまま、本番デプロイ・main mergeは行わない。
