# 公式AIキュレーター（毎時自動投稿システム）設計書

担当: 技術開発部 / 作成日: 2026-07-19

## 0. 調査結果サマリー（設計の前提となる既存実装の事実）

`backend/server.js`（全1411行）と `frontend/public/index.html` を確認。

### `posts` コレクション（Firestore）の実スキーマ
投稿の新規作成は現状フロントがクライアントSDKで直接 `addDoc(collection(db,"posts"), postData)`（`index.html` 11671〜11727行）。加えてサーバー側にも書き込み口があり、`scheduled_posts` 機能（`backend/server.js` 493〜653行）が `db.collection("posts").add({...})` で firebase-admin から直接書いている前例がある。

```js
{
  title: string,
  body: string,
  tags: "comma,separated,no-hash",      // "#"は付けない。表示時に分割
  userType: "paid" | "free" | "guest",  // normalizeUserType()で決定。バッジ表示に直結
  address: "0x...",                     // 小文字化して保存される場面が多い
  userId: string,
  createdAt: Date, updatedAt: Date,
  goodCount: number, changeCount: number,
  goodUsers: string[], changeUsers: string[],  // arrayUnionで蓄積
  imageUrl?: string,          // 任意（base64データURL）
  scheduledPostId?: string,   // 予約投稿経由の場合のみ
}
```

- good/change: `updateDoc(postRef, { goodCount: increment(1), goodUsers: arrayUnion(myAddr) })`（11451〜11513行）。ランキングは `posts` を最大500件キャッシュ取得（5分TTL、`_rankingCache`）して集計（974〜1104行付近）。
- EMUERの配布（`addGoodBatch`）は `goodCount` 連動の自動ミントではなく、`airdrop_registrations` / `monthly_distributions` / `bonus_rewards` 経由の**管理者操作トリガー**。→ AI投稿にGoodが付いても自動で誰かにEMUERが払い出される設計にはなっておらず、誤発火リスクが低い。
- `user_profiles`: doc ID = ウォレットアドレス（小文字）。フィールドは `address, displayName, updatedAt` のみ（947〜958行）。
- **重要な落とし穴**: `getUserTypeBadge(type, address)`（`index.html` 11113行）は `paid`/`free`/default の3値しか想定しておらず、**未知の値はdefault（ゲスト扱い）になりAI司書であることが伝わらない**。要件「正体を明示」に反するため case 追加が必須（1.参照）。
- **最重要の前例**: `SCHEDULED_POSTS_COL = "scheduled_posts"` が `cron.schedule("*/5 * * * *", ...)`（node-cron、Asia/Tokyo）で定期実行し `posts` に公開するパターンが本番稼働中。日次バッチ `runAirdropBatch()` も `cron.schedule("0 2 * * *", ...)` で稼働。→ 今回は**この延長として実装するのが最も現実的**。
- Room1（学びコンテンツ）は `room1_contents`（734行〜）で `theme/subTheme/subSubTheme/summary/body/note/noteUrl` を保持。ネタ元の型設計の参考（noteUrlの前例あり）。
- `backend/package.json` の依存は `cors, ethers, express, firebase-admin, node-cron, socket.io` のみ。Anthropic系SDK未導入。**Node標準の `fetch` で依存を増やさず実装可能**。
- `ADMIN_SECRET_KEY` を `x-admin-key` ヘッダーで検証する管理者API保護パターンが既存（248〜253行）。今回のキルスイッチ/ログAPIもこれに合わせる。

---

## 1. `posts` スキーマへのAI投稿の載せ方

既存フィールドはそのまま使い、以下を**追加**する（既存の人間投稿には無いフィールドなので後方互換）。

```js
{
  // ── 既存フィールドはそのまま ──
  title, body, tags, address, userId, createdAt, updatedAt,
  goodCount: 0, changeCount: 0, goodUsers: [], changeUsers: [],

  // ── AI投稿を識別するための追加フィールド ──
  userType: "ai_curator",        // 既存の paid/free/guest とは別の新値
  authorType: "ai_curator",      // 横断的な分類キー。人間投稿には存在しない = undefined が human
  isAI: true,                    // where("isAI","==",true) で単純抽出できる軽量フラグ
  aiDisclosure: true,            // 景表法対応：明示開示済みであることの内部監査フラグ
  aiModel: "claude-haiku-4-5-20251001",
  sourceType: "aozora" | "law" | "system",
  sourceId: "ai_curator_sources/<docId>",  // ネタ元参照（重複防止・出典表示）
  relatedPostId: "posts/<docId>" | null,   // 誘導リンク先（5.で自動選定）
}
```

既存投稿は `authorType` が存在しない = 人間投稿と判定できるため、**既存500件規模のマイグレーション不要**。

### 投稿者アドレスの設計（落とし穴）
`address` は多くのコードパスで `.toLowerCase()` や配列比較（`goodUsers.includes(myAddr)`）に使われる。文字列である限りクラッシュはしないが、本物のアドレスでないと将来の管理画面（ランキング・報酬送金）で事故る（存在しないアドレスへの送金がtx失敗する等）。そこで:

- `ethers.Wallet.createRandom()` で**秘密鍵を一切保存しない使い捨てEOAアドレス**を1つ生成し `AI_CURATOR_ADDRESS` として環境変数に固定（署名も送金もしないアイデンティティ用途のみなので秘密鍵は不要＝破棄してよい）。
- `user_profiles` に1件登録:

```js
await db.collection('user_profiles').doc(AI_CURATOR_ADDRESS.toLowerCase()).set({
  address: AI_CURATOR_ADDRESS.toLowerCase(),
  displayName: "SchoolPark公式・AI司書",
  bio: "青空文庫・法律・お金の制度から「学校が教えないお金・ネット・人生の知識」を毎時お届けする公式AIキュレーターです。投稿はすべて生成AI（Claude）による自動生成であり、原典（著作権切れの名著・法令・公的制度）の紹介に限定しています。個人の感想・投資助言は行いません。",
  isAI: true,
  updatedAt: new Date().toISOString()
}, { merge: true });
```

- ランキング/報酬系の管理画面には「`isAI === true` のアドレスは除外」フィルタを1行追加することを推奨（誤ってボーナス送金対象に選ばれない事故防止）。

### 必須のフロント変更（正体明示）
`getUserTypeBadge()`（`frontend/public/index.html` 11113行）に case 追加。**これをやらないと「正体を明示」要件を満たせない。**

```js
function getUserTypeBadge(type, address) {
  let badge = '';
  switch (type) {
    case 'paid':       badge = `<span class="badge badge-paid">有料利用者</span>`; break;
    case 'free':       badge = `<span class="badge badge-free">無料利用者</span>`; break;
    case 'ai_curator':  // ★追加
      badge = `<span class="badge badge-ai" title="この投稿はAIによる自動生成です">🤖 SchoolPark公式・AI司書（自動生成）</span>`;
      break;
    default:           badge = `<span class="badge badge-guest">ゲスト利用者</span>`;
  }
  ...
```

---

## 2. 実行環境の選定

### 採用: 既存Renderバックエンド（`backend/server.js`）の `node-cron` に統合

| 選択肢 | 判定 | 理由 |
|---|---|---|
| **Render + node-cron（既存パターン踏襲）** | ◎ 採用 | `scheduled_posts`（5分毎）・`runAirdropBatch`（日次）が同構造で本番稼働中。firebase-admin初期化済み・env管理済み・ログ運用済み。**新規インフラ・新規課金なし**。「既存スタックに載る規模」に最も合致 |
| Cloud Functions + Cloud Scheduler | △ 不採用 | GCPプロジェクトの請求・IAM・別デプロイパイプラインが新規に必要で、既存Render運用と二重管理になる。コード資産の移植コストも発生 |
| GitHub Actions cron（単独） | △ 補助のみ | 無料だがFirestore admin鍵をGitHub Secretsに置くことになり秘密情報の管理場所が増える。信頼済み実行環境があるのに二重化するメリットが薄い |

**懸念**: Render無料プランは15分無アクセスでスリープする。既存の日次バッチ（資金移動を伴う `runAirdropBatch`）がcron頼みで運用されている実績から**有料プラン（常時稼働）の可能性が高い**が未確認。念のため:

- **バックアップトリガー**: GitHub Actions（無料）で毎時5分に `curl -X POST https://emu-realtime.onrender.com/api/ai-curator/run -H "x-admin-key: ${{ secrets.ADMIN_SECRET_KEY }}"` を実行。本処理は**冪等**（同じ時間帯に1回しか投稿しない）に設計するため二重発火しても安全。Render側が生きていればGitHub Actions側は即終了する。

---

## 3. Claude API 投稿生成コード（完全版）

### 3.1 環境変数（新規）
```
ANTHROPIC_API_KEY=sk-ant-...      # サーバー側のみ。フロントには絶対に渡さない
AI_CURATOR_ADDRESS=0x...          # ethers.Wallet.createRandom() で生成した識別用アドレス
ADMIN_SECRET_KEY=（既存を流用）    # /api/ai-curator/* の保護
ALERT_WEBHOOK_URL=（任意）        # 障害時通知用のDiscord/Slack Webhook。未設定でも動作
```

### 3.2 メインコード（`backend/server.js` に追加）

```js
// ════════════════════════════════════════
// AI Curator（公式AIキュレーター）システム
// 既存の scheduled_posts / runAirdropBatch と同じ node-cron パターンを踏襲
// ════════════════════════════════════════

const ANTHROPIC_API_KEY   = process.env.ANTHROPIC_API_KEY || "";
const AI_CURATOR_ADDRESS  = (process.env.AI_CURATOR_ADDRESS || "0x000000000000000000000000000000000000AI").toLowerCase();
const AI_CURATOR_MODEL    = "claude-haiku-4-5-20251001";
const ALERT_WEBHOOK_URL   = process.env.ALERT_WEBHOOK_URL || "";

const AI_CURATOR_SOURCES_COL = "ai_curator_sources";
const AI_CURATOR_LOGS_COL    = "ai_curator_logs";
const AI_CURATOR_STATE_DOC   = "system_config/ai_curator"; // { enabled, lastHourKey, dailyCount, dailyDateKey, lastPostId }

// ── 開示テキスト（LLMの出力に依存させず、必ずコード側で機械的に付与する） ──
// ※文言は法務レビュー反映版（docs/plans/06-legal-review.md 4-3項）。
//   コード側固定文のためAPIの生成トークンには加算されない。
const AI_DISCLOSURE_FOOTER = (sourceMeta) => `

---
🤖 この投稿はSchoolPark公式AIキュレーター「AI司書」による自動生成です。
出典：${sourceMeta.citationLabel}（青空文庫・法令・公的制度など公開情報に基づく紹介）
生成モデル：Claude（${AI_CURATOR_MODEL}）
※本投稿は公開情報の教養としての紹介であり、法律相談・税務相談・投資助言・投資勧誘には該当しません。個別の法的判断や資産運用の意思決定は、弁護士・税理士・ファイナンシャルプランナー等の専門家にご相談のうえ行ってください。内容の正確性には努めていますが、最新の法改正等を反映していない場合があります。誤りに気づかれた場合は運営お問い合わせ窓口までご連絡ください。`;

// ── JST時刻キー（"2026-07-19T13"）── 同一時間帯の二重投稿防止に使う
function _jstHourKey(d = new Date()) {
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 13); // "YYYY-MM-DDTHH"
}
function _jstDateKey(d = new Date()) {
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10); // "YYYY-MM-DD"
}

// ── 時間帯カテゴリ振り分け（6.のスケジュール表に対応） ──
function _categoryForHour(jstHour) {
  if (jstHour >= 7  && jstHour < 9)  return "system"; // 通勤・通学：制度もの・実用
  if (jstHour >= 9  && jstHour < 12) return "law";    // 午前：契約・消費者保護
  if (jstHour >= 12 && jstHour < 13) return "aozora"; // 昼休み：読み物
  if (jstHour >= 13 && jstHour < 18) return (jstHour % 2 === 0 ? "law" : "system"); // 午後：交互
  if (jstHour >= 18 && jstHour < 21) return "aozora"; // ゴールデンタイム：名著・人生訓
  if (jstHour >= 21 && jstHour < 24) return "system"; // 夜：資産形成・節約系
  return "aozora"; // 0-6時（深夜帯）：軽めの読み物中心
}

// ── ネタ元選定：未使用優先・同カテゴリ内でランダム性を持たせる ──
async function _pickAiCuratorSource(category) {
  const snap = await db.collection(AI_CURATOR_SOURCES_COL)
    .where("category", "==", category)
    .where("active", "==", true)
    .orderBy("lastUsedAt", "asc") // null（未使用）が最も古い扱いで先頭に来る
    .limit(5)
    .get();
  if (snap.empty) {
    // 指定カテゴリが枯渇/未整備な場合は他カテゴリにフォールバック
    const fallback = await db.collection(AI_CURATOR_SOURCES_COL)
      .where("active", "==", true).orderBy("lastUsedAt", "asc").limit(5).get();
    if (fallback.empty) return null;
    const i = Math.floor(Math.random() * fallback.docs.length);
    return { id: fallback.docs[i].id, ...fallback.docs[i].data() };
  }
  const i = Math.floor(Math.random() * snap.docs.length); // 上位5件からランダム（毎回同じ順にならないように）
  return { id: snap.docs[i].id, ...snap.docs[i].data() };
}

// ── 関連ノートの自動選定（既存の _getRankingSource() を再利用＝追加の読み取りコストなし） ──
async function _pickRelatedPost(sourceTags = []) {
  try {
    const { postsSnap } = await _getRankingSource(); // 既存のランキング用キャッシュ（5分TTL）
    let best = null, bestScore = -1;
    postsSnap.docs.forEach(doc => {
      const d = doc.data();
      if (!d.tags || d.isAI) return; // AI自身の過去投稿は誘導先から除外（人間投稿に流す）
      const postTags = d.tags.split(",").map(t => t.trim()).filter(Boolean);
      const score = postTags.filter(t => sourceTags.includes(t)).length;
      if (score > bestScore) { bestScore = score; best = { id: doc.id, ...d }; }
    });
    if (best && bestScore > 0) return best;
    return null; // マッチなし→呼び出し側でデフォルトリンクにフォールバック
  } catch (e) {
    console.error("related post match error:", e.message);
    return null;
  }
}

// ── 誘導リンクのテキスト生成（フロントに ?tag= 対応が無い前提のゼロ改修フォールバック） ──
function _buildRelatedLinkText(relatedPost, sourceTags) {
  const base = "https://schoolpark-emu.vercel.app";
  if (relatedPost) {
    const tag = encodeURIComponent((relatedPost.tags || "").split(",")[0] || "");
    return `\n\n📖 関連するEmuのノート：「${relatedPost.title}」\n${base}/?tag=${tag}（Emu内で検索窓に「${(relatedPost.tags||"").split(",")[0]}」と入力すると見つかります）`;
  }
  const kw = sourceTags[0] || "お金";
  return `\n\n📖 Emu内で「${kw}」と検索すると、関連する仲間のノートが見つかります。`;
}

// ── Claude Messages API 呼び出し（サーバー側のみ） ──
async function _callClaudeForCuratorPost(source) {
  const systemPrompt = `あなたはSchoolParkという学びプラットフォームの公式AIキュレーター「AI司書」です。
役割：青空文庫（著作権切れの名著）・法律・お金の制度という「学校が教えてくれない知識」を、
1つの投稿＝「一口ノート」として紹介することだけがあなたの仕事です。

厳守事項（違反すると投稿は破棄されます）：
1. 与えられた sourceExcerpt（下記）に書かれている事実・数字・条文・制度名だけを使うこと。sourceExcerpt に無い金額・年数・条文番号・統計を絶対に創作しない（ハルシネーション厳禁）。
2. 個別の金融商品・銘柄・投資判断を推奨しない。「〜すべき」という断定的な行動指示をしない。あくまで知識紹介。
3. 人間オーナーが書く体験談・意見・エッセイの真似をしない。あなたは「紹介者」であって「体験者」ではない。一人称の感想（「私は〜だと思う」）を書かない。
4. 400〜550文字程度の日本語で、タイトル・本文をJSON形式のみで出力すること。JSON以外の文字（前置き、挨拶、コードブロック記法）は一切出力しない。
5. 利回り・リターンの数値を予測・保証する表現をしない（「年利〇%が期待できる」等）。
6. 「今が始め時」「絶対に得をする」等、断定的な時機・優劣の判断を示す表現をしない。
7. 特定の金融機関名・商品名・ファンド名を挙げない。

出力フォーマット（これ以外の形式を出力しないこと）：
{"title":"（20字以内、絵文字1つまで可）","body":"（400〜550字の本文。見出しや箇条書きを使ってもよい）","tags":["タグ1","タグ2","タグ3"]}`;

  const userPrompt = `カテゴリ: ${source.category}
出典: ${source.citationLabel || source.title}
sourceExcerpt（この内容のみを根拠にすること）:
"""
${source.summary}
"""
関連タグ候補: ${(source.tags || []).join("、")}

上記の sourceExcerpt を元に、一口ノートを作成してください。`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: AI_CURATOR_MODEL,
      max_tokens: 800,
      temperature: 0.5, // 事実性が重要なので低め
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }]
    })
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Claude API error ${res.status}: ${errText.slice(0, 300)}`);
  }
  const data = await res.json();
  const rawText = data?.content?.[0]?.text || "";
  const usage = data?.usage || { input_tokens: 0, output_tokens: 0 };

  // JSON抽出（前置き文が混ざっても { から } までを拾う保険）
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Claude応答にJSONが見つかりません: " + rawText.slice(0, 200));
  const parsed = JSON.parse(jsonMatch[0]);

  if (!parsed.title || !parsed.body || parsed.body.length < 100) {
    throw new Error("Claude応答のバリデーション失敗（本文が短すぎる/欠落）");
  }
  return { title: parsed.title, body: parsed.body, tags: parsed.tags || [], usage };
}

// ── Firestoreログ + アラート ──
async function _logAiCuratorRun({ status, sourceId, postId, model, usage, error, hourKey }) {
  try {
    const costUsd = usage
      ? (usage.input_tokens / 1_000_000) * 1.0 + (usage.output_tokens / 1_000_000) * 5.0 // Haiku 4.5想定単価。請求書と定期照合すること
      : 0;
    await db.collection(AI_CURATOR_LOGS_COL).add({
      status, sourceId: sourceId || null, postId: postId || null,
      model: model || AI_CURATOR_MODEL,
      inputTokens: usage?.input_tokens || 0,
      outputTokens: usage?.output_tokens || 0,
      costUsd, error: error || null,
      hourKey, createdAt: new Date()
    });
  } catch (e) {
    console.error("AI curator log write failed:", e.message);
  }
  if (status === "error" && ALERT_WEBHOOK_URL) {
    fetch(ALERT_WEBHOOK_URL, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: `🚨 AI Curator エラー (${hourKey}): ${error}` })
    }).catch(() => {});
  }
}

// ── メイン処理（cronからもAPIからも呼ばれる。冪等） ──
async function runAiCuratorHourly({ manual = false } = {}) {
  if (!db) { console.warn("⚠️ Firestore未接続 - AI Curatorスキップ"); return; }
  if (!ANTHROPIC_API_KEY) { console.warn("⚠️ ANTHROPIC_API_KEY未設定 - AI Curatorスキップ"); return; }

  const hourKey = _jstHourKey();
  const dateKey = _jstDateKey();
  const stateRef = db.doc(AI_CURATOR_STATE_DOC);
  const stateSnap = await stateRef.get();
  const state = stateSnap.exists ? stateSnap.data() : {};

  // ① キルスイッチ
  if (state.enabled === false) { console.log("⏸️ AI Curator: 停止中（キルスイッチOFF）"); return; }
  // ② 同一時間帯の二重投稿防止（Render cron と GitHub Actions バックアップの二重発火対策）
  if (!manual && state.lastHourKey === hourKey) {
    console.log(`ℹ️ AI Curator: ${hourKey} は投稿済みのためスキップ`); return;
  }
  // ③ 日次暴走防止（本来24回/日のところ安全マージンを持たせて上限26回）
  const dailyCount = state.dailyDateKey === dateKey ? (state.dailyCount || 0) : 0;
  if (dailyCount >= 26) {
    console.error("🚨 AI Curator: 日次投稿上限に到達。異常発生の疑いのため停止します");
    await stateRef.set({ enabled: false, pausedReason: "daily_cap_exceeded", pausedAt: new Date() }, { merge: true });
    await _logAiCuratorRun({ status: "error", error: "daily cap exceeded - auto paused", hourKey });
    return;
  }

  const jstHour = parseInt(hourKey.slice(11, 13), 10);
  const category = _categoryForHour(jstHour);

  let source, generated;
  try {
    source = await _pickAiCuratorSource(category);
    if (!source) throw new Error(`カテゴリ ${category} のネタ元が空です`);

    generated = await _callClaudeForCuratorPost(source);

    const relatedPost = await _pickRelatedPost(source.tags || []);
    const linkText = _buildRelatedLinkText(relatedPost, source.tags || []);
    const disclosure = AI_DISCLOSURE_FOOTER({ citationLabel: source.citationLabel || source.title });

    const postRef = await db.collection("posts").add({
      title: `📚 ${generated.title}`,
      body: generated.body + linkText + disclosure,
      tags: [...(generated.tags || []), ...(source.tags || [])].filter((v, i, a) => a.indexOf(v) === i).join(","),
      userType: "ai_curator", authorType: "ai_curator",
      isAI: true, aiDisclosure: true, aiModel: AI_CURATOR_MODEL,
      sourceType: source.category, sourceId: source.id,
      relatedPostId: relatedPost ? relatedPost.id : null,
      address: AI_CURATOR_ADDRESS, userId: AI_CURATOR_ADDRESS,
      createdAt: new Date(), updatedAt: new Date(),
      goodCount: 0, changeCount: 0, goodUsers: [], changeUsers: []
    });

    // ネタ元の使用履歴を更新（重複防止のローテーション用）
    await db.collection(AI_CURATOR_SOURCES_COL).doc(source.id).update({
      lastUsedAt: new Date(), usedCount: (source.usedCount || 0) + 1
    });

    await stateRef.set({
      enabled: state.enabled !== false,
      lastHourKey: hourKey, lastPostId: postRef.id,
      dailyDateKey: dateKey, dailyCount: dailyCount + 1
    }, { merge: true });

    console.log(`✅ AI Curator投稿完了: posts/${postRef.id}（${category} / ${source.title}）`);
    await _logAiCuratorRun({ status: "success", sourceId: source.id, postId: postRef.id, usage: generated.usage, hourKey });
  } catch (e) {
    console.error("❌ AI Curator実行エラー:", e.message);
    await _logAiCuratorRun({ status: "error", sourceId: source?.id, error: e.message, hourKey });
  }
}

// 毎時0分に実行（Asia/Tokyo）
cron.schedule("0 * * * *", () => runAiCuratorHourly(), { timezone: "Asia/Tokyo" });

// ── 管理用API（既存の x-admin-key パターンを踏襲） ──
app.post("/api/ai-curator/run", async (req, res) => {
  if (req.headers["x-admin-key"] !== process.env.ADMIN_SECRET_KEY) return res.status(403).json({ error: "UNAUTHORIZED" });
  res.json({ message: "実行を開始しました" });
  runAiCuratorHourly({ manual: true }); // 手動テスト・GitHub Actionsバックアップ用
});

app.post("/api/ai-curator/toggle", async (req, res) => {
  if (req.headers["x-admin-key"] !== process.env.ADMIN_SECRET_KEY) return res.status(403).json({ error: "UNAUTHORIZED" });
  const { enabled, reason } = req.body;
  await db.doc(AI_CURATOR_STATE_DOC).set({ enabled: !!enabled, pausedReason: reason || null, pausedAt: new Date() }, { merge: true });
  res.json({ success: true, enabled: !!enabled });
});

app.get("/api/ai-curator/logs", async (req, res) => {
  if (req.headers["x-admin-key"] !== process.env.ADMIN_SECRET_KEY) return res.status(403).json({ error: "UNAUTHORIZED" });
  const snap = await db.collection(AI_CURATOR_LOGS_COL).orderBy("createdAt", "desc").limit(50).get();
  res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
});
```

**設計上の要点**: 開示テキスト（`AI_DISCLOSURE_FOOTER`）と誘導リンク（`_buildRelatedLinkText`）は**Claudeの出力に含めさせず、コード側で機械的に必ず連結**している。法令・金額など事実に関わる部分もClaudeに新規生成させず、`ai_curator_sources.summary`（人間が事前に用意した根拠テキスト）の範囲内でのみ言い換えさせる。これがハルシネーション対策と景表法対応の両方の核。

### 3.3 コスト試算（毎時1本＝月720本）

前提（Claude Haiku 4.5の公表単価。API契約時に最新価格を再確認すること）: 入力 $1.00 / 100万トークン、出力 $5.00 / 100万トークン。

| 項目 | 1回あたり | 月720回 |
|---|---|---|
| 入力トークン（system約550字＋sourceExcerpt約300字＋フォーマット指示） | 約1,300 tokens | 0.936M tokens |
| 出力トークン（JSON構造＋本文400〜550字） | 約450 tokens | 0.324M tokens |
| 入力コスト | $0.0013 | **$0.94** |
| 出力コスト | $0.0023 | **$1.62** |
| **合計（月間）** | 約$0.0035/本 | **約$2.6/月（≒400円、$1=155円換算）** |

max_tokens上限に近い出力が毎回続く最悪ケースでも月$5〜6（≒800〜900円）程度。Firebase無料枠・Render既存プランへの影響も `posts` 書き込みが1日24件増える程度で無視できる。

---

## 4. ネタ元データの持ち方（`ai_curator_sources`）

### 4.1 スキーマ
```js
{
  category: "aozora" | "law" | "system",
  title: "貧乏物語",
  citationLabel: "河上肇『貧乏物語』（青空文庫）",  // 投稿末尾の出典表示
  author: "河上肇",                // aozora用
  aozoraUrl: "https://www.aozora.gr.jp/cards/...",
  lawName: "利息制限法",           // law用
  lawArticle: "第1条",
  officialUrl: "https://elaws.e-gov.go.jp/...",
  systemName: "NISA（新NISA）",     // system用
  systemOfficialUrl: "https://www.fsa.go.jp/policy/nisa2/",
  summary: "150〜300字。Claudeが根拠として使う『すでに人が事実確認済みの要約』。ここが唯一の事実の源泉",
  tags: ["お金", "歴史", "格差"],
  active: true, usedCount: 0, lastUsedAt: null, createdAt: new Date()
}
```

**運用ルール**: `summary` は**Claudeではなく人間（もしくは法務レビューを経たプロセス）が事前に作成**する。Claudeの役目はこれを「一口ノート」の文体に整えるだけで、事実の出所（条文番号・制度の金額など）を新たに調べさせない。これにより毎時投稿でも法的リスクを制御可能な規模に保つ。

法令原文は著作権法13条により著作権の目的にならないため引用は自由だが、官公庁サイトの解説文（金融庁・厚労省・国税庁など）の**文章表現そのもの**を丸ごとコピーするのは避け、事実（制度名・金額・要件）だけを抜き出して自分たちの言葉で `summary` を書く。

### 4.2 シード候補（代表例。実運用では150〜300件まで拡充推奨）

| category | 対象 | メモ |
|---|---|---|
| aozora | 福沢諭吉『学問のすゝめ』 | 死後70年経過・パブリックドメイン確定 |
| aozora | 河上肇『貧乏物語』 | 同上 |
| aozora | 新渡戸稲造『武士道』 | 同上 |
| aozora | 内村鑑三『代表的日本人』 | 同上 |
| aozora | 本多静六（蓄財に関する著作） | 死後70年経過（2022年時点で確定） |
| law | 利息制限法（上限金利） | e-Gov原文引用可 |
| law | 特定商取引法（クーリングオフ） | 同上 |
| law | 消費者契約法（不当条項の無効） | 同上 |
| law | 民法（成年年齢・契約の取消し） | 同上 |
| law | 労働基準法（残業代・有給休暇） | 同上 |
| law | 借地借家法（敷金・原状回復） | 同上 |
| system | NISA（新NISA制度） | 金融庁公式情報を要約 |
| system | iDeCo | 同上 |
| system | ふるさと納税 | 総務省・国税庁情報を要約 |
| system | 高額療養費制度 | 厚労省情報を要約 |
| system | 失業保険（雇用保険の基本手当） | ハローワーク公式情報を要約 |
| system | 奨学金制度（給付型・貸与型） | JASSO情報を要約 |
| system | 医療費控除・住宅ローン控除 | 国税庁情報を要約 |

### 4.3 重複防止
1. **ローテーション**: `lastUsedAt` 昇順（未使用=null優先）で取得し上位5件からランダム選択。同じ記事が連続しない。
2. **使用回数の記録**: `usedCount` を都度インクリメント。プロンプトに「この出典の紹介は今回で${usedCount+1}回目」を渡せば同じ角度の紹介文を避けさせられる（軽微な拡張）。
3. **カテゴリ内フォールバック**: 在庫が尽きたカテゴリは他から補い「ネタ切れで投稿が止まる」事態を防ぐ。
4. **本文の重複検知（保険）**: `ai_curator_logs` に直近本文の冒頭50文字を保存し、生成後に類似度チェック（高すぎたら再生成/スキップ）。ソースが150件超あれば6日に1回しか同ネタに当たらないため初期は優先度低。

---

## 5. 関連ノートへの誘導リンクの自動選定

`_pickRelatedPost()` の手順:

1. 既存の `_getRankingSource()`（`posts` を最大500件・5分TTLでキャッシュ）を**そのまま再利用**。追加のFirestore読み取りコストがゼロで済む。
2. ネタ元の `tags`（例 `["お金","歴史","格差"]`）と各投稿の `tags`（カンマ区切りを分割）の**一致数**をスコアとし最高スコアの投稿を選ぶ。
3. AIキュレーター自身の過去投稿（`isAI === true`）は候補から除外し、必ず**人間の投稿**に誘導する（AI同士のループを避け人間コンテンツへ送客）。
4. マッチが0件の場合は特定の投稿ではなく「Emu内で『${タグ}』と検索してください」という**テキスト誘導**にフォールバック（存在しないリンクを貼らない）。
5. リンク形式:
   - **案A（推奨・要フロント改修）**: `https://schoolpark-emu.vercel.app/?tag=お金` を発行し、`index.html` の起動処理に「`?tag=` があれば `executeSearch()` を自動実行」を追加（既存の `?contact=` パラメータ処理と同パターンで10行程度）。真のワンクリック導線になる。
   - **案B（ゼロ改修・即運用可）**: 投稿タイトルとタグ名をテキストで示し「Emu内の検索窓に入力してください」と案内。既存の検索バーがそのまま使え、今すぐ運用開始できる。

初期リリースは案Bで開始し、効果を見てから案Aに着手するのが低リスク。

---

## 6. 24時間スケジュール設計

毎時0分に必ず1本投稿する前提。時間帯によって「何を投稿するか」のカテゴリだけを変える。

| 時間帯（JST） | カテゴリ | 狙い |
|---|---|---|
| 00:00〜06:59（深夜帯） | aozora中心 | ユーザーが少ない時間帯なので即効性の低い軽めの読み物（名著の一節・格言）に振る |
| 07:00〜08:59（通勤・通学） | system（制度） | 短時間で読める実用知識 |
| 09:00〜11:59（午前） | law（法律） | 仕事前・契約関連で役立つ知識 |
| 12:00〜12:59（昼休み） | aozora | じっくり読める読み物枠 |
| 13:00〜17:59（午後） | law/systemを1時間おきに交互 | バランス配分 |
| 18:00〜20:59（ゴールデンタイム） | aozora（名著・人生訓） | 最も力を入れる時間帯。人間投稿との相乗効果を狙う |
| 21:00〜23:59（夜） | system（資産形成・節約系） | 一日を振り返りながら読む制度もの |

深夜帯も要件通り投稿を止めないが、将来「深夜だけ2時間おき」にしたくなった場合は `cron.schedule` を `"0 7-23 * * *"` ＋深夜用の別スケジュール（例 `"0 0,3 * * *"`）に分けるだけで対応できる設計にしてある。

---

## 7. 停止・監視の仕組み

### キルスイッチ
- Firestore `system_config/ai_curator` の `enabled` で即座に停止。
- `POST /api/ai-curator/toggle`（`x-admin-key`必須）で管理画面やcurlから即時ON/OFF。再デプロイ不要。
- **自動停止**: 1日の投稿数が26件（想定24＋マージン）を超えたら自動的に `enabled:false` にして暴走を止める。

### 冪等性による二重投稿防止
- `lastHourKey` にJST時間帯キーを記録し、同じ時間帯の再実行（Render再起動やGitHub Actionsバックアップの重複発火）を無視。

### ログ
- `ai_curator_logs` に全実行（成功/エラー）を記録: 使用ソース、生成投稿ID、モデル、入出力トークン数、推定コスト、エラー、時間帯キー。
- `GET /api/ai-curator/logs`（管理者限定）で直近50件を確認。

### アラート
- エラー時に `ALERT_WEBHOOK_URL`（任意設定）へ fire-and-forget 通知。未設定でも `console.error`（Renderログ）で追跡可能。
- 日次上限到達時は自動停止＋ログに `daily_cap_exceeded` として記録。

### 手動トリガー
- `POST /api/ai-curator/run`（管理者限定）でcronを待たずに即時1本生成。動作確認・バックアップ起動用。

---

## 8. 本番投入の必須条件（法務レビュー反映）

詳細は [06-legal-review.md](06-legal-review.md)。以下がすべて完了するまで `runAiCuratorHourly()` の自動運転を開始しないこと。

1. **AIバッジ実装の完了と目視確認** — `getUserTypeBadge()`（`index.html` 11113行）に `ai_curator` case を追加し、**先にデプロイする**。これが未対応のままAI投稿が始まると、AI投稿がデフォルトの「ゲスト利用者」バッジで表示される。これは単なる実装バグではなく、**「正体を隠した表示」を生む景表法・消費者保護上の欠陥**にあたる。手動で1件生成し、フロントで実際にAIバッジが表示されることを目視確認してから自動運転を開始する。
2. **開示フッター文言の強化** — 3.2のコードに反映済み。
3. **利用規約への新条文追加** — `terms.html` に「第6条（AI生成コンテンツに関する特則）」を挿入（条文案は06-legal-review.md 4-7項）。`privacy.html` 第4条の業務委託先テーブルにAnthropic PBCの行を追加。
4. **誤り通報・訂正フローの整備**
   - 投稿詳細画面またはバッジのツールチップに「内容に誤りがあれば、お問い合わせよりご連絡ください」を明記し、`privacy.html` 第10条の問い合わせ先に直結させる
   - 運用手順書の「毎日の作業時間割」に「前日AI投稿のスポット確認」を1項目追加（07:35〜07:40）
   - 訂正は原則として削除ではなく本文冒頭への「※本投稿には一部誤りがあり、訂正しました」の付記。金額・条文番号など実害の大きい誤りのみ削除対応
5. **社内ルールの明文化** — 「一般ユーザーを装う非公式風AIアカウントは今後も作らない」。現行設計（公式・AI明記）はステマ規制の対象外だが、匿名AIアカウントは全く別の高リスク領域に入る。
6. **AI司書にEmu/EMUERを推奨させない** — 公式アカウントの自画自賛広告は、ステマとは別枠で景表法の優良誤認規制の対象になる。担当領域（名著・法律の歴史・制度の成り立ち）の切り分けを維持する限りこの懸念は生じない。

## 実装時の変更対象ファイル
- `backend/server.js` — 上記コードを `scheduled_posts` セクション付近に追加
- `frontend/public/index.html` — `getUserTypeBadge()`（11113行）に `ai_curator` case を追加（**AI投稿開始より前にデプロイすること**）
- `frontend/public/terms.html` — 第6条（AI生成コンテンツに関する特則）を追加
- `frontend/public/privacy.html` — 業務委託先テーブルにAnthropic PBCを追加
- `backend/package.json` — **変更不要**（標準 `fetch` で実装、Anthropic SDK追加不要）
