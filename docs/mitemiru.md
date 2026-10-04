# みてみる（SchoolPark内の交換所）

運営が置いた商品を、EMUER・JPYC・円で手に入れる場所。支払いが確かめられると引換コードが出て、会場で運営に見せて受け取る。

- 画面: `frontend/public/schoolpark/east-shopping.html`（Emuの「みてみる」から開く）
- サーバー: `backend/mitemiru.js`（`/api/mitemiru`）、テスト `backend/mitemiru.test.js`

## 支払いの方法

| 方法 | 確かめ方 | 回数枠 |
|---|---|---|
| EMUER（未変換） | 未受取の報酬を `spent` にする。多いぶんはおつりの報酬にする | Light 月1・Plus 週1・Pro 無制限、無料は不可 |
| EMUER（ウォレット） | `EMUERv2.exchange` の注文記録を鎖で確かめる | 同上 |
| JPYC | 受取先への送金を鎖で確かめる（2承認）。同じ送金は二度使えない | なし |
| カード | Stripe Checkout（単発）。Webhook か確認ボタンで支払い済みを確かめる | なし |
| 会場で現金 | 運営が引換コードで探して「現金を受け取って渡した」 | なし |

回数枠は v2 の「みてみるの交換」枠（`emuer_v2_access_usage` の `exchange`）と共通。支払いが成功したときだけ消費し、運営都合の返金で取り消す。

未変換の報酬は、受け取りの署名を出すと `authorizedUntilMs` が付き、その期限まではみてみるで選ばない（鎖の上でも受け取れて二重に使えるのを防ぐ）。`spent` の報酬には署名を出さない。

## 本番で必要なこと

1. **Firestore Rules を反映する**（`mitemiru_*` をブラウザから書けないようにした）。反映前に公開すると、誰でも注文を支払い済みにできてしまう。
2. Render の環境変数
   - `EMUER_V2_AUTHORIZER_PRIVATE_KEY`（既存）: ウォレットのEMUER払いの署名に使う
   - `STRIPE_SECRET_KEY`・`STRIPE_WEBHOOK_SECRET`（既存）: カード払い。Webhook は月額会員と同じ `/api/billing/webhook`、イベントは `checkout.session.completed`
   - `MITEMIRU_JPYC_RECEIVER`（任意）: JPYCの受取先。未設定ならトレジャリー `0x1C15…CFE4`
3. ウォレットのEMUER払いの返金・受け渡し済みの記録（`refundExchange`・`markExchangeFulfilled`）は、`REFUND_ROLE` を持つ運営ウォレットで「運営」タブから行う。受け渡し済みにしないと、その額は返金用の取り置きとしてトレジャリーに拘束されたまま。

## 運営の流れ（イベント当日）

1. 「運営」タブで商品を出す（価格・在庫・受け取り方・取消条件。状態を「販売中」に）
2. 来場者が「手に入れる」から払う。現金なら支払い待ちのコードが出る
3. 来場者のコードを「引換コードで探す」に入れ、「渡した」（現金なら「現金を受け取って渡した」）
