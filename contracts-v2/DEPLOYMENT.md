# EMUER v2 デプロイ・切替手順

## 現在地

`EMUERv2.sol` は2026-09-18にPolygon PoSへデプロイ済み。既存本番の旧アドレス、残高、画面、APIはこのデプロイだけでは変更されない。2026-10-01 00:00 JSTより前は、コントラクト自身が報酬請求と交換を拒否する。

- Network: Polygon PoS Mainnet（chain ID 137）
- Contract: `0x9c102cC3016C70767082b60196565878D9314864`
- Admin / Treasury: `0x1C156b6a8CaA6772430edA2cBB0d20CF41B9CFE4`
- Compiler: Solidity 0.8.27
- OpenZeppelin Contracts: 5.0.2
- EVM: Shanghai
- Optimizer: enabled, 200 runs

## 固定した値

- Polygon mainnet: chain ID 137
- 管理者兼トレジャリー: `0x1C156b6a8CaA6772430edA2cBB0d20CF41B9CFE4`
- 初期・固定供給: 10,000,000 EMUER
- 月間実配布上限: 416,000 EMUER（JST暦月、繰越なし）
- 管理者移行待機: 86,400秒
- Solidity 0.8.27、optimizer 200、EVM Shanghai

## 署名前の確認

1. `npm install` 後に `npm test` を実行する。
2. `artifacts/EMUERv2.json` が直近テストで再生成されていることを確認する。
3. 接続ネットワークがPolygon mainnet（137）、署名者が上記トレジャリーであることを確認する。
4. デプロイ見積りとウォレットのPOL残高を確認する。
5. コンストラクタ引数は上記トレジャリーと `86400`。秘密鍵をチャット、Remixのファイル、GitHubへ保存しない。

`deploy.cjs`はローカル環境変数から実行できるが、MetaMaskを使う場合はRemixへ`src/EMUERv2.sol`を入れ、Injected Providerで本人が署名する。どちらも同じコンストラクタ値を使う。

## デプロイ直後の読取確認

- `name=Emuer`、`symbol=EMUER`、`decimals=18`
- `totalSupply=10,000,000 × 10^18`
- `treasury`と`defaultAdmin`が指定アドレス
- トレジャリー残高が全供給量
- `MONTHLY_REWARD_CAP=416,000 × 10^18`
- `START_TIMESTAMP=1790780400`
- 一般ウォレットの`transfer`と`approve`が失敗

デプロイだけでは既存アプリを切り替えない。新アドレスを記録し、Polygonscanでソース検証後、サーバーとフロントの設定を段階的に更新する。

## 10月1日のデータ切替

1. 旧台帳・旧コントラクトを読取専用として記録し、旧定期付与を停止する。
2. `backfill-reactions.cjs`を最初はdry-runで実行する。
3. 過去のGood/Change件数と一意な反応者数が一致しない投稿を手動確認する。
4. スナップショットの件数・合計・SHA-256を保管し、同じ入力で一度だけ確定する。
5. 過去ログイン・一日シェア・議論・改善反映・懸賞は遡及しない。
6. 新規の日常報酬を10月1日以降のイベントから記録する。

バックフィルは既存の投稿・反応を更新・削除しない。新しいコレクションへ未変換報酬を作る。アドレスとPassportの本人対応を確認するまでオンチェーン変換を許可しない。

## アプリ切替の必須項目

- Render: 新コントラクトアドレス、署名ドメイン、開始日時を設定。旧`addGoodBatch`、月次配布、旧懸賞精算を停止。
- Firestore: v2台帳、申請、注文、返金の書込みはサーバー専用。利用者は自分の表示用データだけ読めるようRulesを追加。
- Emu: 旧0.5ログインや旧3 EMUER懸賞の説明・計算を新仕様へ変更。
- Passport「価値」: 変換・みてみるへの入口、未変換、申請待ち、受取可能、オンチェーン残高を区別。
- プラン: light月1、plus相当週1、pro無制限。変換と交換は別枠。本人ウォレット署名必須。
- みてみる: 商品が登録されるまで交換を有効にしない。
- 監視: 月間配布額、トレジャリー可用残高、返金予約額、失敗トランザクション、未払い列を確認。

## 戻し方

開始前は新機能フラグを無効にする。開始後に問題があればコントラクトをpauseし、新規署名発行を停止する。既存の投稿・SchoolPark機能はEMUER v2から独立して継続できるようにする。返金はpause中でも可能。
