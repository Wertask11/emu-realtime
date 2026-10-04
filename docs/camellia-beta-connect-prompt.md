# 依頼：Camellia β の入力データを、SchoolPark の管理画面に即時反映させる

あなたは `Wertask11/camellia-beta`（https://camellia-beta.vercel.app/ ）を
担当しています。いまこのアプリのデータは **ブラウザの localStorage
（キー `camellia-prototype-v3`）にしか無く、認証もサーバーもありません**。

これを、別リポジトリ `Wertask11/emu-realtime` にある **SchoolPark の運営管理画面**
から即時に見られるようにしてください。管理画面側はすでに完成していて、
**そちらは一切変更しません。** β 側を管理画面の形に合わせます。

**管理画面はここです → https://schoolpark-emu.vercel.app/membership-admin.html**
（上のタブの「Camellia」を押すと、入った方の一覧が出ます）

この画面は**オーナーのウォレットでログインした人にしか開きません**
（サーバーが `OWNER_ONLY` を返します）。**あなたは開けません。**
反映できたかどうかの確認は、オーナーに頼んでください。

---

## 0. 結論（先に全体像）

```
Camellia β（ブラウザ）
  └ hooks/useCamelliaStore.ts の保存エフェクト    ← ここ1か所に差し込む
      ├ localStorage（いままでどおり。消さない）
      └ Firestore へ直接書く（新規）
            emusch-2a111 / camellia_users/{uid}/...
                                  ↑
              SchoolPark 管理画面が Admin SDK で読む（変更しない）
```

**サーバーは作りません。** ブラウザから Firestore に直接書きます。
権限のルールが「本人だけが自分の `camellia_users/{uid}` 以下を書ける」
という形で既に用意されているからです。書いた瞬間に管理画面から見えます。

---

## 1. 書き込み先（この形以外は管理画面に出ません）

Firebase プロジェクトは **`emusch-2a111`**（SchoolPark / Emu と同じ）。

```
camellia_users/{uid}                     ← {uid} は Firebase Auth の uid
  birthDate      "1998-04-12"   ← 必須。文字列。無いとルールに弾かれる
  agreedAt       ISO8601        ← 必須。文字列。同意した時刻
  agreedVersion  "2026-10-04"   ← 任意
  passport       "0x..."        ← ches_accounts/{uid}.chesAddress（無ければ .walletAddress）
  updatedAt      ISO8601
  ※ camelliaId は絶対に自分で書かない（後述 4-③）

camellia_users/{uid}/daily/{YYYY-MM-DD}  ← 文書IDは「日本時間」の日付
camellia_users/{uid}/profile/basic
camellia_users/{uid}/profile/settings
camellia_users/{uid}/profile/location
camellia_users/{uid}/profile/chat
camellia_users/{uid}/profile/personality
camellia_users/{uid}/profile/activity
camellia_users/{uid}/imports/{type}
```

### ★ 重要：`profile/` の下は、この7つの名前しか読まれません

管理画面の一覧APIは `profile` を全部読みますが、**返すのは
`basic` / `settings` / `location` / `chat` / `personality` / `control` / `activity`
の7つだけ**です。`profile/fortunes` のような名前で置くと、
読み取り回数だけ消費して画面には出ません。

β 独自のデータ（`fortunes` / `treeLeaves` / `insights` / `savedActions` など）は、
**`profile/basic` の中か、その日の `daily/{日付}` の中に入れてください。**
管理画面は**知らない欄もそのまま名前と値で表示します**（決め打ちではありません）。
なので好きな欄を足して構いません。

### `admin/` には絶対に書かないこと

`camellia_users/{uid}/admin/**` は**ルールで書き込み禁止**です
（運営がサーバーから書く場所）。読むのは自由です。
`admin/control` に運営が入れた7つの機構（observe / interpret / nudge /
depend / sanction / isolate）が入っています。

---

## 2. 差し込む場所（β 側）

### 2-1. 保存している唯一の場所

`hooks/useCamelliaStore.ts` の13行目、この `useEffect` です。

```ts
useEffect(()=>{
  if(ready) localStorage.setItem(STORAGE_KEY, JSON.stringify({...state, updatedAt:stamp()}))
},[state,ready]);
```

**ここに Firestore への書き出しを1行足すだけ**にしてください。
`state` が変わるたびに必ず通る、たった1つの経路です。
画面（`screens/*.tsx`）も `app/page.tsx` も触る必要がありません。

```ts
useEffect(()=>{
  if(!ready) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify({...state, updatedAt:stamp()}));
  syncToSchoolPark(state);          // ← 足すのはこれだけ
},[state,ready]);
```

### 2-2. 新しく作るファイル（4つ）

| ファイル | 役割 |
|---|---|
| `lib/schoolpark/firebase.ts` | Firebase の初期化と、ログイン状態の保持 |
| `lib/schoolpark/map.ts` | β の形 → 管理画面の形への変換（後述3） |
| `lib/schoolpark/sync.ts` | `syncToSchoolPark(state)`。差分だけ送る（後述5） |
| `components/PassportGate.tsx` | ログインしていない人に出す画面 |

### 2-3. 変える既存ファイル（2つ）

| ファイル | 変更 |
|---|---|
| `hooks/useCamelliaStore.ts` | 上の1行 |
| `app/page.tsx` | `if(!store.ready)` の直後に、未ログインなら `<PassportGate/>` を返す |

### Firebase の設定（公開してよい web 設定。すでに公開リポジトリに入っています）

```ts
const firebaseConfig = {
  apiKey: "AIzaSyBKHS1D8Or6gfMd4NbzhDI7dG5Je7BLtbs",
  authDomain: "schoolpark-emu.vercel.app",
  projectId: "emusch-2a111",
  storageBucket: "emusch-2a111.firebasestorage.app",
  messagingSenderId: "795496371585",
  appId: "1:795496371585:web:51deec91b8a2152e4c8480"
};
```

`npm i firebase` が要ります。

---

## 3. 変換表（β の形 → 管理画面の形）

### 3-1. `Checkin` → `daily/{YYYY-MM-DD}`

β が持っている欄は5つだけで、管理画面は22欄を知っています。
**持っていない欄は、0 を入れずに「書かない」でください。**
0 と「書いていない」の区別が付かなくなります（管理画面は未記録を未記録として出します）。

| β | → | `daily` の欄 | 変換 |
|---|---|---|---|
| `mood: 1..5` | → | `mood`（文字列） | `{1:'😢 とてもつらい',2:'😟 すこしつらい',3:'😶 ふつう',4:'🙂 よい',5:'😄 とてもよい'}` |
| `sleep: number` | → | `sleep` | そのまま（時間） |
| `stress: '低い'\|'普通'\|'やや高い'\|'高い'` | → | `stress: 0..10` | `{低い:2, 普通:5, やや高い:7, 高い:9}` |
| `body: '良い'\|'普通'\|'疲れ気味'\|'悪い'` | → | `fatigue: 0..10` | `{良い:2, 普通:4, 疲れ気味:7, 悪い:9}` |
| 〃 | → | `energy: 0..10` | `{良い:8, 普通:6, 疲れ気味:3, 悪い:1}` |
| `periodDays: number` | → | `cycle`（文字列） | `月経${periodDays}日目` |
| 〃 | → | `lastMenstrualDate` | `createdAt` から `periodDays` 日引いた日付 |
| `createdAt` | → | `savedAt` | そのまま |
| 〃 | → | `date` / 文書ID | **日本時間**の `YYYY-MM-DD` |

**書かない欄**（β が集めていない）:
`anxiety` `loneliness` `motivation` `irritability` `concentration`
`pain` `painPlace` `temperature` `appetite` `symptoms` `medication`
`sleepQuality` `need` `mindNote` `bodyNote`

日付は `lib/memory/engine.ts` の `jstParts()` がすでに日本時間で出しています。
**それを使い回してください**（`new Date().toISOString().slice(0,10)` は世界時なので、
朝9時より前の記録が前日になります）。

同じ日に複数回チェックインしたときは、**その日の最後のものを書いてください**
（文書IDが日付なので上書きになります）。

### 3-2. `Profile` → `profile/basic`

| β | → | 欄 |
|---|---|---|
| `name` | → | `displayName` |
| `lifestyle` | → | `occupation` |
| `priority` | → | `goal` |
| `age` | → | `birthYear`（文字列のままでよい） |
| `interests` / `availableMinutes` / `periodEnabled` | → | そのままの名前で足す（管理画面は知らない欄も出します） |

### 3-3. `AIConversation` → `profile/chat`

```ts
{ messages: conv.messages.map(m => ({ role: m.role, text: m.text, at: m.createdAt })),
  total: conv.messages.length }
```

`role` は `'user' | 'assistant'` のまま。管理画面は `user` を「ご本人」、
それ以外を「Camellia」と出します。**新しい200件まで**にしてください
（1文書1MB上限。日本語は1文字3バイト）。

### 3-4. `analyticsEvents` + `contextualMemory` → `profile/activity`

管理画面は `events[].kind` が次の4つのときだけ数えます。**名前を変えないでください。**

| 管理画面の `kind` | β の何を当てるか |
|---|---|
| `open` | `analyticsEvents` の `session_start` / `check_view` / `fortune_open` / `tree_open` → `{kind:'open', page:'today'\|'check'\|'fortune'\|'tree', at}` |
| `nudge-shown` | `contextualMemory` の `event==='proposed'` |
| `nudge-click` | `contextualMemory` の `event==='started'` |
| `community-post` | β に該当なし。**作らない**（`support` が 0 のままになるのが正しい） |

形は `{ events: [{kind, at, page?}], total }`。**300件まで**。

管理画面はここから次を計算します（だから名前が合っていないと全部 0 か空になります）。

```
responseRate = nudge-click ÷ nudge-shown
keepRate     = 直近14日のうち daily がある日数 ÷ 14
support      = community-post の回数 × 10
follow       = responseRate×0.6 + keepRate×0.4
resistance   = 100 − follow
```

### 3-5. `profile/settings`

β には該当する設定がありません。最低限これを入れてください。

```ts
{ saveData:true, allowLocation:false, useImported:false, externalLlm:false,
  aiModel:'camellia-beta-rule-based' }
```

### 3-6. 送らないもの

`insights` / `insightFeedback` / `savedActions` / `actionFeedback` は
管理画面に置き場所がありません。どうしても見たいなら
`profile/basic` の中に要約だけ入れてください（独立した文書にしても出ません）。

---

## 4. 先に決めないと進めない4点

### ① ログインをどうするか（これが最大の作業）

いまの β には認証がありません。`camellia_users/{uid}` に書くには
**Firebase Auth のセッションが要ります**（ルールが `request.auth.uid == uid`）。

**Firebase Auth のセッションはオリジンをまたぎません。**
`camellia-beta.vercel.app` と `schoolpark-emu.vercel.app` は別オリジンなので、
**SchoolPark でログイン済みでも、β 側では未ログインです。**

選べるのは2つです。

- **案A（おすすめ）: β を SchoolPark と同じオリジンに載せる。**
  `schoolpark-emu.vercel.app/camellia/` に Vercel の rewrite で出す。
  → 既存のログインがそのまま効く。ブランド切り替えの iframe にも戻せる。
  → 親の関数（`window.parent.openSpPassport()` など）も呼べる。
- **案B: ドメインはそのままにして、β 側で自分でログインさせる。**
  同じ Firebase プロジェクトなので、**同じアカウントなら uid も同じ**です。
  → **Firebase コンソール → Authentication → 設定 → 承認済みドメイン に
    `camellia-beta.vercel.app` を足す必要があります**（これが無いと必ず失敗します）。
  → ブランド切り替えに入れると iframe が別オリジンになり、親の関数は呼べません。

**どちらにするかをオーナーに確認してから進めてください。**

### ② 生年月日を集めていない

`camellia_users/{uid}` は **`birthDate` が文字列で入っていないとルールに弾かれて
1バイトも書けません。** いまの `OnboardingScreen.tsx` / `MyScreen.tsx` は
`age`（文字列）だけで、生年月日は集めていません（grep で0件）。

**オンボーディングに生年月日の入力を足してください。**
あわせて **18〜45歳の判定**が要ります（この数字は emu-realtime の
`backend/billing.js` と `membership-admin.html` に入っています。必ず同じに）。

### ③ Camellia ID を自分で作らない

形は `CAM-XXXX-XXXX-XXXX`（使う文字は `23456789ABCDEFGHJKLMNPQRSTUVWXYZ`。
`0 O 1 I` は使わない）。**いま発行できるのは運営の管理画面だけ**です。
ルール上も、一度入った `camelliaId` は書き換えられません。
**β からは読むだけ**にしてください。

### ④ 同意文

気分・睡眠・ストレス・月経は**要配慮個人情報**で、それを運営の管理画面に
出します。**入口の同意文に「運営が内容を確認することがあります」を
必ず入れてください。** これを書いていた旧 Camellia の入口画面は削除済みで、
いま同意の根拠が宙に浮いています。同意した時刻を `agreedAt` に入れてください。

---

## 5. 書き込み回数を抑える（これを外すと無料枠が飛びます）

この Firebase プロジェクトは **Spark（無料枠）で、1日20,000書き込み・
50,000読み取り**です。過去に読み取り枠を使い切った実績があります。

β の保存エフェクトは `state` が変わるたびに走ります。そのまま全部送ると、
1セッションで数百回書くことになります。**必ず次の2つを入れてください。**

1. **まとめ書き（debounce）** — 最後の変更から **1.5秒** 待ってから送る。
2. **差分だけ送る** — 文書ごとに「前に送った中身の指紋」を
   `localStorage`（例 `camellia-sync-sent`）に持ち、同じなら送らない。

旧実装は次の形でした（そのまま使って構いません）。

```ts
function fingerprint(s: string) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36) + ':' + s.length;
}
// path ごとに fingerprint を控えて、変わったものだけ setDoc(..., {merge:true})
```

さらに:

- `daily` は**変わった日だけ**（全日を毎回送らない）。
- 送れなかったときは指紋を控えないこと（次に必ずやり直せるように）。
- `pagehide` のときに、待っているぶんを送り切ること。

---

## 6. できたことの確かめ方

1. β でログインしてチェックインを1件保存する。
2. 2秒以内に Firestore コンソールで
   `camellia_users/{自分のuid}/daily/{今日の日本時間の日付}` ができていること。
3. **オーナーに** https://schoolpark-emu.vercel.app/membership-admin.html を開いてもらい、
   上のタブの **Camellia** を押して、自分の行を開いて「日々の記録」に出ていること。
   （この画面はオーナー専用です。あなたは開けません）
4. 「プロフィール」「設定」「Camellia AI との会話」「行動」にも出ていること。
5. 年齢が「不明」になっていないこと（＝`birthDate` が入っている）。
6. 同じ内容でもう一度保存して、**Firestore の書き込みが増えないこと**（＝差分判定が効いている）。

---

## 7. やってはいけないこと

- `emu-realtime` 側のコードを変えること（管理画面もルールもAPIも完成しています）
- `camellia_users/{uid}/admin/**` に書くこと（ルールで禁止）
- `camelliaId` を自分で作る・書き換えること
- 既存の `camellia_users` の記録を消す・上書きで壊すこと
- `profile/` の7つ以外の名前で文書を作って「出るはず」と思うこと
- 未記録の欄に 0 を入れること
- localStorage をやめること（オフラインで書けなくなります。**両方に書く**のが正解）

---

## 参考：管理画面が叩いている窓口（変更不要・確認用）

すべて `requireOwner`（運営のウォレットのみ）。β からは呼びません。

```
GET  /api/billing/admin/camellia              入った方の一覧（記録を全部返す）
POST /api/billing/admin/camellia/control      7つの機構の入り切り
POST /api/billing/admin/camellia/issue-ids    Camellia ID をまとめて発行
POST /api/billing/admin/camellia/reply        運営が手で返事を書く
GET  /api/billing/admin/camellia/reports      通報の一覧
POST /api/billing/admin/camellia/post/delete  投稿を消す
GET/POST /api/billing/admin/camellia/rules    判定基準
```

サーバーは https://emu-realtime.onrender.com （Render・Express）です。
