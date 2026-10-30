# WalletConnect の部品（Emu の「ウォレットではじめる」用）

Emu の画面はビルドなしの静的ファイルなので、`@walletconnect/ethereum-provider` を1つのファイルにまとめて
`frontend/public/vendor/walletconnect/` に置いている。画面（`frontend/public/wallet-choice.js`）は、
「HashPort Wallet など」を選んだときにだけ、このファイルを読み込む。

## 作り直し方

```sh
cd tools/walletconnect
npm install
npm run build
```

版を上げるときは、`package.json` の版と、出力するファイル名（`ethereum-provider-<版>.js`）、
`wallet-choice.js` の `WC_SRC` をそろえて変える。版は公開から2週間以上たったものを使う。
`vendor/walletconnect/` の LICENSE も、新しい版の `node_modules` から写し直す。

## ライセンス

WalletConnect と Reown AppKit は、オープンソースではなく Reown のコミュニティライセンス。
- 教育・研究と、アプリの開発には使用料はかからない。利用者数（MAU）や呼び出し回数が Reown の決めた量を超えたら、商用ライセンスを結ぶ必要がある（Reown の利用規約に量が出る）。
- 配るときは、ライセンスの写しと「Portions © 2025 Reown, Inc. All Rights Reserved」の表記を付ける（`vendor/walletconnect/readme.txt`）。
