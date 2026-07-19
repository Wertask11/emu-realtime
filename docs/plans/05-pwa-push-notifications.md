# PWAプッシュ通知施策（毎日戻る仕掛け）設計書

担当: 情報システム部 / 作成日: 2026-07-19

## 0. 現状調査結果

### PWA / 通知基盤
- **`manifest.json` は存在しない**（`frontend/public/` 配下に無し）。`<link rel="manifest">` の記述もどのHTMLにも無い。
- **Service Worker は一切存在しない**（`sw.js` / `firebase-messaging-sw.js` 等、リポジトリ全体でゼロ件）。
- `frontend/public/index.html`（8757〜8814行付近）に **ブラウザNotification API（フォアグラウンドのみ）** を使った「エージェント通知」機能が既に実装済み。これはPushではなく、タブを開いている間だけ鳴る簡易通知。**Service Worker経由のバックグラウンドPushは未実装**、FCM も未導入。
- Firebase構成（`index.html` 15486行）に `messagingSenderId: "795496371585"` が既に含まれており、FCM追加時に新規プロジェクト作成は不要。
- フロント: **Firebase v10.8.0 モジュラーSDK**（CDN `type="module"`）／バックエンド: **firebase-admin v13.7.0**（`admin.messaging()` 利用可）。
- 認証はメール/パスワードではなく **MetaMaskウォレット接続**（`eth_requestAccounts`）。ユーザー識別子は常にウォレットアドレス（`window.connectedAccount` / `localStorage.emuWallet`）。
- **good/投稿**: 投稿ドキュメントに `goodCount`（数値）と `goodUsers`（配列）を持つ構造（`backend/server.js` 545〜547, 1056〜1104行）。ランキングAPI `/api/ranking` が `good_given` 等の集計を提供。
- **GA4 (gtag)** が `G-QPQX7LM82Z` で導入済み（`index.html` 9〜13行）。計測はGA4 + Firestoreログの併用が現実的。

### 最重要の既存パターン
EMUER（ERC-20）の付与は既に「**オフチェーン申請 → 日次/月次バッチでまとめてオンチェーンmint**」で稼働中。

- `airdrop_registrations`（毎日2:00 JST、`runAirdropBatch`）
- `secret_door_rewards`（毎日2:30 JST、`runSecretDoorBatch`。`pending→processing→done` の3状態遷移、失敗時ロールバックあり）
- `monthly_distributions`（毎月20日、オーナー署名検証付き手動トリガー）
- いずれも `EMUER_ABI_MINIMAL` の `addGoodBatch(address[], uint256[])` で、**運営のoperatorWalletが1txで複数アドレスへ一括mint**。ガス代はユーザー負担ゼロ。

→ 今回の「花を育てる」型の報酬受取もこのパターンをそのまま拡張するのが最も低リスク。

※ 参考: 予約投稿のcronは実際には `cron.schedule("*/5 * * * *", ...)`（5分毎）だった。

---

## 1. 企画案5本と実装優先順位

### 案A（Camellia型①）「椿の苗を育てる」連続ログイン・ストリーク通知
ログイン（または1アクション）で毎日「水やり」。苗→芽→蕾→満開とビジュアルが育つ。忘れると成長が止まる（枯れはしないが足踏み＝ロスアバージョン）。

通知文例:
1. 「🌱 椿の苗、今日の水やりまだだよ。あと2時間で今日の分が受け取れなくなるよ」
2. 「🌸 3日連続ログイン達成！次は7日で満開のご褒美（EMUER＋NFTパーツ）」
3. 「🎉 7日間育てた椿が満開に。EMUER 50枚とレアパーツを受け取ってね」

- 発火条件: 当日未ログイン検知（20:00 JST）／連続記録が途切れる直前（21:30、1日1通まで）／マイルストーン達成時（即時）
- リテンション効果: **高**（ストリーク施策は「翌週再訪」に直結する定番パターン。ロスアバージョンが強く働く）
- 実装コスト: **M**（streakカウンタ、育成ステージ判定、cron判定、FCM送信、花コンポーネントUI）
- 依存: FCMトークン基盤（案Dで整備）、EMUER付与は既存 `addGoodBatch` バッチを拡張

### 案B（Camellia型②）「みんなの椿ガーデン」コミュニティ協力育成通知
全ユーザーの当日アクション（ログイン数・投稿数・good数）が合算され「共同の椿の庭」が育つ。マイルストーン到達で全員に一括報酬。

通知文例:
1. 「🌳 今日はあと18人の来園でガーデンに新しい花が一輪増えるよ」
2. 「🌸 SchoolParkの椿ガーデンに花が咲きました！来園した人全員にEMUER 10枚ボーナス」
3. 「⏰ ガーデンの締切まで残り3時間。あなたの1アクションが力になるよ」

- 発火条件: 集計値が閾値の80%/100%到達時（トピック配信）、締切前3時間のリマインド（未参加者のみ）
- リテンション効果: **中〜高**（社会的証明・FOMOで新規〜中間層に効くが、個人貢献感が薄いと逓減。案Aと併用が前提）
- 実装コスト: **L**（全体集計バッチ、Socket.io進捗配信、`sendToTopic` 一斉配信、不正増殖対策）

### 案C 今日のお題（1日1問クイズ）通知
noteで販売中の「探索・学びシリーズ」（ケンタ・サクサク・りさ記事）と連動し、毎日1問の3択クイズ。正解でEMUER少額付与、7日連続正解でnote限定コンテンツ解放。

通知文例:
1. 「🧠 今日のお題が届いたよ：『ケンタが見つけた化石はどこで見つかった？』3択でチャレンジ」
2. 「⏳ 今日のお題まだ未回答。あと4時間で今日の分は締め切りだよ」
3. 「✅ 今日のお題正解！7日連続正解でnote限定コンテンツが解放されるよ」

- 発火条件: 毎日9:00 or 18:00配信、未回答者への締切前リマインド（1日1通）
- リテンション効果: **高**（明確な「今日だけの理由」を毎日提供でき、学びコンテンツ販売と相乗）
- 実装コスト: **M**（お題マスタ管理は既存 `/api/room1` 系の承認フローと同パターンで流用可、正誤判定API、通知）
- 依存: noteコンテンツとの連携（お題データの継続供給が必要）

### 案D 自分の投稿にgoodが付いた通知
通知文例:
1. 「👍 誰かがあなたの投稿にGoodを押しました！」
2. 「🎉 あなたの投稿が本日のGoodランキング3位にランクイン中」
3. 「👍👍 あなたの投稿に5件のGoodが集まったよ。お返しに誰かの投稿にもGoodしてみない？」

- 発火条件: `goodCount` increment発生時（既存のgood処理に1行追加）
- リテンション効果: **中**（社会的承認は強いが、対象が「既に投稿した人」に限定されリーチが狭い）
- 実装コスト: **S**（FCM基盤さえあれば既存箇所にpush呼び出しを追記するのみ）
- **最初に着手すべきPoC案件**

### 案E キュレーターの新着（週刊ダイジェスト）通知
週1回、その週の人気投稿・新着スポット・ランキング上位をまとめて配信。休眠ユーザーのwin-back狙い。

通知文例:
1. 「📬 今週のSchoolParkダイジェストが届きました。人気投稿TOP3をチェック」
2. 「🏆 今週のGoodランキング1位が決定！あなたの順位は？」
3. 「🆕 東エリアに新しいスポットが追加されたよ。今週末に遊びに来てね」

- 発火条件: 毎週金曜19:00 JST、7日以上未訪問者を優先配信
- リテンション効果: **低〜中**（毎日の再訪動機にはならないが離脱者の呼び戻しに向く）
- 実装コスト: **S〜M**（既存 `/api/ranking` を流用した週次集計cron＋Topic一斉配信）

### 優先順位（実装コスト対リテンション効果）

| 順位 | 案 | コスト | 効果 | 根拠 |
|---|---|---|---|---|
| 1 | D. good通知 | S | 中 | 最小工数でFCM基盤全体（トークン管理・SW・送信ユーティリティ）を実戦投入できるPoC。ここで基盤の不具合を潰してから展開するのが合理的 |
| 2 | A. 椿の苗ストリーク | M | 高 | 「毎日戻ってくる」への直接効果が最大。案Dの基盤にstreak判定とreward基盤を足すだけ |
| 3 | C. 今日のお題 | M | 高 | 効果は案Aと同等だが、noteコンテンツ供給という外部依存があるため3位。EC収益との相乗効果があり中期的には最優先候補 |
| 4 | E. 週刊ダイジェスト | S〜M | 低〜中 | 実装は簡単だが「毎日再訪」への寄与は小さい。休眠層向けの補助施策 |
| 5 | B. みんなの椿ガーデン | L | 中〜高 | 効果は魅力的だがリアルタイム全体集計・不正対策・Topic配信設計でコスト最大。案Aが軌道に乗った後の拡張 |

**実装順序**: D → A → C → E → B

---

## 2. ガス代の制約設計【必須】

### 原則
既存の `airdrop_registrations` / `secret_door_rewards` と同じ「**申請はいつでもオフチェーン記録、mintは運営が日次バッチで一括実行**」を拡張する。ユーザーは一度もガス代を払わない。最重要なのは「**アクション数・クレーム操作の頻度に運営側のガス代（オンチェーンtx回数）が比例しないこと**」。

### Firestoreデータ構造

`daily_actions/{wallet}_{YYYY-MM-DD}`（不変の行動ログ。backend APIのみ書き込み可、フロントから直接書き込み不可）
```
{
  wallet: "0xabc...",
  date: "2026-07-19",
  actions: {
    login: true, goodGiven: 2, posted: true, quizAnswered: true, watered: true
  },
  rewardPoints: 15,        // API呼び出し時点でサーバー側が計算した確定値（改ざん不可）
  createdAt: <serverTimestamp>
}
```

`flower_streaks/{wallet}`（案A/Bの育成状態）
```
{
  currentStreak: 4, longestStreak: 12,
  lastWateredDate: "2026-07-19",
  stage: "bud",             // seed / sprout / bud / bloom
  totalBlooms: 2, updatedAt: <serverTimestamp>
}
```

`pending_rewards/{reward_wallet_sourceType_sourceId}`（既存 `secret_door_rewards` を汎用化）
```
{
  address: "0xabc...", amount: "15",
  sourceType: "streak" | "quiz" | "good_received" | "garden",
  sourceId: "2026-07-19",
  registeredAt: <serverTimestamp>,
  status: "pending" | "claim_requested" | "processing" | "done",
  claimBatchId: null
}
```

### クレーム（受取）フロー：週1でも成立する設計

1. **毎日**: ログイン/good/投稿/クイズ/水やりのたびにbackend APIが `daily_actions` に確定ログを書き、対応する `pending_rewards` を `status: pending` で作成。オンチェーン処理は一切なし（Firestore書き込みのみ）。
2. **UI表示**: マイページに「未受取EMUER: 320」を表示（`status == pending` をクエリして合算、読み取りのみでガス代ゼロ）。いつ受け取っても、何日分溜めても構わない。
3. **ユーザーが「まとめて受け取る」を押す**（週1でも月1でも任意）:
   - `personal_sign`（MetaMaskの署名リクエスト。**署名にガス代はかからない**）でウォレット所有証明を取得
   - `POST /rewards/claim { address, timestamp, signature }`
4. **backend検証**（新設 `verifyUserSignature` — 既存の `verifyOwnerSignature` をユーザー用に一般化）:
   - 署名検証（`ethers.utils.verifyMessage`）とtimestampの300秒以内チェック
   - `address` 一致 & `status == pending` を全件取得し合算
   - **不正増殖対策**: `daily_actions` の実ログと突合し、`pending_rewards.amount` の合計が `daily_actions.rewardPoints` の合計と一致するか再計算検証。加えて **1ウォレットあたり1日の上限（例: 最大50 EMUER/日）** を適用し超過分は切り捨て
   - 該当ドキュメント群を `status: claim_requested` に更新し即時レスポンス（「受取申請を受け付けました。数時間以内に反映されます」）
5. **オンチェーン送金**: 既存の `runAirdropBatch` / `runSecretDoorBatch` と同じ思想で、**日次1〜2回のcronバッチ**（例: 深夜2:45 JST新設）が `status == claim_requested` の全ウォレット・全金額を集計し `addGoodBatch(addresses, amounts, gasOptions)` で**1txにまとめて**mint。処理後 `status: done` + `txHash` を記録。
   - 100人が同時に「今すぐ受け取る」を押しても発生するtxは日次バッチ回数分（1〜2回）のみ。**運営のガス代は「クレーム回数」ではなく「バッチ実行回数」にのみ比例**する。
   - 既存同様、失敗時は `processing→pending` へロールバック。

### 検証方法まとめ
- 行動ログと報酬申請を分離し、**クレーム時に必ず両者を突合**して改ざん・リプレイ攻撃を防止
- Firestoreルールで `daily_actions` / `pending_rewards` へのクライアント直接書き込みを禁止し、backend API（Admin SDK）経由のみに限定
- 1日あたりの付与上限キャップでbot連打リスクを抑制
- 署名検証は既存 `verifyOwnerSignature`（`backend/server.js` 262〜273行）と同一パターンを流用し実装リスクを低減

---

## 3. 技術実装設計（PWA + FCM）

### 3-1. manifest.json（新規: `frontend/public/manifest.json`）
```json
{
  "name": "SchoolPark",
  "short_name": "SchoolPark",
  "description": "MetaMaskで入場する体験型コミュニティ SchoolPark",
  "start_url": "/index.html?utm_source=pwa",
  "scope": "/",
  "display": "standalone",
  "orientation": "portrait-primary",
  "background_color": "#0d1b3d",
  "theme_color": "#0d4a8a",
  "icons": [
    { "src": "/assets/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/assets/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "/assets/icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```
※ 現状 `/assets/mascot.jpg` はJPGかつ角丸考慮なしのため、maskable用に余白を持たせたPNGを新規に用意する必要がある（既存アセットの流用不可）。

`index.html` の `<head>` に追加:
```html
<link rel="manifest" href="/manifest.json">
<meta name="theme-color" content="#0d4a8a">
<!-- iOS Safari用（ホーム画面追加でPWA化するために必須） -->
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="SchoolPark">
<link rel="apple-touch-icon" href="/assets/icons/icon-192.png">
```

### 3-2. Service Worker（新規: `frontend/public/firebase-messaging-sw.js`、ルート直下必須）
```js
// Service Worker内はcompat SDKを使用（Firebase公式推奨。type:"module" SWの互換性リスクを避ける）
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyBKHS1D8Or6gfMd4NbzhDI7dG5Je7BLtbs",
  authDomain: "emusch-2a111.firebaseapp.com",
  projectId: "emusch-2a111",
  storageBucket: "emusch-2a111.firebasestorage.app",
  messagingSenderId: "795496371585",
  appId: "1:795496371585:web:51deec91b8a2152e4c8480"
});

const messaging = firebase.messaging();

// バックグラウンド（アプリ未起動/タブが裏）でのPush受信
messaging.onBackgroundMessage((payload) => {
  const { title, body, icon } = payload.notification || {};
  const data = payload.data || {};
  self.registration.showNotification(title || 'SchoolPark', {
    body: body || '',
    icon: icon || '/assets/icons/icon-192.png',
    badge: '/assets/icons/icon-192.png',
    tag: data.type || 'general',       // 同種通知の積み重ね防止
    data
  });
});

// 通知クリック時: 計測用パラメータを付けてアプリを開く/フォーカス
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const type = event.notification.data?.type || 'general';
  const targetUrl = `/index.html?utm_source=push&notif_type=${type}`;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});
```

### 3-3. フロント: FCMトークン管理（`index.html` に追記）
```html
<script type="module">
  import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging.js";

  const messaging = getMessaging(window.app); // 既存の initializeApp(firebaseConfig) を再利用
  const VAPID_KEY = "＜Firebaseコンソール Cloud Messaging タブで発行するVAPID公開鍵＞";

  // iOS Safariでは「ホーム画面に追加」されたPWAでないとPush不可
  function isIosStandalonePwa() {
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isStandalone = window.navigator.standalone === true
      || window.matchMedia('(display-mode: standalone)').matches;
    return !isIos || isStandalone; // iOS以外はtrue、iOSはstandaloneのときのみtrue
  }

  async function registerFcmToken() {
    if (!('serviceWorker' in navigator) || !('Notification' in window)) return null;
    if (!isIosStandalonePwa()) {
      showIosA2hsBanner(); // 「ホーム画面に追加して通知を受け取ろう」バナー
      return null;
    }
    try {
      const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
      const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
      if (!token) return null;

      const wallet = (window.connectedAccount || localStorage.getItem('emuWallet') || '').toLowerCase();
      if (wallet && window.db && window.fbLib) {
        await window.fbLib.setDoc(
          window.fbLib.doc(window.db, 'fcm_tokens', wallet),
          {
            tokens: window.fbLib.arrayUnion(token),
            platform: navigator.platform,
            userAgent: navigator.userAgent,
            lastSeenAt: new Date(),
            notifTypes: { streak: true, quiz: true, good: true, digest: true, garden: true }
          },
          { merge: true }
        );
      }
      gtag('event', 'notif_token_registered', { platform: navigator.platform });
      return token;
    } catch (e) {
      console.warn('FCMトークン取得失敗:', e);
      return null;
    }
  }

  // フォアグラウンド受信（タブを開いている間）
  onMessage(messaging, (payload) => {
    _sendAgentNotification(payload.notification?.title, payload.notification?.body); // 既存関数を流用
  });

  window._registerFcmToken = registerFcmToken;
</script>
```

### 通知権限リクエストのUX（いつ許可を求めるか）
- **初回のMetaMask接続直後には求めない**。ウォレット接続という重い許可の直後に通知許可を重ねると許可率が大きく下がる（許可疲れ）。
- **2段階（ソフトプロンプト方式）を採用**:
  1. 独自UIバナー（ネイティブダイアログではない）を、価値を実感した瞬間にだけ表示。トリガー例:
     - 誰かから初めてgoodをもらった直後（案D）
     - 椿の苗が「芽が出た」（3日目ストリーク達成）瞬間（案A）
  2. バナーで「OK、通知を受け取る」を押したときのみ `Notification.requestPermission()` を呼ぶ。
  3. ネイティブダイアログで拒否された場合は**同一ユーザーに7日間再表示しない**（`localStorage` にcooldown記録）。ブラウザは一度拒否されるとJSから再度聞けない仕様のため、自前のソフトプロンプトを都度出し直す設計にする。
- iOSで `isIosStandalonePwa()` が false の場合は上記フローを出さず、「ホーム画面に追加して通知を受け取ろう」誘導バナー＋手順（共有ボタン→ホーム画面に追加）を表示。

### iOS Safari のPWAプッシュ制約への対応方針
- iOS 16.4以降かつ**ホーム画面に追加（A2HS）してstandaloneで起動しているPWAでない限りPushは機能しない**（Safariのタブでは `Notification.requestPermission` 自体が実質使えない）。
- `window.navigator.standalone` または `matchMedia('(display-mode: standalone)')` で判定し、非対応環境では通知UIを一切出さず**A2HS誘導バナー**を表示。
- iOS 16.4未満には、Pushの代替として**既存のアプリ内通知一覧API**（`GET /api/sp/notifications`）をメイン体験に位置づける。マイページの通知ベルに未読バッジを表示し、Pushは「あれば嬉しいオマケ」として扱う。
- MetaMaskアプリ内ブラウザはPWA化・Push対応が不安定なため、通知施策は「Safari/Chromeで直接開いてホーム画面に追加したユーザー」を主対象とし、MetaMaskアプリ内ブラウザ利用者には通知許可UIを出さない。

### 3-4. 通知送信側コード（`backend/server.js` に追記。本プロジェクトはFirebase FunctionsではなくExpress+node-cron運用のためその構成に合わせる）
```js
// =====================
// Push通知ユーティリティ（firebase-admin messaging）
// =====================
const admin = require("firebase-admin");

async function sendPushToWallet(wallet, { title, body, type, data = {} }) {
  if (!db) return;
  const lc = wallet.toLowerCase();
  const tokenDoc = await db.collection("fcm_tokens").doc(lc).get();
  if (!tokenDoc.exists) return;
  const { tokens = [], notifTypes = {} } = tokenDoc.data();
  if (notifTypes[type] === false) return; // ユーザーが当該種別をOFFにしていたら送らない
  if (isQuietHours()) return;             // 22:00-8:00は送らない
  if (!(await underDailyCap(lc))) return; // 1日2件上限チェック

  if (tokens.length === 0) return;
  const message = { notification: { title, body }, data: { type, ...data }, tokens };
  try {
    const resp = await admin.messaging().sendEachForMulticast(message);
    // 失効トークンのクリーンアップ
    const invalid = [];
    resp.responses.forEach((r, i) => {
      if (!r.success && ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'].includes(r.error?.code)) {
        invalid.push(tokens[i]);
      }
    });
    if (invalid.length) {
      await tokenDoc.ref.update({ tokens: admin.firestore.FieldValue.arrayRemove(...invalid) });
    }
    await db.collection("notification_logs").add({ wallet: lc, type, title, sentAt: new Date(), successCount: resp.successCount });
  } catch (e) {
    console.error("Push送信エラー:", e.message);
  }
}

function isQuietHours() {
  const jstHour = new Date(Date.now() + 9 * 3600000).getUTCHours();
  return jstHour >= 22 || jstHour < 8;
}

async function underDailyCap(wallet) {
  const todayKey = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const snap = await db.collection("notification_logs")
    .where("wallet", "==", wallet).where("sentAt", ">=", new Date(todayKey)).get();
  return snap.size < 2; // 1日最大2件
}

// ── 案A: 椿ストリークの水やりリマインド（毎日20:00 JST） ──
cron.schedule("0 20 * * *", async () => {
  if (!db) return;
  const snap = await db.collection("flower_streaks").get();
  const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  for (const doc of snap.docs) {
    const s = doc.data();
    if (s.lastWateredDate === today) continue; // 今日は水やり済み
    await sendPushToWallet(doc.id, {
      title: "🌱 椿の苗が水やりを待ってるよ",
      body: `連続${s.currentStreak}日の記録、今日も続けよう`,
      type: "streak",
      data: { streak: String(s.currentStreak) }
    });
  }
}, { timezone: "Asia/Tokyo" });

// ── 案E: 週刊ダイジェスト（毎週金曜19:00 JST） ──
cron.schedule("0 19 * * 5", async () => {
  // 既存の /api/ranking 集計ロジックを流用してTOP3等を取得後、
  // fcm_tokens 全件へ admin.messaging().sendEachForMulticast で配信
}, { timezone: "Asia/Tokyo" });

module.exports.sendPushToWallet = sendPushToWallet; // 案D側から呼び出す
```

案D（goodされた通知）は、既存のgood加算処理（`goodCount` / `goodUsers` 更新箇所）に以下を追記するだけ:
```js
await sendPushToWallet(postOwnerAddress, {
  title: "👍 投稿にGoodが届いたよ",
  body: `${goodCount}件のGoodが集まっています`,
  type: "good",
  data: { postId }
});
```

### 3-5. 通知の頻度上限とユーザー設定UI
- **頻度上限**: 1ユーザー1日最大2件（`underDailyCap` で強制）。優先度は good > streak > quiz > digest。同日に複数条件が重なった場合は優先度順に配信し、残りはキューして翌日以降に間引く。
- **サイレント時間帯**: 22:00〜8:00 JSTは送信しない（`isQuietHours`）。
- **設定UI**（マイページ内、`fcm_tokens/{wallet}.notifTypes` を更新するトグル）:
```html
<div id="notifSettingsPanel">
  <h3>通知設定</h3>
  <label><input type="checkbox" id="notif-streak" checked> 🌱 椿の苗リマインド</label>
  <label><input type="checkbox" id="notif-quiz" checked> 🧠 今日のお題</label>
  <label><input type="checkbox" id="notif-good" checked> 👍 Goodされた時</label>
  <label><input type="checkbox" id="notif-digest" checked> 📬 週刊ダイジェスト</label>
  <label><input type="checkbox" id="notif-garden" checked> 🌳 みんなの椿ガーデン</label>
  <button id="notif-all-off">すべてオフにする</button>
</div>
<script>
  ['streak','quiz','good','digest','garden'].forEach(type => {
    document.getElementById(`notif-${type}`).addEventListener('change', async (e) => {
      const wallet = (window.connectedAccount || '').toLowerCase();
      if (!wallet) return;
      await window.fbLib.setDoc(
        window.fbLib.doc(window.db, 'fcm_tokens', wallet),
        { notifTypes: { [type]: e.target.checked } },
        { merge: true }
      );
    });
  });
</script>
```

---

## 4. 計測との接続（8段階ファネルの「翌週再訪」への効き方）

ファネル: LP訪問 → MetaMask接続試行 → 無料パス取得 → 初回閲覧 → 初回good → 初回投稿 → **翌週再訪** → 公式パス購入

通知施策は「初回投稿」を完了したユーザーに対して**翌日以降から配信対象とする**（何もしていないユーザーへの配信は無意味）。

### フロント側イベント（GA4 gtag、既存 `G-QPQX7LM82Z` に相乗り）
| イベント名 | 発火タイミング | 主要パラメータ |
|---|---|---|
| `notif_permission_prompt_shown` | 自前ソフトプロンプト表示時 | `trigger_type`（`first_good_received` / `flower_sprout` / `ios_a2hs_banner`） |
| `notif_permission_result` | ネイティブ許可ダイアログの結果 | `result`（granted/denied/dismissed）, `trigger_type` |
| `notif_token_registered` | FCMトークン取得・保存成功時 | `platform` |
| `notif_clicked` | 通知タップで `?utm_source=push&notif_type=xxx` に到達時 | `notif_type` |
| `weekly_revisit` | 既存ファネルの「翌週再訪」に相乗り | `attributed_to`（`push` / `organic` 等） |

### バックエンド側（Firestoreログ）
| コレクション | 記録タイミング | 用途 |
|---|---|---|
| `notification_logs` | 通知送信時（`sendPushToWallet` 内） | 送信実績・頻度上限判定・CTR算出の分母 |
| `notification_attribution/{wallet}_{weekKey}` | 週次バッチで集計 | 下記 |

```
{
  wallet: "0xabc...", weekKey: "2026-W29",
  notifsSentThisWeek: 4, notifsClickedThisWeek: 2,
  firstRevisitAt: <timestamp>,
  revisitSource: "push" | "organic",
  daysSinceLastVisitAtNotif: 3,
  funnelStageAtNotif: "初回投稿"
}
```

### 分析設計
- **通知経由の再訪判定**: `notificationclick` → `?utm_source=push&notif_type=xxx` に遷移 → フロント初期化時にURLパラメータを検出し `weekly_revisit` に `attributed_to: 'push'` を付与。技術開発部の既存ファネルに手を入れずパラメータ拡張のみで対応可能。
- **A/Bコホート比較**: 通知許可済み群 vs 未許可（denied/dismissed）群で「初回投稿→翌週再訪の到達率」を比較し、通知施策単体のリフトを算出。
- **主要KPI（週次）**:
  1. 通知到達率（`notification_logs.successCount` ベース）
  2. 通知CTR（`notif_clicked` / 配信成功数）
  3. **通知経由の翌週再訪寄与率**（`revisitSource == 'push'` ÷ 全 `weekly_revisit`）— 本施策の直接的な成功指標
  4. 種別ごとの解除率（`notifTypes` でOFFにされた比率。高い種別は文面・頻度を見直す）
- **配信対象条件**: 「初回投稿」未完了ユーザーへは案A/C/D（アクション連動型）を配信しない。案E（週刊ダイジェスト）のみ「初回閲覧」完了時点から配信対象とし、休眠離脱を防ぐ役割を持たせる。

---

## 参照ファイル
- `backend/server.js`（Express本体、cron、EMUER付与バッチ、CORS/Firebase Admin初期化 — 全1411行）
- `frontend/public/index.html`（メインSPA、Firebase v10初期化、MetaMask接続、EMUERレート管理、既存Notification API — 全16945行）
- `backend/package.json` / `package.json`（firebase-admin, ethers, node-cron, socket.io）
- `frontend/public/` に `manifest.json` および Service Worker が存在しないことを確認済み
