# EMUER経済圏MVP 第3工程：公開判定

対象：Emu for SchoolPark / Wertask11/emu-realtime。2026-11-06 UTC（最終確認はJST 11月7日）。

**判定：有料Explorerは未完成・受付OFF。共通画面の安全な部分公開を進める。有料サービス完成とは判定しない。**

## A. 成果物と配備の区別

- 基準057c3c5を実在確認し、stage2-report.md・operations.mdと46ファイルの変更を照合した。
- 専用worktree/ブランチ `feat/emuer-economy-production-20261106` を作成。元のPassport作業ブランチと未コミット作業を保持した。
- mainの追加更新PR #277（朝/昼/夜の起動・ログインテーマ）は競合なく取り込み、維持した。
- 本報告の配備前時点では本番設定・DB・Rules・コントラクトを変更していない。実EMUERの消費・返却も行っていない。
- PR、本番SHA、Vercel/Render配備、公開URLの反映後証跡は下の「配備結果」へ追記する。コードが存在することと本番稼働を区別する。

## B. 第3工程で実装した内容

1. Founder承認どおり、価格5 EMUER、JST全体20件/本人3件/同時2件、入力・出力100,000 tokens/日、1依頼5,000予約、7日間試験運用へ整合させた。
2. 上限は台帳決済前の同一トランザクションで検査。上限後の注文・引落を作らない。商品交換枠・Lab/冷蔵庫くんの枠を消費しない。
3. countTokensで実リクエストを事前計数。過大なら資料を減らし、収まらなければ推論せず返却。実入力・出力を一度だけ記録。不明使用量・5,000超過は新規受付を停止し、保守的予約を維持する。
4. プロジェクト対応、請求/費用対策、共有予算の確認フラグと承認記録参照、試験開始日時を必須化。未設定・期間外はfail-closed。トークン承認を金銭支出承認に置き換えない。
5. worker成功heartbeatを確認し、古い/失敗時は決済を拒否。既払ジョブは永続保持。停止後は再生成せず返却し、返却未確定はrefund_pendingのまま。一度だけ使用量・返却を確定する。
6. 外部送信直前に資格・資料の公開/同意/内容ハッシュとleaseを再確認する。
7. 自由入力文はサービス内の字句照合に限定。外部へは固定の目的種別と、別途許諾・個人情報確認済みの公開資料タイトル/要約/関連順だけを送る。実資料IDを依頼内の仮番号へ置き換え、名称・実ID・根拠・遷移先はサーバーで復元する。AIが創作したURLやIDを採用しない。
8. 共通画面へ正確な利用条件、ログアウト時の受付状況、Owner限定のworker/使用量/未解決状況を追加。残高はログイン必須。秘密設定を公開しない。
9. DB/外部AIを呼ばない読取専用GET /api/economy/statusを追加。配備SHA・受付OFF・wallet/external無効を確認できる。
10. Firebaseテスト設定の相対パス不備を修正し、rootのfirebase.economy-tests.jsonで実CLI起動を再現できるようにした。

仕様/API/保存領域・設定名・停止/復旧手順は [operations.md](operations.md) に記載。

## C. 維持した機能・データ

- 既存Mitemiru台帳払い・おつり・返却・引渡しを再利用。独立した通貨残高を作らない。注文usageId:nullでCity交換回数に影響させない。
- ウォレット、未受取報酬、支払可能額、受取承認中、支払い済み処理中を区別する。
- City公式ショップ、既存商品11品、無料AI、Knowledge Lab/Text、公開知識、Guild/Questの参加・報酬を変更しない。
- 認証、SchoolPark ID、Passport、公式パス、課金、Rules、Polygon mainnetコントラクトを変更しない。
- Explorerのウォレット払いは固定無効。外部交換はmockでTRANSFER_RESTRICTED・quote:null・executable:falseのまま。送金・approve・DEX・架空レートなし。

## D. テスト・AI実行結果

第2工程の763件を再実行し、全合格・skipなし。その後の第3工程テスト結果は [stage3-evidence/tests.json](stage3-evidence/tests.json) を参照。

最終の自動テストは計**950件合格・失敗0・skip0**（backend470＋Auth/Firestore/Rules13＋既存フロント445＋Lab/出典/安全性22）。既存mainの起動テーマを含む。

- バックエンド：470件合格。価格/認証/冪等性/別人拒否/失敗返却/予算到達/利用資格/未知使用量停止/資料撤回/自由入力と内部IDの外部不送信など。
- 実Firestore/AuthとRules：13件合格。専用demoプロジェクト、localhostのみ。本番資金・本番Firebaseなし。
- OSレベルでworkerをSIGTERM停止し、別Nodeプロセスで再起動。保存済み注文を保持、生成0回で元台帳に一度だけ返却。leaseを検証DBで期限切れにして再現した。
- ブラウザ：375/390/412/768/1280/1440/1920px全幅。料金確認・戻る・横はみ出し・console errorなし。390pxで実ローカルAuthの本人切替、5 EMUERの模擬残高引落、結果表示を確認。返却待ち画像はHTTP fixtureの表示検証で、金融返却の証拠と混同しない。
- 実Gemini：公開Guild定義のみ。countTokens 200→generateContent 200。実使用入力220/出力13/計233 tokens、LEARN Guildの実ID learnと根拠を復元。本番DB・EMUER不使用。推論成功からプロジェクト請求先や本番設定を推定しない。
- npm audit（backend）：high/critical 0。残りmoderate8/low14。ethers v5系列等の既存指摘を残し、大規模なethers v6移行は行っていない。ws 8.21.3と既存Wallet/RPC互換テストを維持。
- 一律build/lint/typecheckスクリプトのない静的フロントなので、関連テスト・実Chromium・JS/script構文確認46件を実施し全合格。Cityの生成成果物は作り直さない。

証拠： [ブラウザ行列](stage3-evidence/browser.json) / [実AI](stage3-evidence/live-provider.json) / [audit](stage3-evidence/dependency-summary.json)。

画面（専用demoのみ）： [PC](stage3-evidence/desktop-1280.png) / [スマホ](stage3-evidence/mobile-390.png) / [結果](stage3-evidence/mobile-result-390.png) / [返却待ち表示](stage3-evidence/refund-pending-390.png)。実Android/iPhoneの測定ではなくChromiumのviewport検証。

### 修正して再検証した環境上の失敗

- 長時間稼働したfixtureのAuth token期限切れでブラウザ401。fixtureを再起動して全幅を再検証した。
- 統合試験と別のローカルworkerを同時稼働させると、停止対象ジョブを別workerが取得して試験がタイムアウトした。共有demo DBに触る試験は逐次実行し、別workerを止めて13件全合格。テストを削除/skipしていない。

## E. 公開阻害要因・Founderの残操作

### P0：有料受付をONにできない条件

1. **API Clientの対象条件**：[Gemini API利用規約](https://ai.google.dev/gemini-api/terms)（取得2026-11-06、記載有効日2026-03-23）は18歳以上に加え、18歳未満を対象/利用が見込まれるAPI Clientの制限を規定する。既存Emuは未成年利用がある。Explorerだけのserver-owned adultVerifiedゲートは実装したが、全体サービスとの整合が解決済みとは判定しない。利用形態・提供地域も含め、提供者/法務への確認が必要。既存未成年ユーザーを排除していない。
2. **実プロジェクト・請求・共有クォータ・費用上限**：この環境はGemini推論用APIのみ利用可能。GCP管理identity、Render/Vercel管理credentialはない。AI Studio「APIキー」で候補キーのプロジェクトを確認し、Cloud Console「お支払い」「割り当てとシステム上限」で実請求モード/請求先・共有制限を確認する。APIキーや支払情報はチャットへ送らない。承認済みの金銭上限と実効的停止手段を確定し、設定/監視記録へ反映する。Cloud Billingの予算通知だけを自動支払停止とみなさない。
3. **対象資料・資格・商品・workerの本番設定**：実際に新用途の許諾/個人情報確認済み資料、確認済み対象者、商品status/条件版、7日開始日時が必要。全ての資料や自己申告ユーザーを自動承認する処理はない。サンプル設定やdemoの報酬を本番へコピーしない。
4. **本番受入**：上記成立後、Founderが対象アカウント・5 EMUER・操作範囲を明示承認したテストが必要。現在は本番の認証済み残高、決済、Explorer提案、履歴、実返却を未確認。本人としてログインしたと偽らない。

公開料金表ではGemini 3.5 Flash-Lite Standardが入力$0.30/100万tokens、出力（thinking含む）$2.50/100万tokens。これは取得時の公開単価で、実プロジェクトの請求設定/費用上限を確認したことにはならない。課金額、為替、共有AI費用、モデル/料金変更の監視が必要。[公式資料の取得ハッシュ](stage3-evidence/official-sources.json)。

### 公開対象外として維持

Explorer wallet払い、外部トークン実交換、REFUND_ROLEを使う新返却送信は未実装/未検証で固定無効。自由移転制限を解除しない。

## F. 変更ファイル

Stage2からの変更一覧： [changes-from-stage2.txt](stage3-evidence/changes-from-stage2.txt)。mainからの公開差分はPRのFiles changedを正本とする。PR #277由来の起動テーマは既存mainの取り込みであり経済機能の変更ではない。

主な第3工程対象：backend/economy/{agent,config,service,router,fixture,economy.test,release.test}.js、backend/server.js、frontend/public/economy/{app.js,index.html}、frontend/public/privacy.html、firebase.economy-tests.json、tools/economy-tests/{fixture,worker-process,integration.test,live-provider}.cjs・browser.py・production-readonly.py、docs/economy/{operations,service-product.example,stage3-report}と証跡。

## G. 配備結果（反映後に追記）

PR/main/フロント/バックエンドの配備は未判定。配備前の本番 /api/economy/status は404、既存City商品一覧は200/11品、Lab AI statusはavailable:true、既存EMUER v2はchain137のまま。新しい有料受付は有効にしていない。

## H. 最終判定

開発・分離検証の完了と、有料Explorerの本番完成を分ける。有料受付OFFの共通機能部分公開は可能。有料MVP全体の完成条件はP0解消と承認済み本番受入を終えるまで未達。
