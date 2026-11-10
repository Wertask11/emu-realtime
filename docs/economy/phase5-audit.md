# Phase 5 実装前監査・方式

> 2026-11-10追補：[実チェーン照合・署名器・POL予約](phase5-operator-release.md)。以下はPR #324時点の記録。RPC通信は追補で成功しており、未照合という記述は当時の状態です。現判定はPARTIAL / Polygon OFF。

2026-11-10、基点main e0e04f9（PR #323）。未コミット変更なしから専用ブランチを作成。

既存ソース：contracts-v2/src/EMUERv2.sol、artifacts/EMUERv2.json、DEPLOYMENT.md、backend/emuer-v2/router.js、mitemiru.js、economy、identity/router/wallet-signatureを調査。

- 既存指定：Polygon PoS 137、EMUERv2 `0x9c102cC3016C70767082b60196565878D9314864`、treasury/admin `0x1C156b6a8CaA6772430edA2cBB0d20CF41B9CFE4`。記録上2026-09-18デプロイ。Solidity0.8.27、OZ5.0.2、Shanghai、optimizer200。
- ソースではERC20派生、18桁、固定10,000,000×10^18。通常transfer/transferFrom/approveは拒否し、allowanceによる消費は利用不可。外部mint・upgrade関数はない。
- 正規exchangeはEIP712のEmuer/version2/chainId/contractとorderId/productId/buyer/price/deadlineを署名で固定。priceはburnでなくtreasuryへ移り、reservedForRefundsに拘束される。
- REFUND_ROLEのrefundExchangeは元buyerへ全額返却。二重返却不可・pause中も可能。markExchangeFulfilled後は返却不可なので、成果物の永続保存より前には呼ばない。claimRewardとJST月416,000上限は別経路で維持。
- ソースの停止はPAUSER_ROLE、再開はDEFAULT_ADMIN_ROLE、admin移行遅延86,400秒。今回は権限・pause・コントラクトを変更しない。実チェーン値は下記の通信制限解消後に別途照合する。
- PassportはFirebase UID→SchoolPark ID、明示ウォレット連携とnonce署名検証を使用。検証器はEOA/EIP1271に対応。新支払は現在の登録wallet一致＋専用の短命・一度限り署名を確認し、初期は直接exchangeできるEOAを対象とする。ユーザー鍵は預からない。
- economyは5 EMUER、Plus/Pro・提供資格、20/3/2、5,000/100,000予約tokens、永続worker・保存・返却・冪等性。サービス注文は共通Mitemiru ordersにあるが現状ledger専用。
- Cityのchain確認はorders状態中心で、厳密なreceipt/event/canonical block/再編成の確認にそのまま使わない。既存refund APIは返却済みの確認で、返却送信ではない。一般shop APIからサービス注文の検証を迂回させない。
- Renderに既存authorizer設定あり、専用refund鍵の設定はなし。秘密値は非表示。RPCホストpolygon-mainnet.infura.ioは現在の環境許可外（proxy403）。Polygon・法務公式サイトとともに通信許可案を保存済み。未照合値を本番承認済みとしない。

採用方式A：正規exchange/refundExchangeと共通商品・注文・ジョブを再利用する。新コントラクト・approve・自由送金は使わない。チェーン支払だけの厳密な確定・再編成確認、返却/提供完了の永続outboxを追加する。オペレーターは専用署名インターフェースで接続し、未接続・役割不明・ガス/法務/独立監査未承認なら既定OFF。

変更予定：backend/economy/polygon*.js（所有署名・チェーン照合・outbox）、service/config/router（共通ジョブ・方法固定・復旧）、mitemiru.js（サービス内部経路・shop迂回拒否）、frontend/public/economy（方法・実RPCガス見積もり・署名・状態）、関連試験・運用文書。コントラクト・既存台帳・Passport方式・Rules・Knowledge Lab・Camelliaは変更しない。

ローカルで同じSolidityを分離チェーンに配備し、決済→生成→保存・失敗返却を確認する。本番/公開チェーンのデプロイ、管理変更、資産消費/返却、実ガス支出は実行しない。危険点は遅延決済・再編成・二重請求/返却・支払元競合・署名権限・nonce再使用。元buyer・固定注文、確定receipt/event/state、永続outbox、既払復旧の継続で対処する。

実装上の依存確認：Mitemiruファイル自体の変更は避け、serverのmount前に認証付きservice-order guardを置いた。公式EMUER案内のorigin/content hashを変えず、既存の資料許諾・ショップ処理を維持する。wallet注文はショップの予約期限フィールドを使わず、専用のfinalized失効確認を使う。データ移行はない。
