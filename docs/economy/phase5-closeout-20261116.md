# 冷蔵庫くん Phase 5 — コード完成作業・公開ゲート

2026-11-16。Repository: Wertask11/emu-realtime。Production: https://schoolpark-emu.vercel.app/ 。本報告は11月11日の報告を更新する。監査対象の実装commitは **99fde816bf915378f2947e7053427e45435cbecb**、取り込み基点mainは **046ca28**（PR #343まで）。PR/merge/実稼働SHAは反映後にPR本文と実行証拠へ記録する。本書だけを配備成功証拠にしない。

**今回のコード改修と分離検証、元ビルドの証明、外部監査・法務、本番資産受入は別の判定である。Polygon受付はOFF。**

## 1. 今回実際に解消した問題

- 空workerの30秒ごとの一律DB確認を廃止。新規依頼は永続化後に即時wake、重複依頼はwakeも重複させない。空キュー確認は最大5分、稼働中は30秒、readiness/heartbeatは1分。再起動直後は即照合する。
- 支払確認待ちも即時wakeする。quota時は既存の60/120/240/300秒待機と受付停止を維持する。
- 受付OFF/期限後は販売できない商品の3件のreadiness読み取りを省く。後日明示的な設定変更があれば全gateを再読し、古い情報で再開しない。既払キュー・返却は止めない。
- 本人の既存5 EMUER引落・注文・成果物原本を再照合。既知4件以外の追加依頼なし、現対象の二重請求なし、結果/成果物のハッシュ不変。追加消費0。
- テストの固定試験期間が11月14日で切れていた問題を修正。**専用エミュレータ内だけ**現在時点の試験期間を使う。再起動した子プロセスも親の同じ設定を継承する。本番期限は変更しない。
- 旧承認snapshotの正の試験を保存し、現行資料の参照元変更を拒否する試験を追加。EMUER/星空の更新を旧承認で自動許諾しない。production承認文書は更新していない。

## 2. 実装・検証結果

[Firestore経路別分析](phase5-review/firestore-cost-analysis.md)、[返却権限の設計判断](phase5-review/refund-authority-decision.md)、[KMS導入準備](../../services/polygon-signer/infra/README.md)。

対象コードの分離試験：backend670 / signer30 / local EVM32 / Auth・Firestore・Rules・browser65 / frontend257 / analytics9 / membership113 / build verifier3 = **1,179 node tests**。既存Solidity17シナリオ群とTerraform mock-plan2件を別集計。合計**1,198項目**。最終ログの成功を確認してから配備する。

初回エミュレータ試験は固定日付/旧origin承認のため24件失敗、その後子workerの古い設定継承で1件失敗した。試験の削除・skip・権限緩和・production承認の上書きでは解決していない。成功経路のローカル試験期間を正し、元の請求/返却/所有者/再起動のassertを維持した。旧承認の正の試験はcommit20e62e0から再現した12資料を使い、現行変更資料の拒否を別途検証する。

本番追加決済、実KMS、Amoy、新しい実Gemini生成は実施しない。SDK double/local EVM/本番RPC読み取りを本番資産試験と混同しない。backend/signer dependency auditはhigh0/critical0、既存low/moderateは残る。新規runtime依存追加なし。

## 3. PR・稼働SHAと変更保護

作業branch `fix/phase5-idle-budget-and-release-infra-20261116`。前回の未commit変更はpatchとuntracked archiveへ保存してからmainをfast-forwardで取り込んだ。PR #335以降の39ファイル（EMUER受取/残高表示、ギフト、Knowledge Lab、Rules、スマホ操作等）は保護している。

変更はeconomy worker/readiness、対応試験、署名器の隔離受入ツール/IaC、経路別計測ツール、監査文書。Knowledge Lab製品コード、City、Camellia、契約、会員判定、既存台帳、token、Rulesのproduction変更なし。既存5 EMUER/Plus・Pro/3・20・2/token予算を変更しない。

Render直近3回の配備はbuild_failedで、backendは旧版に留まっていた。rootDir=backendのbuildCommandがyarnだが、管理されているのはpackage-lock.jsonのみ。localのYarn解決は成功したため過去の失敗原因をYarnだけとは断定しない（Render logs APIは403）。npm ci --omit=dev --ignore-scriptsによる新規installと全runtime依存のimportは成功し、lock/overridesに従う再現可能な手順へ合わせる。変更する設定・実際のhost build結果は配備証拠に記録し、有料planや他設定は変更しない。

再開時の本番backendは20e62e0、mainは046ca28だった。配備時はmainの既存更新を巻き戻さず統合する。Render/Vercel反映は実SHAと配信内容で照合する。新Previewの通信保護で表示できない場合は、build成功と実画面確認を分けて記録する。

## 4. Firestore安定性・台帳原本

24時間の分離実験：空キュー290回、readiness1,440回、最低読み取り4,610回、health書込み1,730回。旧11,520read/5,760writeから約60%/70%削減。期限停止中はreadinessの3件も読まない。cleanup、実行中ジョブ、実identity/source/権限照合、index課金、再試行、他サービスを除く**1 instanceの下限値**であり、共有プロジェクトの総量・残量を保証しない。

公開statusはDB読み取り0。process内のqueueScans/readinessRefreshes/wakeups/次回確認までの時間と固定errorStageを追加。個人ID/本文/生errorを公開しない。課金メーターではなく再起動でリセットする。

11月16日15:25 JSTの原本照合：引落5、completed/fulfilled、quote/fingerprint各1、成果物revision1・結果/成果物hashが過去原本と一致、非終端jobなし。読み取りのみ。旧driverは「受付enabled」を必須にしていたため総合flagはfalseだったが、原本整合性は全条件true、受付falseは期限到来による正常動作。元の証拠を残し、判定を分ける。

現在workerは正常、TRIAL_NOT_ACTIVEで新規受付停止。実際の日次使用量/正確な残量はAPIから取得できず、Console確認が必要。11月11日のquota発生を「再発しない」と保証しない。不要readは修正済みで、Billingや有料プランは変更していない。

## 5. 元ビルド一致

[再検証JSON](phase5-review/build-recheck-20261116.json)。chain137、token `0x9c102cC3016C70767082b60196565878D9314864`。11月16日RPC codeHashも `0xf042b8262aff375381943d5e13f196f3e9a025aac3d359d1aff9720cf8aa4158`。ABI・immutable代入後の実行部分は一致、**metadataを含む全runtimeは不一致**。完全検証は未完了。

デプロイcommit82868f3のsourceは現sourceと同一。過去artifactは切り詰め/破損があり、元compiler inputを証明しない。5種類のimport表記・14root名・literal有無で140候補CIDを調べても一致しなかった。これは候補探索であって原metadata回収ではない。

CID `QmNnLm7UdQSu5uVoCCfviHAKJWXTYEyRqzvCgDLkejSEiX` の取得用host追加案は未適用（環境revision35）。元input/metadata/全sourceを回収して既存verifierで完全一致を確認する必要がある。元のpath/設定/内容差の確定原因は未特定。metadata不一致だけで再発行・再デプロイしない。

## 6. REFUND_ROLE残存リスク

現tokenは返却と提供確定が同じglobal role。専用KMSでも、Sign権限を盗まれ署名ポリシーを迂回されればCityを含む未精算注文に影響する。アプリの5 EMUER/用途/注文/期限制限をオンチェーン制限としない。

role単独で任意walletへtreasury全額を送金できるわけではないが、既存注文の不正返却・偽の提供確定が可能。最大影響はその時点の全未精算注文と将来流入であり、1依頼5やアプリ日次枠ではない。現在のglobal予約は15 EMUERで、恒久的上限ではない。

既存tokenを変えず、固定product/5 EMUER/注文登録/capsと返却・提供確定の別権限を持つimmutable adapterを間に置く設計を作成。独立registrar/完了attestorの信頼と既払返却の継続も明記した。新契約の実装前承認が必要なため、Solidity実装/配備/role grantは行っていない。既存資産の移転・再発行は不要とする案で、監査・Founder判断待ち。

## 7. 実KMS接続

AWS KMS非抽出secp256k1、最小IAM、workload認証、private endpoint制約、管理/緊急停止/署名主体の分離、CloudTrail/S3をTerraform化。公式checksum確認済Terraform1.9.8とlock済AWS provider5.100.0でfmt/validate/mock-plan2件成功。`apply`も実リソースも0。destroy防止を試験のために解除していない。

実KMS受入は別承認の隔離鍵のみ。未承認/production鍵の指定は通信前に拒否、標準は公開鍵検証のみ。署名も別承認後の1回に限定し、gasLimit1の実行不能なsynthetic txをローカル検証する。broadcast機能なし。実KMS成功とは未判定。

実AWS account、鍵、private runtime/Render到達経路、Google workload federation、適切な実IAM、CloudTrail配信、実停止/復旧は外部設定待ち。Terraform構文やmockが実ネットワーク・実監査ログを保証しない。key管理者はpolicyを変更できる最終trust principalである。

## 8. POL必要額・固定費

[11月16日15:26 JST RPC費用表](phase5-review/cost-refresh-20261116.json)。現在280.934655761 gwei。refund110,697/fulfill74,058 gasは11月11日の実RPC simulation、本人exchange139,482はlocal EVM実績。今回の価格を掛け直したもので、そのwallet/注文の新しい本番見積もりではない。今回grant62,338/revoke44,135/pause54,631 gasもRPC simulationのみ。

| 操作 | 当該gas価格での参考POL | 区別 |
| --- | ---: | --- |
| 本人exchange | 約0.0391853 | gasはlocal、署名前は実wallet見積もり |
| 返却 | 約0.0310986 | 過去実RPC gas×新価格 |
| 提供確定 | 約0.0208055 | 同上 |
| 初期role grant | 約0.0175129 | 今回simulation |
| role revoke | 約0.0123991 | 今回simulation |
| token pause | 約0.0153477 | 今回simulation。Cityも止まるため既定の停止手段にしない |
| 鍵交換のgrant+revoke | 約0.0299120 | 新鍵/KMS費用・資金移動は別 |

未承認予算例：refund150k＋fulfill100k、max400gweiなら最大予約0.1 POL/注文、同時2件0.2 POL、返却のみ2件0.12 POL。20件/日なら日2、7日14、仮30日60 POL。失敗gasも枠に含み、pending署名が残る間は予約を解放しない。現在fee×安全余裕が上限を超えれば受付停止。これらは承認額・実支出・継続期間決定ではない。

KMS参考は本番key USD1/月＋ECC Sign USD0.15/10,000、その他API/隔離key/compute/private network/log/S3/tax別。月600署名例はUSD0.009だが実ready API量やruntime費用を含まない。RPC既存プラン/共有quota/請求先は未確認。新adapter配備費は承認後のbytecodeで見積もる。POL/JPYは通信未許可で未取得、円額を創作しない。

## 9. 独立監査・法務

[監査依頼書](phase5-review/auditor-handoff.md)、[事故対応](phase5-review/operations.md)、[法務依頼](phase5-review/legal-questions.md)と本書/コードSHAを対象にする。worker変更も脅威・負荷・復旧の対象。raw鍵/認証情報/本人本文を監査packageへ含めない。

独立監査は未実施・未発注。候補OpenZeppelin Security/Cyfrin/Quantstamp、受託範囲・費用は書面見積もり待ち。自己reviewで代用しない。global role、DB server IAM、private ingress、real key stop、gas liability、nonce/reorg、既払返却は必須対象。

11月16日にe-Gov公式APIを再取得。資金決済法のCurrentEnforced revisionは `421AC0000000059_20260812_508AC0000000064`、8月12日施行。EMUERの法的性質、台帳とtoken、前払/暗号資産交換業、保管/返却、規約・表示、未成年、税務会計、AML/保存期間は専門家判断待ち。条文取得は適合確認ではなく、過去のGemini利用法務確認も転用しない。

## 10. Polygon本番公開可否・継続

**公開不可・OFF維持**。元build、実KMS/権限、POL承認、独立監査、法務、実監視・復旧、Founder公開承認、承認範囲内の限定本番受入が未了。今回のコード改修/分離試験成功と外部安全保証取得を区別する。

試験期限 **2026-11-14 15:48:46.671 JST** 到来済み。現在の新規依頼停止は正常。既払照合/返却、保存済み成果物・無料実践の現行資格/許諾/30日保存を維持。継続提供には期限/料金/対象/AI無料枠/日次token・回数/POL・infra予算/利用規約の明示決定が必要。無断延長なし。

### Founderにしかできない操作（まとめて判断）

| 操作 | サービス・実施画面 | 費用 | 上限/承認内容 | リスク | 完了確認 |
| --- | --- | --- | --- | --- | --- |
| 原metadata/相場への通信 | Codex環境Settings → Network、保存済みapi.sourcify.dev/ipfs.io/api.coingecko.com案をreview→保存→Publish、又は元compiler inputを提供 | 設定自体0 | 公開資料のreadのみ | 不明inputを原本と誤認しない | fresh接続、CID/全source/全runtime一致 |
| 実使用量の参照 | Firebase Console → emusch-2a111 → Firestore → 使用状況/Cloud quota | read-only、Billing変更0 | 使用量・残量の確認、必要なら読み取り監視権限だけ | 共有app負荷をworkerだけと誤認しない | read/write/delete実数と期間、worker/errorStage |
| KMS/専用runtime準備 | AWS KMS/IAM/VPC/CloudTrail、Terraform planレビュー | key USD1/月＋隔離key/API/runtime/network/log/S3等は見積もり | account/region/role/private経路/保持期間/費用上限を一括承認。まだapplyしない | Global Sign/DB/IAM・private接続未検証 | 隔離鍵、実IAM拒否、private到達、CloudTrail、停止/復旧 |
| 限定adapter設計の承認 | 設計書→監査対象/管理者wallet計画 | 実装見積もり、配備gas未確定 | product/5/注文登録/権限/caps/停止/既払移行を先に承認 | token側roleはglobal、新契約の監査が必要 | ローカル拒否試験・監査後に別途配備承認 |
| 独立監査・法務・税務 | 監査先と弁護士/税理士へ対象SHA/資金/権限/規約の依頼 | 未見積もり、無断発注0 | 範囲/外部送付/契約/金額を承認 | 重大指摘・事業区分・記録義務未確定 | 書面結論、条件、重大/高risk解消 |
| POL資金・roleの設定 | 管理者wallet、RPCとprivate operator設定 | grant/revoke実gas＋必要POL。例0.2同時準備、月60は未承認例 | 購入/送金/role/日月trial枠を個別上限付きで一括判断 | 広い権限、gas変動、未解決署名の責任 | finalized資金/role/原子的予約、緊急停止 |
| 継続提供・限定受入 | 運営決定→Render/Firestore設定、本人wallet | 新規依頼1回5 EMUER＋本人/運営のPOLを別見積もり | 期間/条件を先に決定。試験account/回数/最大EMUER・POL/返却範囲の別承認 | 期限の無断延長/未承認資産操作 | 全gateと本人同意、実receipt/成果物/履歴/返却 |

本番EMUER消費/付与/返却、Polygon署名/tx、POL購入/送金/支出、role/contract変更、AWS作成/契約、監査発注は今回すべて0。新規受付の再開や本番試験を承認したものとして扱わない。
