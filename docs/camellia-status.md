# Camellia 現状報告（2026-10-05 検証）

Camellia は **https://camellia-beta.vercel.app/** （`Wertask11/camellia-beta`）です。
SchoolPark / Emu の中（左上タブ）からは行けません。独自アプリです。

検証したコミット: `2895a2e`（camellia-beta / main）

---

## 1. 結論：即時反映は「条件付きで、はい」

| | 判定 |
|---|---|
| 仕組みは正しく作られているか | **はい。** 設計どおり |
| 全データが管理画面に行くか | **はい。** 7つの決まった場所＋`imports/` に全部 |
| 即時か | **はい。** 最後の操作から1.5秒後に書く |
| **いま実際に動いているか** | **未確認。** Firebase の「匿名ログイン」が有効かどうかで決まる |

**確かめることが1つあります。**
Firebase コンソール → Authentication → Sign-in method → **「匿名」が有効か。**
無効だと `signInAnonymously` が `auth/operation-not-allowed` で落ち、
**1バイトも書かれません**（画面には何も出ず、コンソールに警告が1行出るだけ）。

---

## 2. どう繋がったか

```
Camellia β（ブラウザ）
  └ hooks/useCamelliaStore.ts の保存エフェクト（指定どおり1行だけ足されている）
      ├ localStorage（いままでどおり）
      └ syncToSchoolPark(state)
           ↓ 1.5秒まとめ書き・指紋で差分だけ
         Firestore  emusch-2a111 / camellia_users/{uid}/...
                                  ↑
         SchoolPark 管理画面が Admin SDK で読む（こちらは無改造）
```

ログインは **匿名（`signInAnonymously`）**。
`app/page.tsx` で、オンボーディングを終えた人に自動でかかります。
ログイン画面も同意画面もありません（指示どおり）。

---

## 3. 書かれる中身（全部）

| Firestore の場所 | 中身 | 管理画面での見え方 |
|---|---|---|
| `camellia_users/{uid}` | `updatedAt`、（あれば）`passport` | 一覧の行 |
| `profile/basic` | 表示名・職業・目標・年齢・興味・月経記録の有無・使える分数 | 「プロフィール」 |
| `profile/settings` | 固定値＋`aiModel: camellia-beta-rule-based` | 「設定」 |
| `profile/chat` | AI会話（新しい200件） | 「Camellia AI との会話」 |
| `profile/activity` | 行動（新しい300件） | 「行動」＋従順スコアの計算元 |
| `daily/{YYYY-MM-DD}` | その日の最後のチェックイン | 「日々の記録」 |
| `imports/{種類}-{id}` | **localStorage の全部**を1件1文書でJSON保存 | 「ほかのアプリから取り込んだもの」 |

`imports/` に入るのは13種類：
`meta` `profile` `checkin` `action` `action-feedback` `saved-action`
`conversation` `context-memory` `insight` `insight-feedback`
`fortune` `tree-leaf` `analytics`

**つまり、占い・木の葉・気づき・あとで見る・フィードバックまで、
管理画面の決まった欄に入らないものも全部届きます。**

### 変換（チェックイン）

| β | → | `daily` | 変換 |
|---|---|---|---|
| `mood 1..5` | → | `mood` | 😢とてもつらい／😟すこしつらい／😶ふつう／🙂よい／😄とてもよい |
| `sleep` | → | `sleep` | そのまま |
| `stress` | → | `stress` | 低い2／普通5／やや高い7／高い9 |
| `body` | → | `fatigue` / `energy` | 良い2・8／普通4・6／疲れ気味7・3／悪い9・1 |
| `periodDays` | → | `cycle` / `lastMenstrualDate` | 「月経N日目」＋逆算した日付 |

**集めていない欄（不安・孤独感・痛み・服薬など）は、0を入れずに書いていません。**
管理画面では「未記録」と出ます。これが正しい状態です。

日付は日本時間（`jstParts`）。同じ日に複数回書いたら最後のものが残ります。

---

## 4. 指示どおりに守られていること

- `camellia_users/{uid}/admin/**` に書いていない（ルールで禁止）
- `camelliaId` を自分で作っていない
- `agreedAt` / `birthDate` を書いていない（同意を取らない方針どおり）
- 親フレーム（`window.parent.*`）を呼んでいない
- localStorage をやめていない（両方に書く）
- 1.5秒のまとめ書きと、指紋による差分送信がある
- 指紋は **Firestore が受け取ってから** 控えている（失敗したら次に送り直す）
- `pagehide` で送り切る
- 書き込みは400件ずつのバッチ

β 側には自前の試験（`tests/schoolpark-sync-cases.mjs`）も入っていて、
上のうち主要なものを固定しています。

---

## 5. 見つかった問題（4つ）

### ① 繋がっていない窓口が2つある（SchoolPark連携が使えない）

`lib/auth/camellia.ts` が、この2つを呼びます。

```
POST https://emu-realtime.onrender.com/api/camellia-auth/passport/exchange
POST https://emu-realtime.onrender.com/api/camellia-auth/line
```

**どちらも emu-realtime に存在しません。** `/api/camellia-auth` は未実装です。

また「SchoolParkとつなぐ」は、この先へ飛ばします。

```
https://schoolpark-emu.vercel.app/camellia-connect.html
```

**このページも存在しません。**

結果：
- **「登録せずに試す」（匿名）→ 動く。記録は管理画面に届く**
- **「SchoolParkとつなぐ」→ 404。繋がらない**
- **「LINEではじめる」→ LINEの画面までは行くが、戻ってきた所で失敗する**

匿名でも記録は全部届きます。ただし `ches_accounts/{uid}` が無いので、
**管理画面の一覧にお名前とパスポート番号が出ません**（uid だけになります）。

### ② 記録が1件でも壊れていると、同期が丸ごと止まる（静かに）

`mapCheckin` は `moodText[checkin.mood]` のように表を引きます。
表に無い値（古い v1 / v2 から移ってきた記録など）が1つでもあると
`undefined` になり、Firestore は `undefined` を受け取らずに例外を投げます。

同期は全部を1回のバッチで送るので、**その1件のせいで全部が書かれません。**
しかも失敗は `console.warn` が1行出るだけで、画面には何も出ません。
指紋も控えないので、以後ずっと同じ失敗を繰り返します。

### ③ 管理画面の読み取りが、使うほど重くなる

`imports/` は **1件につき1文書** です。しかも β 側の
`analyticsEvents` と `contextualMemory` に**上限がありません**（`slice` ゼロ）。

30日ふつうに使った方 1人あたりの目安：

```
analytics       ~300文書     context-memory  ~180文書
checkin / fortune / action   各~30文書
                             合計 およそ 600文書
```

管理画面（`GET /api/billing/admin/camellia`）は、
**全員ぶんの `imports` を毎回、上限なしで読みます。**

```
1回の表示で読む数 ≒ 人数 + Σ(2 + 日々の記録 + 5 + imports)
10人 × 600 ＝ 約6,000読み取り／1回ひらくごと
```

Firebase の無料枠は **1日50,000読み取り**。
この計算だと **1日8回ひらくと使い切ります。**
このプロジェクトは過去に読み取り枠を使い切ったことがあります。

### ④ 端末を変えた初回だけ、記録がひと呼吸遅れる

同期の控え（`camellia-sync-sent`）が空で、サーバーに既に記録がある人は、
ぶつからないように **その回は `imports/` だけ**書きます。
`daily` やプロフィールは、**次に何か操作したとき**に届きます。

壊れてはいません。初回だけ遅れます。

---

## 6. emu-realtime 側（SchoolPark）の Camellia 関連

### 残っているもの（全部そのまま動く）

| | 場所 |
|---|---|
| 管理画面 9本 | `frontend/public/camellia/` |
| 運営画面の Camellia タブ | `frontend/public/membership-admin.html` |
| 管理用の窓口 7つ | `backend/billing.js`（すべて `requireOwner`） |
| 権限のルール | `firestore.rules`（`camellia_users` / `camellia_community` / `camellia_reports`） |
| 入った方の記録 | Firestore（1件も消していない） |

管理用の窓口：

```
GET  /api/billing/admin/camellia              入った方の一覧
POST /api/billing/admin/camellia/control      7つの機構の入り切り
POST /api/billing/admin/camellia/issue-ids    Camellia ID をまとめて発行
POST /api/billing/admin/camellia/reply        運営が手で返事を書く
GET  /api/billing/admin/camellia/reports      通報の一覧
POST /api/billing/admin/camellia/post/delete  投稿を消す
GET/POST /api/billing/admin/camellia/rules    判定基準
```

### 消したもの（2026-10-04）

- 利用者側の画面 `camellia/control-user.html` と、それだけが読んでいた15本
- `backend/camellia.js`（`/api/camellia`）
- ブランド切り替えの Camellia 行（`index.html` と `schoolpark/dao.html`）

### 前から開いている穴（今回も直していない）

- **`camellia_admin` がルールの受け皿に落ちている。**
  除外リストに入っていないので、ログインしていなくても
  `camellia_admin/rules.threshold` を読み書きできます。
  直すなら `&& coll != 'camellia_admin'` を1行足すだけです。
- **7つの機構の名前が食い違う。** 画面は `rules` を送り、
  サーバーは `reward` を受ける。`rules`（規則変更）は捨てられています。
- **利用規約・特商法・プライバシーポリシーに Camellia の記載がゼロ。**
  オーナーは「作らない」と決めています。

---

## 7. いますぐ確かめること

1. **Firebase コンソール → Authentication → Sign-in method → 「匿名」を有効に。**
   これが無いと何も届きません。
2. https://camellia-beta.vercel.app/ を開き、「登録せずに試す」でチェックインを1件保存。
3. Firestore コンソールで `camellia_users/{uid}/daily/{今日}` ができているか。
4. https://schoolpark-emu.vercel.app/membership-admin.html の **Camellia タブ**に出ているか。
   年齢「不明」・「同意なし」で出るのが正しい状態です。
