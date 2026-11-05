# SchoolPark Passport 2.0 — Release Candidate 判定

日付：2026-11-05。PR：[Wertask11/emu-realtime #272](https://github.com/Wertask11/emu-realtime/pull/272)。ブランチ：`feat/passport-2-completion-20261105`。

**報告対象の実装commit SHA：`047d65bfda9db1bf72bbc5e54518817501056280`**（検証資料・手順を加える後続docs commitとは区別）。前回PRの比較基点は `737086c`、取り込み済みmainは `f9be01a`。

## リリース判定

| 判定 | 結果 | 対象・限界 |
|---|---|---|
| A. 開発完了 | **限定範囲で達成** | アカウント所有確認のVC2/SD-JWT、管理署名接続、同意・拒否、端末鍵、固定登録先での提示。RC自動試験470/470。既知の重大なZKP問題は対象外 |
| B. RC完成 | **ZKPを含まない限定RCとして達成** | エミュレーター統合、実Wallet製品、既存Emu回帰、7幅UI、運用/復旧手順まで。実KMS成功や政府認証接続を意味しない |
| C. 本番公開可能 | **不可・Founder承認待ち** | 実KMS/IAM、正式な接続/契約、実機、必要な独立監査・法務、実インフラ/運用検証が未完了 |

mainマージ、本番デプロイ、Rules公開、実本番の保存領域・ユーザーデータ変更は**一切行っていません**。既存serverのproduction強制disabledは維持。`createManagedRouter` は将来の承認済みbootstrapで接続するfactoryであり、環境変数だけで既存本番へ自動接続されません。

## 1. 公開対象として準備した機能

- 既存SchoolPark IDとログイン所有者に結び付けたアカウント証明。VC2 Data Integrity / `ldp_vc` と `dc+sd-jwt` は別形式。政府の本人確認、年齢、City出店権、公式パス権利を自動発行しません。
- SD-JWTの実属性選択、KB-JWT所持者署名、必要属性不足/未知発行者/別鍵/別audience/nonce/期限/失効の拒否。固定DCQL要求と1件のaccount応答だけを受け入れ、任意の要求・別credential format・余分なresult識別子を拒否。
- pre-authorized code + PIN、登録client/完全一致redirect、authorization code + S256 PKCE、発行承認/拒否、短命かつ一回限りのコード・nonce・state。一般向け外部Issuer/Verifier登録や任意URL取得はありません。
- `createManagedRouter` にKMS SDK署名器・登録鍵・公開鍵配布・重要操作のFirebase失効確認・共有レート制限・緊急停止を接続。秘密鍵のソフトウェアfallbackなし。現行サーバーへ自動mountしません。
- `workloadKmsClient` はOIDC token fileによるSTS federationを明示指定し、static access-keyのdefault chainへfallbackしません。STS/KMS endpointは指定regionのAWS HTTPSに固定。token値や資格情報をログ出力しません。
- 鍵ARN/用途/アルゴリズム/有効状態/公開鍵pin、旧公開鍵を保持するローテーション、侵害鍵拒否、監査。侵害/期限切れの鍵は一覧画面でも信頼済みと表示しないよう修正しました。
- Firestore共有固定windowレート上限。複数workerが同じ予算をtransactionで消費。IP/UIDは保存せず、共通の別管理HMAC鍵とwindowで不可逆なprivate document IDへ変換。障害・不正counterはfail-closed。HMACは匿名化の絶対保証ではなくprivateな短期の仮名化です。
- realmを限定した期限切れticket/audit/rate-limit削除、dry-run既定の隔離環境用one-shot job、TTL/index設定のレビュー用案。本番ジョブ/TTLは未設定です。
- 既存Passportから「証明書・プライバシー」へ入る導線、失効/期限/発行者/信頼状態、開示内容、提示拒否・履歴、端末内非抽出鍵と紛失時の失効/再発行。dialog名とキーボード操作を確認しました。

提供予定範囲は [rc-profile.json](rc-profile.json)。汎用デジタルID規格の全機能や全Wallet製品への適合認証ではありません。

## 2. ZKP安全性と除外

0.33.0の問題を再現・分類しました。末尾0/非0/32byte追加、末尾bit変更に加え、1byte切り詰めも受理しました。16byte切り詰め、先頭追加、中央bit改ざん、不正base58/空白/空文字は拒否されました。署名資格の偽造成立は確認していませんが、厳密なデシリアライズを保証できません。

最新0.35.0の登録情報・上流source/history・issue検索・代替AnonCredsを調査しましたが、安全なdrop-in修正は確認できませんでした。独自暗号、JSでの手書きbinary parser、末尾の切捨て/固定長照合は導入していません。詳細と最小再現は [zkp-upstream-reproduction.md](zkp-upstream-reproduction.md)。上流への投稿・連絡は行っていません。

**元のTODOテストは変更・削除・skipしていません。** 全backend試験で引き続き失敗するTODOとして実行します。RC試験はZKP機能全体を除外した明示的なscopeで、TODOだけを無条件に成功扱いするものではありません。

RCでは全ZKP APIをJSON parserより前に404拒否。公開用ディレクトリから約7.8MiBのWASMとライセンスbundleを除去し、専用CSPからWASM evaluation許可も削除。研究bundleは `/tmp` にだけ別生成し、明示opt-inのlocal fixtureだけが配信します。ZKP資格は架空データのみで、通常VC/SD-JWTやCity/EMUERの権限判定に転用しません。

**ZKPは本番対象外。ZKPを含む完成・安全性認定はしていません。** 実Android/iPhoneでの時間・メモリ・電池測定も未実施です。前回のdesktop/6x CPU測定は実機測定に置き換えません。

## 3. テストと証拠

| 試験 | 結果 |
|---|---|
| RC対象の全backend自動試験 | **470/470成功、失敗0、skip0、TODO0** |
| 実験ZKPを含む全backend | **全476件：475成功、失敗0、既知の失敗するTODO 1**。終了コード0だけで全成功と判定しない |
| 既存Emu回帰 | **226/226成功** |
| Rules deny4ロール + Admin許可/本人拒否 + 実共有rate/cleanup + managed統合 | **7/7成功** |
| 取り込み済み運営画面 | **4/4成功** |
| 実KMS相当SDKテスト | 障害で新規発行を拒否し保存件数不変、鍵交換後の既発行VC検証、侵害鍵拒否、公開鍵pin不一致、control欠落、別originの同意ページを拒否 |
| 実ブラウザ | **375/390/412/768/1280/1440/1920px**。SD受領/拒否/承認、Tab/Escape、dialog label、10回開閉、再読み込み後のログイン・記録維持、横崩れ/新page/API errorなし |
| 実Wallet | 下記マトリクス。未改変製品で再実行成功 |
| インストール/ビルド | 別の空ディレクトリでlockfileから `npm ci --ignore-scripts` 成功。通常bundle生成、server/router構文、`git diff --check` 成功 |
| dependency audit | runtime **22件：critical/high 0、moderate 8、low 14**。未解消の既存指摘を隠さない |

実統合はAuth/Firestoreエミュレーター＋AWS SDK試験用の**非抽出テスト署名鍵**＋実HTTPルーターで、発行→同意前拒否→同意→提示→緊急停止まで検証。実AWS成功とは区別しています。RulesのAdmin許可はクライアントへの権限緩和ではなくserver bypassの確認です。

画面：[390px](screenshots/rc-wallet-390.png) / [1280px](screenshots/rc-wallet-1280.png)。安全な集計：[rc-validation-20261105.json](rc-validation-20261105.json)。生ログは `/workspace/outputs/passport-rc-20261105/`。短時間の繰返しは既存のrate上限に当たるため、上限を緩めず試験を時間分割しました。

実機/VoiceOver・NVDA等の実スクリーンリーダー、数時間/数日のsoak、公開TLS、実KMS、政府sandbox、全サービスの外部侵入試験は未実施。全リポジトリのあらゆる外部接続試験が成功したとは報告しません。

## 4. Wallet相互運用マトリクス

| 実装/製品 | VC2 ldp_vc | SD-JWT | Dock ZKP | 実施範囲 |
|---|---|---|---|---|
| 内蔵Passport | 成功 | 成功 | RC対象外 | sandbox/RC自動試験、既存ログインからの実ブラウザ |
| walt.id Wallet API2 **1.2.1** | 未確認/対象suiteの一般互換を主張しない | **受領・提示・再送拒否・失効拒否成功** | 非対応として扱う | 未改変製品、localhost、架空資格、API操作。pre-authorized issuance |
| OWF独立VCI/VP SDK 0.9.2 | 限定試験成功 | HTTP/crypto試験 | 非対応 | 製品Wallet試験とは数えない |
| 別製品/OS Wallet | 未実施 | 未実施 | 対象外 | 第二の実製品と実端末の接続環境なし。対応済みと表示しない |

walt.idの固定image digestは `sha256:7937cfe2450e5521e272615179baef66f805459df391f2321b2f20ad92468614`。SDKだけで代替せず、製品バイナリをJava21で実行。設定だけloopback・開発用persistence/authへ変更しました。

SDの失効はSchoolPark側の不透明なstatus_idと受信側の再確認です。汎用Token Status List、任意Verifierとの失効相互運用、第三者全般への提示を完成済みとしません。authorization-code + PKCEは自動試験済みですが、この製品の実試験はpre-authorized方式です。

## 5. 公的認証の現行公式確認

2026-11-05にTLS検証を有効にして取得・照合：

- [民間/行政向け実装ガイド](https://developers.digital.go.jp/documents/auth-and-sign/implement-guideline)
- [民間向けAPIリファレンス](https://developers.digital.go.jp/documents/auth-and-sign/authserver/)

今回の実行環境で上記は200取得できました。前回の403報告を現在の確認結果と混同しません。一方、ガイドからリンクされた [民間事業者向け情報](https://services.digital.go.jp/auth-and-sign/business/) は別hostでproxy 403。料金・申込資格/個別審査/契約詳細と申込フォームの各入力画面は未確認です。

確認した具体的な仕様：

1. 認証はcodeフロー。`state`、S256 PKCE、ID tokenの正当性をRPで確認。認証の `acr_values` は資料上 `aal3 crl` または `aal3 ocsp`、後者は申込み時相談とされています。これはSchoolPark発行VCの政府保証ではありません。
2. 属性はUserInfoで必要に応じ取得。`openid`必須、name/address/birthdate/gender/picture/mynumber等は別scope。**mynumberは絶対に要求しない**。将来の最小要求案はアカウント連携にopenid、年齢判定に必要な場合だけbirthdate。実際の返却制御を正式sandboxで確認するまで接続しません。
3. 基本4情報は券面入力補助AP由来。UserInfoには個人番号の項目も存在するため、許可scope・受信境界・未知属性拒否・ログ/解析排除を接続前に独立確認する必要があります。不要な氏名/住所/性別を保持する案は採用しません。
4. 署名APIは署名トランザクション開始と結果取得を伴う別用途。ガイドは、民間向け結果について暗号化やplatform事業者への連携、RP側での署名検証責任を説明しています。認証だけの資格・契約と署名利用を同一視しません。
5. 認証結果/属性の取得可能時間は資料上60分。これはSchoolParkがその後の私的コピーを自由に保存できる、または自動削除できるという意味ではありません。
6. 申請時に登録したback-channel logout先への通知とlogout token検証、subによる対応付けが説明されています。既存Firebase UID/SPIDと政府subを自動同一視しません。

現在 `government.mjs` はモックのままで成功でもgovernmentVerified=false/VCなし。政府APIへの認可要求・userinfo取得・12桁個人番号の取得/保存・実本人確認済み資格の発行は行っていません。

## 6. ブロッカーと必要な監査

| 重要度 | 残項目 | 扱い |
|---|---|---|
| ZKP公開阻止 | 非正規proof受理、独立暗号監査、witness更新/追跡・共謀モデル、実機性能 | **ZKPをRC/本番から完全除外**。将来解消しない限り追加しない |
| 本番公開阻止 | 実KMS・OIDC/IAM・実鍵ローテーション/障害復旧 | SDK代替だけで済ませず、専用実テスト鍵/許可された環境で統合試験が必要 |
| 本番公開阻止 | 承認済みRules、fresh realm、TTL/index/job、backup/restore・監視・容量・LB/WAF | エミュレーター結果だけで本番完了としない。現在一切適用なし |
| 本番公開阻止 | 本番提供範囲の独立セキュリティ評価、実Android/iPhone、必要な法務確認、Founder承認 | RC限定scopeでも実施が必要 |
| 政府機能公開阻止 | 申請資格/契約/料金・正式sandbox/client・属性/保証/同意・個人番号排除の確認 | 未接続のまま除外。アカウント証明だけを政府本人確認と表示しない |
| 既存リスク | moderate 8/low 14、既存の自由記述KYC/Walletログ、長時間・大規模負荷、第二製品 | 新VCへコピーせず、既存データを削除せず、別途レビュー。全システム無漏えい認定はしない |

独立監査は、公開profileの認可/IDOR/同意・OAuth/DCQL境界、holder binding/replay/status、KMS/IAM/復旧、CSP/XSS/CSRF/SSRF、shared rate/負荷、バックアップ/データ保持、既存ログ・PostHog経路まで。ZKPを将来公開する場合は別途暗号・実装監査が必要です。

法務は公的個人認証法/個人情報保護法、API利用条件/委託・越境移転、本人同意/目的、取得情報の削除・開示、VC発行者と受領先の責任/保証、未成年の年齢境界を実際の提供条件で確認します。法務適合の認定はしていません。

## 7. Founderの残作業（未実行）

### AWS/IAM・鍵

1. AWS KMSの「キーの作成」で、専用の非対称/ECC_NIST_P256/署名と検証の**テスト鍵**を用意。本番鍵と分ける。鍵ARN/公開鍵は設定、秘密鍵はエクスポート/環境変数化しない。
2. IAMのID provider/roleで実行基盤のOIDCを登録。trust policyのissuer/audience/subjectを実際のworkloadへ完全限定し、ワイルドカードの外部主体を許可しない。実行基盤がOIDCを発行できない場合は対応基盤の選定が必要。
3. [IAM最小権限案](aws-kms-iam.example.json) のplaceholderを専用ARNへ置換しレビュー。アプリにはGetPublicKey/DescribeKey/Signのみ、鍵作成/削除/権限変更を与えない。これは適用済みpolicyではありません。
4. role ARN/region/token fileの**パス**を `workloadKmsClient` へ渡し、STS/KMS宛の通信を承認。実行環境には現在AWS outbound identity/資格情報がなく、実接続はできませんでした。値をチャットへ貼る必要はありません。
5. 公開鍵pinと旧鍵ring、失効/停止control、共通rate HMAC秘密を専用の安全な設定/Secret Managerで管理。HMACをworkerごとに生成しない。IAM/KMS key policyの両方、CloudTrail/監査閲覧権限、復旧担当を確認。

### マイナアプリ

1. 開発者サイトの「デジタル認証サービス」→「行政機関等・民間事業者向け実装ガイドライン」→「民間事業者向け情報」を開く。リンク先は前記の別サイトです。
2. 申込先の画面で、SchoolParkの事業主体・対象サービス・利用目的・必要な認証のみ/署名も必要かを確認し、利用資格・審査・費用・platform事業者契約の要否を公式窓口へ確認。**フォームの次画面は本環境で未確認のため、ボタン名や必須入力欄を推測しません。**
3. 正式sandbox、client登録、redirect/domain、公開鍵/認証方式、必要ならlogout先を登録。認証/署名/JWE用鍵はVC署名鍵と目的分離。個人番号scopeを申請/要求しない。
4. 同意文面、最小属性、返却保証水準・失効/再確認、法務/保持期間と責任を確定してから、別承認の実装・sandbox試験へ進む。モック結果を正式結果と扱わない。

### インフラ・審査

Founder承認後にのみRules/専用IAM/保存領域を適用し、**Rules公開後にfresh realmを生成**。管理SDKはRulesをbypassするため、RulesだけでIAM最小権限を達成したと考えない。専用service account・対象databaseへの権限を確認してください。実端末・独立監査・法務の担当/予算を確保し、最終承認まで本番bootstrapを変更しません。

## 8. インストール・設定・運用

隔離環境の再現：

```
git switch feat/passport-2-completion-20261105
npm ci --prefix backend --ignore-scripts
node tools/passport-v2-tests/build-wallet.cjs
node tools/passport-v2-tests/run-rc-tests.cjs
node tools/passport-v2-tests/run-rc-tests.cjs --all
node --require ./tools/passport-v2-tests/use-system-chromium.cjs --test tools/emu-tests/*.test.cjs
```

Auth/Firestoreエミュレーターとfixture、実Wallet製品、ブラウザ/Rules再現は [tests README](../../tools/passport-v2-tests/README.md)。必ず `demo-*` project とloopbackを使い、実課金鍵・本番Firebaseへ向けない。`--all` のTODOは前述の既知失敗です。

将来の承認済み接続は `workloadKmsClient`→`createManagedRouter`。既存の `requireFirebaseUser` / `identity.findByUid` / Firebase失効確認をそのまま注入し、新規認証方式やIDを作らない。issuer/base/frontendのHTTPS origin、登録client/redirect・Verifier正式名/目的/保持契約、storage realm、公開鍵ring、rate鍵を設定し、discoveryを同じrouterへ向けます。現在のserver.jsのmountは自動変更していません。

TTL/index案は [設定案](firestore-indexes.example.json)。**適用していません**。accounts/statusのTTL削除は設けず、既発行VCや失効tombstoneを消さない。ticket/audit/rateだけをrealm指定・件数制限で削除します。

隔離用jobの例（既定dry-run。`--apply` はdemoエミュレーター以外では拒否）：

```
GCLOUD_PROJECT=demo-emu-knowledge-lab-passport2 FIRESTORE_EMULATOR_HOST=127.0.0.1:8787 PASSPORT_STORAGE_REALM=YOUR_64_HEX_REALM node tools/passport-v2-tests/maintenance.mjs
```

本番schedulerは未配置です。承認済みの運用主体が `firestoreOperations.cleanup` を専用実行identityで起動するジョブを設置し、最初はdry-run、件数・対象realmを確認してから有効化してください。監査90日案とtombstone保持期間は法務/Founder確認が必要です。

## 9. 復旧・ロールバック

- リリース前に、配備commit/lockfile/configのhash、公開鍵ring、control、バックアップと責任者を記録。backupは個人情報を含み得るため暗号化・最小権限・保持期限・隔離restore試験が必要。実backup/restoreは未実施です。
- 異常時はまず発行/提示をcontrolで停止。RCのguardはcontrol不在・読取障害・侵害鍵を503拒否し、ソフトウェア署名器へfallbackしません。KMS障害時に新規発行しないことを確認。既に署名済みのstatusは有効期間内cacheから応答する場合があり、それを新規発行成功とは扱いません。
- bootstrapを既存のdisabled routerへ戻し、既存Passportを継続。DB/ID/契約/パス/EMUER記録を巻き戻さず、新realmの証明/失効データを保持。停止後はログ/鍵状態/保存状態を確認し、再開承認を得る。
- 通常ローテーションは新鍵pin/署名器を段階配置し、旧公開鍵は既発行VCの期限まで保持。旧鍵のSign権限停止/無効化と公開検証鍵の保持を区別。侵害の場合は旧鍵を信頼から外し全該当証明を拒否し、本人の既存ログインで失効/再発行する。
- 端末紛失は既存ログインで旧証明を失効し、新しい端末鍵で再発行。端末鍵を復号/回収して別端末へ移す機能はありません。非抽出鍵でも同一originの不正スクリプトによる利用は防ぎ切れません。

## 10. 費用・変更範囲

金額は未契約・未確認のため提示しません。KMS鍵の保持/Sign等の従量、Firestore transaction/保存/TTL/index/job、Secret Manager/STS実行基盤、監視/backup/WAF、政府API/必要なplatform契約、実機と独立監査/法務/事故対応の費用が必要です。API本体が無料か、仲介費用を含め無料かを混同しません。

前回 `737086c` との差分はPRのFiles changed/commit `047d65b`。backendのmanaged/workload/rate/試験、RCのZKP API拒否・bundle分離、通常CSP、Passportの入口名・dialog label、Rules/infra/browserの**隔離試験**を変更しました。既存backend/server.js、Rules本文、identity/認証方式/課金/パス/星空/Quest/City/EMUER/Wallet判定の変更・ユーザーデータ移行はありません。重要モジュールのバイト一致を確認しています。

RC限定scopeはレビュー可能です。ZKP・公的認証・実KMS・本番運用の未完了を隠して「Passport 2.0全機能完成」「本番公開可能」とは判定しません。
