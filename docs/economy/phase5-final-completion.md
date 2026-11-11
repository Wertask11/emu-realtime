# 冷蔵庫くんに頼む Phase 5 最終完成報告

2026-11-11。基点main `098d2e8` / PR #333・#334。Production：https://schoolpark-emu.vercel.app/ （emu-for-schoolpark.vercel.appも同じbackendを参照）。

**総合PARTIAL / Polygon受付OFF**。実装完成、安全性検証、本番運用準備、限定本番受入を別々に判定する。mockやローカルchainを実本番成功としない。

## 1. 実装・検証・運用・受入の判定

| 判定軸 | 結果 | 根拠・残件 |
| --- | --- | --- |
| 実装完成 | PARTIAL | 本体・adapter・保護処理・offline検証・分離試験は実装済み。原build完全一致と実KMS統合未了 |
| 安全性検証 | PARTIAL | 内部試験成功。独立監査未実施、global REFUND_ROLE等の高リスク残件 |
| 本番運用準備 | PARTIAL | 監視/停止/復旧/費用/設定資料を整備。実KMS/operator/予算/法務/監査設定は未承認・未実施 |
| Polygon決済本番受入 | PARTIAL（未実施） | 追加EMUER/POL/本番署名禁止。条件・対象・費用の個別承認なし |

既存アプリ内5 EMUER・全5作業・無料実践を維持。Plus/Pro、3/20/2、既存token予算・試験期限を変更しない。Knowledge Lab/City/Camellia/契約/台帳/Rules/コントラクトの製品実装は変更しない。

## 2. 今回完成した修正

- KMS停止中はcached signatureを返さない。backendも保存済みraw bytesの送信直前にsigner readinessを再確認。既送信txの照合は続け、停止で取り消せたとはしない。
- 独立operator controlをbackend/signing transaction/readyで確認。欠落・disabled・haltedはfail-closed。新規受付OFFと、既払返却を含む緊急署名停止を区別する。
- POL予約はmin(finalized残高,latest残高)。未確定入金・新しい出金・古いsnapshot・operator変更を安全に扱う。
- 既存日次/trialに加え承認済み月次上限を必須化。全未処理予約とJST月の実費を同一Firestore transactionで判定し、月替わりで予約を消さない。
- mined status0もcanonical/finalized・tx/from/to/gas/priceを検証して費用を一度だけ記帳。残り予約と返却待ちを保持。新nonce/置換/追加支出を自動化しない。
- 別途承認されたmanual refund/fulfillmentはprivate hash hintだけを受け、同一order/buyer/amount/event/実状態をcanonical/finalizedで照合。古い失敗txにより永久待ちにならない。成果物保存後にmanual refundを検出した場合も返却検証へ遷移する。成功表示を直接書き換えない。
- offline原build verifierを追加。Solc固定、全inline source hash、ABI、immutable、runtime全体、metadata CIDを比較。CIDのdigestをraw JSON SHA256と混同しない。元build不一致はexit2。URL import、未知library、曖昧なcontract/metadataを拒否する。
- 監査図・権限・脅威・再現・事故対応・法務・費用・設定テンプレートを作成。独立署名サービスは本番アプリへmountしない。

変更はbackend/economy/polygon-*とwallet限定settlement、services/polygon-signer/policy、対応試験、contracts-v2/scripts/verify-original-build.cjsと試験、docsに限定。新しい常時poll/全件scanは追加しない。monthly/gas_spendはprivate point reads/writesでRulesは公開しない。

## 3. 元ビルド・実チェーン

[検証JSON](phase5-review/build-verification.json) / [実RPC証拠](phase5-review/chain-cost-evidence.json)。

- Polygon PoS chain137、EMUERv2 `0x9c102cC3016C70767082b60196565878D9314864`、runtime hash `0xf042b8262aff375381943d5e13f196f3e9a025aac3d359d1aff9720cf8aa4158`。
- supply10m/decimals18、treasury/current admin `0x1C156b6a8CaA6772430edA2cBB0d20CF41B9CFE4`、paused=false。11月11日finalized block97,102,278でhash/供給/管理者/停止/既存15 EMUER予約を再確認済み。
- creation tx `0x77c1087e8bdfe7c1176f698cd889a599245486e765c6289f2e262aa20ac322cf`、deployerは同じtreasury、nonce109、2026-09-18配備。constructor(treasury,86400)を照合。
- Solc0.8.27/OZ5.0.2/optimizer200/Shanghai。入力source hashとcompiler metadataのsource hash、ABI、immutable代入後の**実行部分**は一致。metadataを含む全runtimeは不一致。
- EIP1967 implementation/admin/beacon slotsは全0。source-compatibleな直接runtimeにupgrade関数/実装addressはない。slot0だけでproxy不在と断定したものではない。管理者・PAUSER・REFUNDは既存契約のまま。
- metadata不一致の確定原因はmetadata CIDが異なること。元inputのsource名/URL/設定等のどれが違ったかは未特定。historical artifactはtool出力のtruncation headerを含むbase64由来の不正dataで、元buildの証拠にできない。復元できたふりをしない。
- actual CID：`QmNnLm7UdQSu5uVoCCfviHAKJWXTYEyRqzvCgDLkejSEiX`。元input/metadata/依存sourceを回収してverifierへ渡す。通信追加案api.sourcify.dev/ipfs.ioは保存済みだが未適用。元JSONが得られなければこのgateは未完了。

再デプロイは現時点で必要性未確定。別tokenを勝手に作ると既存残高/固定供給/claim/返却予約/Cityに影響する。必要なら費用・移行/並存・権利・同意・監査を別計画にして承認待ち。

## 4. KMS・返却・運用

[設定と事故対応](phase5-review/operations.md)、[権限/資金/脅威図](phase5-review/auditor-handoff.md)。実AWS identity/key/operator/サービスは未設定。mockを実KMS成功としない。用途分離は現AUTHORIZERと新返却operatorで行う。現REFUND_ROLEが全注文へ及ぶことは解消していない。

返却は失敗・再試行・再起動・RPC/reorg/KMS停止・role剥奪・ガス不足でpendingを保持する。canonicalな返却が確認できた場合だけ確定。運営はcontrol/safety/coverage/worker/pendingを既存認証付きoperationsで確認。本人は既存依頼/支払履歴を確認する。管理者manual操作も別承認であり今回の本番操作は0。

専用KMSは非輸出ECC_SECG_P256K1、固定ARN/public address、workload identity、最小Sign/Describe/GetPublic、private ingress、CloudTrail、nonce、停止/rotationを実環境で検証する必要がある。static keyをRenderへ置く代替を勧めない。IAM・DB server権限の範囲は外部監査対象。

## 5. POL・固定費・円換算

[費用表](phase5-review/costs.md) / [計算JSON](phase5-review/costs.json)。実RPCの無書込みsimulationでrefund110,697、fulfill74,058、role付与(dummy)62,338、pause54,631 gasを測定。本人exchange139,482はlocal EVM実績で本番見積もりではない。現在fee・64block中央値/95%値を区別した。

未承認例：limits150k/100k、ceiling400gweiなら1注文0.1 POL、2件0.2 POL（返却のみ0.12）。日次/月次/trialの額はFounder承認待ち。円換算quote未取得のため円額を創作しない。api.coingecko.com追加案は未適用。式・日時・根拠をcostsへ記録する。

KMS参考USD1/key/月＋ECC Sign USD0.15/10,000回。その他API/compute/network/log/tax別。RPCは既存Infuraを使用するが契約プラン/月次枠/請求先未確認で無料とはしない。新資源・契約・POL購入/送金は0。

## 6. 独立監査・法務

[監査依頼書](phase5-review/auditor-handoff.md)にarchitecture/資金フロー/権限/脅威/再現/証跡/既知risk/事故手順。候補OpenZeppelin Security/Cyfrin/Quantstamp、受託・見積もり未確認、未発注。費用は書面見積もりとFounder承認後。自分のreviewを独立監査としない。

[法務依頼書](phase5-review/legal-questions.md)は法的性質、台帳/token、前払式支払手段、暗号資産交換業、保管/返却、表示/規約、未成年、税務会計、AML/CFT、個人情報/記録を実構成に即して整理。e-Gov現行施行版JSON取得はできたが、適用判断・弁護士/税理士確認は未完了。費用未見積もり、勝手な相談送付/契約はしていない。

## 7. テスト・配備証跡

[今回の試験集計](phase5-release-evidence-20261111.json)。既存1,114件を維持したうえで1,128 node tests＋既存Solidity17項目＝1,145項目成功。失敗0/skip0。SDK double、local EVM、実Auth/Firestore emulator、ブラウザを区別。新規実Gemini、本番EMUER/POL/署名、実KMS、Amoyは未実施。

PRと本番SHA・反映後確認はマージ後にPR本文と実行evidenceへ記録する。このpre-merge報告を配備成功証拠としない。本番では非課金・非署名の表示/HTTP/status/auth拒否、worker、既存ledger、5作業、wallet OFFを確認する。新Preview URLが通信制限/SSOで確認できない場合はその旨を記録し、build成功と実画面確認を分ける。

## 8. 本番公開ゲート（すべて必要）

- [ ] 元build完全検証
- [ ] 実KMS設定/統合試験
- [ ] 専用返却権限の実環境検証
- [ ] POL/インフラ/API予算承認
- [ ] 独立監査と重大/高リスク解消
- [ ] 法務・必要体制・規約確認
- [x] 対応コードの分離統合試験（本番受入を代替しない）
- [ ] 実運用監視・停止/復旧・rotation検証
- [ ] Founderの明示的公開承認
- [ ] 承認済み上限内の限定本番受入

## 9. 期限・Founderに必要な操作

現試験終了 **2026-11-14 15:48:46.671 JST**。現在既存ledger受付は有効。期限後新規受付が止まり、既払照合・返却は続く。保存済み成果物/無料実践は現行資格・許諾・30日保存。無断延長しない。継続の料金/対象/予算/規約の判断が必要。

1. 元build資料提供、又は保存済み3host通信案を環境設定で確認→保存→Publish。現revision35では未許可。適用後にfresh接続で再確認する。
2. AWS account/region/専用runtime/private到達経路/費用を承認。key/role作成、実KMS試験、POL資金は具体的上限を別承認。鍵をチャットへ送らない。
3. 専属弁護士/法務・税理士へPolygon資産フローの確認、監査候補へ対象SHA/範囲/見積もり。外部送付/発注も承認後。
4. 監査指摘解消・法務・予算・実運用・継続方針を確定してから、対象account/回数/最大5 EMUER/POL/失敗返却範囲の本番受入承認を行う。今は追加消費禁止なので実施しない。

署名/消費/返却/role変更/contract変更/新KMS契約/監査発注は今回0。未確認事項をtrueにしない。
