# EMUER経済圏 第2工程：構成と第3工程の運用

これは第2工程の開発資料です。本番へ設定・登録・課金・送金・デプロイしていません。

## 対象と禁止事項

SchoolPark Explorerは共通プロフィールとウォレット、およびLab/Text/Guild/Quest/Cityから同一画面へ入る。既存Mitemiruの未受取報酬支払い・おつり・返却・引渡しを内部呼出しで再利用する。商品交換回数を増減しない。

オンチェーン払いは未提供。`chainPaymentEnabled:false` を固定し、クライアント指定の `emuer_chain` も拒否する。REFUND_ROLEの有無・返却送信者・ガス・確認数が未検証なので、確認APIだけで返却成功としない。既存Mitemiruのウォレット払い・返却確認は変更していない。

外部交換は入力確認→移転制限確認→見積もり前停止のmock。`quote:null`、`executable:false`。レート、送金、approve、署名、外部エージェント送金、DEX取引は作らない。将来用の読み取り見積もり形式は `backend/economy/quote.schema.json`。現コントラクトの自由移転禁止を解除する実装はない。

## HTTP API

全経路が既存Firebase ID token検証を使い、SchoolPark IDをサーバー側で引く。Cookieのみで支払えない。`Cache-Control: private, no-store`。本人用APIに任意のUID/Passport ID/送金先を渡す仕様はない。

| Method | `/api/economy` 配下 | 内容 |
|---|---|---|
| GET | `/me` | 受付状況・本人資格・各残高・外部接続状況 |
| POST | `/quotes` | `{goal}` 300文字以内。料金・条件版・10分の有効期限を提示 |
| POST | `/jobs` | `{quoteId, requestId, termsVersion, paymentConsent:true, aiConsent:true}`。methodを指定するならemuer_ledgerのみ |
| GET | `/jobs` | 本人SchoolPark IDの最新履歴。最大50件。結果本文は含めない |
| GET | `/jobs/:id` | 本人の結果。表示時に権限・公開・許諾・資料内容を再確認 |
| GET | `/external` | 非対応理由 |
| POST | `/external/simulate` | `{chainId:137,token:"EMUER",amount:"5"}`。見積もり前に停止するmock |

同じSchoolPark IDとrequestIdから同じジョブ・注文を作る。同じキーで別quoteを送ると409。同じquoteを異なるキーで再利用しても拒否。同一依頼再送で追加請求しない。価格はサービス商品文書から読み、Founder承認値5と条件版を照合する。支払いトランザクション内でも価格・条件の変更を拒否する。

## 保存場所

すべて新設の制御文書は `emuer_v2_agent_*` に置き、既存Rulesの `emuer_v2_.*` クライアント拒否を継承する。本番Rules変更は不要。既存の認証・契約・Passport文書を移行しない。

| Collection | 主な内容 |
|---|---|
| `emuer_v2_agent_products` | サービス商品。文書ID `agent_schoolpark-explorer-v1` |
| `emuer_v2_agent_quotes` | 本人ID、目的、価格、条件版、期限、一度きりの使用先 |
| `emuer_v2_agent_jobs` | 本人ID、注文参照、状態、同意日時、目的、結果、処理履歴、lease |
| `emuer_v2_agent_usage` | JST日別の全体件数・本人件数・保守的なトークン予約量 |
| `emuer_v2_agent_quote_usage` | 同一SchoolPark IDの料金照会濫用抑止（6回/分） |
| `emuer_v2_agent_system/slots` | 複数worker共有の実行lease（最大2件） |
| `emuer_v2_agent_eligibility` | サーバー確認済みの提供対象資格。本人の自己申告で書けない |
| `emuer_v2_agent_source_approvals` | 新AI用途の資料利用許諾・個人情報確認・内容ハッシュ |
| **既存** `mitemiru_orders` | 支払済み額・返却・引渡し。`storeType:agent_service`、`serviceJobId`、`usageId:null` |
| **既存** `emuer_v2_rewards` | 使用済み報酬、おつり、元経路への全額返却 |

新商品は商品一覧の既存11品とは別のprivate collection。汎用の商品購入APIからこのSKUを直接購入することは拒否する。`mitemiru-change`・`mitemiru-refund`を再利用し、報酬率や新規付与を増やしていない。

残高は、ウォレット・未受取報酬記録・支払い可能額・受取署名で拘束中の額・依頼処理中の支払済み額を分ける。未確認をゼロや利用可能扱いしない。多数の未受取報酬やRPC障害時は利用可能額を未確認とする。支払い自体は必ず既存の厳密な支払い処理で再確認する。

## 状態・復旧

`awaiting_payment → queued → running → result_saved → completed`

- 台帳引落・おつり・注文作成・queued更新は**同一トランザクション**。
- 未決済のRPC障害はawaiting_payment。10分後はexpired。期限後に復旧して勝手に決済しない。
- 本人の枠3件/日、全体20件/日、同時実行2件。日付はJST。商品交換枠を使わない。
- 受付した依頼は失敗時も当日枠に残す。これは決済前に表示する。
- 1依頼32,768トークンを保守的に予算予約する。20件分で655,360。既存AIの枠と同一視しない。
- 日付をまたいだ依頼、10分経過、受付条件失効・予算減額によって実行できなくなった依頼は実行せず返却する。
- runningのleaseは5分。provider HTTPは45秒上限。外部送信直前にもlease残りを確認する。
- worker消失・不明な外部AI応答は再生成せず `refund_pending` へ。外部APIの「厳密に一度だけの実行」は保証しない。
- `result_saved`からは再生成せず、既存Mitemiruの引渡しだけを再開する。
- 返却失敗・通信不明はrefund_pendingを保持。既存Mitemiruで元台帳への全額返却が確認できたときだけrefunded。
- 失効したworkerの遅い応答はlease tokenと状態照合で不採用。
- 目的と結果は原則30日後に除去する。未解決の支払・返却は確認が終わるまで保持。取引・同意日時・条件版・状態イベントは保持。
- jobにTTL自動削除を設定しない。専用purgeがterminalだけを内容除去する。quotes/quote_usageだけならdeleteAfterのTTL追加は任意だが今回未設定。

## 実データとAI

公開知識とKnowledge Labは既存のposts＋正規検索索引を共有する。Guestに開放されていない過去投稿を回避して読む処理は入れない。各投稿を再読し、publicPost判定と既存の投稿者AI同意も確認する。

Textはroom1_contents、Guildは既存公式定義とsp_guilds、Questはsp_questsの公開OPEN/RUNNING、Cityはliveの公式ショップ商品。参加者・非公開プロフィール・配送先・非公開投稿を読んで送らない。非公開のGuild記録を公式定義へ黙ってフォールバックしない。

追加の資料確認は、文書ID `sha256(JSON.stringify(sourceKey))` に以下を設定する（サーバー管理のみ）：

```
{ piiReviewed: true,
  purpose: "explorer-20261106-v1",
  contentHash: sha256(JSON.stringify([送信するtitle,送信するsummary])),
  validUntilMs: 検証期限のミリ秒数 }
```

sourceKeyは `knowledge:ID` / `knowledge_lab:ID` / `knowledge_text:ID` / `guild:ID` / `quest:ID` / `city_product:ID`。summaryはサーバーが抽出する最大400文字の対象部分。利用許諾と個人情報確認を済ませた資料だけを承認する。既存の意味検索・掛け合わせへの同意を、勝手にこの有料用途へ拡大しない。編集でハッシュが変われば自動で対象外。

モデルは資料keyを選ぶ。名称・理由・根拠・リンクはサーバーが正規資料から復元し、自由な生成URL・架空ID・生成された追加主張を採用しない。関連候補がなければ空結果。**正常に探索完了した場合は候補なしでも5 EMUER**と決済前に表示する。処理失敗時は全額返却する。

目的の既知の識別子・連絡先・秘密を検出して拒否するが、正規表現を個人情報完全判定とは呼ばない。本人への注意表示、資料の内容ハッシュに結び付いた人による確認、固定フィールド射影、送信前の任意同意を併用する。ログ・PostHogに目的・生成内容・残高・個人IDを追加しない。

## 第3工程の設定（今回は実施していない）

価格5、20/3/2は決定済み。再承認は不要。以下は事実・提供条件を確認してから設定する。

1. API利用対象とGemini規約の適合を確認する。Gemini利用規約2026-03-23版の18歳未満へのAPI Client提供制限と、既存サービスの未成年利用条件との整合が未確定。単にフラグをONにして解決したことにしない。
2. 提供対象プランと資格確認方法を決める。`emuer_v2_agent_eligibility/{sha256(JSON.stringify(spid))}` の `adultVerified:true, providerAllowed:true, validUntilMs` は確認済み対象だけに設定する。ログイン済み・有料・公的本人確認済みを混同しない。自己申告や検証用記録を本番確認済みに転用しない。
3. 許諾と個人情報確認が済んだ実資料を承認し、正規検索索引がreadyであることを確認する。
4. 既存Lab・冷蔵庫くんを含むGeminiプロジェクト全体の実予算・モデルの規約/料金/レート上限を確認する。本実装の予約上限はExplorer用であり、提供者の請求額や他機能の支出を自動集約するものではない。実予算が未確認なら新規受付OFFを維持する。
5. Renderに以下を設定する（秘密値をチャット・Gitへ貼らない）：

| 変数 | 条件 |
|---|---|
| `ECONOMY_EXPLORER_ENABLED` | 確認完了後のみtrue。初期false |
| `ECONOMY_WORKER_ENABLED` | trueで永続ジョブ・返却・内容除去を10秒/毎時実行。未設定なら新規受付も拒否 |
| `ECONOMY_AI_TERMS_ATTESTED` | 利用規約・データ取扱いの確認が成立した場合のみtrue |
| `ECONOMY_AI_AUDIENCE_ATTESTED` | 対象者条件との整合確認後のみtrue |
| `ECONOMY_AI_SOURCE_USE_ATTESTED` | 対象資料の新用途の許諾確認後のみtrue |
| `ECONOMY_AI_BUDGET_ATTESTED` | 他AIを含む実予算との配分・監視確認後のみtrue |
| `ECONOMY_EXPLORER_PLANS` | 確定したguest/light/plus/proのCSV。既定は空（受付不可） |
| `ECONOMY_EXPLORER_DAILY_TOKEN_BUDGET` | 32768〜655360の整数。未設定なら受付不可 |
| `ECONOMY_EXPLORER_MODEL` | 既定gemini-3.5-flash-lite。許可されたFlashモデルのみ |
| `GEMINI_API_KEY` | 既存の安全な秘密管理。許諾・料金の合うプロジェクト |
| `POLYGON_RPC_URL` | 既存Mitemiruの読取RPC。台帳支払時にclaimPaidを照合 |

6. サービス商品例JSONを内容確認してprivate collectionに登録する。初期draftのままでは受付しない。提供条件成立後のみliveへ。
7. mainの次の更新も確認し、専用ブランチで統合テスト。通常手順でPR・Preview・Render/Vercelを反映するのは**第3工程の指示後**。Vercelの追加rewrite `/api/economy/*` も同時に反映する。
8. worker再起動と停止、refund_pending滞留、RPC障害、予算到達、本人以外のAPI拒否を本番受入計画で確認。今回の支払いテストはdemoエミュレーターのみ。
9. ウォレット支払いを提供するなら、別途実装・検証が必要。REFUND_ROLE保持者、非抽出署名手段、ガス、refundExchange送信、確認数、markExchangeFulfilledとの順序、再編成時の照合を確定する。現版は設定だけでチェーン払いをONにできない。

## 停止・ロールバック

新規受付停止は `ECONOMY_EXPLORER_ENABLED=false` または商品status=draft。**返却・照合が終わるまでworkerは止めない**。既払注文やジョブを削除しない。旧版へ戻す前にqueued/running/result_saved/refund_pendingを照合し、未提供分は元台帳へ返す。既存City API・商品・記録は独立して残る。契約・Rules・コントラクトにロールバック操作は不要。

## ローカル再現

- `npm ci --prefix backend --ignore-scripts`
- `npm ci --prefix tools/economy-tests --ignore-scripts`
- `npm --prefix backend test`
- 既存のFirebase CLI（必要なら`npm ci --prefix tools/quest-tests --ignore-scripts`）で `tools/quest-tests/node_modules/.bin/firebase emulators:start --only auth,firestore --project demo-emu-economy-stage2 --config tools/economy-tests/firebase.json` を起動する。
- 分離エミュレーター：project `demo-emu-economy-stage2`、Firestore127.0.0.1:8892、Auth127.0.0.1:9292。Rulesは既存全文。外部Firebaseを指定するとfixtureが拒否する。
- `node --test tools/economy-tests/integration.test.cjs tools/economy-tests/rules.test.cjs`
- `node tools/economy-tests/fixture.cjs` → localhost4257。`python3 tools/economy-tests/browser.py`（Python Playwrightと/usr/bin/chromium）。ブラウザは外部への全通信を遮断。
- `EXPLORER_LIVE_TEST_APPROVED=true NODE_USE_ENV_PROXY=1 node tools/economy-tests/live-provider.cjs` は別途明示した実AIテスト。公開Guild説明のみ1回送信。実行せずに実API成功と扱わない。

テスト用資格・商品・報酬を本番へコピーしない。fixture・Rules拒否テストのlocalhost限定を解除しない。
