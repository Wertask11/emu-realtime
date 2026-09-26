# SchoolPark Quest Star（譲渡不可の完走証明）

## 状態

ソースと発行 API は用意済み。Polygon 本番へのデプロイ、ソース検証、発行用ロール設定は未実施です。アドレス未設定の間、パスポートは「証明書NFTは発行準備中」と表示します。星と完走記録は Firestore の承認記録から先に表示されます。

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
