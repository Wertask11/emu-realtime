# SchoolPark 専用ウォレット・決済・KYC 仕様書

| 項目 | 内容 |
|---|---|
| バージョン | 1.0 (Draft) |
| 作成日 | 2026-07-07 |
| 対象システム | SchoolPark (emu-realtime) |
| 関連コンポーネント | backend/server.js (Express + Firestore + ethers) / frontend/public/schoolpark/* / EMUERトークン (Polygon) |

---

## 1. 目的・スコープ

SchoolPark 内で完結して使用する**専用ウォレット(SchoolPark Wallet)**と、それを使った**決済(SchoolPark Pay)**の仕様を定義する。あわせて、**各ウォレットに 1:1 で紐付く KYC(本人確認)**と、運営が **KYC を専用画面で確認・審査できる管理コンソール(KYC Console)** の仕様を定義する。

### スコープに含むもの
- SchoolPark Wallet(パーク内残高 = SP EMUER)の開設・残高・入出金仕様
- SchoolPark 内コンテンツ(ショッピングモール、ホテル、映画館 等)での決済仕様
- ウォレット単位の KYC 紐付け・ティア・状態遷移・データ保持仕様
- KYC 専用確認画面(管理者用 KYC Console)と KYC 参照 API
- ユーザー自身が自分の KYC 状態を確認する UI(銀行ページ内)

### スコープに含まないもの
- 法定通貨(円/クレジットカード)決済 ※将来フェーズ
- EMUER トークンコントラクト自体の変更
- Emu 本体(SchoolPark 外)の決済

---

## 2. 前提(既存システム)

本仕様は既存実装を土台とし、破壊的変更を行わない。

| 既存要素 | 現状 | 本仕様での扱い |
|---|---|---|
| EMUER トークン | Polygon (chainId 137) 上の ERC-20。`EMUER_CONTRACT_ADDRESS` | オンチェーン残高(実EMUER)としてそのまま利用 |
| SP EMUER | west-bank.html に「SchoolPark EMUER(コンテンツ残高)」として表示済み | SchoolPark Wallet の内部残高として正式定義 |
| ウォレット接続 | MetaMask + EIP-712 署名(wallet-success-ui.js のエアドロ登録と同方式) | ウォレット開設・本人性確認に同じ署名方式を採用 |
| good/change → EMUER 変換 | west-bank.html(good 10pt = 1 EMUER / change 20pt = 3 EMUER) | SP EMUER への入金経路として仕様化 |
| ショッピング購入 | east-shopping.html → Firestore `sp_shopping_orders` | SchoolPark Pay の決済 API に置き換え |
| バックエンド | Express + Firestore + ethers(運営ウォレットで `addGoodBatch` 配布) | API 追加。運営ウォレットは出金(オンチェーン送金)にも使用 |

---

## 3. 用語定義

| 用語 | 定義 |
|---|---|
| EOA | ユーザーの外部ウォレットアドレス(MetaMask 等)。SchoolPark Wallet の主キー |
| SchoolPark Wallet | EOA と 1:1 で作成される SchoolPark 専用アカウント。SP EMUER 残高を保持 |
| SP EMUER | SchoolPark 内でのみ使えるオフチェーン内部残高。パーク内決済はすべて SP EMUER で行う |
| 実EMUER | Polygon オンチェーンの EMUER 残高 |
| 出金 (Withdraw) | SP EMUER → 実EMUER への変換(運営ウォレットからのオンチェーン送金) |
| KYC レコード | ウォレット 1 件に対して 1 件だけ存在する本人確認記録 |
| KYC ティア | Tier 0 / 1 / 2。ティアに応じて利用可能機能・限度額が変わる |
| KYC Console | 運営専用の KYC 確認・審査画面 |

---

## 4. 全体アーキテクチャ

```
[ユーザー(ブラウザ)]
  ├─ MetaMask (EOA / EIP-712 署名)
  ├─ schoolpark/*.html ── 決済UI (SchoolPark Pay ウィジェット)
  └─ west-bank.html ──── ウォレット/残高/KYC申請・自分のKYC状態確認
          │ HTTPS
          ▼
[backend/server.js (Express)]
  ├─ /wallet/*    ウォレット開設・残高・履歴
  ├─ /pay/*       決済・返金
  ├─ /kyc/*       KYC申請・状態照会(ユーザー用)
  └─ /admin/kyc/* KYC審査(管理者用・KYC Console 専用)
          │
          ├─ Firestore: sp_wallets / sp_wallet_ledger / sp_payments /
          │             sp_kyc_records / sp_kyc_audit_logs
          ├─ Cloud Storage: KYC書類画像(暗号化バケット・非公開)
          └─ ethers: 運営ウォレット → EMUERコントラクト(出金送金)

[管理者(オーナー)]
  └─ frontend/public/admin/kyc/index.html (KYC Console)
```

設計原則:
1. **パーク内決済はオフチェーン(SP EMUER)で完結**させ、ガス代・遅延・署名回数をゼロにする。
2. **オンチェーンに触れるのは入金(変換)と出金のみ**。出金は KYC 済みウォレットに限定する。
3. **KYC はウォレットアドレスを主キーに 1:1** で紐付け、どの画面・APIからも `walletAddress` だけで即引けるようにする。

---

## 5. SchoolPark Wallet 仕様

### 5.1 ウォレット開設

- ユーザーが MetaMask 接続後、EIP-712 署名(domain: `SchoolPark Wallet`, chainId 137)で開設意思を証明する。既存エアドロ登録(`wallet-success-ui.js`)と同じ方式。
- 署名検証に成功したら Firestore `sp_wallets/{walletAddress}` を作成する(アドレスは小文字正規化)。
- **1 EOA = 1 SchoolPark Wallet**。既存レコードがある場合は再開設不可(`ALREADY_EXISTS`)。
- 開設時の KYC は不要(Tier 0 で開設される)。

### 5.2 ウォレット状態

| 状態 | 説明 | 遷移 |
|---|---|---|
| `active` | 通常状態 | 開設時の初期値 |
| `frozen` | 凍結。決済・出金不可、残高照会のみ可 | 不正検知・KYC却下累積時に運営が設定 |
| `closed` | 解約。全操作不可 | ユーザー申請 or 運営判断。残高0が条件 |

### 5.3 残高モデル(二層)

| 残高 | 保管場所 | 用途 |
|---|---|---|
| SP EMUER | Firestore `sp_wallets.balance` | パーク内決済すべて |
| 実EMUER | Polygon オンチェーン | 外部利用・保有。パーク内決済には直接使わない |

- `balance` は**整数(EMUER の 100 分の 1 = セント単位)**で保持し、浮動小数演算を禁止する。表示時のみ小数変換。
- 残高を変更する処理はすべて Firestore **トランザクション**内で行い、同時に `sp_wallet_ledger` へ台帳エントリを 1 件追加する(残高と台帳の不整合を作らない)。

### 5.4 入金(SP EMUER が増える経路)

| 経路 | 内容 | KYC要件 |
|---|---|---|
| ポイント変換 | good 10pt = 1 EMUER / change 20pt = 3 EMUER(既存レート踏襲) | Tier 0 可 |
| 運営付与 | イベント報酬・ボーナス(既存 `/admin/bonus` 相当) | Tier 0 可 |
| デポジット(将来) | 実EMUER → SP EMUER のオンチェーン入金 | Tier 1 以上 |

### 5.5 出金(SP EMUER → 実EMUER)

- **Tier 2(KYC承認済み)のウォレットのみ**申請可能。
- フロー: 申請 → `sp_withdrawals` に `pending` で記録 → 運営ウォレットがオンチェーン送金(既存のバッチ処理と同様、日次バッチ可) → `completed` + txHash 記録。
- 申請時点で SP EMUER 残高から**即時に減算(ロック)**する。送金失敗時は自動で残高へ戻し `failed` とする。
- 限度額は §7.4 の KYC ティア別限度額に従う。

---

## 6. 決済仕様(SchoolPark Pay)

### 6.1 決済対象

ショッピングモール(east-shopping)、ホテル(east-hotel)、映画館(south-cinema)、グルメ街(east-gourmet)ほか、SchoolPark 内の全有料コンテンツ。各コンテンツは `merchantId`(例: `east-shopping`)として登録する。

### 6.2 決済フロー

```
コンテンツ(iframe)                backend                     Firestore
   │ 1. POST /pay/checkout ─────────▶│
   │    {walletAddress, merchantId,  │ 2. トランザクション:
   │     items[], totalAmount,       │    - wallet.status == active 確認
   │     idempotencyKey}             │    - KYCティア×限度額チェック
   │                                 │    - balance >= total 確認
   │                                 │    - balance 減算 + ledger 追記
   │                                 │    - sp_payments 作成 (completed)
   │ 3. {paymentId, status} ◀────────│
   │ 4. 完了UI表示・spActivityLog     │
```

- 決済は**同期・即時確定**(オフチェーンのため)。`pending` を挟む必要があるのは出金のみ。
- **冪等性**: クライアントは決済ごとに UUID の `idempotencyKey` を生成する。同一キーの再送には最初の結果をそのまま返す(二重課金防止)。
- 残高不足は `INSUFFICIENT_BALANCE`、限度額超過は `LIMIT_EXCEEDED`(必要ティアを応答に含め、KYC 申請導線を出す)。

### 6.3 決済ステータス

| 状態 | 説明 |
|---|---|
| `completed` | 決済確定(初期状態。オフチェーンのため即確定) |
| `refunded` | 全額返金済み |
| `partially_refunded` | 一部返金済み |

### 6.4 返金

- 運営のみ実行可(`POST /admin/pay/refund`)。ユーザーからはカスタマーサポート経由。
- 返金は元の `paymentId` に紐付け、SP EMUER を残高へ戻し、台帳に `refund` エントリを追加する。
- 返金可能期間: 決済から 30 日。

### 6.5 台帳 (`sp_wallet_ledger`)

すべての残高変動を追記型(append-only)で記録する。

| type | 意味 |
|---|---|
| `convert_in` | ポイント変換入金 |
| `grant` | 運営付与 |
| `payment` | 決済(減算) |
| `refund` | 返金(加算) |
| `withdraw_lock` | 出金申請ロック(減算) |
| `withdraw_revert` | 出金失敗戻し(加算) |

各エントリ: `{walletAddress, type, amount(符号付き), balanceAfter, refId(paymentId等), createdAt}`

---

## 7. KYC 仕様

### 7.1 基本方針 — ウォレットと 1:1 紐付け

- KYC レコードは **`sp_kyc_records/{walletAddress}`** に保存する。ドキュメント ID = ウォレットアドレス(小文字)とすることで、**ウォレットアドレスさえ分かれば KYC 状態を 1 read で確認できる**。
- 1 ウォレットに複数の KYC レコードは存在しない。再申請は同一ドキュメントの上書き + 履歴を `history[]` サブ配列(または監査ログ)に残す。
- 同一人物が複数ウォレットで KYC を申請することは Tier 2 では禁止(氏名+生年月日+書類番号のハッシュで重複検知し、審査画面に警告表示)。

### 7.2 KYC ティア

| ティア | 名称 | 必要情報 | 解放される機能 |
|---|---|---|---|
| Tier 0 | 未認証 | ウォレット署名のみ | ウォレット開設、ポイント変換、少額決済 |
| Tier 1 | 基本認証 | ニックネーム、メールアドレス(確認コード認証)、生年月日、居住国 | 通常決済、デポジット |
| Tier 2 | 本人確認済み | Tier 1 + 氏名(本名)、住所、本人確認書類画像(運転免許証/マイナンバーカード表面/パスポート)+ セルフィー | 出金、高額決済 |

### 7.3 KYC 状態遷移

```
 unsubmitted ──申請──▶ pending ──承認──▶ approved
     ▲                    │
     │                    ├──却下──▶ rejected ──再申請──▶ pending
     │                    │              │
     └────────────────────┘         3回却下で wallet.status = frozen 検討
                                    (運営判断・KYC Console から操作)
approved ──書類期限切れ/情報変更──▶ expired ──再申請──▶ pending
```

| 状態 | 説明 |
|---|---|
| `unsubmitted` | ウォレット開設直後(Tier 0) |
| `pending` | 申請済み・審査待ち |
| `approved` | 承認済み(`tier` フィールドが承認ティアを示す) |
| `rejected` | 却下(却下理由 `rejectReason` 必須) |
| `expired` | 書類有効期限切れ等による失効 |

### 7.4 KYC ティア別限度額

| 項目 | Tier 0 | Tier 1 | Tier 2 |
|---|---|---|---|
| 1回あたり決済上限 | 500 SP EMUER | 5,000 SP EMUER | 50,000 SP EMUER |
| 月間決済上限 | 2,000 SP EMUER | 20,000 SP EMUER | 200,000 SP EMUER |
| 出金 | 不可 | 不可 | 月 100,000 EMUER まで |

※金額は運用開始時にオーナーが `sp_config/limits` で変更可能とする。

### 7.5 KYC データの保管・保護

- 本人確認書類画像は Firestore に**保存しない**。非公開の Cloud Storage バケット(サーバーサイド暗号化)に置き、Firestore にはストレージパスのみ記録する。
- 画像への直接 URL は発行せず、KYC Console からの閲覧時のみ**有効期限 5 分の署名付き URL** をバックエンドが発行する。
- 個人情報フィールド(氏名・住所・生年月日)はアプリ層で暗号化(AES-256-GCM、鍵は環境変数 `KYC_ENC_KEY`)して保存する。
- 保持期間: 取引終了(ウォレット `closed`)から **7 年**(犯罪収益移転防止法の確認記録保存期間に準拠)。期間経過後に削除。
- 却下・失効したレコードの書類画像は 90 日で削除(再申請に不要なため)。

### 7.6 コンプライアンス留意点(法務部確認事項)

- SP EMUER の出金(暗号資産 EMUER への変換)は、設計次第で**資金決済法上の暗号資産交換業・前払式支払手段**への該当性論点がある。**出金機能の有効化前に法務部レビューを必須**とする(それまで出金 API はフィーチャーフラグ `WITHDRAW_ENABLED=false` で無効化)。
- Tier 2 の本人確認は当面は運営の目視審査とし、将来は eKYC ベンダー(TRUSTDOCK / LIQUID 等)接続を想定した `provider` フィールドを設けておく。

---

## 8. KYC Console(KYC 専用確認画面)仕様

**配置**: `frontend/public/admin/kyc/index.html`(既存 `admin/room1` と同じ配置規約)
**認証**: 管理者トークン(`ADMIN_KYC_TOKEN`、環境変数)。既存の owner 系 API と同方式の Bearer 認証。トークンなしでは API は一切データを返さない。

### 8.1 画面構成

#### ① 審査キュー(一覧)
- ステータスタブ: `審査待ち (pending)` / `承認済み` / `却下` / `全件`
- 各行: ウォレットアドレス(短縮表示)、申請ティア、申請日時、重複警告バッジ(§7.1)、経過時間
- 検索ボックス: **ウォレットアドレスを貼り付けると該当 KYC を即表示**(1:1 紐付けのため完全一致で 1 件に解決)
- 並び順: 申請日時の古い順(先入れ先出しで審査)

#### ② 審査詳細
- 左ペイン: 申請情報(復号済みの氏名・生年月日・住所・メール)、ウォレット情報(残高、開設日、決済回数、累計決済額、ウォレット状態)
- 右ペイン: 書類画像プレビュー(署名付きURL・5分期限)、セルフィー比較表示
- 操作:
  - `承認` → ティアを選択して approve(理由メモ任意)
  - `却下` → 却下理由(定型: 画像不鮮明 / 書類期限切れ / 情報不一致 / その他自由記述)必須
  - `ウォレット凍結` / `凍結解除`
- すべての操作は `sp_kyc_audit_logs` に記録(操作者・操作・対象・理由・タイムスタンプ)。**監査ログは削除・編集不可(append-only)**

#### ③ ダッシュボード
- 審査待ち件数 / 平均審査時間 / ティア別承認ウォレット数 / 直近30日の却下率

### 8.2 ユーザー側 KYC 確認 UI

- `west-bank.html` に「🪪 本人確認」タブを追加。自分のウォレットの現在ティア・KYC 状態・却下理由(却下時)・限度額を表示し、申請/再申請フォームへ誘導する。
- 決済時に限度額超過 (`LIMIT_EXCEEDED`) が出た場合、決済 UI から本人確認タブへ直接遷移できる導線を置く。

---

## 9. データモデル(Firestore)

### `sp_wallets/{walletAddress}`
```jsonc
{
  "walletAddress": "0xabc...",      // 小文字正規化。docId と同一
  "status": "active",               // active | frozen | closed
  "balance": 123450,                // SP EMUER セント単位(整数)
  "kycTier": 0,                     // 0 | 1 | 2 (approved 時のみ昇格。非正規化キャッシュ)
  "kycStatus": "unsubmitted",       // sp_kyc_records.status の非正規化コピー
  "monthlySpent": 4200,             // 当月決済累計(限度額判定用・月初リセット)
  "createdAt": Timestamp,
  "updatedAt": Timestamp
}
```

### `sp_kyc_records/{walletAddress}`
```jsonc
{
  "walletAddress": "0xabc...",
  "status": "pending",              // unsubmitted|pending|approved|rejected|expired
  "requestedTier": 2,
  "approvedTier": 0,
  "email": "enc:...",               // AES-256-GCM 暗号化
  "emailVerified": true,
  "fullName": "enc:...",
  "birthDate": "enc:...",
  "country": "JP",
  "address": "enc:...",
  "documents": [
    { "type": "drivers_license", "storagePath": "kyc/0xabc/doc1.jpg", "uploadedAt": Timestamp }
  ],
  "selfiePath": "kyc/0xabc/selfie.jpg",
  "dedupeHash": "sha256(...)",      // 氏名+生年月日+書類番号のハッシュ(重複検知用)
  "rejectReason": null,
  "rejectCount": 0,
  "provider": "manual",             // manual | trustdock | liquid (将来)
  "submittedAt": Timestamp,
  "reviewedAt": Timestamp,
  "reviewedBy": "owner",
  "expiresAt": Timestamp            // 書類有効期限
}
```

### `sp_payments/{paymentId}`
```jsonc
{
  "paymentId": "pay_...",           // ULID
  "walletAddress": "0xabc...",
  "merchantId": "east-shopping",
  "items": [{ "name": "...", "price": 1200, "qty": 1 }],
  "totalAmount": 1200,
  "status": "completed",            // completed | refunded | partially_refunded
  "refundedAmount": 0,
  "idempotencyKey": "uuid",
  "createdAt": Timestamp
}
```

### その他
- `sp_wallet_ledger/{autoId}` — §6.5 の台帳
- `sp_withdrawals/{withdrawId}` — 出金申請 (`pending|completed|failed`, `txHash`)
- `sp_kyc_audit_logs/{autoId}` — KYC Console 全操作の監査ログ(append-only)
- `sp_config/limits` — ティア別限度額(§7.4 の値。運営が変更可能)

インデックス: `sp_kyc_records` に `(status, submittedAt)`、`sp_payments` に `(walletAddress, createdAt)`、`sp_kyc_records` に `(dedupeHash)`。

---

## 10. API 一覧

すべて `backend/server.js` に追加。リクエスト検証(署名 or 管理者トークン)を必須とする。

### ユーザー系(ウォレット署名認証: EIP-712 / timestamp 5分以内)

| Method | Path | 説明 |
|---|---|---|
| POST | `/wallet/open` | ウォレット開設(署名検証) |
| GET | `/wallet/:address` | 残高・状態・kycTier・当月利用額(公開情報のみ) |
| GET | `/wallet/:address/ledger` | 台帳履歴(署名認証・本人のみ) |
| POST | `/pay/checkout` | 決済実行(冪等キー必須) |
| GET | `/pay/:paymentId` | 決済照会(本人のみ) |
| POST | `/kyc/submit` | KYC 申請/再申請(multipart: 書類画像) |
| GET | `/kyc/status/:address` | 自分の KYC 状態・ティア・限度額(本人のみ。書類画像は返さない) |
| POST | `/withdraw/request` | 出金申請(Tier 2 のみ / `WITHDRAW_ENABLED` 時のみ) |

### 管理者系(Bearer: `ADMIN_KYC_TOKEN`)

| Method | Path | 説明 |
|---|---|---|
| GET | `/admin/kyc/queue?status=pending` | 審査キュー一覧 |
| GET | `/admin/kyc/:address` | **ウォレット指定で KYC 詳細を即取得**(復号済み・書類署名URL付き) |
| POST | `/admin/kyc/:address/approve` | 承認(`{tier, memo}`) |
| POST | `/admin/kyc/:address/reject` | 却下(`{reason}` 必須) |
| POST | `/admin/wallet/:address/freeze` | 凍結 / 解除(`{frozen: bool, reason}`) |
| POST | `/admin/pay/refund` | 返金(`{paymentId, amount, reason}`) |
| GET | `/admin/kyc/audit-logs` | 監査ログ照会 |

### エラーコード(共通)

`ALREADY_EXISTS` / `WALLET_NOT_FOUND` / `WALLET_FROZEN` / `INSUFFICIENT_BALANCE` / `LIMIT_EXCEEDED`(+ `requiredTier`) / `KYC_REQUIRED` / `INVALID_SIGNATURE` / `DUPLICATE_IDEMPOTENCY_KEY`(=初回結果を返却) / `UNAUTHORIZED`

---

## 11. セキュリティ要件

1. **署名認証**: ユーザー系の書き込み API は EIP-712 署名 + timestamp(±5分)で検証。リプレイ防止のため署名済みリクエストの nonce(idempotencyKey)を記録する。
2. **残高整合性**: 残高変更は必ず Firestore トランザクション + 台帳追記。台帳合計と残高の定期照合バッチ(日次)を設ける。
3. **KYC データ**: §7.5 の暗号化・署名付きURL・保持期間を厳守。KYC Console 以外のいかなる API も復号済み個人情報を返さない。
4. **管理 API**: `ADMIN_KYC_TOKEN` は最低 32 バイトのランダム値。監査ログに操作者を記録。トークンはリポジトリにコミットしない。
5. **レート制限**: `/kyc/submit` はウォレットあたり 24 時間に 3 回まで。`/pay/checkout` はウォレットあたり毎分 10 回まで。
6. **画像アップロード**: 拡張子・MIME・サイズ(10MB)検証。EXIF は保存時に除去。

---

## 12. 非機能要件

| 項目 | 目標 |
|---|---|
| 決済応答時間 | p95 < 800ms(オフチェーンのため) |
| 可用性 | 既存 Render 構成に準拠。決済失敗時はユーザー残高を減らさない(トランザクション保証) |
| 監査 | 残高変動・KYC 操作の 100% を台帳/監査ログに記録 |
| KYC 審査 SLA | 申請から 72 時間以内に承認/却下(Console ダッシュボードで超過を可視化) |

---

## 13. 実装フェーズ計画

| フェーズ | 内容 | 依存 |
|---|---|---|
| Phase 1 | `sp_wallets` + `/wallet/*` + `/pay/checkout`(Tier 0 限度額のみ)。east-shopping の購入処理を SchoolPark Pay に接続 | なし |
| Phase 2 | KYC Tier 1(メール認証)+ `/kyc/*` + west-bank に本人確認タブ | Phase 1 |
| Phase 3 | KYC Tier 2(書類提出)+ **KYC Console**(`admin/kyc/`)+ 監査ログ | Phase 2 |
| Phase 4 | 出金(`/withdraw/*`)— **法務部レビュー完了が前提**(§7.6) | Phase 3 + 法務確認 |
| Phase 5 | eKYC ベンダー接続・法定通貨決済検討 | Phase 4 |

---

## 14. 変更履歴

| 版 | 日付 | 内容 |
|---|---|---|
| 1.0 | 2026-07-07 | 初版作成 |
