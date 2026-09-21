# SchoolPark ID（Passport ID）

「この人は誰か」を表す、一人にひとつの固定の番号。
LINE・Google・メール・ウォレットは、その番号へ入るための**入口**にすぎない。

```
SchoolPark ID （変わらない・一人に一つ）
  ├─ ログイン方法（LINE / Google / メール / ウォレット）
  ├─ 連携ウォレット（署名で所有を確かめたもの）
  ├─ 名義（walletAddress / chesAddress）← 既存データはここにぶら下がっている
  ├─ 公式パス保有情報
  ├─ Membership（Emu light / plus / pro）
  ├─ Passport（Humanity / KYC / World ID / 資格）
  ├─ ギルド・Quest・投稿・知恵・議論・貢献履歴・星空
  ├─ EMUER
  └─ 今後のリアルイベント参加・報酬・資格・実績
```

---

## 1. 変更前に何が起きていたか（調査結果）

### 1-1. chesAddress は Firebase UID から作られている

```js
// frontend/public/index.html  CHES.deriveWalletAddress
// backend/server.js           _deriveChesAddress
keccak256("ches-wallet:v1:" + uid) の下位20バイト → チェックサム付きアドレス
```

uid はログイン方法ごとに別物になる。

| ログイン方法 | Firebase UID | walletAddress | chesAddress |
|---|---|---|---|
| Google | Firebase が発行する uid | ＝ chesAddress | uid から導出 |
| メール | Firebase が発行する uid | ＝ chesAddress | uid から導出 |
| LINE | `line:<LINEユーザーID>` | ＝ chesAddress | uid から導出 |
| ウォレット | `wallet:<小文字アドレス>` | 署名で確認した実アドレス | uid から導出（実アドレスとは別物） |

### 1-2. 調査した5つの問いへの答え

| 問い | 答え |
|---|---|
| 1. 一人につき Passport ID は一つだけか | **いいえ。** ログイン方法ごとに `ches_accounts/{uid}` が作られ、番号も別になる |
| 2. ログイン方法を変えても同じ Passport へ入れるか | **いいえ。** 別 uid → 別 chesAddress → 別 Passport・別データ |
| 3. 公式パス情報がログイン方法をまたいで維持されるか | **いいえ。** `paid_users` はアドレスが鍵。LINE で入った人の導出アドレスは載っていない |
| 4. 同一人物の重複アカウントが存在し得るか | **はい。** LINE＋Google＋ウォレットで最大3つ |
| 5. Passport に表示していた値は何か | `chesAddress`（uid から導出した 0x… の擬似アドレス）。ウォレットでも Firebase UID でもないが、**ログイン方法ごとに変わる値** |

### 1-3. 既存データ内に、ログイン方法をまたぐ本人紐付け情報はあったか

**無い。** 調べた範囲では、

- `ches_accounts/{uid}` … uid（＝ログイン方法）が鍵。人ではない
- `ches_wallets/{address}` … アドレス → uid の逆引き。create のみ許可（重複防止はここが担っていた）
- `user_profiles/{address}` … 表示名。アドレスが鍵
- `paid_users/{address}` … 公式パス。アドレスが鍵
- `subscriptions/{uid}` `entitlements/{uid}` `plan_usage/{uid}_…` … uid が鍵
- `membership_grants` … **存在しない**（付与は `entitlements` コレクション）

いずれも「人」ではなく「ログイン方法」か「アドレス」に紐づいていた。

---

## 2. 採用した設計

### 2-1. SchoolPark ID の形式

```
SP-XXXX-XXXX-XXXX-XXXX
```

- 文字集合は Crockford Base32（`0-9 A-Z` から `I L O U` を除く32文字）。`1/I`・`0/O` を読み違えない
- 16文字 ＝ **80ビットの乱数**。順に試して他人の番号に当てること（列挙）はできない
- メールアドレス・LINE ID・Firebase UID・ウォレットアドレスを**一切含まない**。番号から素性もログイン方法も分からない
- 一度決まったら変わらない

### 2-2. 発行場所

**サーバーのみ**（`backend/identity.js` → `POST /api/identity/resolve`）。
ブラウザは受け取って表示するだけ。`localStorage` の値は本人判定に一切使わない。

### 2-3. DB 構造（新規4コレクション + 既存1フィールド）

| コレクション | 文書ID | 中身 | 書き手 |
|---|---|---|---|
| `sp_identities` | `SP-…` | `spid, status, primaryUid, links[], addresses[], createdAt, updatedAt` | サーバーのみ |
| `sp_auth_links` | `fb:<uid>` / `wallet:<小文字アドレス>` | `linkId, kind, provider, subject, spid, linkedAt` | サーバーのみ |
| `sp_link_tickets` | ランダム48桁 | `spid, issuedForUid, expiresAt, usedAt` | サーバーのみ |
| `sp_identity_duplicates` | ハッシュ | `spid, otherSpid, reason, status:"pending_review"` | サーバーのみ |
| `sp_identity_audit` | 自動 | 発行・連携・拒否の記録 | サーバーのみ |
| `ches_accounts/{uid}` | 既存 | **`spid` を1つ足すだけ**（他は一切触らない） | サーバーのみ |

**「一人一つ」を担保しているのは `sp_auth_links` の文書IDの一意性。**
`ches_wallets` と同じ考え方で、`transaction.create()` は既にある文書に対して必ず失敗する。
同時に何本リクエストが来ても、ひとつの認証情報に番号が2つ生まれることはない。

### 2-4. 紐付け方法

| 対象 | どう結び付けるか |
|---|---|
| Firebase UID | `sp_auth_links/fb:<uid>` を、検証済み ID トークンの uid から作る |
| LINE | Firebase custom token（`line:<sub>`）→ 上と同じ経路。LINE の ID トークンはバックエンドが LINE に問い合わせて検証済み |
| Google | Firebase Auth ネイティブの認証結果 → 上と同じ経路 |
| ウォレット | `personal_sign`（EIP-191）で所有を確認 → `sp_auth_links/wallet:<addr>` |
| 公式パス | `sp_identities.addresses[]`（連携済みの全名義）で `paid_users` を引く |

**名前・表示名・メールアドレスの一致では、絶対に結び付けない。**

---

## 3. 画面の流れ

```
SchoolParkロゴ画面
  ↓
ログイン／アカウント作成（LINE / Google / メール / ウォレット）
  ↓
Firebase Auth で認証
  ↓
ches_accounts を用意（既存の CHES フロー。変更なし）
  ↓
連携の途中なら → POST /api/identity/link/complete（既存の番号へ足す）   ★resolve より先
  ↓
POST /api/identity/resolve → 既存の SchoolPark ID を解決（無ければ一度だけ発行）
  ↓
SchoolParkメイン画面
```

`resolve` より先に `link/complete` を通すのが要。
逆にすると、足そうとしたログイン方法に新しい番号が先に発行されてしまい、
そのあとの連携が「すでに別の番号のもの」として断られる。

### 追加ログイン方法の紐付け（Passport から）

新しい設定画面は作らない。**Passport の1ページ目**に統合してある。

```
Passport PAGE 1 · IDENTITY
  SCHOOLPARK ID        SP-XXXX-XXXX-XXXX-XXXX   [番号をコピー]
  …
  連携ログイン方法      LINE  Google
  連携ウォレット        連携済み 0x3333…3333
  [LINEを追加] [Googleを追加] [ウォレットを連携]
```

1. `POST /api/identity/link/ticket` … いまの番号へログイン済みでないと券は出ない（10分・1回きり）
2. 新しい方法で正式に認証する
3. `POST /api/identity/link/complete` … 新しい方法の **ID トークン** ＋ 券

---

## 4. 公式パスと先行公開の判定

```
SchoolPark ID
  → 連携済みの名義（walletAddress / chesAddress / 連携ウォレット）
  → paid_users に載っている
  → 公式パス保有 → Emu plus 相当
  → 2026-09-21 00:00 JST から SchoolPark へ入場可能
```

判定は `GET /api/schoolpark/entry-status`（**サーバー時刻**。ブラウザの時計は使わない）。

```js
hasOfficialPass = 旧判定(uid の walletAddress / chesAddress を paid_users で引く)
              || 新判定(SchoolPark ID の addresses[] を paid_users で引く)
```

**OR なので、これまで通っていた人が通らなくなることはない。**
互換用に残したもの（すべて現役）:

- `paid_users` の直読み（小文字・チェックサム表記の両方）
- `walletAddress` / `chesAddress` による判定
- `entitlements`（付与）／ `subscriptions`（Stripe）
- Firestore Rules の `hasPass()` / `canAccessSchoolPark()`
- 画面側の `window.hasPaidNFT`

ウォレットを**いま繋いでいなくても**、正式に連携済みなら判定できる。

---

## 5. 既存ユーザーの移行

### 方針

1. 既存 `ches_accounts` を調べる
2. その Passport を基準に、固定の SchoolPark ID を割り当てる
3. 現在の Firebase UID をその番号へ紐付ける（`sp_auth_links/fb:<uid>`）
4. `walletAddress` と `chesAddress` は**別名義としてそのまま保持**（書き換えない）
5. `paid_users` の公式パス情報を、名義経由で番号に関連付ける
6. 旧判定は互換フォールバックとして全部残す
7. `sp_identity_audit` で後から追えるようにする

### 削除・リセットは一切しない

移行が足すのは `ches_accounts/{uid}.spid` の1フィールドだけ。
`walletAddress` `chesAddress` `membership` `createdAt` も、
投稿・Quest・ギルド・星空・EMUER・公式パス・Membership も**触らない**。
（`backend/identity.test.js` の「11. 既存の名義を書き換えない」で確認している）

### 冪等性

何度実行しても番号は増えない。判定順は

1. `sp_auth_links/fb:<uid>` があればそれ
2. `ches_accounts/{uid}.spid` があればそれ（途中で落ちた分の拾い直し）
3. uid が `wallet:0x…` で、そのアドレスが既に連携済みならその番号
4. どれも無ければ、そのときだけ新規発行

### 実行方法（**まだ実行していない**）

```bash
# ① まず空打ち。何件になるかだけを見る。書き込みはしない。
curl -X POST "https://emu-realtime.onrender.com/api/identity/admin/backfill" \
     -H "Authorization: Bearer <運営のFirebase IDトークン>"

# ② 件数を確認してから、実行する
curl -X POST "https://emu-realtime.onrender.com/api/identity/admin/backfill?dry=0" \
     -H "Authorization: Bearer <運営のFirebase IDトークン>"
```

**そもそも一括移行は必須ではない。** ログインした人から順に、
`/api/identity/resolve` が一度だけ発行する（自然移行）。
一括移行は「ログインしていない人にも先に番号を配りたい」場合だけ。

### バックアップ・復旧

- 一括移行の前に Firestore のエクスポート（`gcloud firestore export`）を取ること
- 書き込む先は `sp_identities` / `sp_auth_links` / `sp_identity_audit`（すべて新規）と
  `ches_accounts.spid`（新規フィールド）だけ
- 取り消したい場合は、新規3コレクションを削除し、`ches_accounts` の `spid` フィールドを消せば
  変更前と完全に同じ状態に戻る（既存フィールドは一切変えていないため）

---

## 6. 重複 Passport の扱い

**自動統合しない。** 次の2つが異なりうるため、機械的に混ぜると取り返しがつかない。

EMUER 残高 / 投稿 / Quest / ギルド / 星空 / 公式パス / Membership / ウォレット / 実績 / Passport 情報

検出できる重複候補は2種類。どちらも `sp_identity_duplicates` に
`status: "pending_review"` で記録し、**会員管理画面に表示するだけ**。

| reason | いつ出るか |
|---|---|
| `auth-already-linked` | 追加しようとしたログイン方法が、すでに別の番号のものだった |
| `wallet-already-linked` | 連携しようとしたウォレットが、すでに別の番号のものだった |

### 統合機能について（未実装・要承認）

統合は今回実装していない。実装する場合に必要な検討事項:

- **影響範囲**: `posts` `post_good_impacts` `post_changes` `knowledge_*` `ichinichi_*`
  `sp_quests/*/commits` `sp_guild_members/*/joins` `sp_wisdom/*/cites` `sp_park/*/joins`
  `sp_votes/*/ballots` `sp_trust` `emuer_offchain` `emuer_offchain_ledger`
  `user_profiles` `entitlements` `subscriptions` `plan_usage` `camellia_users`
  — いずれも**アドレスを鍵にしている**ため、統合＝大量のドキュメントの書き換えになる
- **代案（推奨）**: データを動かさず、`sp_identities.addresses[]` に
  もう一方の名義を足して「別名義」として読ませる。書き換えが0件で済み、取り消せる
- どちらを採るにしても、**対象件数・影響範囲・復旧手順を先に報告してから**実行する

---

## 7. セキュリティ

| 守ること | どう守っているか |
|---|---|
| ID 発行はサーバー側 | `backend/identity.js` のみ。ブラウザには発行経路が無い |
| 認証済み UID から本人を解決 | `requireFirebaseUser` が ID トークンを検証してから uid を決める |
| localStorage を信用しない | 番号は毎回サーバーに聞く。localStorage は表示の控えのみ（しかも uid が一致しないと使わない） |
| ウォレット連携は署名確認 | `personal_sign` + サーバー発行の1回限り nonce。nonce は発行した本人しか使えない |
| 追加時は正式な認証結果を使う | `link/complete` は「足す側」の ID トークンを必須にする |
| 別人の Passport を横取りできない | 券は「いまの番号へログイン済み」でないと出ない。相手の認証情報が既に別番号なら 409 で拒否 |
| 一つの認証情報を複数 Passport へ紐付けない | `sp_auth_links` の文書ID一意性（`transaction.create`） |
| Passport ID の列挙攻撃を防ぐ | 80ビット乱数 ＋ `sp_auth_links` はクライアントから読めない ＋ `sp_identities` は本人と運営のみ |
| API の直接呼び出しでも権限確認 | 全エンドポイントが `requireFirebaseUser` / `requireOwner` を通る |
| Firestore Rules でも保護 | 下記 §8 |
| 運営者判定は維持 | `SP_OWNER_ADDRESSES` / `isOwnerAddr()` は一切変更していない |
| ブラウザ時計を使わない | 入場判定は `entry-status`（サーバー時刻）と Rules の `request.time` |
| 秘密鍵・認証コード・パスワードを要求しない | 署名のみ。手数料もかからない |

### 残っているリスク（正直に書く）

**券を第三者に渡す誘導（account-linking phishing）。**
攻撃者が自分の券を被害者に踏ませると、被害者の認証情報が攻撃者の番号に足される可能性がある。
現状の緩和策:

- 券は10分・1回きり
- 券を渡す前に、**追加先の SchoolPark ID を確認ダイアログに明示**している
- `sp_identity_audit` に全件記録している

さらに強めるなら、券を発行した端末でしか使えないようにする（端末バインド）ことが考えられる。
今回は入れていない。

---

## 8. Firestore Rules の変更内容

追加したのは5つの `match` と、汎用許可からの除外5行のみ。**既存のルールは1行も変えていない。**

```
match /sp_identities/{spid} {
  allow read: if signedIn()
    && (get(accountPath()).data.get('spid', '') == spid
        || isOwnerData(get(accountPath()).data));
  allow write: if false;                 // サーバー（Admin SDK）のみ
}
match /sp_auth_links/{linkId}        { allow read, write: if false; }  // 読めると列挙できる
match /sp_link_tickets/{ticketId}    { allow read, write: if false; }  // 読めると横取りできる
match /sp_identity_duplicates/{id}   { allow read: if isOwner(); allow write: if false; }
match /sp_identity_audit/{id}        { allow read: if isOwner(); allow write: if false; }
```

`match /{coll}/{document=**}` の除外リストにも5コレクションを追加（汎用許可へ漏らさないため）。

`tools/count-rule-access.js` の数値は変更前と**完全に同一**。
既存の書き込みパスに、参照回数の負担を一切足していない。

### 手動反映が必要

```bash
firebase deploy --only firestore:rules
```

**この反映をしないと**: 新しいコレクションが `match /{coll}/{document=**}` の
汎用許可（読み書き自由）に落ちる。サーバーは Admin SDK なので動くが、
`sp_auth_links` をブラウザから読めてしまい、番号の列挙と横取りが可能になる。
**コードのデプロイと同時か、それより先に反映すること。**

---

## 9. API 一覧

| メソッド | パス | 認証 | 用途 |
|---|---|---|---|
| GET/POST | `/api/identity/me` `/resolve` | ログイン必須 | 自分の番号を取る（無ければ一度だけ発行） |
| POST | `/api/identity/link/ticket` | ログイン必須 | 追加用の引換券（10分・1回きり） |
| POST | `/api/identity/link/complete` | 追加する側のログイン必須 | 券を使って既存の番号へ足す |
| GET | `/api/identity/link/wallet/nonce` | ログイン必須 | 署名する文言 |
| POST | `/api/identity/link/wallet` | ログイン必須 | 署名を検証してウォレットを連携 |
| GET | `/api/identity/admin/whois` | 運営のみ | 番号・uid・アドレスのどれからでも引く |
| GET | `/api/identity/admin/duplicates` | 運営のみ | 重複候補の一覧 |
| POST | `/api/identity/admin/backfill` | 運営のみ | 既存ユーザーへの割り当て（既定は空打ち） |

`GET /api/schoolpark/entry-status` に `schoolParkId` が増えた（既存フィールドは変更なし）。

---

## 10. 変更ファイル

| ファイル | 内容 |
|---|---|
| `backend/identity.js` | **新規**。番号の発行・解決・連携・公式パス判定・重複記録・移行 |
| `backend/identity-router.js` | **新規**。`/api/identity` の窓口 |
| `backend/identity.test.js` | **新規**。27件 |
| `backend/identity-router.test.js` | **新規**。8件（本物の署名で検証） |
| `backend/fake-firestore.js` | **新規**。取引の性質まで真似たテスト用 Firestore |
| `backend/server.js` | identity を作って entitlement に渡す／`/api/identity` を mount／`entry-status` に `schoolParkId` と番号ベースの公式パス判定を追加／ウォレットログイン時に番号を用意／`signInProvider` を identity に載せる |
| `backend/entitlement.js` | `holdsOfficialPass` に**番号ベースの判定を足す**（旧判定はそのまま。OR） |
| `firestore.rules` | 新規5コレクションのルール＋汎用許可からの除外 |
| `frontend/public/index.html` | `window.SPID` レイヤー／Passport に SchoolPark ID を表示／連携ログイン方法・連携ウォレットの表示と追加ボタン／ログイン時の解決と券の消費／ログアウト時の控え破棄 |
| `frontend/public/membership-admin.html` | 重複候補の一覧を会員管理に表示 |
| `frontend/public/schoolpark/fountain.html` | 公式パス判定でパスポート（番号ベースの結果）も見る |

---

## 11. 将来ここへぶら下げるもの

すべて `sp_identities/{spid}` を親にする。
新しい機能は「どのログイン方法で入ったか」を見ないこと。

SchoolPark Passport / 公式パス保有情報 / Emu light・plus・pro / ギルド所属 / Quest /
投稿・知恵・議論 / 貢献履歴 / 星空 / KYC / Humanity / World ID / ウォレット /
リアルイベント参加 / リアルイベント報酬 / EMUER / 今後追加される資格や実績
