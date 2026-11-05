# Passport 2.0 完成フェーズ報告 — 2026-11-05

**開発実装を拡張しました。本番公開は不可です。ZKPの未解決検証事項、実KMS・公的認証・外部監査・実機検証が残っています。mainへのマージ、本番デプロイ、Rules公開は行いません。**

前回の `feat/passport-2-vc-20261105` / `270bd4d` を復元し、報告対象35ファイルの存在と未コミット変更なしを確認。前回backend 448件、既存Emu回帰226件を再実行しました。今回の専用ブランチは `feat/passport-2-completion-20261105`。調査・変更予定の報告後に実装しました。途中でmainが `8ac3dd3` から `f9be01a`（運営画面のPR #271）へ更新されたため、その差分も保持して取り込みます。以前の [report.md](report.md) は初回成果物の履歴です。現在の判定は本書を参照してください。

## 1. 実装した機能

| 対象 | 実装と確認範囲 |
|---|---|
| 署名 | AWS KMS SDKアダプター。P-256 SIGN_VERIFY、鍵ARN・状態・用途・出自・公開鍵を検査。標準ライブラリによるDER変換。非抽出テスト鍵を使うSDK代替で署名検証。秘密鍵の平文設定なし |
| 鍵・信頼 | 明示的な発行者/公開鍵/期限/検証先レジストリ。旧公開鍵の保持、侵害鍵の拒否、緊急停止、公開鍵配布、固定項目の監査ログ、期限切れticket/auditの削除関数 |
| 通常VC | 既存のW3C VC2 / Data Integrity / Bitstring Status Listを維持。アカウント所有確認だけを証明。個人番号や公的本人確認を発行しない |
| 選択的開示 | `dc+sd-jwt`。アカウント属性の選択、必要属性不足の拒否、ES256署名、`cnf`所持者鍵とKB-JWT、audience/nonce/sd_hash/期限/失効の検証 |
| 発行 | pre-authorized code + PINに加え、登録済みclient/redirect、S256 PKCE、短命かつ一回限りのauthorization code、発行同意/拒否を実装。コードフローは単体/HTTPで検証。実ウォレット試験はpre-authorized方式 |
| 提示 | 最終版DCQL、登録先・目的・実開示属性・非開示属性・保存可能性、承認/拒否、履歴・撤回可能範囲。unsigned要求は `redirect_uri:` client IDと同一応答先を使用 |
| Wallet UI | 発行者/期限/失効/信頼状態、証明受領・提示・拒否、端末内非抽出鍵、鍵削除/失効/再発行、開示選択の保存設定、履歴削除、紛失時のトレードオフを表示 |
| 操作認証 | 新機能の重要操作だけ、15分以内のauth_timeとFirebaseの失効確認を追加。既存LINE/Googleログイン方式・ID対応は維持 |
| ZKP試作 | BBS+署名知識証明 + Bulletproofs++述語 + 正のアキュムレータ所属証明。年齢・本人確認資格・City資格を架空データで生成/検証。通常環境で既定無効。明示的な未監査ローカル試験だけ許可 |

画面だけの選択的開示ではありません。通常VCは全体提示、SD-JWTは対応属性だけを開示し、両者をUI/APIで区別しています。SD-JWTの発行者・有効期限・所持者公開鍵・不透明な失効参照等は隠れません。同じSD-JWTの再提示は関連付け可能で、ZKPとは呼びません。

## 2. 未実装・未完了

- 実AWS KMS/HSM接続、IAM/workload identity、実鍵のローテーション/障害復旧訓練。`managed.mjs` は準備インターフェースで、本番ルーターには接続していません。
- 公的個人認証、政府API接続、正式承認、政府由来の年齢/本人確認資格の発行。Cityの実出店承認をZKP資格へ変換する処理も未接続です。
- ZKPライブラリの厳密なデシリアライズ、外部暗号監査、別実装による独立検証、実スマートフォン測定。下記6章の問題は未修正です。
- 任意の外部Issuer/Verifierへの接続、汎用VC取り込み、公開信頼連合、第三者の一般登録、任意URL取得、mdoc、deferred issuance、DPoP、暗号化VP応答、W3C BBS標準暗号スイート。対応済みとは表示しません。
- 本番のTLS/公開ドメイン・本番保存領域・Rules・TTL・削除ジョブ・多拠点rate limit・負荷試験・法務審査。端末鍵のエクスポート/バックアップ/秘密回復は実装しません。

## 3. 変更ファイル

今回の差分は [completion-files.txt](completion-files.txt)。前回基盤を含むPR全体の差分はPRのFiles changedを参照してください。

- backend新規：`authorization.mjs`、`kms.mjs`、`trust.mjs`、`managed.mjs`、`selective.mjs`、`zkp-issuer.mjs`、`zkp-proof.mjs`、`experimental-zkp.mjs` と対応テスト。
- backend更新：`crypto.mjs`、`service.mjs`、`router.cjs`、`storage.cjs`、ルーターテスト、依存lock、既存serverへの限定mount/discovery/認証接続。
- frontend：Passport専用HTML/CSS/生成JS、遅延ロードのZKP JS、既存indexの認証後の承認要求復帰、専用CSP/プロキシ。
- tools：ブラウザビルド/fixture/実ウォレット接続/別プロセスZKP検証/ブラウザ試験と再現手順。
- docs：本報告、規格/構成/鍵・復旧/政府・ZKP資料。既存Rulesの本番公開なし。

## 4. 使用規格・ライブラリ

| 区分 | 採用 | 主張しないこと |
|---|---|---|
| データモデル | W3C VC Data Model 2.0、Data Integrity `ecdsa-rdfc-2019`、Bitstring Status List。Digital Bazaar各固定版 | 全規格の適合認証取得 |
| 選択的開示 | OpenWallet Foundation `@sd-jwt/sd-jwt-vc@0.24.3`、JOSE 6.2.15、ES256 / `dc+sd-jwt` | SD-JWTが自動的にJSON-LD VC2になる、SD-JWTがZKPである |
| 発行・提示 | OpenID4VCI 1.0 Final / OpenID4VP 1.0 Finalの限定プロファイル。公式GitHub Finalタグで確認 | 任意Wallet・全オプション対応 |
| KMS | `@aws-sdk/client-kms@3.1162.0`、`ecdsa-sig-formatter@1.0.11` | 実AWS/HSMでの検証完了 |
| ZKP | `@docknetwork/crypto-wasm-ts@0.67.0` / WASM 0.33.0、BBS+、Bulletproofs++、VB accumulator | W3C BBS暗号スイートや標準OpenID credential format、独立監査済み |

SD-JWTの `status_id` はアプリの不透明参照とサーバーの失効検査です。標準Token Status Listとしての汎用ウォレット相互運用は未実装。通常VCのまとめ失効リストと混同しません。Dockのproofは独自暗号を作ったものではありませんが、組み合わせた実験用プロファイルはSchoolPark固有で標準Wallet互換を主張しません。

## 5. セキュリティ検証

- 偽造/期限切れ/失効/異なる鍵・利用者・提示先、同意拒否/撤回、同時replay、PIN試行上限、grantのscope差替え、PKCE/redirect/state/nonce、政府モックを検証。
- ブラウザに非抽出CryptoKey、サーバーに秘密鍵を保存しない構成。新ページにPostHogやclient-error送信なし。固定エラー、no-store/no-referrer、厳密body許可、サイズ制限、任意外部URL取得なし、専用CSP、bearer認証/JSON/明示同意で新経路を保護。
- 非抽出鍵でも同一originのXSS/乗っ取りによる鍵操作は防ぎ切れません。既存アプリ全体の外部侵入試験や認証基盤の安全性認定は未実施です。
- Rulesエミュレーターは未ログイン/本人/他人/運営の4ロールで新名前空間への直接・catch-all・ネストアクセスを拒否。本番Rulesは変更しません。
- 新しい管理保存領域はRules公開後に生成するfresh realmを要求。古い寛容なRulesで事前作成された同名レコードを信頼しないためです。既存ID/データの移行ではありません。
- 以前の `ws` highはethers依存側8.18.x。使用箇所調査ではbackendのWebSocketProvider利用なし。受信Engine.IOは既に8.21.3。overrideを8.21.3に揃え、ethers providerとローカルWSのRPC応答も検証しました。攻撃が本番で成功するという認定はしていません。
- runtime auditは22件（critical/high 0、moderate 8、low 14）。既存指摘は残っています。Dock付随typedocのminimatchはスコープ限定overrideで修正。全アプリ脆弱性ゼロとは主張しません。

## 6. ZKPの実測と未解決問題

架空の署名済み生年月日/資格/有効期間/非公開失効IDとholder secretを使用。Aは署名済み誕生日の範囲、B/Cは署名済み資格値の範囲、全ケースで期限と現在のアキュムレータ所属を証明します。DOB・氏名・住所・秘密・失効IDは提示しません。単なる自己申告booleanやSD-JWTをZKPと呼んでいません。

3ケースの生成/検証、未成年/未確認/未承認/期限切れの拒否、署名本体改ざん、audience変更、失効の拒否、同一資格から異なるproof生成を確認。別プロセスは公開proof/公開鍵だけでライブラリを直接呼び出して検証します。ただし**同じライブラリを使うため別暗号実装/外部監査ではありません**。

**未解決：Dock WASM 0.33.0がproofの余分な末尾バイトと一部末尾変更を受理しました。** 証明本体の変更や不正条件は拒否され、資格偽造の成立は確認していませんが、厳密な入力検証・非正規表現への耐性が未完了です。追跡可能性/リプレイ対策を証明文字列の一意性に依存させてはいけません。受信側はnonce/stateの一回消費で防御していますが、これをライブラリ問題の修正とは扱いません。

この未達要件は `zkp.test.mjs` の `RELEASE BLOCKER: Dock rejects appended proof bytes` に**失敗するTODOテストとして残しています**。単なるテストの削除・成功扱いにはしません。通常環境でも `PASSPORT_ZKP_UNAUDITED_TEST_ONLY=true` がなければZKP API/UIは無効。productionでは同設定でも有効になりません。公開には上流レビュー/厳密な標準デシリアライズと外部監査が必要です。代替は信頼できる発行者の条件付きSD-JWT等ですが、これはZKPではなく関連付け可能性が残る方式です。

ブラウザ測定値は成果物 `completion-browser.json` を参照。390px、Chromiumデスクトップ、CPUを6倍遅延させた検証であり、**実スマートフォンではありません**。生成からサーバー検証完了までの時間で、証明生成だけの時間ではありません。メモリは50ms間隔のrenderer RSS（アプリ/JS/WASMを含む）とJS heap差分。WASM専用ピークやGCを除いた割当量ではありません。ZKPバンドル約7.8MiBは操作時だけロードします。実端末の速度/メモリ/電池負荷は公開前の条件です。

ランダム化されたproofでも、発行/提示時刻、共通発行者・schema・期限の集団、通信メタデータ、発行者へのwitness取得要求から相関され得ます。公開一括witness更新や共謀モデルの監査は未完了。完全な追跡不能とは表示しません。UTC暦日の18年境界は試験ポリシーで、法域・閏日・時差の運用確定も必要です。

## 7. 実ウォレット相互運用

未改変の **walt.id Wallet API2 1.2.1** 製品バイナリで、SD-JWTのoffer→受領→VP要求解決→本人の明示同意→提示受信成功、再送拒否、失効拒否を確認しました。

固定image digest：`sha256:7937cfe2450e5521e272615179baef66f805459df391f2321b2f20ad92468614`。コンテナから製品を取り出しJava 21で起動。設定のみlocalhost HTTP/開発用persistenceへ変更し、SDKだけで代替したものではありません。試験はAPI経由・架空利用者・隔離エミュレーター。外部公開TLS、製品スマホUI、OS Wallet、他社の本番検証サービスとの接続は未実施です。

通常VC2 `ldp_vc` とDock実験ZKPはこの製品で互換確認していません。製品が未対応のData Integrity suiteを含むmetadataを拒否したため、SD発行者のmetadataを `/sd` に分離し、対応する形式だけを提示しました。署名suiteを偽って通す変更はしていません。

## 8. 公的認証API接続の残条件

利用者から公式サイト許可設定の完了連絡を受けた後も、選択中の実行環境のeffective allowlistに公式hostがなく、デジタル庁/OpenID公式URLへのGETがproxyの403でした。設定未実施と決め付けず、**稼働環境への反映未確認**として扱います。公式GitHubのW3C/OpenID Final文書は確認しましたが、デジタル庁の最新API/条件は確認できていません。

認証APIは利用者の認証結果、署名APIは対象文書等への電子署名を扱う別用途です。これは一般的な区別であり、現行サービスの具体的なレスポンス属性/申込権限を確認済みという意味ではありません。

| 必要な確認・操作 | 現在 |
|---|---|
| デジタル認証アプリ/サービスの正式な認証API・署名APIの最新版、利用条件、返却属性・保証水準 | 公式資料の現行確認待ち |
| 申請主体・利用目的・対象サービス・審査・接続承認・sandbox登録・redirect/domain登録 | 未申請/未接続。Founder/正式管理者の操作が必要 |
| 認定事業者との契約が必要か、直接接続可能か | 未確認。推測で契約要否を確定しない |
| client認証/証明書/信頼chain・失効確認・本番認証情報の安全な受領 | 未設定。値をチャットへ送らない |
| 利用者同意、必要な属性だけの取得、個人番号12桁を取得しないデータ設計 | 新VCは12桁等を受け付けない。正式APIの属性抑制方式は接続前に確認 |
| 公的個人認証法・個人情報保護法・電子署名/委託/越境移転・保持/削除・漏えい対応 | 実際の利用目的と契約で法務確認が必要 |

モック成功でも `governmentVerified=false`、VCなし。実公的認証結果がない利用者に政府認証済み証明を発行する経路はありません。

## 9. 本番運用費用

実価格は未確認・未契約です。無料と断定しません。

- KMS：保持鍵数 × 鍵の月額 + Sign/GetPublicKey/DescribeKey等の回数 × リクエスト単価。地域/サービスの見積もりが必要。
- 独立HSMを選ぶ場合：HSM稼働/冗長化/管理費。今回AWS KMSアダプターの検証と同義ではありません。
- アプリ/Firestore：発行・提示・状態参照・監査ログ・cleanupの読取/書込・保存・TLS/監視/バックアップ。
- 政府API/認定事業者：正式条件でAPI利用料・契約/初期/従量費を確認。現在金額不明。
- 暗号/セキュリティ監査、法務、実端末試験、事故対応の工数。ZKP試作の公開費用は見積もり前。

## 10. 法務・運用判断

発行者/提示先の責任分界、資格の根拠・撤回、保証水準、目的外利用の禁止、相手の保持/削除契約、本人同意、未成年の年齢判定、API委託先とデータ移転、監査ログ90日案と失効tombstoneの保存期間を、運用主体の承認と専門家確認で確定してください。ログ90日/履歴50件は実装上の上限/準備案で、法定保存期間ではありません。相手へ渡った情報の削除は利用者UIから保証できません。

## 11. 検証・デプロイ手順

再現手順は [tools README](../../tools/passport-v2-tests/README.md)。結果ログ/画像/安全な集計JSONは `/workspace/outputs/passport-completion-20261105/`。テスト件数の最終結果はPRと成果物ログを参照してください。TODOは成功数に加えません。

実施した範囲：backend単体/HTTP/暗号、既存Emu回帰、Rules4ロール、実ブラウザ7幅（375/390/412/768/1280/1440/1920）、専用CSP、SD受領/拒否/同意、架空ZKP3条件、既存ログイン維持/戻る、実ウォレット製品、依存audit、構文/ビルド/差分。

実施できない範囲：実KMS・公的認証・本番アカウント操作/課金/報酬、実端末、全製品Wallet、独立暗号実装、外部侵入/暗号監査、長期運用/負荷・障害訓練。既存重要10モジュールは基点と同一で、ID/LINE/Google/Wallet/課金/権利/City/EMUER/KYCを移行しません。Quest/星空を含む実利用者データの書込みなし。

将来の公開手順（今回実行しない）：

1. PRレビューと残課題の解消。ZKPのTODOを隠さず解消・外部監査。UIの本番提供範囲を明示。
2. Founder承認後、Rulesのdenyとcatch-all除外を検証・公開。**公開後に**fresh storage realm（64 hex）を生成。既存/preseedレコードを再利用しない。
3. 非抽出の本番KMS鍵と最小IAM/workload identityを設定。秘密鍵の環境変数化は禁止。公開鍵pin・旧鍵期限・正式検証先/保持契約を登録。
4. realm固有controlを承認下で初期化。緊急停止/侵害鍵一覧/監査/cleanup・TTL・バックアップの実運用試験。現在のcleanup関数は自動jobではない。
5. 必要な政府申請/契約・正式sandbox/本番認証、属性と法務確認。個人番号を受領しないことを確認。
6. 実TLS/実KMS/物理スマホ/外部Wallet/復旧/性能・監視を検証し、別途リリースレビュー。現在のproduction強制disabledはenv設定だけで解除できないため、承認された提供範囲の明示的な公開変更が必要。
7. その後にmainマージとデプロイの承認を得る。今回はDraft PRまで。

## 12. 完成判定

| 判定項目 | 結果 | 理由 |
|---|---|---|
| 開発完了 | **全体未完了／限定プロファイルの実装・隔離検証まで** | KMSアダプター・SD-JWT・Wallet UI・実製品接続・架空ZKPは実装。汎用相互運用とZKP入力検証等は未完了 |
| セキュリティ検証完了 | **不可** | 内部試験済みだがZKPに既知TODO、外部監査・実KMS/侵入試験なし |
| 公的認証接続完了 | **未接続** | 正式仕様・条件の現行確認、申請/契約/認証情報・実認証結果がない |
| 本番公開可能 | **不可** | 上記に加えてRules/保存領域/運用/実端末/正式公開承認が未完了。本番はdisabledを維持 |
