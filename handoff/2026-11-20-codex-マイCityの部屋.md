# Codex への依頼：SchoolPark City の「マイCity」を、自分の部屋にする

依頼主：オーナー（2026-11-20）
リポジトリ：Wertask11/emu-realtime（本番：schoolpark-emu.vercel.app／API：emu-realtime.onrender.com）

## 1. やってほしいこと（オーナーの言葉）

> SchoolPark City のマイCityは、部屋だけでいい。
> SchoolPark 公式の仮想店舗みたいな感じで、部屋があって、そこに色々置けたりする。
> 置物を置いたり飾り付けしたりでき、その道具は SchoolPark City の公式店舗（SchoolPark）で EMUER と交換できる。
> 他人の部屋を見られたり、X などでシェアできたりすると面白い。

いまの「MY CITY」（`frontend/public/schoolpark/city.js` の `myCity()`）は、次のものを並べた一覧で、本人にしか見えない。
- 訪れたスポット
- クエストの実績
- 限定の星
- ギルド

**この一覧はやめて、部屋だけにする。** ただし記録（チェックイン・実績）のデータや API は消さない。同じ記録は、パスポートと星空で見られる。

## 2. 遊び方のイメージ

- 箱庭のように、自分の部屋を模様替えして楽しむ。床・壁・窓のある部屋を、少し上から見下ろす形にする。
- 家具・置物・壁紙・床・窓の外の景色を、マス目の上に置く・動かす・回す・しまう。
- 手持ちの道具（持ち物）から選んで置く。
- 道具は、City の公式店舗（SchoolPark 公式ショップ）で EMUER と交換して増やす。
- 最初から、無料の道具を数個渡しておく。部屋が空っぽで始まらないようにするため。
- 部屋は「公開する／しない」を選べる。
  - 公開した部屋は、ほかの人が見に来られる。見た人は「いいね」を送れる。
- X でシェアできる。シェアするのは、部屋の画像と公開ページの URL だけ。

**大事な注意：既存のゲームの再現にはしない。**
- 「動物の森のような雰囲気」は、ジャンルとしての箱庭・模様替えの遊び方のことです。
- 任天堂（どうぶつの森）の名前・キャラクター・絵・音・UI・アイテムの名前やデザインは、一切使わないでください。
- 「〜の森風」と名乗るのもやめてください。

見た目は Emu for SchoolPark の世界観に合わせます。
- 絵本『とびらのむこう』：紙の質感、クレヨンの線、冷蔵庫くんとその仲間たち
- 素材は既存のものを使ってよい：`frontend/public/emu-theme/emu-ehon.css`、`frontend/public/ehon/`
- City の 3D（`frontend/public/schoolpark/city-world.js`）は three.js を `schoolpark/vendor/city-three.min.js` で同梱しています。3D の部屋にするならこれを使い、外部の CDN やアセットは読み込まないでください。
- 2D（等角の見下ろし図）でもかまいません。スマホで軽く動くほうを選んでください。

## 3. 作り方の方針（既存を壊さない形）

### 道具の入手：既存の公式ショップの仕組みに乗せる
- 公式ショップの交換は `backend/mitemiru.js` が持っています。ここは ChatGPT が作業中なので、触らないでください。
- 部屋の道具は、運営画面から「デジタル配布」の商品として登録してもらいます。
  - `digitalAssetId` を `room-` で始まる名前にします（例：`room-desk-oak-v1`）。
- 部屋の側は、本人の公式ショップの交換記録のうち、
  - 渡し終わったもの（fulfilled）
  - `digitalAssetId` が `room-` で始まるもの
  を「持ち物」として**読むだけ**にします。交換の処理そのものは変えません。
- どの `room-…` がどの道具（形・大きさ・置ける場所・絵）に当たるかの表は、部屋の側に持ちます。
  - 例：`backend/city-room-items.json`
- 道具の値段・個数の上限・締切は、オーナーが運営画面で決めます。
  - 規約 第5条の6（公式ショップでの交換）の範囲で、ほかの公式ショップ商品と同じ扱いです。
  - 値段の案だけ、PR に一覧で書いてください（経理部・商品開発部の案と比べて、オーナーが決めます）。

### 保存
- 新しい API は `backend/city-room.js` に作り、`server.js` に1行で取り付けます。
- 本人の部屋：
  - `GET /api/schoolpark/city/room/me`：持ち物（交換記録から読む）、無料の道具、配置
  - `PUT /api/schoolpark/city/room/me`：配置の保存
- 公開の部屋：
  - `GET /api/schoolpark/city/room/:publicId`：見るだけ
  - `POST …/like`：いいね
  - `POST …/report`：通報
- 置き場所は Firestore の新しいコレクション（例：`city_rooms/{SchoolPark ID}`）です。
  - サーバーだけが読み書きします。ルールは `allow read, write: if false;` にします。
  - 公開ページ用の `publicId` は、パスポートの番号とは別の乱数にします。パスポートの番号は外に出さないでください。
- 保存するときは、サーバーで次を確かめます。
  - 持っていない道具を置いていないか（個数も含む）
  - マス目の範囲・重なり
  - 置ける数の上限
- 通報・非公開・運営の非表示は、たまり場（`backend/tamariba.js`）と同じ考え方にします。

### 画面
- `city.js` の `page === 'my'` を、部屋の画面にします。
  - 部屋は別のファイルに分けます（例：`schoolpark/city-room.js`、`city-room.css`）。`city.js` の変更は、入口の差し替えだけにしてください。
- 「MY CITY」のボタンの説明（`'自分の記録'`）は「自分の部屋」にします。
- 公開の部屋のページは、ログインしていない人にも見られる URL にします（例：`/schoolpark/room.html?id=…`）。
- 3D の街の公式店舗（`openShopWorld`）から、「マイCityへ」の導線（`onMyCity`）はそのまま使います。
- スマホ（375〜430px）とパソコン（1280〜1920px）の両方で使えるようにします。
  - 指でドラッグして置ける・回せること。押すところは 44px 以上。
  - 「動きを減らす」設定のときは、動きを止めます。

### Firebase の読み込み上限に気をつける
- 今日、利用者増で Firebase の無料枠（1日の読み込み上限）に達し、夕方まで止まりました。
- 部屋を開いたときの読み込みは、サーバーを通して少ない回数にしてください。
- 公開の部屋の一覧を何十件も読む作りは避けてください。

## 4. 守ってほしいこと（オーナーの決まり）

- 既存のシステムは壊さない。世界観を壊さない。勝手に目標を変えない。
- `main` へ直接 push しない。force push しない。作業用のブランチを切り、PR を作る。
  - PR の題名・本文・コミットの文は日本語で書く。
  - マージはオーナーが「マージして」と言ってからにする。
- 本番のデータを書き換えない。既存の β のデータを消さない。
- 運営（admin）の確認を弱めない。
- 認証を偽装しない（localStorage・Cookie・Firebase Auth のトークンなどの手動注入をしない）。
- パスワードや認証コードをチャットで求めない。
- 個人の自由記述を PostHog に送らない。
  - 計測は、決まった語・数・はい/いいえだけにします（`frontend/public/emu-analytics.js` の schemas に足す）。
- 他の未マージの PR を勝手に取り込まない。
- 名前は「Emu for SchoolPark」「SchoolPark City」。「SchoolPark」だけ、「Emu」だけでは呼ばない。

## 5. いま同時に進んでいる作業（ぶつからないように）

| 誰が | 何を | 触っているファイル |
|---|---|---|
| ChatGPT | EMUER の経済まわり（economy・polygon-signer・冷蔵庫くんの台帳・みてみる／公式ショップの交換） | `frontend/public/economy/*`、`backend/economy*`、`backend/emuer-v2/*`、`services/polygon-signer/*`、`backend/mitemiru.js` → **触らない** |
| Claude（Claude Code） | パスポートの星空を黄道12星座にする（星座図鑑・星の入れ替え・自分だけの星座・保存・シェア） | `frontend/public/Emu_room2/*`、`frontend/public/index.html` の星空まわり（`_emuSendStarCounts` 付近）、`firestore.rules` に `sp_star_layouts` を追加予定 → **触らない** |
| Codex（あなた） | マイCity の部屋 | `frontend/public/schoolpark/city-room*`（新規）、`city.js` の入口、`backend/city-room*`（新規）、`server.js` の取り付け1行、`firestore.rules` の新しいブロック1つ |

`firestore.rules` は Claude も同時に足します。既存の行は変えず、ファイルの最後のほうに新しい `match` ブロックを1つ足す形にしてください。ぶつかったときは、両方のブロックを残してください。

## 6. テスト（全部通してから PR）

オーナーは「全部通っていること」を求めます。「ほぼ通った」では出さないでください。

- **今回の分**
  - `backend/city-room.test.js`（新規）
    - 持っていない道具は置けない
    - 上限
    - 公開／非公開
    - 通報
    - publicId からパスポートの番号が分からない
  - City の画面テスト（`tools/guild-tests/city*.test.cjs` の書き方に合わせて、部屋を開く・置く・保存・公開ページを見る）
- **既存**
  - `node --test backend/*.test.js`
  - `node --test tools/emu-tests/*.test.cjs`（リポジトリの根から流す）
  - `tools/guild-tests`（`city-*` を含む）
  - `tools/tour-tests`
  - `tools/member-tests`
  - `tools/admin-tests`
  - `firestore.rules` を変えたら、ルールのテスト（エミュレーター）
    - quest-tests、quest-number-tests、wisdom-tests、knowledge-lab の rules 系、economy の rules
- **変えてはいけないファイルを固定しているテストがある**
  - ツアーのテスト（`tools/tour-tests/reizo-tour.test.cjs` のテスト10）が、次のファイルを「認めた変更（`tools/tour-tests/approved-2026-11-07.json`）以外は変えていない」ことで固定しています。
    - `firestore.rules`
    - `backend/identity.js`
    - `backend/entitlement.js`
    - `backend/membership-policy.js`
    - `backend/quest-completion.js`
    - `frontend/public/knowledge.html`
    - ゲームのファイル
  - `firestore.rules` にブロックを足したら、その分を JSON に「今の文→元の文」の組で足してください。
- **画面の確認**
  - スマホ（390px）とパソコン（1440px）の画面写真を PR に付けてください。
  - 部屋・道具を置いた様子・公開ページ・シェアの確認画面を写してください。

## 7. 最初に返してほしいもの

いきなり全部作らず、まず次の4つを PR の下書き（またはメモ）で見せてください。オーナーが見てから本作りに入ります。

1. 部屋の見た目の案（2D／3D のどちらにするか）と、最初の道具の一覧（無料3つ＋交換用10個前後。名前・置ける場所・EMUER の値段の案）
2. 画面の流れ：
   1. マイCity を開く
   2. 置く・動かす・しまう
   3. 公式店舗へ行って交換
   4. 持ち物に入る
   5. 公開・シェア
   6. 他人の部屋を見る
3. 触るファイルの一覧（新規と変更）
4. 新しい API と `firestore.rules` の追加分
