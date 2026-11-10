# Phase 5 返却署名器・POL予約・公開準備

2026-11-10。基点 `b784094ddeda196370249a1f1b1ae3d198fe108f`（PR #332）。

判定：技術実装 **PARTIAL**、セキュリティ **PARTIAL**、法務 **PARTIAL**、本番Polygon決済 **OFF**。
既存アプリ内5 EMUER、Phase 3全5作業、Phase 4無料実践は維持する。
実資産による利用・返却が成功したという報告ではない。

## A. 今回実装したもの

- `backend/economy/polygon-gas.js`：実RPCのstate overrideによる返却・提供確定ガス見積もり。実残高・現在手数料・承認された上限を検査し、**exchange署名を渡す前**にPOLを確保する。
- `polygon-payments.js`：注文・ジョブ・2件のwallet slotと同一Firestore transactionで予約。未払失効はfinalized chain timeと空のordersが証明された時のみ解放。確定返却・提供の原本と費用を原子的に記録する。
- `polygon-operator.js`：新規受付用の日次上限到達で既払注文を止めず、当該注文の確保済み予算から処理する。nonce/unsigned intent/署名bytes/tx hashの永続化・同じtxによる復旧を維持。署名器へのoperationId・60秒期限・冪等キーを追加。新規受付前に認証付きreadinessを確認する。
- `polygon-config.js`：承認済みガス上限・日次・累積試験上限、fee ceiling、2種類のgas limitが未設定ならOFF。
- `polygon-rpc.js`：canonical/finalized receiptから実gasUsed×effectiveGasPrice・支払者・採掘時刻を記録。
- `service.js`：既存運営operations APIにcoverageと停止理由を追加。新しい常時ポーリングや全件スキャンは追加しない。
- `services/polygon-signer/`：アプリとは別プロセスのAWS KMS secp256k1署名器。署名APIを一般公開しない。SDK workload identity、固定ARN・公開アドレス、鍵用途・有効状態・非輸出鍵の検査、Ethereum keccak digestの署名、標準ライブラリによるDER/low-S/回復を実装。PassportのP-256鍵は使わない。
- 署名器は独立してFirestore注文・job・本人/支払wallet・商品・5 EMUER・成果物・予約を読み、実チェーンorders・REFUND_ROLE・nonce・固定137/TOKEN/codeHashを照合。許可メソッドはrefundExchange/markExchangeFulfilledだけ。nonceと署名結果を永続化し、同じ依頼は同じ署名bytesを返す。
- 試験：POL同時予約・日跨ぎ・不足・手数料高騰・古い残高snapshot・operator交換、KMS不正鍵/停止/障害、署名policy改ざん/City注文拒否/所有者/nonce/期限/保存前提供拒否。既存Rulesの直接読書き拒否試験に新private collectionを追加。

Knowledge Lab、City製品コード、既存Mitemiru決済、コントラクト、Passport、Rulesは変更しない。PR #326〜#332の最新変更を取り込み、旧mainをデプロイしない。

## B. 実Polygon照合（読み取りのみ）

証拠：[JSON](phase5-live-chain-20261110.json)。取得UTC 2026-11-10 13:34、block 97,074,816。

| 項目 | 実取得値 |
| --- | --- |
| chainId | 137 |
| EMUERv2 | `0x9c102cC3016C70767082b60196565878D9314864` |
| runtime | 10,618 bytes |
| codeHash | `0xf042b8262aff375381943d5e13f196f3e9a025aac3d359d1aff9720cf8aa4158` |
| supply / decimals | 10,000,000 EMUER / 18 |
| treasury / current admin | `0x1C156b6a8CaA6772430edA2cBB0d20CF41B9CFE4` |
| admin移管遅延 | 86,400秒、pending移管なし |
| paused | false |
| 既存reservedForRefunds | 15 EMUER（既存の拘束。変更していない） |
| 既存authorizer | `0x695A29D99D147aD367214854DC40B30f340c294E`。AUTHORIZERのみ、REFUND/admin/PAUSERなし |
| treasuryの権限 | DEFAULT_ADMIN/AUTHORIZER/REFUND/PAUSERあり |
| 専用refund operator | 未設定。POL残高を持つ対象アドレス自体が未確定 |
| creation tx | `0x77c1087e8bdfe7c1176f698cd889a599245486e765c6289f2e262aa20ac322cf` |
| deployment | block 94,019,867、2026-09-18 12:33:54 UTC。receiptと直接CREATEを照合 |
| constructor | 上記treasury、86400 |
| 自由移転 | transfer/approve/transferFromをeth_callし、FreeTransferDisabledによる拒否を確認 |

Solc 0.8.27 / OZ 5.0.2 / optimizer200 / Shanghaiで再コンパイル。ABIとリポジトリartifactは一致。実runtimeとcreationは、immutable埋込とmetadata除外後の**実行部分が一致**。ただしIPFS metadata hashは不一致で、完全な再現buildは未回収。完全codeHash一致とはしない。`CONTRACT_ATTESTED`は設定しない。

残る確認：元デプロイ時のSolidity standard-json input、依存source、metadataを回収し、metadata差分を説明する。Founderは当時のRemix/ビルド成果物を監査者へ提供する。新規鍵・秘密情報は不要。Sourcify/IPFSから回収する場合は対象公式ホストの追加許可が必要。ソース・コントラクトの変更や再配備で無理に一致させない。

RPCは現在HTTP200で成功。以前の環境CONNECT403は解消。根URLの404とJSON-RPCエラー、認証401/403、timeoutは区別する。既存RPCキーを再発行せず、値・完全URLは証拠へ保存しない。全体runtime検証が未完了のため、JSONの`liveVerified:false`を成功へ書き換えない。

## C. 署名器の権限と外部設定

採用：AWS KMS `ECC_SECG_P256K1` / SIGN_VERIFY / AWS_KMS生成鍵。ARNとEthereumアドレスを固定。静的AWSキー・profileはサーバー起動時拒否。ECS task role、EKS/外部OIDC web identity、EC2 instance roleのいずれかを明示する。Google ADCも署名器専用のworkload credentialを推奨する。

**本物のAWS接続は未実施**。AWSアカウント・KMS鍵・identity・署名サービス・REFUND_ROLE・POL資金の承認/設定がない。ローカルSDK doubleによる暗号検証をAWS統合試験成功とは呼ばない。

IAM最小権限の雛形：[policy](../../services/polygon-signer/iam-policy.example.json)。KMS Sign/DescribeKey/GetPublicKeyは1本のARNだけ、DIGEST/ECDSA_SHA_256だけ。管理/Grant/Export/Decryptは付与しない。CloudTrail、認証付きprivate TLS ingress、専用service identityを設定する。アプリはKMS権限を持たず、署名器APIだけ呼ぶ。

制約：**現REFUND_ROLEは全注文に及ぶ**。当サービス以外の注文を署名器policyは拒否するが、これはオフチェーン制限。KMSを直接使えるidentityが漏えいした場合のグローバル権限リスクは残る。IAM排他管理と独立監査が必須。真の注文別オンチェーン権限を作るには別途コントラクト変更の設計・承認が必要であり、今回は実施しない。

### Founderの設定画面と操作（今は実行しない）

1. AWS Console → KMS → Customer managed keys → Create key。非対称/Sign and verify/ECC_SECG_P256K1。新しい有料資源のため**作成前の個別承認が必要**。public keyだけを抽出しアドレス確認。秘密鍵をエクスポート/環境変数へ保存しない。
2. IAM → workload role。上記最小policyのARNを実値へ置換。signer専用実行環境と信頼するOIDC subject/audienceを固定。ネットワークは選定regionの `kms.<region>.amazonaws.com` のみを追加し、保存・Publish後の通信を確認。
3. 専用TLSサービスへ`services/polygon-signer`を配置。`npm ci --ignore-scripts`、`npm test`。Node22以上。`POLYGON_SIGNER_ENABLED`既定OFF。`POLYGON_AWS_IDENTITY_MODE`、`POLYGON_KMS_KEY_ARN`、`AWS_REGION`、project/ADC、RPC、pinned address/codeHash、ガスcap、32文字以上のservice tokenを秘密設定する。listenは127.0.0.1、private TLS ingress/sidecar経由のみ。mainアプリへ自動でmountしていない。
4. 元adminから専用アドレスへのREFUND_ROLE付与は**別承認**。影響は全注文返却・提供確定権限。復旧は受付OFF→既払処理を照合→旧鍵のpending/nonce確認→承認済みのrole revoke/新鍵設定。既存treasury/admin/authorizerを置換しない。
5. POL入金・署名疎通試験・mainnet txは金額/範囲/上限を別承認してから行う。元admin鍵の流用は禁止。

`GET /ready`はKMS公開鍵状態・アドレス・実chain/code/role確認。Sign権限、実tx、サービス可用性の運用実証を置き換えない。公開前の隔離KMS統合試験は別途必要。

## D. ガス予算

実RPC `eth_estimateGas`のstate override（送信・保存・ガス消費なし）：

| 処理 | gas見積もり | 当時275.911412105 gweiでの参考POL |
| --- | ---: | ---: |
| refundExchange | 110,697 | 0.030542565585787185 |
| markExchangeFulfilled | 74,058 | 0.020433447357672090 |

実際の既存注文は使わず、RPC内だけに5 EMUER注文・残高を仮置きし、実codeを実行した。fromは既存REFUND_ROLE保有treasuryだが**署名・nonce消費なし**。専用operatorが未設定なので、その実残高は未検証。1,024 blockの限定ログ探索では実operationサンプルなし。履歴がないと断定しない。

承認検討用の計算例（**未承認・本番設定していない**）：refund gas limit150,000、fulfill100,000、fee ceiling400 gweiなら1注文の保守予約は合計250,000×400gwei = **0.1 POL**。2件なら0.2 POL。20件すべてをこの上限で扱う日次枠なら2 POL、7日なら14 POLという上限シナリオ。これは購入推奨額・支出見込・安全の保証ではない。実fee急騰では新規受付を停止し、上限を自動増額しない。現在feeに25%余裕が乗らなければ受付不可。POLの市場価格を取得していないため円換算しない。

必要設定：既存MAX_GAS_WEI/DAILY_GAS_WEIに加え、`ECONOMY_POLYGON_TRIAL_GAS_WEI`、`MAX_FEE_WEI`、`REFUND_GAS_LIMIT`、`FULFILL_GAS_LIMIT`（各ECONOMY_POLYGON_接頭辞）。金額はFounderの明示承認値のみ。

予約は`emuer_v2_agent_gas_reservations/{orderId}`と`system/polygon-gas-coverage`。日次は`operator_gas/{JST日}`。残高snapshot15秒、最新settlement blockより古いsnapshot拒否。全未処理予約（前日・pending含む）＋実支出が日次・試験累積上限以内か、同一transactionで検査する。同じ注文の重複予約、二重解放を拒否する。operator交換時に未処理予約を別鍵へ流用しない。

通常の既払返却は当日新規枠・intake OFFによって停止しない。canonical/finalized receiptでgas payer/実費/採掘日を確定して一度だけ精算。不足や署名異常は既存のprivate safety stop＋運営operationsへ表示。自動補充/送金/ガス増額はない。運営は既存`/api/economy/admin/operations`を認証付きで監視し、coverage.heldWei、停止理由、返却待ち、workerを確認する。外部通知先を勝手に設定しない。

既存pending txは同じraw bytesで再送。別nonceやgas bumpは自動生成しない。**採掘済みstatus0、上限超過、nonceの外部使用は運営incident**。既払返却を成功扱いせず、slotと予約を保持し、新規受付を止める。失敗txの実費精算・置換/再発行は証拠付きの個別復旧承認が必要で、無制限の再送資金は予約しない。この運用を未実証のままONにしない。

### 費用

AWS公式東京region pricing（2026-11-08公開データ、11-10取得）：customer-managed KMS key **USD1/月、時間按分**。ECC non-RSA2048 API **USD0.15/10,000回**。Sign/Verify/GetPublicKeyは無料枠対象外。単純な140署名のSignだけならUSD0.0021、コードは鍵状態・公開鍵照合/readyも呼ぶため呼出し回数は増える（単純5call/依頼なら700call ≈ USD0.0105の例。実単価区分・retry・税等は請求で確認）。コンピュート/private ingress/ログ/監視/ネットワーク/独立監査・法務は別見積もり。新しい無料サービスとして扱わず、今回契約・支出はゼロ。

## E. セキュリティ・独立監査・法務

外部監査へ渡す対象：本doc、phase5-audit.md、phase5-polygon.md、live-chain JSON、実Solidity/ABI/compiler設定、polygon-*.js、独立署名器・IAM雛形、ローカルchain/SDK/Rules試験、以下の資産フロー。

```
利用者wallet --本人exchange 5 EMUER--> treasury (reservedForRefunds)
  -> canonical/finalized検証 -> 既存job -> 成果物の本人専用保存
  -> 専用署名器 markExchangeFulfilled -> 予約解除
失敗 -> refund_pending durable outbox -> 専用署名器 refundExchange
  -> original buyerへ5 EMUER -> finalized照合 -> refunded
```

脅威：tx再利用・他注文すり替え・buyer変更・偽chain/code・reorg・source permission撤回・worker再起動・nonce競合・signer侵害・グローバルREFUND_ROLE・資金枯渇・RPC障害・試験期限。対策と残存リスクは上記。セルフレビューとローカル試験は独立監査ではない。独立費用は見積もり未取得、金額を創作しない。

法務依頼事項：EMUERの発行/取得/消費/返却構造・対価性・利用可能範囲・移転制限・prepaid残高・暗号資産/資金決済法等の該当性、ガス代非返却、サービス不提供時の原状回復、返却待ち/障害時の告知、未成年と既存資格、保管期間、金融監査情報の保持と削除、AML/制裁等の必要性、利用規約/契約主体。FSAの公式案内は取得したが法的適合の確認ではない。e-Gov本文はJS shellのみで全文確認未了。専門家の対象契約・コントラクト・署名器を含む確認記録が必要。

既存試験終了 **2026-11-14 15:48:46.671 JST** を維持。新規受付/署名期限を延長しない。既払注文の返却workerは維持。保存済み成果物・無料実践は既存会員資格/許諾/30日保存方針。継続提供と新決済規約は別判断。

## F. リリースと停止・復旧

本体コードはOFFで配備可能。署名器・キー・role・POLが未準備でも既存ledgerを通す。新規wallet依頼を作らない。`ECONOMY_POLYGON_ENABLED=false`でwalletだけ停止し、workerを止めない。既払注文とpending txがある状態で署名器鍵/nonce/DBを初期化しない。

各attestationをまとめてtrueにしない。source provenance、独立監査、法務、managed key実接続と専用権限、POL・費用上限、署名器の認証と復旧、残り試験期限を確認してから、別の本番受入承認を得る。今回の実資産操作は0。通常ledgerのコードrollbackは前SHAへ戻せるが、wallet運用開始後のrollbackはoutbox/予約schemaを読める版を残す必要がある。データ削除・Rules公開は不要。

PR/SHA・最終試験件数・本番反映は [release evidence](phase5-release-evidence-20261110.json) に記録する。

## 最終ローカル検証・変更範囲

1,114件のnode:testと17の実Solidityシナリオ、合計1,131項目成功。内訳はrelease evidence参照。ウォレットUIは375/390/412/768/1280/1440/1920px、実本番の非ログイン画面も同幅を読み取りで確認。Geminiは今回の決済試験では既存の分離doubleで、追加の本番生成/EMUER消費はしない。Amoy・実KMS・本番返却は未検証。

初回のFirestore一斉送信で1つ503、依存する保存期間assertionも失敗した。静かなfresh emulatorで同じ63件が成功。失敗ログも実行成果物に保持。既存Solidity月跨ぎ試験はethersの短期RPC cacheが時間移動前の失敗見積もりを再利用したため、**試験providerだけcacheTimeout:-1**を指定した。コントラクトやassertionは変えず17項目成功。新native POL試験はbalance guardとdaily guardの両方へ同時に当たるfixtureを修正し、十分な合成残高でdaily制限を単独検証した。

依存監査：backend high/critical 0、signer high/critical 0。既存ethers/Firebase由来などのlow/moderateは残る（JSONに件数）。新署名器の初期依存選択で検出したcritical XML parser系は、同サービスのAWS SDK/Firebase依存を更新して解消。既存backend依存は変更しない。Ganache等の開発用依存リスクは既存Phase5報告どおりで、公開signerへGanacheをimportしない。

変更ファイル：backend/economyのpolygon-config/operator/payments/rpc/gas/gas.test/service、contracts-v2/testのeconomy-payment/v2-policy、tools/economy-testsのrules/polygon-gas-integration、独立services/polygon-signerのpackage/lock/identity/kms/policy/serverと各試験・README・IAM雛形、docs/economyのoperations/phase5-audit/phase5-polygonと追補・証拠JSON。Knowledge Lab/City/ログイン/台帳/本番Rules/コントラクトの製品実装は変更しない。

追補：PR #333後の最終レビューで、保存済みtxの再送直前にも実REFUND_ROLEを確認するよう修正。新たなローカルEVM試験で、接続断→同一raw bytes保存→role撤回後の再送ゼロと返却待ちを検証した。既存の本番roleは変更していない。
