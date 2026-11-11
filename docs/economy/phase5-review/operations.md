# Phase 5 本番設定・緊急停止・復旧

本番Polygon受付はOFF。設定テンプレートはservices/polygon-signer/production.env.example。空欄やfalseを一括でtrueにしない。現状はAWS identity/key/signer/operator/承認予算/監査/法務がないため接続・公開操作を行わない。

## 公開までの設定順序

1. 元inputでbuildを検証。IPFS CIDはbuild-verification.json参照。取得hostの追加案api.sourcify.dev/ipfs.ioは保存済みで、現在の通信許可を意味しない。環境設定で確認→保存→Publish→fresh接続で確かめる。元input/metadataは公開ビルド資料だけを使用し、鍵は送らない。
2. Founderがアカウント・region・専用実行環境・費用上限を承認。既存のAWS環境が確認できない場合、新しいKMS/VM/VPC/private ingressを勝手に作らない。AWS KMS Console Customer managed keysでECC_SECG_P256K1/SIGN_VERIFYを選択する案。未作成。
3. 専用workload roleだけに固定ARNのDescribeKey/GetPublicKey/Sign(DIGEST/ECDSA_SHA_256)。AWS static key/profileの利用は禁止。AWS IAM/OIDC trustのissuer/audience/subjectを実環境へ固定。IAM policy雛形を確認し、Admin/Grant/Decryptは付与しない。
4. signer専用のFirestore ADC/IAMを用意。private TLS/認証と到達経路を確定する。Renderからprivate AWSへ自動で到達できるとは仮定しない。既存承認済みprivate runtimeがなければ、専用環境・networkの見積もりと承認が先。mainアプリへKMS権限を付けない。
5. 隔離KMS試験用の実API・料金が承認された後、専用テスト鍵でKeySpec/address/停止/認証拒否/障害/CloudTrailを検証。開発鍵を本番へ移さない。本番roleを付けない。mock結果と区別する。
6. 本番専用の公開keyからoperator addressを確認。現authorizerと異なるkey/addressであること、REFUND_ROLEだけを付ける計画を審査。付与は全注文に及ぶので個別承認・ガス上限・独立監査が必要。treasury/admin/authorizerを置換しない。
7. POL/fee/limit/daily/monthly/trial上限・補充方法を承認。資金はfinalized後に有効とする。POL購入/送金は別承認。KMS/RPCの月額・APIクォータ・費用監視と停止閾値を設定する。
8. Firestore Console → emuer_v2_agent_system → polygon-operator-control。承認された初期設定で `{enabled:true,halted:false,revision:1}`。欠落/disabled/haltedは署名・新規wallet受付を拒否する。Firestore client Rulesは開けない。
9. signerのenvとサービスを設定、HTTPS `/ready`で実key/chain/code/role/controlを確認。これはSign権限/実tx成功/外部監査を代替しない。署名ログをsecret-safeに運用する。送信先は既存token、chain137固定。
10. 独立監査、重大/高リスク解消、法務、運用監視、Founder公開承認を証拠reference付きで確認する。既存試験期限が近い/終了した場合は継続方針を先に確認。無断延長しない。
11. 本番受入は対象本人・回数・最大5 EMUER・user/運営POL上限・失敗返却範囲を別承認。今は追加本番消費禁止なので実施しない。全部合格後だけwallet intakeをON。

## 3種類の停止

| 操作 | 効果 | 注意 |
| --- | --- | --- |
| ECONOMY_POLYGON_ENABLED=false または polygon-safety.stopped=true | 新規wallet受付停止 | 通常の既払返却・確認は続ける。ledgerと無料実践を維持 |
| polygon-operator-control.enabled=false または halted=true | 新規署名と保存済みraw bytes再送を停止 | signerとbackend両方が確認。既払記録は返却待ちとして保持 |
| KMS DisableKey / on-chain role revoke | key又はcontract権限を停止 | 事前承認/管理者対応。role revokeはPOLが必要。KMS停止で送信済みtxを取り消せない |

Firestore制御やKMS状態の確認と送信の間の分散raceは完全にはなくせない。chain上のroleとcanonical receiptが最終根拠。すでにbroadcast済みtxの監視は停止しても続ける。緊急停止を「全署名の取消」と表示しない。

## 事故手順

- KMS停止/role剥奪/認証障害：intake OFF、必要ならoperator control停止。注文/job/署名/nonce/予約を保持。ログは固定エラー・opId/txHash・key公開IDのみ。secret/token/user本文を共有しない。
- RPC timeout/pending：同じraw bytes/hash/nonceだけを照合する。未確定を返却済み/失効済みとしない。replacement、gas bump、新nonceは自動化しない。別RPCへ切替える場合もchain/code/role/finalityを再確認し、危険なfallbackで確定条件を緩めない。
- status0：canonical/finalizedになった失敗txのgasUsed/effectivePrice/支払者/宛先を照合し、一度だけ費用記帳する。残りPOL予約を残し、slotも解放しない。自動再署名しない。未確定receipt・不一致は支出確定扱いしない。
- 資金不足：新規受付停止。既払返却を成功扱いしない。coverageと実残高、未処理/失敗費用、nonceを照合し、追加POL/上限変更はFounderの別承認後。全未処理予約を日/月替わりで消去しない。
- どうしても専用keyで返却できない：既存adminによるoriginal buyerへのrefundを**別承認**する選択肢。対象orderId/金額5/chain/token/参照元/ガス上限/nonceを確認してから担当者が実行する。今回Codexは実行しない。
- 別途承認済みmanual refund/fulfillmentがすでにchainで成功している場合：trusted operatorが該当private mitemiru_ordersのrefundTransactionHash/fulfillmentTransactionHashへ実hashだけを記録。status/paymentStatus/refundStatusを直接成功へ書き換えない。workerがcanonical/finalizedの同じorder・buyer・amount・event・実状態を検証し、費用/予約と履歴を整合させる。不一致/不明ならpendingのまま。

## ローテーション・復旧

非対称KMS鍵は新key/addressを作る手動計画。alias差替えだけで回復したと扱わない。新key・IAM・role・POLは承認対象。intakeを止め、旧operatorのpending tx・nonce・全予約を照合。未処理予約がある間は新addressへ予算を流用できない。旧返却を完了又は承認済みmanual経路で照合してから、旧role/keyを停止、新pinned ARN/addressへ変更し隔離試験・ready・監査確認後に再開。DB/nonce/raw bytesを初期化しない。

## 監視・保持・期限

既存認証付きGET /api/economy/admin/operationsのpolygon control/safety/coverage、worker、pendingを確認。新常時pollや全件scanは追加しない。KMS CloudTrail、IAM変更、拒否増加、RPC失敗、POL予算、status0/返却待ち、FireStore429の通知先と費用は運営が承認する。勝手に外部通知を送らない。

署名器はprivate TLS ingress下で認証・8KiB入力上限・1実行枠を持つ。外部rate limit/複数instance/予算監視も運用承認する。署名結果/nonce/費用は金融監査記録で、保持期間は法務未決定。未完了記録を自動削除しない。本人の成果物・実践30日は維持。

試験終了：**2026-11-14 15:48:46.671 JST**。新規quote/受付/exchange署名期限を延長しない。期限到達時も既払照合/返却workerを停止しない。保存済み成果物と追加料金なしの実践は既存の資格/許諾/保存期間による。継続提供・費用・資格・規約の決定待ちならwallet正式公開はOFF。

## 配備・rollback

本体をOFFのまま配備する。signerは別サービスで未配備。既存Render/Vercelの通常コード配備以外に有料資源を追加しない。main更新を取り込み、Lab/City/Camellia/台帳を変更せず関連試験と7幅を確認。実稼働SHA・worker・5作業・ledger・wallet OFFを確認する。

今回新設のmonthly accountingと失敗gas帳簿を運用開始した後は、それを読めない旧版へ無条件rollbackしない。intake OFF、既払完了/返却と監査snapshot、互換性のある版で復旧。未払い意図の期限切れもfinalized時刻と空ordersを確認してから。Rules公開・破壊的migrationは不要。
