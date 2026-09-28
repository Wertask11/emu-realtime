# SchoolPark Quest Star（譲渡不可の完走証明）

## 状態

**デプロイ済み（2026-09-28）。**

| | |
|---|---|
| ネットワーク | Polygon PoS Mainnet（chain 137） |
| アドレス | `0xdcAe7317F4E64fef054bd8f6BA94f9C06fb1F8B6` |
| デプロイのブロック | 94579082 |
| コンパイラ | Solidity 0.8.27 / optimizer 200 / EVM shanghai |
| OpenZeppelin | 5.0.2（Remix では `@openzeppelin/contracts@5.0.2/...` と版を明示して取り込む） |

Render の `SP_QUEST_STAR_CONTRACT` と `SP_QUEST_STAR_MINTER_PRIVATE_KEY` は設定済み。

`GET /api/schoolpark/quest-completions/certificate/config` は、環境変数だけでなく
チェーンまで見て答える（2026-09-28 にそう直した。以前は環境変数が入っているだけで
`ready:true` を返していた）。返すもの：

| 欄 | 意味 |
|---|---|
| `ready` | いま本当に1件発行できるか |
| `reason` | `NOT_DEPLOYED` / `BAD_MINTER_KEY` / `MINTER_NOT_AUTHORIZED` / `MINTER_LOW_GAS` / `CHAIN_UNREACHABLE` / `""`（発行できる） |
| `minter` | 発行係のアドレス。MINTER_ROLE を与える相手。**秘密鍵は返さない** |
| `canMint` | 発行係が MINTER_ROLE を持っているか |
| `matic` | 発行係の残高。0.01 MATIC を下回ると `MINTER_LOW_GAS` |

答えは60秒だけ取っておく（発行に失敗したときは、その場で捨てて見直す）。
同じ内容は運営画面の SchoolPark タブ →「限定星を配る」→「NFTの発行」に出る。
直し方もそこに書いてある。

### MINTER_ROLE の付与（未実施なら先にこれ）

コントラクトの constructor は、**置いた人**（＝オーナーの実ウォレット）にだけ
`MINTER_ROLE` を与える。サーバーの発行係は別の住所なので、役を渡すまで発行は必ず失敗する。

1. 運営画面で発行係のアドレスを控える（上の `minter`）。
2. Polygonscan か Remix で、**コントラクトを置いたウォレット**から
   `grantRole(role, account)` を1回実行する。
   - `role` = `MINTER_ROLE()` を読んだ値
     （`0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6`）
   - `account` = 発行係のアドレス
3. 運営画面を開き直して「発行できます」になることを確かめる。

発行係にはガス代の MATIC も要る（1件あたり 0.01 MATIC ほど）。

残っているもの：実際に1件発行して `tokenForCompletion` / `ownerOf` / `tokenURI` と
転送が拒否されることを確かめること。Polygonscan でのソース検証（任意）。
検証するときは、**Remix で実際にコンパイルしたソース**を貼る。リポジトリの
`src/SchoolParkQuestStar.sol` は import に版を書いていないので、そのままでは一致しない。

限定星（`sp_stars`）も同じコントラクトを使う。もともと「星」のコントラクトなので
分けていない。鍵の頭が `"schoolpark-star"` なので、完走の鍵とは衝突しない。

## 完走と100 EMUER

一般 #001 LEARN のみ、運営画面から10月1日以降に個別予算10,000 EMUERを一度だけ公開できます。「認める」は本人の「やってみた・つまずいた・気づいた」各1本以上と知恵カードをサーバーで検証し、予算から100 EMUERを確保して承認します。最大100人です。参加者はパスポートに署名確認済みのウォレットを連携してから承認を受け、同じウォレットでログインして EMUER v2 の報酬を請求します。クエスト画面の古い予算欄は支払元ではありません。

## デプロイ

- Solidity 0.8.27 / OpenZeppelin 5.0.2 / optimizer 200 / Shanghai。
- Polygon PoS Mainnet（chain ID 137）。管理者にオーナーの実ウォレットを指定してデプロイします。
- `SchoolParkQuestStar.sol` はトークンの移転、焼却、承認を拒否します。完走鍵は SchoolPark ID とクエスト ID のハッシュで、個人情報をオンチェーンに出しません。
- 別のガス用発行ウォレットを用意し、管理者が `MINTER_ROLE` を付与します。管理者の秘密鍵を Render へ置きません。
- Render に `SP_QUEST_STAR_CONTRACT`（検証済みアドレス）、`SP_QUEST_STAR_MINTER_PRIVATE_KEY`（発行専用）、`POLYGON_RPC_URL` を設定します。秘密鍵は GitHub、チャット、Firestore に保存しません。
- 最初にテスト完走で発行し、`tokenForCompletion`、`ownerOf`、`tokenURI`、転送失敗、パスポートの星と日付が一致することを確認します。

発行が失敗しても完走・EMUERの記録は消えません。同じ完走鍵で再試行でき、オンチェーンで既に発行済みなら二重発行しません。
