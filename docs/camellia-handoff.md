# Camellia 引き継ぎ書（Claude 側 → ChatGPT 側）

2026-10-04。SchoolPark / Emu のブランド切り替えから入っていた Camellia
（Claude 側で作っていたほう）を**消しました**。これからは ChatGPT 側で
作っている Camellia β（https://camellia-beta.vercel.app/ ）を「Camellia」とします。

**オーナーの決定（2026-10-04）**

- Camellia は**独自アプリ**。SchoolPark / Emu の左上タブからは切り替えさせない。
  ブランドの切り替えからは削除済みで、**戻す予定はない**。
- **利用規約・同意画面は作らない。**
- 繋ぐのは**管理画面だけ**。入力されたデータが即時に管理画面へ出ればよい。

ただし**全部は消していません**。消していないものが、新しい Camellia に
いくつか条件を出します。この文書はその条件をまとめたものです。

- リポジトリ: `Wertask11/emu-realtime`
- 本番: https://schoolpark-emu.vercel.app/ （Vercel・静的）
- サーバー: https://emu-realtime.onrender.com （Render・Express）
- Firebase プロジェクト: `emusch-2a111`
- このコミット: `b811642`（ブランチ `claude/loving-hamilton-3xb95f`）

---

## 1. 消したもの

| 消したもの | 何だったか |
|---|---|
| `frontend/public/camellia/control-user.html` | 利用者の画面本体 |
| 同フォルダの JS 15本 | `camellia-auth.js` `camellia-gate.js` `camellia-store.js` `camellia-nudge.js` `camellia-community.js` `camellia-sidebar.js` `camellia-composer.js` `camellia-model.js` `camellia-reply.js` `camellia-home.js` `control-enhance.js` `managed-settings.js` `home-calendar.js` `restore-location.js` `user-db-sync.js` |
| `backend/camellia.js` | `/api/camellia/models` と `/api/camellia/chat`（Anthropic API を叩く対話窓口）。呼んでいたのは上の画面だけ |
| ブランド切り替えの Camellia 行 | `index.html`（Emuのサイドバー・スマホのメニュー・`CHES_BRAND_PAGES`・`BRAND_MAINTENANCE`・`BRAND_LABELS`・`chesHubGo`・`chesMenuGo`）と `schoolpark/dao.html`（SchoolParkの左上） |

コードは git の履歴に残っています。例:
`git show b811642^:frontend/public/camellia/control-user.html`

---

## 2. 消していないもの（＝新しい Camellia が従う相手）

### 2-1. 入った方の記録（Firestore）

**1件も消していません。** 構造は次のとおりです。

```
camellia_users/{uid}                        ← uid は Firebase Auth の uid。パスポート番号ではない
  uid, passport, birthDate, ageAtSignup,
  agreedAt, agreedVersion, updatedAt,
  camelliaId, camelliaIdIssuedBy, camelliaIdIssuedAt

camellia_users/{uid}/daily/{YYYY-MM-DD}     ← 文書IDが日付。同じ日は上書き
  mood, sleep, sleepQuality, need, anxiety, stress, loneliness,
  motivation, irritability, concentration, mindNote,
  painPlace, temperature, appetite, cycle, lastMenstrualDate,
  pain, fatigue, energy, symptoms, medication, bodyNote,
  date, savedAt, updatedAt

camellia_users/{uid}/profile/basic          ← displayName, birthYear, occupation, goal
camellia_users/{uid}/profile/settings       ← saveData, allowLocation, useImported, externalLlm, aiModel
camellia_users/{uid}/profile/location       ← latitude, longitude, accuracy, at
camellia_users/{uid}/profile/chat           ← { messages: [{role,text,at}], total }
camellia_users/{uid}/profile/personality    ← bigFive{}, enneagram{type,scores}, yg, mbti, animal
camellia_users/{uid}/profile/control        ← 管理画面の模型の状態
camellia_users/{uid}/profile/activity       ← { events: [{kind, at, page?}], total }
camellia_users/{uid}/imports/{type}         ← name, characters, importedAt, content, truncated

camellia_users/{uid}/admin/control          ← 運営が入れた7つの機構。本人は読めるが書けない
camellia_users/{uid}/admin/replies/items/{id} ← 運営が手で書いた返事 { text, by, createdAt }

camellia_community/{postId}                 ← uid, name, text(500字まで), createdAt
camellia_reports/{reportId}                 ← by, postId, reason(300字まで), createdAt
camellia_admin/rules                        ← threshold, changedBy, changedAt
```

`profile/activity` の `kind` は `open`（画面を開いた）・`nudge-shown`・
`nudge-click`・`community-post` の4つです。サーバーがここから
反応率・継続率・抵抗値を数えます（後述 2-3）。

### 2-2. 権限のルール（`firestore.rules`）

**そのままにしてあります。**（オーナーが Firebase コンソールに手で貼る運用です）

| パス | 読み | 書き |
|---|---|---|
| `camellia_users/{uid}` | 本人だけ | 本人だけ。`birthDate` と `agreedAt` が文字列であること。`camelliaId` は**一度決まったら変えられない** |
| `camellia_users/{uid}/{kind}/{docId}` | 本人だけ | 本人だけ（`kind != 'admin'`） |
| `camellia_users/{uid}/admin/**` | 本人は読める | **誰も書けない**（Admin SDK だけ） |
| `camellia_community/{postId}` | Camellia に入った人だけ | 自分名義の新規だけ。更新は不可。削除は本人と運営 |
| `camellia_reports/{reportId}` | **誰も読めない** | 自分名義の新規だけ |

「Camellia に入った人」の判定は
`exists(/databases/$(database)/documents/camellia_users/$(request.auth.uid))` です。
つまり**新しい Camellia も `camellia_users/{uid}` を作らないと、
コミュニティが読めません。**

### 2-3. 管理画面（残すと決めたもの）

ファイルは `frontend/public/camellia/` に9本残っています。

```
control-admin.html            ← 運営画面の枠の中に出る「管理センター」
control-admin-previous.html   ← ひとつ前の画面（7つの機構・従順スコアの模型）
camellia-admin-bridge.js      ← 外側から本物の利用者を受け取る postMessage の口
admin-enhance.js / admin-settings.js / admin-calendar.js / admin-menstrual.js
personality-charts.js / daily-history-admin.js
```

入口は運営専用の `frontend/public/membership-admin.html` の **Camellia タブ**です。
そこから次を呼びます（すべて `requireOwner`＝運営のウォレットのみ）。

| 窓口 | 何をするか |
|---|---|
| `GET /api/billing/admin/camellia` | 入った方の一覧。記録・設定・会話・取込・行動を全部返す |
| `POST /api/billing/admin/camellia/control` | 7つの機構の入り切りを `admin/control` に書く |
| `POST /api/billing/admin/camellia/issue-ids` | Camellia ID をまとめて発行（`?dry=1` で下見） |
| `POST /api/billing/admin/camellia/reply` | 運営が手で返事を書く → `admin/replies/items` |
| `GET /api/billing/admin/camellia/reports` | 通報の一覧（利用者からは読めないので唯一の行き先） |
| `POST /api/billing/admin/camellia/post/delete` | 通報された投稿を消す |
| `GET/POST /api/billing/admin/camellia/rules` | 従順判定の基準（`camellia_admin/rules`） |

一覧 API は、上の記録をそのまま返すほかに `assessment` を計算して返します。

```
responseRate = nudge-click ÷ nudge-shown        （誘導を出して押した割合）
keepRate     = 直近14日のうち記録した日数 ÷ 14
deviation    = 直近の anxiety/stress/loneliness が過去14日平均からどれだけ離れたか
support      = community-post の回数 × 10（100上限）
follow       = responseRate × 0.6 + keepRate × 0.4
resistance   = 100 − follow
```

---

## 3. 新しい Camellia に出る条件

### 必須

1. **ログインは SchoolPark パスポートを使うこと。**
   Firebase Auth（プロジェクト `emusch-2a111`）の同じセッションです。
   Camellia 専用の登録画面を作らないでください。パスポート番号は
   `ches_accounts/{uid}.chesAddress`（無ければ `.walletAddress`）にあります。

2. **`camellia_users/{uid}` を作ること。** 文書IDは **Firebase の uid** です
   （パスポート番号ではありません。人に見せる番号を鍵にすると狙われるため）。

   **訂正（2026-10-04）**：以前ここに「`birthDate` と `agreedAt` を文字列で
   入れないとルールに弾かれる」と書いていましたが、**誤りでした。**
   ルールは `request.resource.data.get('birthDate','')` という書き方で、
   欄が無ければ `''` が返り `'' is string` は真になります。
   **無くて構いません。** 非文字列（Timestamp や数値）で入れたときだけ弾かれます。

3. ~~**対象は 18〜45歳。**~~ 同意も生年月日も取らない方針になったので、
   入口での年齢判定は行いません。`backend/billing.js` と
   `membership-admin.html` の `MIN_AGE`/`MAX_AGE` は、
   管理画面が年齢を表示するときの目安として残っています。
   `birthDate` を入れないかぎり「不明」と出ます（それが期待どおりです）。

4. ~~**入口の同意文**~~ オーナーの決定により、**同意は取りません。**
   `agreedAt` は書きません。管理画面には「同意なし」と出ます（期待どおり）。
   既存の方の `agreedAt` / `agreedVersion` はそのまま残っています。

5. **Camellia ID を自分で作らないこと。**
   形は `CAM-XXXX-XXXX-XXXX`（`23456789ABCDEFGHJKLMNPQRSTUVWXYZ`、
   読み違えやすい `0 O 1 I` は使わない）。
   画面側の発行処理は消したので、**いま作れるのは
   `POST /api/billing/admin/camellia/issue-ids` だけ**です。
   ルール上も、一度入った `camelliaId` は書き換えられません。

### 管理画面を生かしたままにするなら

6. 上の 2-1 の**置き場所と欄の名前をそのまま使ってください。**
   変えると管理画面に何も出なくなります（一覧 API が読む場所が決め打ちのため）。

7. 行動の記録（`profile/activity`）の `kind` を
   `open` / `nudge-shown` / `nudge-click` / `community-post` のまま使ってください。
   変えると `assessment` が全部 0 か null になります。

8. **`admin/` 以下には書かないでください。** ルールで書き込み禁止です。
   運営が入れた機構（`admin/control`）を読んで画面に効かせるのは自由です。

### 切り替えに戻すとき（いまは行いません）

**オーナーの決定により、Camellia をブランドの切り替えに戻すことはしません。**
以下は、将来もし方針が変わったときのための手順です。


`frontend/public/index.html` の `CHES_BRAND_PAGES` に1行足すだけです。

```js
const CHES_BRAND_PAGES = {
  camellia: { url: '<新しいCamelliaのURL>', name: 'Camellia', color: '#e0576f',
              bg: '#fff6f2', ownNav: true },
  heartoo:  { url: 'https://school-park-homepage.vercel.app/Heartoo.html', ... }
};
```

`ownNav: true` は「そのページが自前のサイドバーを持っているので、
枠の戻るバーを出さない」という意味です。自前のサイドバーが無いなら外してください。

あわせて次も戻す必要があります（消した場所と同じです）。

- `BRAND_LABELS` に `camellia:'Camellia'`
- `chesHubGo` と `chesMenuGo` の `case 'camellia':`
- Emuのサイドバーの行 / スマホのメニューの行 / `openSpMobileMenu` の並び
- `schoolpark/dao.html` の `brands:` の並び
- 準備中にしたいなら `BRAND_MAINTENANCE` に `camellia: true`

試験 `tools/guild-tests/brand-gate.test.cjs` が「Camellia が切り替えに無いこと」を
固定しているので、戻すときはそこも書き直してください。

---

## 4. 引き継ぎ前に直したほうがよい3点（調べて確認済み）

### ① `camellia_admin` がルールの受け皿に落ちている

`firestore.rules` のいちばん下に、除外リストに無いコレクションを
**誰でも（ログインしていなくても）読み書きできる**包括許可があります。

```
match /{coll}/{document=**} {
  allow read, write: if coll != 'sp_members' && ... && coll != 'camellia_reports';
}
```

`camellia_users` / `camellia_community` / `camellia_reports` は除外されていますが、
**`camellia_admin` は入っていません。** つまり従順判定の基準
（`camellia_admin/rules.threshold`）は外から書き換えられます。
影響は管理画面の模型の表示だけですが、開いたままです。

直すなら、除外リストに `&& coll != 'camellia_admin'` を足すだけです。
（ルールはオーナーが手でコンソールに貼る運用なので、こちらでは触っていません）

### ② 7つの機構の名前が、画面とサーバーで食い違っている

| | 名前 |
|---|---|
| 管理画面（`control-admin-previous.html` の `defs`） | observe, interpret, nudge, depend, sanction, isolate, **rules** |
| サーバー（`billing.js` の `allowed`） | observe, interpret, nudge, depend, sanction, **reward**, isolate |

`rules`（規則変更）は**サーバーが受け取らずに捨てています。**
画面でチェックを入れても保存されません。逆に `reward` は受け取る用意が
あるのに、画面から送られてきません。

### ③ 利用規約・特商法に Camellia が1文字も無い（オーナーは作らない方針）

`frontend/public/terms.html` / `tokushoho.html` / `privacy.html` を調べましたが、
**Camellia の記載はゼロ**でした（grep で0件）。
コードのコメントには「特商法・利用規約の記載と必ず同じにすること」と
書いてあるのに、合わせる先が存在しない状態です。

オーナーは「利用規約は要らない・同意も取らない」と決めています。
事実として記録しておくと、Camellia が扱う気分・睡眠・ストレス・月経は
個人情報保護法でいう**要配慮個人情報**にあたり、同法は取得にあたって
あらかじめ本人の同意を得ることを求めています（法20条2項）。
**判断はオーナーのものです。** ここでは、その前提で作っていることだけ
記録しておきます。

---

## 5. 画面まわりで知っておくとよいこと

- **枠の中で開かれます。** ブランド切り替えから入ると、Emu（`index.html`）の
  中の `<iframe id="cbfFrame">` に出ます。同一オリジンです。
- 枠の中から親を呼べます。消した画面は
  `window.parent.openSpPassport()`（パスポートを開く）、
  `window.parent.chesHubGo(brand)`（ブランドを移る）、
  `window.parent.chesBrandFrameClose()`（枠を閉じる）を使っていました。
  これらは親側に残っています。
- `window.parent.camelliaSideState(open)` は**消しました**
  （お問い合わせの丸ボタンの出し入れ用）。必要なら戻します。
- `maintenance-guard.js` は「運営の4アドレス以外を全部はじく」仕組みです。
  いまは `MAINTENANCE = false` で素通りします。各ページに残してあります。

---

## 6. いまの状態（まとめ）

```
SchoolPark・Emu の中の Camellia  なし（切り替えから削除。戻さない）
Camellia 本体                   独自アプリ https://camellia-beta.vercel.app/
案内の文                        「独立したアプリ（この中からは行けません）」
入った方の記録              そのまま（1件も消していない）
権限のルール                そのまま
管理画面                    そのまま動く（membership-admin.html の Camellia タブ）
管理用の窓口                7つともそのまま
Camellia ID の発行          管理画面の「まとめて発行する」だけ
パスポートの Camellia ID 表示 残してある
```
