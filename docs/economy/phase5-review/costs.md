# POL・運用費用表

取得UTC：2026-11-11T01:34:07.190Z。実資産支出0。すべて見積もりで実取引成功ではない。

| 操作 | gas | 現在feeでのPOL | 直近64block中央値でのPOL | 同95%値でのPOL | 根拠 |
| --- | ---: | ---: | ---: | ---: | --- |
| 本人exchange | 139,482 | 0.039302049712284072 | 0.050177742972448392 | 0.05216354323865748 | 11月10日local EVM receipt; 本番wallet別見積もり |
| 運営refundExchange | 110,697 | 0.031191257631814212 | 0.039822526303186932 | 0.04139851554960258 | 11月11日実RPC state override |
| 運営markExchangeFulfilled | 74,058 | 0.020867432339601768 | 0.026641884178987848 | 0.02769624528733812 | 11月11日実RPC state override |
| 初期REFUND_ROLE付与 | 62,338 | 0.017565070582328648 | 0.022425690350127528 | 0.02331319423589732 | 実RPC simulation; 未設定dummy宛て、実付与ではない |
| token.pause | 54,631 | 0.015393457778292476 | 0.019653147189801036 | 0.02043092679106334 | 実RPC simulation; 実停止ではない |

現在RPC gasPriceは281.771480996 gwei。中央値359.743500756、95%値373.98046514は64blockの観測であり、恒常的な通常/混雑価格の保証ではない。

本人exchangeは別のPOL支出。金額は署名前に本人walletの実estimateで表示する。上記local gasは将来本番請求額ではない。失敗txも採掘されればgasを消費する。未送信の署名拒否/KMS停止/予算拒否はchain gasを消費しない。

## 予約・上限（提案、未承認）

gas limits150,000/100,000、fee ceiling400gweiを仮定すると、返却だけの2件準備枠0.12 POL、提供確定まで含めた2件の保守予約0.2 POL。1注文0.1 POL、日20件の上限シナリオ2 POL、7日14 POL。30日60 POLは継続承認後を仮定した計算で、現7日試験を延長するものではない。

月額・日次・trial capはFounder承認値のみ設定する。コードはMONTHLY_GAS_WEIも必須にし、JST月の実費と全未処理予約を原子的に検査する。予約を月替わりで消去しない。上記fee ceilingなら25%余裕条件により現在feeが320gweiを超えると新規受付を停止する。観測混雑時には受付停止し得る。上限の自動増額・自動POL補充はない。既払返却は予約内で継続し、署名器/権限/資金が不足すれば返却待ち・incident対応とする。

停止閾値：有効POL=min(finalized残高,latest残高)<全未処理予約+新予約、25%余裕>承認fee ceiling、gas見積もり+25%>承認limit、日次/月次/trial費用超過、KMS/role/独立control異常、RPC finality不明、台帳不整合。

## 初期設定・事故・再デプロイ

role付与/オンチェーンpauseは上記simulation参考。key rotationは新KMS+role付与/旧role剥奪等の追加costが必要。剥奪/replacementの実額は対象・nonce・実行時見積もりとFounder承認後に確定する。Firestore制御による停止・KMS停止はtoken gasを要しないが、クラウドAPI料金は契約による。失敗・再試行は残り予約と実費を記録し、新nonce/gas bumpを無断で作らない。

再デプロイの必要性は未確定。metadata不一致だけで新tokenを発行しない。現tokenは非proxy・upgrade関数なしのsource-compatible code。必要なら新address、旧10m供給・既存残高/claim/予約/Cityとの並存、移行・ユーザー同意・監査・費用を別設計し承認待ち。現時点で再デプロイ料を0や確定額としない。

## 円換算と固定費

POL/JPYの実相場未取得（追加ホスト許可案は保存、適用未確認）。円額を創作しない。式はPOL費用×同時刻のPOL/JPY。quote取得時に日時・出典を記録し、想定rateと実測rateを区別する。

AWS東京の既知参考：KMS customer-managed key USD1/月・時間按分、ECC Sign USD0.15/10,000回。仮600署名のSign単体はUSD0.009、Describe/GetPublic等・再試行・compute/private TLS/log/network/税は別。非対称Sign/GetPublic等を無料枠と断定しない。実AWS見積もりは設定前に確認する。

RPCは既存Infuraを再利用。キーだけでは契約プラン・請求先・月間枠を確認できない。ダッシュボードでFounderが確認する。Render/Vercel既存契約、独立signer実行費、外部監査/法務は未見積もり。有料契約・KMS作成・POL購入/送金は今回実施しない。
