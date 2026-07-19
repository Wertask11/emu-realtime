# Emu/LP 8段階計測ファネル 実装設計書

担当: 技術開発部 / 作成日: 2026-07-19 / **優先度: 最高（全施策の前提）**

## 1. 調査結果 — イベント差し込み箇所一覧

調査対象: `frontend/public/index.html`（16,945行）/ `actionhub.js` / `actionschema.js` / `wallet-success-ui.js` / `backend/server.js`（1,411行）

### 主要な発見事項

- **Firebase初期化**: `index.html:15474-15512`。`type="module"` で `initializeApp` → `getFirestore` を実行し、`window.db` / `window.fbLib`（collection, addDoc, setDoc, updateDoc, doc, getDoc, increment, arrayUnion, query, where, onSnapshot 等）をグローバル公開。**外部ファイルから使う前提の窓口が既にある**ため、新規ライブラリもこれを再利用するのが自然。
- **`signInAnonymously` は import されているが一度も呼ばれていない**（Grepで0件）。つまり現状 Firestore への書き込みはすべて `request.auth == null` の状態で行われている（`posts` / `sp_stats` / `sp_pass_logs` 等の既存コレクションと同じ信頼モデル）。→ セキュリティルール設計に直結する重要事実。
- **既存の類似トラッカー `spTrack()`**（`index.html:10380-10436`）: `sp_stats/global`（カウンタ）、`sp_paid_pass`/`sp_free_pass`（アドレス別）、`sp_pass_logs`（個別ログ）という「集計ドキュメント + 個別ログ」の二層構造が既に実装済み。**今回もこのパターンを踏襲**。
- **管理者API認証が2種類存在**:
  - `x-admin-key` ヘッダ方式（`server.js:249-250`, `481-482`）— バッチ起動などの操作系
  - ウォレット署名方式 `verifyOwnerSignature()`（`server.js:262-273`）— **読み取り系の `/admin/restriction-stats`（`server.js:339-353`）が採用**。今回のファネル集計APIも読み取り系なのでこちらに合わせる。
- **cron集計は `node-cron` が既に依存関係にあり稼働中**（`server.js:489-491, 567`）。Cloud Functions は未導入・Blazeプラン移行の形跡なし。

### 各イベントの差し込み箇所

| # | イベント | ファイル:行 | 関数/箇所 |
|---|---|---|---|
| 0（土台） | ライブラリ読込 | `index.html:4542`（`wallet-success-ui.js` の直後） | `<script src="/emu-funnel-tracker.js"></script>` |
| 1 | LP訪問 | `emu-funnel-tracker.js` 自身のIIFE内で自動発火（index.html変更不要） | スクリプトロード時 |
| 2a ボタン押下 | `index.html:10439`（`connectWalletButton` click直後）/ `index.html:14594`（`onFreeNftClick` 冒頭） | 有料・無料両ボタン |
| 2b MetaMask未検出 | `index.html:10443-10447` / `index.html:14598-14602` | `typeof window.ethereum === "undefined"` 分岐 |
| 2c ユーザー拒否 | `index.html:10526-10539`（catch、`err.code`判定）/ `index.html:14605`（**現状try/catchが無い箇所に追加**） | |
| 2d 接続成功 | `index.html:10450-10452` / `index.html:14605-14607` | `eth_requestAccounts` 成功直後 |
| 3 | 無料パス取得 | `index.html:14666`（`spTrack('free', account)` 直後） | `onFreeNftClick` |
| 4 | 初回閲覧 | `index.html:12734`（`closeSpMap()` 冒頭） | CHESメニュー「Emu」導線の唯一の実体 |
| 5 | 初回good | `index.html:11456-11470`（goodボタンの `updateDoc` 成功直後） | `attachReactionHandlers` |
| 6 | 初回投稿 | `index.html:11722-11730`（新規投稿 `addDoc` 成功直後、else側のみ＝更新は除外） | `postForm` submit |
| 7 | 翌週再訪 | `emu-funnel-tracker.js` 内、STAGE_1発火時に自動判定（index.html変更不要） | |
| 8 | 公式パス購入 | `index.html:7307-7333`（`goTomainapp()` 冒頭、`_resolvedPassType` 判定直後） | 全ログイン経路の唯一の合流点 |
| API | 新規エンドポイント | `backend/server.js:353`（`/admin/restriction-stats` 直後）に `/admin/funnel-stats` | |
| cron | 新規ジョブ | `backend/server.js:491`（既存cron群の直後） | |

### 設計判断の理由

- **「8. 公式パス購入」**: `checkHexaNFT()`（10544-10613）に直接仕込むと3箇所のreturn分岐すべてに手を入れる必要があり差分が煩雑。すべてのログイン経路（有料ボタン10524／無料ボタン14669／ゲスト14917）が必ず `goTomainapp()` を呼ぶ時点で `window.hasPaidNFT` が確定済みのため、**単一箇所**に仕込む方が安全でメンテしやすい。
- **「4. 初回閲覧」**: 投稿フィード用DOM（`#postFeed`）自体はページロード直後から `startRealtimeUpdate()`（15196-15226）で常時裏更新されているため、DOM生成やrenderPostsをトリガーにすると「見てすらいないのに閲覧扱い」になる。ユーザーが実際に地図オーバーレイを閉じてフィードを目にする一点（`closeSpMap()`）が最も正確。

---

## 2. イベント計測ライブラリ（新規ファイル `frontend/public/emu-funnel-tracker.js`）

```javascript
/**
 * ================================================================
 * emu-funnel-tracker.js
 * Emu/LP 8段階計測ファネル トラッカー（vanilla JS + Firestore）
 * ----------------------------------------------------------------
 * 依存: window.db / window.fbLib （index.html の Firebase 初期化 <script type="module">
 *       で公開されている窓口をそのまま利用。新たな firebase-app 初期化は行わない）
 *
 * 書き込み先:
 *   - funnel_events : 追記オンリーのイベントログ（診断用）
 *   - funnel_users  : 匿名ID 1件=1ドキュメント。各段階の「初到達タイムスタンプ」のみ保持
 *
 * 設計方針:
 *   1. 匿名ID(uid)は localStorage に永続化。ウォレットが分かった時点で紐付ける。
 *   2. 各ステージは「初回のみ」funnel_users を書き込む（生涯最大11回）。
 *      funnel_events は毎回書くが、同一ステージの連打は3秒デバウンスで握りつぶす。
 *   3. Firestore無料枠（Spark: 書き込み20,000/日, 読み取り50,000/日）前提で
 *      書き込み数の最小化を最優先。
 * ================================================================
 */
(function () {
  "use strict";

  var STAGES = {
    LP_VISIT:               { key: "lp_visit",                    stage: "1"  },
    WALLET_CLICK:           { key: "wallet_attempt_click",         stage: "2a" },
    WALLET_NOT_DETECTED:    { key: "wallet_attempt_not_detected",  stage: "2b" },
    WALLET_REJECTED:        { key: "wallet_attempt_rejected",      stage: "2c" },
    WALLET_SUCCESS:         { key: "wallet_attempt_success",       stage: "2d" },
    FREE_PASS_CLAIMED:      { key: "free_pass_claimed",            stage: "3"  },
    FIRST_VIEW:             { key: "first_view",                   stage: "4"  },
    FIRST_GOOD:             { key: "first_good",                   stage: "5"  },
    FIRST_POST:             { key: "first_post",                   stage: "6"  },
    WEEK2_REVISIT:          { key: "week2_revisit",                stage: "7"  },
    OFFICIAL_PASS_PURCHASE: { key: "official_pass_purchase",       stage: "8"  }
  };

  var STAGE_ORDER = [
    "lp_visit", "wallet_attempt_click", "wallet_attempt_not_detected",
    "wallet_attempt_rejected", "wallet_attempt_success", "free_pass_claimed",
    "first_view", "first_good", "first_post", "week2_revisit", "official_pass_purchase"
  ];

  var LS_UID_KEY            = "emu_funnel_uid";
  var LS_FIRST_SEEN_KEY     = "emu_funnel_first_seen_at";
  var LS_DONE_PREFIX        = "emu_funnel_done_";       // 生涯1回フラグ
  var LS_WALLET_LINKED      = "emu_funnel_wallet_linked";
  var DEBOUNCE_MS           = 3000;
  var READY_POLL_MS         = 250;
  var READY_POLL_TIMEOUT_MS = 20000; // 超えたら諦めて捨てる（無限リトライ防止）

  // ---------------------------------------------------------------
  // 匿名ID
  // ---------------------------------------------------------------
  function _uuid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0, v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function getUid() {
    try {
      var uid = localStorage.getItem(LS_UID_KEY);
      if (!uid) { uid = _uuid(); localStorage.setItem(LS_UID_KEY, uid); }
      return uid;
    } catch (e) {
      return "temp_" + _uuid(); // localStorage不可（プライベートモード等）
    }
  }

  function getFirstSeenAt() {
    try {
      var v = localStorage.getItem(LS_FIRST_SEEN_KEY);
      if (!v) { v = new Date().toISOString(); localStorage.setItem(LS_FIRST_SEEN_KEY, v); }
      return new Date(v);
    } catch (e) { return new Date(); }
  }

  function _walletAddr() {
    try {
      var w = localStorage.getItem("emuWallet"); // 既存コードと同じキーを再利用
      return w ? w.toLowerCase() : null;
    } catch (e) { return null; }
  }

  // JST日付キー（YYYY-MM-DD） — サーバー側Node集計と一致させる
  function dateKeyJST(d) {
    d = d || new Date();
    var fmt = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }); // sv-SE = YYYY-MM-DD
    return fmt.format(d);
  }

  // ---------------------------------------------------------------
  // Firestore 準備待ちキュー
  // ---------------------------------------------------------------
  var _queue = [], _flushing = false, _pollStarted = false, _pollStartedAt = 0;

  function _isFirestoreReady() {
    return !!(window.db && window.fbLib && window.fbLib.setDoc && window.fbLib.addDoc);
  }

  function _startPollIfNeeded() {
    if (_pollStarted) return;
    _pollStarted = true;
    _pollStartedAt = Date.now();
    var timer = setInterval(function () {
      if (_isFirestoreReady()) { clearInterval(timer); _flushQueue(); return; }
      if (Date.now() - _pollStartedAt > READY_POLL_TIMEOUT_MS) {
        clearInterval(timer);
        console.warn("[EmuFunnel] Firestore準備待ちタイムアウト。キューを破棄(" + _queue.length + "件)");
        _queue = [];
      }
    }, READY_POLL_MS);
  }

  function _flushQueue() {
    if (_flushing) return;
    _flushing = true;
    var jobs = _queue.slice();
    _queue = [];
    jobs.forEach(function (job) { _writeNow(job); });
    _flushing = false;
  }

  // デバウンス（完全メモリ内処理・書き込み0件）
  var _lastFired = {};
  function _debounced(stageKey) {
    var now = Date.now(), last = _lastFired[stageKey] || 0;
    if (now - last < DEBOUNCE_MS) return true;
    _lastFired[stageKey] = now;
    return false;
  }

  // ---------------------------------------------------------------
  // 書き込み
  // ---------------------------------------------------------------
  function _writeNow(job) {
    try {
      var lib = window.fbLib, db = window.db, now = new Date();

      // ① funnel_events（追記ログ・診断用）
      lib.addDoc(lib.collection(db, "funnel_events"), {
        uid: job.uid, stage: job.stage, event: job.eventKey,
        wallet: job.wallet || null, detail: job.detail || null,
        dateKey: dateKeyJST(now),
        ua: (navigator.userAgent || "").slice(0, 120), // 端末種別の粗い切り分け用。個人特定情報は含めない
        ts: now
      }).catch(function (e) { console.warn("[EmuFunnel] event write failed:", e.message); });

      // ② funnel_users（初回到達サマリー。生涯1回だけ）
      if (job.isFirstEver) {
        var userRef = lib.doc(db, "funnel_users", job.uid);
        var patch = { uid: job.uid, updatedAt: now };
        patch["reached_" + job.eventKey + "_at"] = now;
        if (job.wallet) patch.wallet = job.wallet;
        lib.setDoc(userRef, patch, { merge: true })
          .catch(function (e) { console.warn("[EmuFunnel] user summary write failed:", e.message); });
      }

      // ③ ウォレット紐付け（分かった時点で一度だけ）
      if (job.wallet) {
        try {
          if (localStorage.getItem(LS_WALLET_LINKED) !== job.wallet) {
            localStorage.setItem(LS_WALLET_LINKED, job.wallet);
            lib.setDoc(lib.doc(db, "funnel_users", job.uid), {
              wallet: job.wallet, walletLinkedAt: now
            }, { merge: true }).catch(function () {});
          }
        } catch (e) {}
      }
    } catch (e) {
      console.warn("[EmuFunnel] write error:", e);
    }
  }

  // ---------------------------------------------------------------
  // 公開API: track(eventKey, { detail, wallet })
  // ---------------------------------------------------------------
  function track(eventKey, extra) {
    extra = extra || {};
    if (!eventKey) return;
    if (_debounced(eventKey)) return; // 3秒以内の同一イベント連打は完全に無視

    var uid = getUid();
    var wallet = extra.wallet ? String(extra.wallet).toLowerCase() : _walletAddr();

    var lsKey = LS_DONE_PREFIX + eventKey, isFirstEver = false;
    try {
      if (!localStorage.getItem(lsKey)) {
        isFirstEver = true;
        localStorage.setItem(lsKey, new Date().toISOString());
      }
    } catch (e) {
      isFirstEver = true; // localStorage不可時の縮退動作
    }

    var stageInfo = null;
    for (var k in STAGES) { if (STAGES[k].key === eventKey) { stageInfo = STAGES[k]; break; } }

    var job = {
      uid: uid, eventKey: eventKey,
      stage: stageInfo ? stageInfo.stage : "unknown",
      wallet: wallet, detail: extra.detail || null,
      isFirstEver: isFirstEver
    };

    if (_isFirestoreReady()) { _writeNow(job); }
    else { _queue.push(job); _startPollIfNeeded(); }
  }

  // ウォレットが後から判明したときの明示的な紐付け
  function setWallet(address) {
    if (!address) return;
    var addr = String(address).toLowerCase(), uid = getUid();
    try {
      if (localStorage.getItem(LS_WALLET_LINKED) === addr) return;
      localStorage.setItem(LS_WALLET_LINKED, addr);
    } catch (e) {}
    if (_isFirestoreReady()) {
      window.fbLib.setDoc(window.fbLib.doc(window.db, "funnel_users", uid), {
        uid: uid, wallet: addr, walletLinkedAt: new Date()
      }, { merge: true }).catch(function () {});
    }
  }

  // ---------------------------------------------------------------
  // 初期化: LP訪問を自動発火 + 翌週再訪判定
  // ---------------------------------------------------------------
  function _init() {
    track(STAGES.LP_VISIT.key);

    // 翌週再訪: 初回訪問から7日以上経過していたら1回だけ発火
    var firstSeen = getFirstSeenAt();
    var daysSince = (Date.now() - firstSeen.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince >= 7) {
      track(STAGES.WEEK2_REVISIT.key, { detail: "days=" + Math.floor(daysSince) });
    }
  }

  _init(); // Firestore書き込みはキューイングされるためDOM構築を待たなくてよい

  window.EmuFunnel = {
    STAGES: STAGES, STAGE_ORDER: STAGE_ORDER,
    track: track, setWallet: setWallet, getUid: getUid
  };
})();
```

---

## 3. 各差し込み箇所への追加コード（diff）

### 3-1. ライブラリ読込タグ — `index.html:4538-4543`
```diff
 <script src="https://cdn.jsdelivr.net/npm/ethers@5.7.2/dist/ethers.umd.min.js"></script>
 <script src="/actionschema.js"></script>
 <script src="/actionhub.js"></script>
 <script src="https://cdn.socket.io/4.7.2/socket.io.min.js"></script>
 <script src="/wallet-success-ui.js"></script>
+<script src="/emu-funnel-tracker.js"></script>
 <script>
 // ★ GENESIS称号判定
```
理由: `window.ethereum` 依存はなく、`window.db`/`window.fbLib` は自前でポーリング待機するため読込順序に神経質になる必要はない。

### 3-2. ステップ2a/2b/2d — 有料パスボタン `index.html:10439-10457`
```diff
 document.getElementById("connectWalletButton").addEventListener("click", async () => {
   // ★ ボタンを押した瞬間にローディング表示
   _showSpLoadingOverlay();
+  window.EmuFunnel?.track(window.EmuFunnel.STAGES.WALLET_CLICK.key, { detail: "paid_button" });

   if (typeof window.ethereum === "undefined") {
     _cancelSpLoadingOverlay();
+    window.EmuFunnel?.track(window.EmuFunnel.STAGES.WALLET_NOT_DETECTED.key, { detail: "paid_button" });
     alert("MetaMaskがインストールされていません。");
     return;
   }

   try {
     const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
     const account = accounts[0];
     window.connectedAccount = account;
     currentUserId = account;
     localStorage.setItem("emuWallet", account);
+    window.EmuFunnel?.setWallet(account);
+    window.EmuFunnel?.track(window.EmuFunnel.STAGES.WALLET_SUCCESS.key, { detail: "paid_button", wallet: account });

     console.log("🦊 Wallet Connected:", account);
```

### 3-3. ステップ2c — catchブロック `index.html:10526-10539`
```diff
   } catch (err) {
     console.error("❌ 接続エラー:", err);
     _cancelSpLoadingOverlay();
+    // MetaMaskの標準拒否コード(4001)・ethers v5の ACTION_REJECTED を判定
+    const _isUserRejected = err && (err.code === 4001 || err.code === "ACTION_REJECTED");
+    window.EmuFunnel?.track(window.EmuFunnel.STAGES.WALLET_REJECTED.key, {
+      detail: _isUserRejected
+        ? "user_rejected:paid_button"
+        : "other_error:paid_button:" + (err && err.message || "").slice(0, 60)
+    });
     const _ws = document.getElementById("walletStatus");
```
補足: 「拒否」と「その他の失敗（タイムアウト等）」はステージとしては同じ2c扱いにし、`detail` で内訳を分ける。これで「ガス代の話に到達する前にそもそも拒否/失敗しているか」を切り分けられる。厳密に分離したい場合は `STAGES` に `WALLET_OTHER_ERROR` を追加してもよい。

### 3-4. ステップ2a/2b/2c/2d — 無料パスボタン `index.html:14594-14609`

現状 `onFreeNftClick` には `eth_requestAccounts` を囲む try/catch が**存在しない**（拒否時に例外が握りつぶされずローディングオーバーレイが残る既存バグ）。計測導入のついでに最小限のtry/catchを追加する。

```diff
 window.onFreeNftClick = async function () {
   _showSpLoadingOverlay();
+  window.EmuFunnel?.track(window.EmuFunnel.STAGES.WALLET_CLICK.key, { detail: "free_button" });

   if (!window.ethereum) {
     _cancelSpLoadingOverlay();
+    window.EmuFunnel?.track(window.EmuFunnel.STAGES.WALLET_NOT_DETECTED.key, { detail: "free_button" });
     alert("MetaMaskをインストールしてください");
     return;
   }

-  // ① connect
-  const accounts = await ethereum.request({ method: "eth_requestAccounts" });
-  window.connectedAccount = accounts[0];
-  currentUserId = accounts[0];
-  localStorage.setItem("emuWallet", accounts[0]);
+  // ① connect
+  let accounts;
+  try {
+    accounts = await ethereum.request({ method: "eth_requestAccounts" });
+  } catch (err) {
+    _cancelSpLoadingOverlay();
+    const _isUserRejected = err && (err.code === 4001 || err.code === "ACTION_REJECTED");
+    window.EmuFunnel?.track(window.EmuFunnel.STAGES.WALLET_REJECTED.key, {
+      detail: _isUserRejected ? "user_rejected:free_button"
+                              : "other_error:free_button:" + (err && err.message || "").slice(0, 60)
+    });
+    alert("ウォレット接続がキャンセルされました。");
+    return;
+  }
+  window.connectedAccount = accounts[0];
+  currentUserId = accounts[0];
+  localStorage.setItem("emuWallet", accounts[0]);
+  window.EmuFunnel?.setWallet(accounts[0]);
+  window.EmuFunnel?.track(window.EmuFunnel.STAGES.WALLET_SUCCESS.key, { detail: "free_button", wallet: accounts[0] });

   window.emuAuth = {
```

### 3-5. ステップ3 — 無料パス取得 `index.html:14657-14670`
```diff
   // 無料パス入場をFirebaseに記録（非ブロッキング）
   spTrack('free', account).catch(() => {});
+  // ファネル計測: 無料パス取得（=無料登録完了）— 初回のみ funnel_users に記録
+  window.EmuFunnel?.track(window.EmuFunnel.STAGES.FREE_PASS_CLAIMED.key, { wallet: account });
   goTomainapp();
 };
```

### 3-6. ステップ4 — 初回閲覧 `index.html:12734-12741`
```diff
 function closeSpMap() {
   document.getElementById("spMapOverlay").style.display = "none";
   document.body.classList.remove('spmap-open');
   closeSpDetail();
   _stopSpLive();
   if (_fwTimer) { clearTimeout(_fwTimer); _fwTimer = null; }
   _spCrowdLeave();
+  // ファネル計測: 初回閲覧（Emu投稿フィードを最初に開いた瞬間）
+  window.EmuFunnel?.track(window.EmuFunnel.STAGES.FIRST_VIEW.key);
 }
```

### 3-7. ステップ5 — 初回good `index.html:11456-11470`
```diff
         _spLogAdd({ type:'good', icon:'👍', title:'Good を送りました', detail: `「${(postData.title||'').slice(0,20)}」` });
         console.log("✅ Firebase: Good記録完了");
+        // ファネル計測: 初回good
+        window.EmuFunnel?.track(window.EmuFunnel.STAGES.FIRST_GOOD.key, { wallet: myAddr });
       } catch (e) {
         console.error("Firebase Good Error:", e);
       }
```

### 3-8. ステップ6 — 初回投稿 `index.html:11722-11730`
```diff
       await window.fbLib.addDoc(window.fbLib.collection(window.db, "posts"), postData);
       _spLogAdd({ type:'post', icon:'📝', title:'Emu に投稿しました', detail: (postTitleInput.value||postData.title||'').slice(0,25) });
       console.log("✅ 新規投稿を作成しました");
+      // ファネル計測: 初回投稿（更新モードでは発火させない＝新規投稿のみ）
+      window.EmuFunnel?.track(window.EmuFunnel.STAGES.FIRST_POST.key, { wallet: window.connectedAccount || null });
     }
```

### 3-9. ステップ8 — 公式パス購入 `index.html:7307-7321`
```diff
   const _resolvedPassType = window.hasPaidNFT ? 'paid' : 'free';
   localStorage.setItem('spPassType', _resolvedPassType);
+  // ファネル計測: 公式パス購入（=有料NFT保有が確認できた最初の瞬間。全ログイン経路がここを通る）
+  if (window.hasPaidNFT) {
+    window.EmuFunnel?.track(window.EmuFunnel.STAGES.OFFICIAL_PASS_PURCHASE.key, { wallet: window.connectedAccount || null });
+  }

   _showSpLoadingOverlay();
```
注意: 既存の `spTrack('paid', account)`（10521行）はボタンクリック時点で無条件に呼ばれており「有料パスボタンを押した回数」であって「実際に有料NFTを保有しているか」ではない。今回の8段目は `window.hasPaidNFT`（`checkHexaNFT()` 後に確定する実保有判定）を条件にしているため、より正確な「購入完了」計測になる。

---

## 4. Firestoreコレクション設計

### 4-1. ドキュメント構造

**`funnel_events`（追記オンリー・診断ログ）**
```
funnel_events/{autoId}
├─ uid: string        // 匿名ID（localStorage永続）
├─ stage: string      // "1" | "2a" | "2b" | "2c" | "2d" | "3" ... "8"
├─ event: string      // STAGE_ORDER のkey
├─ wallet: string|null
├─ detail: string|null // "paid_button" / "user_rejected:free_button" 等（PIIなし）
├─ dateKey: string     // "YYYY-MM-DD"（Asia/Tokyo）
├─ ua: string          // userAgent 先頭120文字（粗い端末判別用）
└─ ts: Timestamp
```

**`funnel_users`（匿名ID 1件=1ドキュメント。集計の主軸）**
```
funnel_users/{uid}
├─ uid: string
├─ wallet: string|null
├─ walletLinkedAt: Timestamp|null
├─ reached_lp_visit_at: Timestamp
├─ reached_wallet_attempt_click_at
├─ reached_wallet_attempt_not_detected_at
├─ reached_wallet_attempt_rejected_at
├─ reached_wallet_attempt_success_at
├─ reached_free_pass_claimed_at
├─ reached_first_view_at
├─ reached_first_good_at
├─ reached_first_post_at
├─ reached_week2_revisit_at
├─ reached_official_pass_purchase_at
└─ updatedAt: Timestamp
```

**`funnel_daily_summary`（サーバー側cronが書き込む。1日1行）**
```
funnel_daily_summary/{dateKey}
├─ dateKey: string
├─ counts: { lp_visit, wallet_attempt_click, ..., official_pass_purchase }
├─ dropRates: { "①LP訪問→②aボタン押下": 42.0, ... }
├─ worstStage: string   // 最も落ちる段
├─ generatedAt: Timestamp
└─ summaryLine: string  // "2026-07-19: lp_visit=120 / ... | 最大離脱: ②a→②d(53%)"
```

### 4-2. インデックス

`funnel_events` は単一フィールドの等価/範囲検索中心（`dateKey`単独、`uid`単独）なので**自動単一フィールドインデックスで足りる**。`funnel_users` の日次集計も「同一フィールドの範囲検索」のみで複合条件が別フィールドに跨らないため、これも自動インデックスで動作する（複合インデックス作成は不要）。

将来「特定日の特定ステージ到達者一覧を直接引きたい」等に備えた保険:
```json
{
  "indexes": [
    {
      "collectionGroup": "funnel_events",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "event", "order": "ASCENDING" },
        { "fieldPath": "dateKey", "order": "ASCENDING" },
        { "fieldPath": "ts", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "funnel_events",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "uid", "order": "ASCENDING" },
        { "fieldPath": "ts", "order": "DESCENDING" }
      ]
    }
  ],
  "fieldOverrides": []
}
```

### 4-3. セキュリティルール案

前提: このアプリは `signInAnonymously()` を呼んでおらず、既存の全コレクション（`posts`, `sp_stats` 等）が `request.auth == null` で書き込まれている。したがって「書き込みは誰でも許可、読み取りは不可（読み取りはバックエンドのAdmin SDK経由に限定）」という非対称ルールが、既存コードの信頼モデルと矛盾せず最も安全な現実解。

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // ── ファネル: 生ログ（追記のみ許可。読み取り・更新・削除は不可） ──
    match /funnel_events/{eventId} {
      allow create: if
        request.resource.data.keys().hasOnly(['uid','stage','event','wallet','detail','dateKey','ua','ts'])
        && request.resource.data.uid is string
        && request.resource.data.uid.size() < 100
        && request.resource.data.event is string
        && request.resource.data.event.size() < 60
        && (request.resource.data.wallet == null || request.resource.data.wallet.size() < 50)
        && (request.resource.data.detail == null || request.resource.data.detail.size() < 200)
        && (request.resource.data.ua == null || request.resource.data.ua.size() < 150);
      allow read, update, delete: if false; // ダッシュボードはバックエンド(Admin SDK)経由のみ
    }

    // ── ファネル: ユーザー別サマリー ──
    match /funnel_users/{uid} {
      allow create, update: if
        request.resource.data.uid == uid
        && request.resource.data.diff(resource == null ? {} : resource.data).affectedKeys()
             .hasOnly([
               'uid','wallet','walletLinkedAt','updatedAt',
               'reached_lp_visit_at','reached_wallet_attempt_click_at',
               'reached_wallet_attempt_not_detected_at','reached_wallet_attempt_rejected_at',
               'reached_wallet_attempt_success_at','reached_free_pass_claimed_at',
               'reached_first_view_at','reached_first_good_at','reached_first_post_at',
               'reached_week2_revisit_at','reached_official_pass_purchase_at'
             ]);
      allow read, delete: if false;
    }

    // ── ファネル: 日次サマリー（Admin SDKのみが書く） ──
    match /funnel_daily_summary/{dateKey} {
      allow read, write: if false;
    }
  }
}
```

補足: Admin SDK（`backend/server.js` の firebase-admin）はセキュリティルールを**バイパス**して読み書きできるため、「クライアントからは読めない」制約はダッシュボードの安全性を損なわない。将来 `signInAnonymously()` を有効化すれば `request.auth.uid == uid` の真の所有者チェックに強化できる（現状は誰でもどのuidにも書けるが、これは既存の `posts`/`sp_stats` と同水準のリスクであり分析用途としては許容範囲）。

---

## 5. 日次集計の仕組み

### 選択: 既存Node/Expressバックエンド（Render）+ node-cron

- `backend/server.js` は既にRender上で常時稼働し、`firebase-admin` 導入済み、`node-cron` も稼働中（489-491, 567行）。**追加コストゼロ**。
- Cloud Functions のスケジュール/Firestoreトリガーは **Blazeプラン（従量課金）が必須**。現状 Spark（無料枠）想定であり「無料枠に収まるよう最適化する」制約と真っ向から矛盾する。
- `count()` 集計クエリ（Admin SDK v13で利用可）なら、対象日のドキュメント件数分ではなく**最大約1000件ごとに1読み取り相当**の低コストで集計できる。

### 集計コード（`backend/server.js:353`、既存 `/admin/restriction-stats` の直後に追加）

```javascript
// =====================
// ファネル計測: 日次集計 & 管理者向け取得API
// =====================
const FUNNEL_STAGE_ORDER = [
  "lp_visit", "wallet_attempt_click", "wallet_attempt_not_detected",
  "wallet_attempt_rejected", "wallet_attempt_success", "free_pass_claimed",
  "first_view", "first_good", "first_post", "week2_revisit", "official_pass_purchase"
];

const FUNNEL_STAGE_LABEL = {
  lp_visit: "①LP訪問",
  wallet_attempt_click: "②aボタン押下",
  wallet_attempt_not_detected: "②bMetaMask未検出",
  wallet_attempt_rejected: "②c拒否/失敗",
  wallet_attempt_success: "②d接続成功",
  free_pass_claimed: "③無料パス取得",
  first_view: "④初回閲覧",
  first_good: "⑤初回good",
  first_post: "⑥初回投稿",
  week2_revisit: "⑦翌週再訪",
  official_pass_purchase: "⑧公式パス購入"
};

// 主要ファネル（分岐系2b/2cを除いた「進捗として意味を持つ」順序。離脱率計算用）
const FUNNEL_MAIN_SEQUENCE = [
  "lp_visit", "wallet_attempt_click", "wallet_attempt_success",
  "free_pass_claimed", "first_view", "first_good", "first_post",
  "week2_revisit", "official_pass_purchase"
];

function _jstDateKey(d) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(d);
}

// 指定JST日付の 00:00:00〜翌日00:00:00 をUTC Timestamp範囲として返す
function _jstDayRange(dateKey) {
  const admin = require("firebase-admin");
  const start = new Date(dateKey + "T00:00:00+09:00");
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return {
    start: admin.firestore.Timestamp.fromDate(start),
    end: admin.firestore.Timestamp.fromDate(end)
  };
}

// 指定日に「新規到達」したユーザー数を各ステージごとに count() で取得
async function computeFunnelDailyCounts(dateKey) {
  if (!db) return null;
  const { start, end } = _jstDayRange(dateKey);
  const counts = {};
  for (const stage of FUNNEL_STAGE_ORDER) {
    const field = "reached_" + stage + "_at";
    try {
      const snap = await db.collection("funnel_users")
        .where(field, ">=", start).where(field, "<", end)
        .count().get();
      counts[stage] = snap.data().count;
    } catch (e) {
      console.warn("⚠️ funnel count failed:", stage, e.message);
      counts[stage] = 0;
    }
  }
  return counts;
}

// 離脱率と「最も落ちる段」を計算
function computeDropRatesAndWorst(counts) {
  const dropRates = {};
  let worstStage = null, worstRate = -1;
  for (let i = 0; i < FUNNEL_MAIN_SEQUENCE.length - 1; i++) {
    const from = FUNNEL_MAIN_SEQUENCE[i], to = FUNNEL_MAIN_SEQUENCE[i + 1];
    const fromCount = counts[from] || 0, toCount = counts[to] || 0;
    const rate = fromCount > 0 ? (fromCount - toCount) / fromCount : 0;
    const key = FUNNEL_STAGE_LABEL[from] + "→" + FUNNEL_STAGE_LABEL[to];
    dropRates[key] = Math.round(rate * 1000) / 10; // %表記（小数1桁）
    if (fromCount >= 5 && rate > worstRate) { // 母数5未満はノイズとして除外
      worstRate = rate;
      worstStage = key;
    }
  }
  return {
    dropRates,
    worstStage: worstStage ? `${worstStage}（${Math.round(worstRate * 1000) / 10}%離脱）` : "データ不足"
  };
}

function buildSummaryLine(dateKey, counts, worstStage) {
  const parts = FUNNEL_STAGE_ORDER.map(s => `${s}=${counts[s] || 0}`).join(" / ");
  return `[FunnelDaily] ${dateKey}: ${parts} | 最大離脱: ${worstStage}`;
}

// 指定日(デフォルト=前日 JST)を集計して保存 + 1行ログ出力
async function runFunnelDailyAggregation(targetDateKey) {
  if (!db) { console.warn("⚠️ ファネル日次集計スキップ: Firestore未接続"); return null; }
  const dateKey = targetDateKey || _jstDateKey(new Date(Date.now() - 24 * 60 * 60 * 1000));
  try {
    const counts = await computeFunnelDailyCounts(dateKey);
    const { dropRates, worstStage } = computeDropRatesAndWorst(counts);
    const summaryLine = buildSummaryLine(dateKey, counts, worstStage);

    await db.collection("funnel_daily_summary").doc(dateKey).set({
      dateKey, counts, dropRates, worstStage, summaryLine, generatedAt: new Date()
    });

    console.log(summaryLine); // ★要件: 毎日1行で出力
    return { dateKey, counts, dropRates, worstStage, summaryLine };
  } catch (e) {
    console.error("❌ ファネル日次集計エラー:", e.message);
    return null;
  }
}

// 毎日04:10 JSTに前日分を集計（他バッチ(02:00台)と時間をずらす）
cron.schedule("10 4 * * *", () => {
  console.log("⏰ ファネル日次集計バッチ起動");
  runFunnelDailyAggregation();
}, { timezone: "Asia/Tokyo" });

// ── 管理者向け: ファネル統計取得API（既存 /admin/restriction-stats と同じ署名認証） ──
app.get("/admin/funnel-stats", async (req, res) => {
  const { address, action, timestamp, signature, days } = req.query;
  if (!verifyOwnerSignature({ address, action: "funnel-stats", timestamp: parseInt(timestamp), signature }))
    return res.status(403).json({ error: "UNAUTHORIZED" });
  if (!db) return res.json({ cumulative: null, dailySummaries: [] });

  try {
    // ① 累積ファネル（全期間）
    const cumulative = {};
    const admin = require("firebase-admin");
    for (const stage of FUNNEL_STAGE_ORDER) {
      const field = "reached_" + stage + "_at";
      const snap = await db.collection("funnel_users")
        .where(field, ">", admin.firestore.Timestamp.fromDate(new Date(0)))
        .count().get();
      cumulative[stage] = snap.data().count;
    }
    const { dropRates, worstStage } = computeDropRatesAndWorst(cumulative);

    // ② 直近N日分の日次サマリー（保存済みを読むだけ＝低コスト）
    const dayCount = Math.min(parseInt(days) || 30, 90);
    const summarySnap = await db.collection("funnel_daily_summary")
      .orderBy("dateKey", "desc").limit(dayCount).get();
    const dailySummaries = summarySnap.docs.map(d => d.data())
      .sort((a, b) => a.dateKey.localeCompare(b.dateKey));

    return res.json({
      cumulative, dropRates, worstStage,
      stageOrder: FUNNEL_STAGE_ORDER, stageLabel: FUNNEL_STAGE_LABEL,
      dailySummaries
    });
  } catch (e) {
    console.error("❌ funnel-stats取得エラー:", e.message);
    return res.status(500).json({ error: e.message });
  }
});

// 手動トリガー（デバッグ用。x-admin-key方式で既存の運用系と統一）
app.post("/admin/funnel-stats/run-now", async (req, res) => {
  const adminKey = req.headers["x-admin-key"];
  if (adminKey !== process.env.ADMIN_SECRET_KEY) return res.status(403).json({ error: "UNAUTHORIZED" });
  const dateKey = req.body && req.body.dateKey; // 省略時は前日
  const result = await runFunnelDailyAggregation(dateKey);
  return res.json({ success: !!result, result });
});
```

### コスト試算（無料枠との比較）

| 項目 | 想定 | 内訳 |
|---|---|---|
| クライアント書き込み | 1人の全ステージ完走で最大 約17〜22件（生涯累計・1日に集中しない） | 1日1,000人がLP訪問、300人がボタンクリック、100人が接続成功、50人が無料パス取得の場合 ≈ 1,000×2 + 300×2 + 100×2 + 50×2 ≈ **2,900件/日** ≪ 20,000件/日（Spark上限） |
| 日次集計cron | 1日1回 × 11ステージ × `count()` 1クエリ | `count()` は概ね1,000件ごとに1読み取り相当。数千ユーザー規模でも**1日数十読み取り相当** |
| ダッシュボード閲覧 | 開いた回数分 | 1日数回でも無視できる規模 |

### バッチ/デバウンスの判断

- **デバウンス（採用）**: 同一ステージの3秒以内の連打をメモリ内でスキップ。ボタン連打・ダブルクリックによる無駄な書き込みを防ぐ。
- **milestone方式（採用・削減効果が最大）**: `funnel_users` への書き込みを各ステージ「生涯1回」に制限。ログイン毎の再書き込みを防ぐ。
- **`writeBatch`（不採用）**: `writeBatch` は複数ドキュメント書き込みをアトミックにまとめる機能であり、**課金上のドキュメント書き込み数は削減されない**（N件書けばNカウント）。今回は1イベントで書くのが最大2件、相互依存もないため、メリットはラウンドトリップ削減程度。書き込み数そのものを減らす前述2施策の方が費用対効果が高い。

---

## 6. ダッシュボードHTML（`frontend/public/admin-funnel-dashboard.html`）

認証は既存の `verifyOwnerSignature`（SP_OWNERウォレット署名）方式をそのまま利用し、生データはクライアントから直接Firestoreを読まず必ず `/admin/funnel-stats` 経由で取得する（4-3のルールと整合）。

```html
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>Emu/LP ファネル計測ダッシュボード（管理者専用）</title>
<script src="https://cdn.jsdelivr.net/npm/ethers@5.7.2/dist/ethers.umd.min.js"></script>
<style>
  :root {
    --bg: #0f1115; --card: #171a21; --border: #2a2e38;
    --text: #e8e8ec; --muted: #8b8f99; --accent: #3fa9f5;
    --danger: #ff5d5d; --ok: #35c98f;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Kaku Gothic ProN", Meiryo, sans-serif;
    padding: 24px;
  }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { color: var(--muted); font-size: 13px; margin-bottom: 24px; }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 20px; margin-bottom: 20px; }
  #gate { max-width: 420px; margin: 80px auto; text-align: center; }
  #gate button, .toolbar button {
    background: var(--accent); color: #fff; border: none; border-radius: 8px;
    padding: 10px 18px; font-size: 14px; cursor: pointer; font-weight: 600;
  }
  #gate button:hover, .toolbar button:hover { opacity: 0.9; }
  #gateStatus { margin-top: 12px; font-size: 13px; color: var(--muted); min-height: 18px; }
  .toolbar { display: flex; gap: 10px; align-items: center; margin-bottom: 20px; }
  .toolbar span { color: var(--muted); font-size: 13px; }
  #dashboard { display: none; }

  /* ── ファネル図 ── */
  .funnel-row { display: flex; align-items: center; margin: 10px 0; gap: 12px; }
  .funnel-label { width: 190px; font-size: 13px; color: var(--muted); flex-shrink: 0; }
  .funnel-bar-wrap { flex: 1; background: #0a0c10; border-radius: 6px; overflow: hidden; height: 28px; position: relative; }
  .funnel-bar { height: 100%; background: linear-gradient(90deg, var(--accent), #6fd0ff); display: flex; align-items: center; padding-left: 10px; font-size: 12px; font-weight: 700; color: #05131c; transition: width .4s ease; white-space: nowrap; }
  .funnel-count { width: 70px; text-align: right; font-size: 13px; font-variant-numeric: tabular-nums; flex-shrink: 0; }
  .funnel-drop { width: 130px; font-size: 12px; color: var(--danger); text-align: right; flex-shrink: 0; }
  .funnel-drop.low { color: var(--muted); }
  .worst-banner { background: rgba(255,93,93,0.12); border: 1px solid rgba(255,93,93,0.4); color: var(--danger); border-radius: 8px; padding: 12px 16px; font-size: 14px; font-weight: 700; margin-bottom: 16px; }

  /* ── 日次サマリーテーブル ── */
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  th, td { padding: 6px 8px; border-bottom: 1px solid var(--border); text-align: right; white-space: nowrap; }
  th:first-child, td:first-child { text-align: left; }
  th { color: var(--muted); font-weight: 600; position: sticky; top: 0; background: var(--card); }
  tr:hover td { background: #1d212b; }
  .table-scroll { max-height: 480px; overflow: auto; }
  .worst-cell { color: var(--danger); font-size: 11px; }
</style>
</head>
<body>

  <div id="gate">
    <h1>🔒 管理者認証</h1>
    <p class="sub">オーナーウォレットで接続・署名してください</p>
    <button id="connectBtn">MetaMaskで接続して認証</button>
    <div id="gateStatus"></div>
  </div>

  <div id="dashboard">
    <h1>Emu/LP 8段階計測ファネル</h1>
    <div class="sub">最終更新: <span id="lastUpdated">-</span></div>

    <div class="toolbar">
      <button id="refreshBtn">再取得</button>
      <span id="rangeLabel">直近30日</span>
    </div>

    <div id="worstBanner" class="worst-banner" style="display:none;"></div>

    <div class="card">
      <h2 style="margin-top:0;font-size:15px;">累積ファネル（全期間・新規到達ユーザー数ベース）</h2>
      <div id="funnelChart"></div>
    </div>

    <div class="card">
      <h2 style="margin-top:0;font-size:15px;">日次サマリー（1日1行）</h2>
      <div class="table-scroll">
        <table id="dailyTable">
          <thead><tr id="dailyTableHead"></tr></thead>
          <tbody id="dailyTableBody"></tbody>
        </table>
      </div>
    </div>
  </div>

<script>
  const API_BASE = "https://emu-realtime.onrender.com"; // backend/server.js のデプロイ先
  const SP_OWNER_ADDRESS = "0xdcc687c05f130e57597a8525771299a4efb6edf7"; // index.html の SP_OWNER と同一
  let _lastFetchArgs = null;

  // 認証: SP_OWNERウォレットで署名 → /admin/funnel-stats
  document.getElementById("connectBtn").addEventListener("click", async () => {
    const statusEl = document.getElementById("gateStatus");
    if (!window.ethereum) { statusEl.textContent = "❌ MetaMaskが見つかりません。"; return; }
    try {
      statusEl.textContent = "接続中...";
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      const address = accounts[0];

      if (address.toLowerCase() !== SP_OWNER_ADDRESS.toLowerCase()) {
        statusEl.textContent = "❌ このウォレットには閲覧権限がありません。";
        return;
      }

      statusEl.textContent = "署名をお願いします...";
      const provider = new ethers.providers.Web3Provider(window.ethereum);
      const signer = provider.getSigner();
      const timestamp = Math.floor(Date.now() / 1000);
      const action = "funnel-stats";
      const message = `SchoolPark Admin:${action}:${timestamp}`;
      const signature = await signer.signMessage(message);

      _lastFetchArgs = { address, action, timestamp, signature };
      await loadFunnelStats();

      document.getElementById("gate").style.display = "none";
      document.getElementById("dashboard").style.display = "block";
    } catch (e) {
      console.error(e);
      statusEl.textContent = "❌ 認証に失敗しました: " + (e.message || e);
    }
  });

  document.getElementById("refreshBtn").addEventListener("click", () => {
    if (_lastFetchArgs) loadFunnelStats();
  });

  async function loadFunnelStats() {
    const { address, action, timestamp, signature } = _lastFetchArgs;
    const url = `${API_BASE}/admin/funnel-stats?address=${encodeURIComponent(address)}&action=${action}&timestamp=${timestamp}&signature=${encodeURIComponent(signature)}&days=30`;
    const res = await fetch(url);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert("取得失敗: " + (err.error || res.status));
      return;
    }
    const data = await res.json();
    renderFunnelChart(data);
    renderDailyTable(data);
    document.getElementById("lastUpdated").textContent = new Date().toLocaleString("ja-JP");
  }

  function renderFunnelChart(data) {
    const { cumulative, stageOrder, stageLabel, worstStage } = data;
    const container = document.getElementById("funnelChart");
    container.innerHTML = "";
    const maxVal = Math.max(1, cumulative[stageOrder[0]] || 1);

    stageOrder.forEach((key, i) => {
      const count = cumulative[key] || 0;
      const pct = Math.max(2, Math.round((count / maxVal) * 100));
      const prevKey = stageOrder[i - 1];
      const prevCount = prevKey ? (cumulative[prevKey] || 0) : null;
      const dropPct = (prevCount && prevCount > 0) ? Math.round(((prevCount - count) / prevCount) * 1000) / 10 : null;

      const row = document.createElement("div");
      row.className = "funnel-row";
      row.innerHTML = `
        <div class="funnel-label">${stageLabel[key] || key}</div>
        <div class="funnel-bar-wrap">
          <div class="funnel-bar" style="width:${pct}%;">${count}</div>
        </div>
        <div class="funnel-count">${count}人</div>
        <div class="funnel-drop ${dropPct !== null && dropPct > 30 ? '' : 'low'}">${dropPct !== null ? "↓" + dropPct + "%" : ""}</div>
      `;
      container.appendChild(row);
    });

    const banner = document.getElementById("worstBanner");
    if (worstStage) {
      banner.style.display = "block";
      banner.textContent = "⚠️ 最も離脱が大きい段階: " + worstStage;
    }
  }

  function renderDailyTable(data) {
    const { dailySummaries, stageOrder, stageLabel } = data;
    const head = document.getElementById("dailyTableHead");
    const body = document.getElementById("dailyTableBody");

    head.innerHTML = `<th>日付</th>` + stageOrder.map(k => `<th>${stageLabel[k] || k}</th>`).join("") + `<th>最大離脱</th>`;

    body.innerHTML = "";
    const rows = [...(dailySummaries || [])].sort((a, b) => b.dateKey.localeCompare(a.dateKey));
    rows.forEach(row => {
      const tr = document.createElement("tr");
      const cells = [`<td>${row.dateKey}</td>`]
        .concat(stageOrder.map(k => `<td>${(row.counts && row.counts[k]) || 0}</td>`))
        .concat([`<td class="worst-cell">${row.worstStage || "-"}</td>`]);
      tr.innerHTML = cells.join("");
      body.appendChild(tr);
    });

    if (rows.length === 0) {
      body.innerHTML = `<tr><td colspan="${stageOrder.length + 2}" style="text-align:center;color:var(--muted);">まだ日次集計データがありません（cronは毎日04:10 JSTに前日分を生成します）</td></tr>`;
    }
  }
</script>
</body>
</html>
```

### 認証設計の要点
- ページ自体は静的HTMLで誰でも開けるが、`/admin/funnel-stats` はサーバー側で `verifyOwnerSignature()`（`server.js:262-273`、SP_OWNER署名検証、有効期限300秒）を通らない限り403を返すため、実データはSP_OWNER以外に渡らない。既存の `/admin/restriction-stats` と完全に同じ認証方式で新しい仕組みは増えていない。
- `<meta name="robots" content="noindex, nofollow">` で誤インデックスを防止。
- クライアントは生の `funnel_events`/`funnel_users` を直接読まない（4-3のルールで `read: false`）。

---

## 7. 適用手順

1. `frontend/public/emu-funnel-tracker.js` を新規作成（第2節のコードそのまま）
2. `frontend/public/index.html` に第3節の8箇所のdiffを適用
3. `backend/server.js` に第5節のコードを追加（既存の `ADMIN_SECRET_KEY` を流用、追加の環境変数は不要）
4. Firebase Consoleで第4節のセキュリティルールを適用（3コレクションのみ追記、既存ルールとの衝突なし）
5. `frontend/public/admin-funnel-dashboard.html` を新規作成してVercelにデプロイ

## 8. 副次的に発見した既存バグ（本diffで同時修正）

`onFreeNftClick`（`index.html:14605` 付近）に `eth_requestAccounts` の try/catch が無く、ユーザーがMetaMaskの接続を拒否すると例外が握りつぶされずローディングオーバーレイが残ったままになる。3-4節のdiffで併せて修正している。
