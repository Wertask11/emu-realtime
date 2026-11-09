# EMUER経済圏：構成と第3工程の運用

> Phase 3の成果物品質・本人用チェック状態・WIL記録シートの最新公開記録は[品質改善報告](phase3-quality-20261109.md)と[本番証跡](phase3-quality-production-20261109.json)を参照。追加の本番消費は0。既存成果物を再生成せず、新規依頼に新形式を適用する。

> 2026-11-09の最新公開状態：冷蔵庫くん Phase 3の全5作業をPlus/Pro向けに本番有効化。公式Quest20件・City11件のみ追加承認。元の11/14試験終了・5 EMUER・20/3/2・無料枠を維持。[全5作業の公開報告](phase3-full-release-20261109.md)、[本番証跡](phase3-full-production-20261109.json)を優先。下記の過去のOFF/3作業のみの記載は当時の履歴。新規Phase 3本番決済は未承認・未実施。

Phase 3の実行・成果物保存の範囲、生成用途の個別許諾、API、停止/残条件は [Phase 3報告](phase3-report.md)。経済圏の第3工程と、AIエージェントのPhase 3を区別する。料金・試験期間は引き継ぐ。

**最新運用状況（2026-11-09）：冷蔵庫くんに頼むPhase 2は許諾済み6領域19資料でPASS。Plus/Pro向け7日間試験の受付・workerは正常。既存1件の実Gemini・5 EMUER引落と過去2件の返却を原本照合済み。詳細は [最終検証報告](phase2-final-verification-20261109.md)、次工程は [Phase 3準備](phase3-preparation.md)。以下には過去工程の未確認/受付OFF時点の手順も含むため、現在の判定は最新報告を優先する。**

第3工程の運用資料です。公開結果は `stage3-report.md` を正本とします。有料受付は公開条件を満たすまでOFFです。

## 対象と禁止事項

SchoolPark Explorerは共通プロフィールとウォレット、およびLab/Text/Guild/Quest/Cityから同一画面へ入る。既存Mitemiruの未受取報酬支払い・おつり・返却・引渡しを内部呼出しで再利用する。商品交換回数を増減しない。

オンチェーン払いは未提供。`chainPaymentEnabled:false` を固定し、クライアント指定の `emuer_chain` も拒否する。REFUND_ROLEの有無・返却送信者・ガス・確認数が未検証なので、確認APIだけで返却成功としない。既存Mitemiruのウォレット払い・返却確認は変更していない。

外部交換は入力確認→移転制限確認→見積もり前停止のmock。`quote:null`、`executable:false`。レート、送金、approve、署名、外部エージェント送金、DEX取引は作らない。将来用の読み取り見積もり形式は `backend/economy/quote.schema.json`。現コントラクトの自由移転禁止を解除する実装はない。

## HTTP API

公開の読取専用 `/status` を除く全経路が既存Firebase ID token検証を使い、SchoolPark IDをサーバー側で引く。Cookieのみで支払えない。`Cache-Control: private, no-store`。本人用APIに任意のUID/Passport ID/送金先を渡す仕様はない。

| Method | `/api/economy` 配下 | 内容 |
|---|---|---|
| GET | `/status` | DB・外部AIを呼ばない公開稼働状態。個人・残高・秘密情報は返さない |
| GET | `/admin/operations` | 既存Owner認証必須。worker・JST日別トークン・未解決件数 |
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
- 1依頼5,000トークンを保守的に予算予約する。全体100,000/日（JST）、初期運用7日。実入力・出力使用量も別記録し、予約枠は当日中解放しない。既存AIの枠と同一視しない。
- 日付をまたいだ依頼、10分経過、受付条件失効・予算減額によって実行できなくなった依頼は実行せず返却する。
- runningのleaseは5分。provider HTTPは45秒上限。外部送信直前にもlease残りを確認する。
- workerは90秒以内の成功heartbeatがなければ新規決済を拒否する。
- 推論前にcountTokensで実リクエストを計数し、出力1,024＋余裕256を確保。資料を減らしても収まらないときは推論せず返却。使用量不明・目標超過はprovider-safetyを停止し、運営照合まで新規受付しない。
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
  aiUseApproved: true, // このExplorer用途の利用許諾を確認済み（個人情報確認とは別）
  purpose: "explorer-20261107-v3",
  contentHash: sha256(JSON.stringify([送信するtitle,送信するsummary])),
  validUntilMs: 検証期限のミリ秒数 }
```

sourceKeyは `knowledge:ID` / `knowledge_lab:ID` / `knowledge_text:ID` / `guild:ID` / `quest:ID` / `city_product:ID`。summaryはサーバーが抽出する最大400文字の対象部分。利用許諾と個人情報確認を済ませた資料だけを承認する。既存の意味検索・掛け合わせへの同意を、勝手にこの有料用途へ拡大しない。編集でハッシュが変われば自動で対象外。

入力文はサービス内の字句照合で関連順を計算する。Googleへは固定の目的種別（learn/practice/compare/shop）と確認済みタイトル・要約・関連順のみ送り、自由入力文は送らない。資料IDも依頼内の仮番号s0…へ置換する。モデルは仮番号を選ぶ。名称・理由・根拠・リンクはサーバーが正規資料から復元し、自由な生成URL・架空ID・生成された追加主張を採用しない。関連候補がなければ空結果。**正常に探索完了した場合は候補なしでも5 EMUER**と決済前に表示する。処理失敗時は全額返却する。

目的の既知の識別子・連絡先・秘密を検出して拒否するが、正規表現を個人情報完全判定とは呼ばない。本人への注意表示、資料の内容ハッシュに結び付いた人による確認、固定フィールド射影、送信前の任意同意を併用する。ログ・PostHogに目的・生成内容・残高・個人IDを追加しない。

## 第3工程の設定（有料受付の有効化条件）

価格5、20/3/2は決定済み。再承認は不要。以下は事実・提供条件を確認してから設定する。

1. API利用対象とGemini規約の適合を確認する。Gemini利用規約2026-03-23版の18歳未満へのAPI Client提供制限と、既存サービスの未成年利用条件との整合が未確定。単にフラグをONにして解決したことにしない。
2. 提供対象プランと資格確認方法を決める。`emuer_v2_agent_eligibility/{sha256(JSON.stringify(spid))}` の `adultVerified:true, providerAllowed:true, validUntilMs` は確認済み対象だけに設定する。ログイン済み・有料・公的本人確認済みを混同しない。自己申告や検証用記録を本番確認済みに転用しない。
3. 許諾と個人情報確認が済んだ実資料を承認し、正規検索索引がreadyであることを確認する。
4. 既存Lab・冷蔵庫くんを含むGeminiプロジェクト全体の実予算・モデルの規約/料金/レート上限を確認する。本実装の予約上限はExplorer用であり、提供者の請求額や他機能の支出を自動集約するものではない。実予算が未確認なら新規受付OFFを維持する。
5. Renderに以下を設定する（秘密値をチャット・Gitへ貼らない）：

| 変数 | 条件 |
|---|---|
| `ECONOMY_EXPLORER_ENABLED` | 確認完了後のみtrue。初期false |
| `ECONOMY_WORKER_ENABLED` | trueで永続ジョブ・返却・内容除去を30秒/毎時実行。未設定なら新規受付も拒否 |
| `ECONOMY_AI_TERMS_ATTESTED` | 利用規約・データ取扱いの確認が成立した場合のみtrue |
| `ECONOMY_AI_AUDIENCE_ATTESTED` | 対象者条件との整合確認後のみtrue |
| `ECONOMY_AI_SOURCE_USE_ATTESTED` | 対象資料の新用途の許諾確認後のみtrue |
| `ECONOMY_AI_BUDGET_ATTESTED` | 他AIを含む実予算との配分・監視確認後のみtrue |
| `ECONOMY_EXPLORER_PLANS` | 確定したguest/light/plus/proのCSV。既定は空（受付不可） |
| `ECONOMY_EXPLORER_DAILY_TOKEN_BUDGET` | 5000〜100000の整数。既定100000。承認上限を超える値は受付不可 |
| `ECONOMY_EXPLORER_TRIAL_START` | ISO日時。設定時刻から7日経過後は新規受付を停止 |
| `ECONOMY_GEMINI_PROJECT_ID` | 実際のAPIキーと請求先を確認したプロジェクトID |
| `ECONOMY_AI_PROJECT_ATTESTED` | 上記の実キー・プロジェクト対応確認後のみtrue |
| `ECONOMY_AI_BILLING_ATTESTED` | 料金・請求モード・費用制限と停止手順を確認後のみtrue |
| `ECONOMY_BUDGET_APPROVAL_REF` | 実際に承認済みの金銭上限・監視記録への参照名。トークン承認を金銭承認に代用しない |
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
- 既存のFirebase CLI（必要なら`npm ci --prefix tools/quest-tests --ignore-scripts`）で `tools/quest-tests/node_modules/.bin/firebase emulators:start --only auth,firestore --project demo-emu-economy-stage2 --config firebase.economy-tests.json` を起動する。
- 分離エミュレーター：project `demo-emu-economy-stage2`、Firestore127.0.0.1:8892、Auth127.0.0.1:9292。Rulesは既存全文。外部Firebaseを指定するとfixtureが拒否する。
- `node --test tools/economy-tests/integration.test.cjs tools/economy-tests/rules.test.cjs`
- `node tools/economy-tests/fixture.cjs` → localhost4257。`python3 tools/economy-tests/browser.py`（Python Playwrightと/usr/bin/chromium）。ブラウザは外部への全通信を遮断。
- `EXPLORER_LIVE_TEST_APPROVED=true NODE_USE_ENV_PROXY=1 node tools/economy-tests/live-provider.cjs` は別途明示した実AIテスト。公開Guild説明のみ1回送信。実行せずに実API成功と扱わない。

テスト用資格・商品・報酬を本番へコピーしない。fixture・Rules拒否テストのlocalhost限定を解除しない。

## インフラ確認・有料受付OFFでの部分公開

- Vercel: `vercel.json` の既存静的配備＋`/api/economy/*`のRenderへのrewriteを確認。Render: backend/server.jsを起動し、常駐workerはECONOMY_WORKER_ENABLED=true時のみ開始する。
- 公開確認は `GET /api/economy/status` のschema/releaseCommit/受付OFF、認証なし `/me` の401、静的ファイルの一致、既存商品の一覧で行う。公開確認だけでpaidフラグや商品を作らない。
- 照合はOwner→EMUER・サービス→運用状況で、worker成功時刻・予約量・実使用量・不明呼出し・返却待ちを確認する。不明使用量は請求側と照合してからprivate system/provider-safetyの停止を解除する。ジョブを削除・再生成しない。
- 7日終了/新規受付停止後もworkerを維持し、既払依頼・返却を照合する。障害時も返却未確定は「返却待ち」。
- Renderの環境設定・GCP請求/共有クォータにはこの作業環境からの管理権限がない。コード配備の成功と、実設定済み・有料公開可能を分ける。
- 本番の5 EMUER試験は対象アカウント・金額・成功依頼/返却操作ごとのFounder承認後に限る。現時点では未実施。

## Free Tier運用の追加条件（2026-11-07）

確定情報：FounderがAI StudioでCHES-SchoolPark / `emusch-2a111` / Gemini 3.5 Flash Lite / Free / RPM15・入力TPM250,000・RPD500、確認画面時点の使用量0、Render既存キーとの一致を確認。これは管理者提供の確認記録で、サーバーがGoogleのquotaをライブ照会した結果ではない。

- `ECONOMY_GEMINI_BILLING_TIER=free`を追加必須とする。既存`ECONOMY_AI_BILLING_ATTESTED`は無料枠のみ・有料契約へ自動移行しない確認にも使う。有効なPaid Tierや新しいカードは必須ではない。`ECONOMY_BUDGET_APPROVAL_REF`は無料枠のみ・金銭支出0円の確認記録への参照でよい。Google/Renderの既存設定を勝手に変更しない。
- modelは`gemini-3.5-flash-lite`だけを許可する。別モデル、有料fallback、Search/Maps有料ツール、Billing upgradeを実装しない。
- 通常のJST 20件/本人3件/100,000予約tokensに加え、`America/Los_Angeles`の日付でも全体20件/100,000予約tokens、rolling60秒で受付2件・推論2回・全provider HTTP10回を強制。countTokensもHTTP枠に含める。DSTはIANA timezoneで処理する。既存City交換・Lab/冷蔵庫くんの枠は減らさない。
- provider日付の予約は`emuer_v2_agent_free_usage/{YYYY-MM-DD}`。短時間制御は既存private system領域の`free-admissions`と`free-provider-window`。クライアントは直接読書きできない。資料承認の新purposeは`explorer-20261107-v3`で、`aiUseApproved:true`と`piiReviewed:true`の両方が必要。既存Labの同意を自動で新用途へ拡張しない。
- 分間枠は決済前にもチェックするため、上限で新しい注文/引落を作らない。既払依頼が内部の分間枠に当たったときは、永続queuedへ戻して待ち、再課金しない。期限/日付が過ぎれば処理せず全額返却する。
- Googleから429/モデル404/認証401・403/要求400/障害503、または通信タイムアウトの場合、新規受付をprovider-safetyで停止する。処理失敗はrefund_pendingを経て実際に元台帳へ返った場合のみrefunded。使用量不明の推論を自動再実行しない。返却workerは停止状態でも復旧を継続する。
- Owner運用画面はExplorerのJST/PT予約・取得した実使用量・直近HTTP数・停止理由・返却待ちを表示する。**他サービスを含むGoogle project全体のライブ残枠ではない**。AI Studio Rate limitsで実使用量を照合する。snapshotの使用量0を将来の残量として固定しない。
- 429後：Renderの受付フラグはOFFのまま、AI Studioでproject/model/RPM/TPM/RPD/利用tierを再確認→queued/running/refund_pendingを照合→不明使用量/返却未確定を解決→provider-safetyの停止をOwnerが解除する。キー/モデルのローテーションで枠を迂回しない。停止を解除するために無料/年齢/許諾ゲートを外さない。
- GoogleのAPI Client対象年齢・professional/business用途・提供地域、対象者/資料の実確認、Founderの本番有効化承認が成立するまで`ECONOMY_EXPLORER_ENABLED=false`。コード完成やFree Tier確認を公開承認に置き換えない。

## 冷蔵庫くんに頼むへの統合（2026-11-07）

現在の正式なユーザー向け名称は **冷蔵庫くんに頼む**。冷蔵庫くんの選択メニューで「画面のガイド」「聞く」「頼む」の順に表示する。「聞く」の既存チャット/案内は維持する。「頼む」を開くだけでは注文や引落を作らず、既存の共通EMUER画面で料金・条件・AI送信の同意後だけ決済する。

内部の `ECONOMY_EXPLORER_*`、`schoolpark-explorer-v1`、商品ID、URL、コレクション、条件版v3は互換性のため維持する。正規商品IDに限り旧表示名の登録も認識する。過去の注文名は読取時に新名称で表示し、取引原本/台帳は移行しない。新規サービス商品の例は新名称。料金5 EMUER、JST20/3/2、100,000予約tokens/日、5,000予約/件、7日間、Free専用の保守的追加制限は維持する。

APIキー所属は前回Founderから `emusch-2a111` と一致の申告を受けているが、今回の指示では未確認として再照合を求められている。実Renderキーの管理API照合権限はこの環境にないため、過去の申告と今回の直接確認を混同せず、有効化前に管理画面で再確認する。キー値をチャットに貼らない。Public statusやモデルmetadata成功からBilling Tier/所属を推定しない。

最新の変更・分離試験・Preview・公開条件・有効化手順は [reizo-request-readiness-20261107.md](reizo-request-readiness-20261107.md)。本番設定/資料/利用資格の承認はこの表示統合によって自動成立しない。新規受付はOFFのまま。#280を含む統合候補PRをレビューし、コード反映・有効化・実EMUER試験を別々に判定する。


## 2026-11-07 workerの無料枠対策

Firestoreの実APIで既定DBの無料読取50,000/日・書込20,000/日を確認。常時起動時の空巡回は、5状態の問い合わせ＋3文書読取で最低8読取/周期。10秒周期では約69,120読取/日・17,280 heartbeat書込/日になるため、30秒周期（約23,040読取/日・5,760書込/日）へ変更した。実データの読取・通常アプリの使用量はこのほかに加算される。

初回tick・永続キュー・90秒の健全性有効時間・失敗返却は維持。空の巡回が無料枠を単独で超える状態を避けるための変更で、24時間稼働保証やGoogle全体の残枠取得を意味しない。返却待ちを止めず、処理中の依頼がないことを確認して配備する。

## 冷蔵庫くんに頼む Phase 2

横断探索の資料許諾・個別フラグ・本人情報の任意参照・停止/復旧は [cross-domain-phase2.md](cross-domain-phase2.md) を参照。全連携の既定はOFF。既存有料受付・試験開始日時を変更せず、コード配備と資料承認を分ける。横断OFF時は既存の公式5ギルド探索を継続する。

2026-11-07の資料別確認・6領域の初期有効化対象・除外根拠は [cross-domain-activation-20261107.md](cross-domain-activation-20261107.md)、内容ハッシュ付きレビュー一覧は [source-reviews-20261107.json](source-reviews-20261107.json)。既存の試験期限を延長しない。

## Firestore復旧確認と読取削減

現在の復旧判定・空巡回/履歴の読取削減・quota backoff・Phase 3着手条件は [firestore-recovery.md](firestore-recovery.md)。待機中はDBを再読込せず、公開statusの`worker.retryAfterMs`を確認できる。既存の5 EMUER受入1件の照合に新しい支払いを使わない。

## 実践・記録（Phase 4）

[実践と記録の操作・データ・権限・保存・停止手順](phase4-practice.md)。`ECONOMY_PHASE4_ENABLED`はコード既定OFF。手動操作は追加0 EMUER・モデル送信なし。新規成果物生成の5 EMUERと試験期限は変更しない。
