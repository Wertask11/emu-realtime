# CHES 認証（LINE / Google）セットアップ手順

SchoolPark の入場ゲートを CHES Identity フロー（LINE / Google 認証 → CHESアカウント・ウォレット・無料Membership 自動生成 → 入園）に刷新しました。
コードは実装済みですが、**本番で動かすには以下のコンソール設定と環境変数が必須**です。

## フロー概要

```
LINEではじめる / Googleではじめる
        ↓ （認証方法だけが異なる。以降は共通）
   CHESアカウント検索
        ↓ なければ自動作成
   CHESウォレット生成（アドレスのみ・秘密鍵なし・決定論的）
        ↓
   無料Membership 付与（オフチェーン：Firestore）
        ↓
      SchoolParkへ入園
```

- ユーザーに「初めてですか？」「無料/有料」を聞かない。Web3・ウォレットを意識させない。
- 認証後の処理はすべて共通の CHES Identity フロー（`window.CHES`）で動作。Apple / メール認証を足す場合も認証部分だけ追加すればよい。
- MetaMask（有料パス）はゲートの「その他の方法で入る」に格納して残置。

## データモデル（Firestore）

- `ches_accounts/{uid}` … `{ uid, provider, providerUid, displayName, email, photoURL, walletAddress, membership:{tier:"free",offchain:true,issuedAt}, createdAt, lastLogin }`
- `ches_wallets/{walletAddress}` … `{ address, uid, type:"address-only", provider, createdAt }`
- `uid`：Google=Firebase uid / LINE=`line:<LINEユーザーID>`
- `walletAddress`：`keccak256("ches-wallet:v1:"+uid)` の下位20バイト（チェックサム付き、秘密鍵は生成しない）

---

## 1. Google ログイン（Firebase Auth ネイティブ）

Firebase コンソール（プロジェクト `emusch-2a111`）:

1. Authentication → Sign-in method → **Google を有効化**（サポートメール設定）。
2. Authentication → Settings → **承認済みドメイン** に本番ドメイン（例 `schoolpark-emu.vercel.app`）と、必要なら `localhost` を追加。

コード側の追加設定は不要（`firebaseConfig` は既存のものを使用）。

## 2. LINE ログイン

### 2-1. LINE Developers

1. プロバイダー配下に **LINE Login チャネル**を作成（メッセージ配信用の「公式アカウント」とは別物）。
2. **Channel ID**（公開値）と **Channel Secret**（秘匿値）を控える。
3. LINE Login 設定 → **コールバックURL** に本番の入場URLを登録（末尾スラッシュまで完全一致）:
   - 例: `https://schoolpark-emu.vercel.app/`
4. スコープ `profile openid email` を有効化（email を使う場合はメール取得申請が必要）。

### 2-2. バックエンド環境変数（**Render**）

`backend/server.js`（＝**Render** にデプロイ）の `POST /api/auth/line` が使用します。
フロント（Vercel）とバックエンド（Render）は別オリジンのため、フロントは既定で
`https://emu-realtime.onrender.com/api/auth/line` を呼びます。よって変数は **Render の
Environment に設定**してください（Vercel ではありません）:

| 変数（Render） | 値 |
|---|---|
| `LINE_CHANNEL_ID` | LINE Login チャネルの Channel ID |
| `LINE_CHANNEL_SECRET` | 同 Channel Secret（**フロントに置かない**） |

> ※ `FIREBASE_SERVICE_ACCOUNT`（custom token 発行に必須）は既に Render に設定済み。

### 2-3. フロント設定（Channel ID / コールバックURL）

`frontend/public/index.html` の CHES レイヤーは以下の優先順で設定を読みます:

1. `window.CHES_CONFIG`（`index.html` 内に**既にオーナー記入欄を用意済み**）
2. `localStorage`（`CHES_LINE_CHANNEL_ID` / `CHES_LINE_REDIRECT_URI`）— 検証に便利
3. 既定値（`lineRedirectUri` = `location.origin + "/"`、`lineTokenEndpoint` =
   `https://emu-realtime.onrender.com/api/auth/line`）

**本番手順はシンプル**：`index.html` 内の「CHES ログイン設定（オーナー記入欄）」コメント直下の
`window.CHES_CONFIG` の `lineChannelId` に Channel ID を入れるだけ（Channel ID は公開値でOK）。

```html
<script>
  window.CHES_CONFIG = {
    lineChannelId: "＜あなたのChannel ID＞",   // ← ここだけ埋める
    lineRedirectUri: location.origin + "/"     // 通常このままでOK（本番= https://schoolpark-emu.vercel.app/ ）
  };
</script>
```

ローカル検証（DevTools コンソール）:

```js
localStorage.setItem("CHES_LINE_CHANNEL_ID", "＜Channel ID＞");
localStorage.setItem("CHES_LINE_REDIRECT_URI", "http://localhost:4173/");
```

---

## 動作の要点 / 既知の制約

- **アドレスのみ発行**のため、CHES 無料ユーザーは秘密鍵を持たず、オンチェーン操作（実EMUER変換・NFT請求）は不可。SchoolPark内の pending EMUER 等はオフチェーン（Firestore/localStorage）で従来通り動作。
- 再訪時は Firebase セッション（`browserLocalPersistence`）＋ `localStorage.ches_uid` があれば**自動サインインして入園**（ゲートをスキップ）。
- ログアウトは `window.CHES.logout()`（セッション破棄＋リロード）。
- 有料は将来の「CHES 有料Membership」で対応予定。当面は MetaMask（その他の方法）で従来の有料NFT保有者が入場可能。

## 変更ファイル

- `frontend/public/index.html` … 入場ゲートUI（LINE/Googleボタン）、CHES Identity レイヤー（`window.CHES`）、Firebase Auth 窓口（`window.fbAuth`）
- `backend/server.js` … `POST /api/auth/line`（認可コード→Firebase custom token）
