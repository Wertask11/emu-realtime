# 冷蔵庫くんに頼む Phase 5 — Polygon決済

2026-11-10。基点main e0e04f9 / PR #323。公開判定 **PARTIAL（ウォレット決済OFF）**。
既存のアプリ内5 EMUER、5種類の生成、追加料金なしの実践・記録を維持する。

## 監査と採用方式

詳細は [実装前監査](phase5-audit.md)。既存設定・デプロイ記録のPolygon PoS 137、EMUER `0x9c102cC3016C70767082b60196565878D9314864`、treasury `0x1C156b6a8CaA6772430edA2cBB0d20CF41B9CFE4` を対象にする。ソースはSolidity0.8.27 / OZ5.0.2 / ERC20派生、18 decimals、初期固定1,000万EMUER。外部mint・upgrade関数なし。treasuryはimmutable。通常transfer/transferFrom/approveは拒否する。allowanceを使った消費や制限迂回は実装しない。

方式A：既存 `exchange` で本人からtreasuryへ正確に5 EMUERを移し、`reservedForRefunds` で拘束。生成・永続保存後にのみ `markExchangeFulfilled` を実行する。失敗は `refundExchange` で元buyerへ全額返却する。REFUND_ROLEが必要で、pause中も返却可能、提供済み・二重返却は不可。claimReward、JST月416,000上限、既存のCity交換は変更しない。

**実チェーンのcode・roles・現在の管理者・creation receiptは未照合**。既存RPCホストは環境の通信許可外で403。記録上の2026-09-18配備をチェーン上で再実証したとは扱わない。許可案の保存は通信許可の適用ではない。実コントラクトのアップグレード不可もソース上の判定と、実codeの照合を区別する。

以前からHEADにあった `contracts-v2/artifacts/EMUERv2.json` とpackage-lockはJSONとして読めないバイナリだった。原本を実行成果物へ退避し、**Solidityソースを変更せず**ABI/bytecodeを再生成、固定依存バージョンからlockを復元した。Ganache内の依存グラフ外extraneous項目は除外し、Linuxで新規npm ciを確認する。新しい本番コントラクトを配備したものではない。

## 支払・権限・確定

- 共通の `mitemiru_orders` / `emuer_v2_agent_jobs` を使用。既存の台帳pay/refundはそのまま呼ぶ。支払方法は見積もり・fingerprint・注文へ固定し、同じ依頼の別方法への切替を拒否する。
- wallet注文は `paymentSource: polygon_wallet` / `method: emuer_chain`。ledgerは従来通り。priceはサーバーの商品5 EMUERが正本。
- 全経路で既存認証、Plus/Pro、成人・地域等の資格を確認。登録ウォレット→SchoolPark IDを再確認し、uid/spid/wallet/purpose/origin/nonce/5分期限を固定した所有署名を一度だけ消費する。ユーザー鍵は取得しない。初期の直接exchangeはEOAのみ。Passport既存のEIP1271対応を削除していないが、この決済のスマートアカウント対応は未実装。
- EIP712 OrderはEmuer/version2/chainId/contract、orderId/productId/buyer/price/deadlineを固定。deadlineは10分の受付期限と既存試験期限の早い方を超えない。通常approveは不要。
- chainId、runtime code hash、18桁、固定供給、treasury、AUTHORIZER_ROLE、REFUND_ROLE、pause、オペレーターPOL残高、finalizedブロック対応を確認する。環境変数をtrueにしただけで接続成功としない。
- hash申告はヒントだけ。txのfrom/to/value/chainId、exchange引数、正確なExchanged/Transferイベント、当該blockのorders状態、canonical block hashを照合する。64確認以上かつfinalized到達後だけqueuedへ進める。
- 共通 `mitemiru_chain_payments` のchain/token/tx hashの原子的利用記録で別注文への再使用を拒否。AI実行前・提供確定前にも支払証拠を再確認する。
- 未送信・未確定では生成しない。署名拒否は送信しない。wall clockの期限切れだけで注文を破棄せず、finalized時刻が署名期限を過ぎ、finalizedのordersが空である場合だけ未払い失効を確定する。
- ブラウザがhashを送れなくても、orderId索引のイベントを作成blockから最大4,096block、512blockずつで発見する。未解決は保留し、全チェーンスキャンはしない。これを超える障害・最終性の巻き戻りは運営レビューが必要。
- ショップ用の弱いconfirm・authorization・cancel・admin経路はservice-order guardで拒否する。既存mitemiru本体は変更しない。新wallet注文は通常ショップの取り置きexpiresAtMsを持たず、専用のfinality照合のみが失効を判断する。

## 返却・再起動

署名は管理された外部署名器へ固定HTTPSホスト・Bearer認証・リダイレクト禁止・タイムアウトで接続するインターフェース。サーバーに返却秘密鍵を追加保存しない。署名器の実施設・認証情報・可用性は未検証。

`emuer_v2_agent_chain_ops` にunsigned intentとnonce・ガス予約を先に保存し、署名のfrom/to/value/chainId/calldata/nonce/gasLimit/gasPriceを検査する。その後、署名済みbytesとhashを保存してからブロードキャストする。再起動・応答喪失時は**同じ署名済みbytes**だけを再照合・送信し、新nonce・自動gas bump・自動再依頼を作らない。確定後はraw bytesを消去する。

専用オペレーターの永続slotで同時送信を直列化する。これは専用アドレスのnonceを他システムが使わない運用を必要とする。`MAX_GAS_WEI` とJST日ごとの `DAILY_GAS_WEI` は最大ガス代の**予約**上限。実際に採掘される日・金額の保証ではない。日跨ぎのpendingを含む費用監視と専用残高上限を、署名器の運用審査で確認する必要がある。金額は未承認のため本番設定しない。

refund/fulfillmentの確定イベント・実状態を再検証するまでrefunded/completedにしない。返却不能・署名異常・ガス上限超過等はwallet専用safety stopに記録し、新しいwallet受付を止める。台帳受付は維持し、既存walletの復旧は続ける。ガス代は5 EMUERとは別で、ネットワークへ支払った分は返却しない。

## 画面とデータ

「支払い方法を選ぶ」からアプリ内・ウォレットを選択する。walletはOFF中「準備中」。ONの場合も所有署名と注文作成の後、`eth_estimateGas`・`eth_gasPrice`・POL残高・EMUER残高を確認し、別画面で操作内容・公開コントラクト・最大消費額・ガス代・返却条件を表示する。本人が再確認して送信ボタンを押すまでtxを送らない。

認証切替時に前の見積もり・署名待ち表示を破棄し、送信直前も接続アカウント・chainIdを確認する。履歴はpending/paid/refund_pending/refunded/fulfilledと確定txへのリンクを示す。追加の無限ポーリングはなく、既存の3分上限・表示中の履歴確認を使用する。

注文はowner(uid/passportId)、serviceJobId、chainId/tokenAddress/wallet、amount/amountWei、chainOrderId/chainProductId、deadline、tx/block/hash/confirmation、payment/refund状態・返却txを持つ。成果物は既存の所有権・許諾再検証・編集・保存を維持する。

新private領域：wallet_challenges（24時間後の削除対象、5分で無効・時次最大100件の掃除）、chain_ops（金融監査用）、operator_gas（ガス予約監査）、system/polygon-safety/slot。既存Rulesがemuer_v2_*、mitemiru_*へのクライアント直接読書きを拒否するためRules公開・DB移行は不要。金融監査保持期間・削除方針は正式公開前の法務確認事項。本人の生成物・実践記録の30日方針は変更しない。

walletは未確定・実行・返却を通じて最大2件の永続in-flight slotを共有する。第三の受付は課金前に止め、確定失効・提供・返却の原子的記録でslotを解放する。RPC障害で未確定注文が積み上がり、Firestoreを再枯渇させないための保守的な同時2件の扱いで、日次20/本人3件や台帳側の枠は変えない。

待機中workerは従来の存在確認1回、public statusはDB読取0回を維持。非空の復旧周期はwallet待ち用の索引queryが1回増える。challenge掃除は1時間に最大1query（100件上限）。ON時の接続確認とwallet本人操作は必要な範囲だけ追加。新しい広範なスキャンやリスナーは追加していない。

## テストと公開判定

実SolidityをローカルGanacheへ配備してexchange/refundを実行する。これは本番EMUERでもAmoyでもない。Gemini部分はこの決済試験では明示的な分離テストダブルで、今回の新しい実Gemini本番試験は行わない。5種類の具体的成果物生成の既存品質検証を壊さず、wallet経由の保存も同じエンジンで検証する。

実ローカルチェーン試験、バックエンド回帰、Auth/Firestore/Rulesの分離試験、画面・ウォレットUX、City/Wallet/会員/Labの回帰結果は実行成果物 `reizo-phase5-20261110` に記録する。失敗した初回の環境設定（ブラウザ実行ファイル・Lab専用エミュレーター・破損lock）は修復後に再実行し、未成功を成功件数へ足さない。

本番はコードの反映とwallet受付を区別する。walletは**OFF**のまま。既存4件の本人注文と原本の5 EMUER引落・成果物hashをデプロイ前後で読み取り照合し、今回の本番消費・付与・返却・生成・公開チェーンtx・ガス支出はすべて0とする。稼働SHAとRender deploy IDはデプロイ後のstatusとmerge commitを突合し、最終報告へ記録する。

## Founderに必要な操作・承認

1. 保存済み通信許可案の4ホストを環境設定で確認・保存・Publish。接続後に実チェーンcode/roles/admin/固定供給/停止状態とcreation receiptを照合する。現在のcodeHashを未検証のまま設定しない。
2. 既存REFUND_ROLEを安全に使用できる専用署名器を用意し、署名・再開・障害試験を実施する。権限付与・鍵/管理者変更・有料契約が必要なら別途承認。チャットへ鍵を貼らない。
3. 署名器のアクセス制御、単一nonce運用、ガス上限/日跨ぎ/監視、秘密鍵の非露出、バックアップ・失敗時復旧を確認。POL補充やガス実支出の承認は未取得。
4. 既存コントラクトと新アダプター・outboxを独立セキュリティレビューし、EMUER消費・返却・資金決済法等の適用、規約・利用者への説明、監査データ保持を法務が確認する。法的適合を断定しない。
5. 上記証拠をそろえて環境設定を行い、個別の本番対象アカウント・最大5 EMUER・回数・実ガス上限・失敗返却の承認を得て受入試験する。今回は資産操作の承認がないため実施しない。

既存試験終了は **2026-11-14 15:48:46 JST**。延長しない。期限後は新規見積もり・受付・署名を拒否する。期限前の支払が確定しても実行条件を満たさなければ全額返却し、返却workerを止めない。保存済み成果物・追加料金なしの実践は既存の会員資格・許諾・保存期間による。継続提供の判断と整合するまでwallet正式公開可能とは判定しない。

## 内部レビュー・依存監査

内部レビューでは、共通shop confirmの迂回、未確定なのにwall clockで失効、保存前の返却予約解放、応答喪失後の別nonce送信、支払元切替、RPC停止中の未確定数増加を確認し、上記guard・finality・outbox・固定方法・in-flight上限で対処した。これは独立した外部監査の完了を意味しない。

`npm audit --omit=dev`（backend）はhigh/critical 0、moderate 11 / low 14（既存ethers5/Firebase等の依存系統）。今回backend依存は追加・更新しない。contracts-v2の全依存監査はhigh 6 / critical 1 / moderate 1 / low 1。Ganache・関連暗号/WS等の開発用ツールとsolc/tmpが対象で、既存固定バージョンのまま。Ganacheは外部公開RPCを立てず、合成鍵のin-process検証だけに使い、本番backendからimportしない。この開発用指摘は解消済みとはしない。署名処理を本番ONにする前の依存・独立レビューに含める。

最終ローカル検証：[検証集計](phase5-evidence-20261110.json)。バックエンド620、画面関連288、City/Wallet/会員397、分離Auth/Firestore/Rules32、Knowledge Lab182、実ローカル決済24、wallet画面7幅の7、既存コントラクト16、**合計1,566項目合格**。重複再実行は合計へ加算しない。別途、7幅の実践開始・保存・再表示・中断再開・コピーも実ブラウザで合格。先行Lab全体試験の1件はエミュレーター競合エラーがあり、単独16/16と最終全体182/182で再確認した。既存の期待値を緩めていない。
