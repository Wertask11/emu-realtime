# ギルド（LEARN / WORK / PLAY / CONNECT / WEB3）

## 何が変わったか

これまでの「ギルド」は、SchoolPark全体のDAO議題を1本のリストで並べる画面だった。
これを「同じ目的・活動領域に関心を持つ人が集まる場所」に変える。

```
Quest #000        SchoolParkの原点。どのギルドにも属さない
   ↓
5 Guild           SchoolParkが活動する領域
   ↓
Proposal          何をするか考え、DAOで決める
   ↓
Quest #001〜      実際に行動する
```

議題はかならずどれか1つのギルドのものになる。採択された議題は「Questにする」で
クエストへ進む。小さな実験・個人の挑戦は、議題を通さず直接クエストとして出せる
（この2つの道はどちらも残す）。

## 一般／特殊について

「一般ギルド／特殊ギルド」という言い方をやめ、**一般議題／特殊議題**に統一した。
思想は変えていない。

- 一般議題（`kind: free`）… 誰でも投票できる
- 特殊議題（`kind: special`）… ギルドに関われる人（運営・公式パス・信用20点以上）だけ

ギルド自体を「LEARNは一般」「WEB3は特殊」と固定しない。同じギルドの中に両方が並ぶ。

## データ

| 置き場 | 中身 | 書ける人 |
| --- | --- | --- |
| `sp_guilds/{guildId}` | 6つ目以降のギルド。最初の5つはコード側（`guild-store.js`）に書いてある | 運営（作成・更新のみ、削除不可） |
| `sp_guild_members/{guildId}/joins/{passport}` | 参加したい | 本人（作成・削除。更新不可＝二重にならない） |
| `sp_guild_members/{guildId}/supports/{passport}` | 応援する | 同上 |
| `sp_votes/{id}.guildId` | どのギルドの議題か。作成時に必須 | 出す人。空の古い議題にだけ運営が1回入れられる |
| `sp_votes/{id}.adoptedOptionId / adoptedAt / adoptedBy` | 採択。1回だけ、あとから変えられない | 運営 |
| `sp_quests/{id}.guildId` | どのギルドの活動か。空も可 | 運営（既存どおり） |
| `sp_quests/{id}.fromProposalId / fromProposalTitle` | 元になった議題。直接クエストは空 | 同上 |

`guildId` の形は `^[a-z0-9-]{1,40}$`。Rules に「5つのうちどれか」とは書いていないので、
ギルドが増えても Rules を触らずに済む。

新しいコレクションは、`firestore.rules` 末尾の受け皿
`match /{coll}/{document=**}` の除外リストにも足してある（足し忘れると誰でも書けてしまう）。

## 後方互換

- `guildId` が無い既存の議題は「未分類」として一覧とは別枠に出る。投票はこれまでどおりできる。
- `guildId` が無い既存のクエストは、どのギルドにも並ばない。クエスト一覧には出る。
- Quest #000 はギルドの数にも一覧にも入らない。`guildId` を後から付けることもできない。
- 既存の票・受けた記録・知恵カード・トレジャリーには手を入れていない。

## 出すときの順番

1. フロントエンド（Vercel main）を先に出す。
   新しい画面は `guildId` を付けて議題を作るが、古い Rules でも通る（未知の欄は無視される）。
   採択とギルド割り当てだけが、まだ動かない。
2. そのあと Rules を出す。
   `npx firebase-tools deploy --only firestore:rules --project emusch-2a111`
3. Rules を先に出すと、古いまま開いている画面から議題を出せなくなる（`guildId` が無いため）。
   逆順にしないこと。開きっぱなしのタブは、Rules 適用後に読み直してもらう。

インデックスの追加は無い（`firestore.indexes.json` は変更なし）。ギルドごとの絞り込みは
読み込んだぶんから画面側で分けている。

## テスト

```sh
# 決まり（Rules）
npm ci --prefix tools/quest-tests
tools/quest-tests/node_modules/.bin/firebase emulators:exec --only firestore \
  --project demo-schoolpark-guilds 'cd tools/quest-tests && node --test guild.test.cjs'

# 一連の流れ（本番の index.html の中身をそのまま使う）
npm ci --prefix tools/guild-tests
npx playwright install chromium
node --test tools/guild-tests/flow.test.cjs
```

## dao.html について

`frontend/public/schoolpark/dao.html` は生成物だが、`tools/dao-build/build-dao.js` は
すでに追随していない（「自分の宿題」画面が生成側に無い）。今回も dao.html を直接編集した。
`docs/quest-000/implementation.md` の "Do not regenerate the entire DAO" と同じ扱い。

## これから

- 新しいギルドを作る導線（議題 → 投票 → 条件達成 → `sp_guilds` に1件）は未実装。
  データの形だけ用意してある。
- 議題とクエストの読み込みは、新しい順に上限つきで取っている（議題100件・クエスト100件）。
  件数が増えたら `guildId` の複合インデックスを足して、ギルドごとに取りに行くほうがよい。
