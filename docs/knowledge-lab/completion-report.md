# Emu Knowledge Lab — 完成機能追加の実装・検証報告

> **最新の本番確認は [2026-10-15 本人確認の追記](production-founder-verification-2026-10-15.md) を参照。** 以下は各実装時点の履歴を含み、「未公開・PR未マージ・AI無効」等を現在の状態と混同しない。AI分析・出典・③への入力・研究保存・意味検索は、その後にFounderが本番成功を報告した。

最新の本番反映とAI有効化は [本番反映とAI有効化](production-release-2026-10-15.md) を参照。PR #196はmainへ反映済み。Founderの明示指示で、こちらで追加した提供条件の停止フラグを撤去する修正を進めた。無料枠・認証・同意・出典・Owner停止は維持。全機能READYは本番のモデル設定と本人操作確認後に判定する。

2026-10-15更新。**実Gemini検証：PASS。総合判定：NOT READY（全機能の正式公開基準）**。実Geminiによる2／3分野の引用付き分析、保存・履歴・保管復元、実埋め込みによる日本語検索5例、同意撤回と所有権保護、6幅の画面操作を確認した。詳細は [実Gemini検証](live-gemini-verification.md)。データは明示的なローカル架空ケースであり、本番ユーザーの経験・本番利用検証と混同しない。追加版Preview・Productionは未検証、PR #196は未マージ。既存ProductionはPR #198で復旧し、今回も保護検査verified／enabled:true、AI無効を確認した。

## A. 前作業と現在

- PR #195：MERGED。最初のmain基準 `ceab38ec7149b2d3f6cd815f0827e99e9c4e9fdf`、最新main/Productionは `e978e01650416ae0e01ae860399e495680fdd373`。旧4不具合の実装を再利用し、作り直していない。
- Founder本人確認：プロフィール保存、下書き→公開、研究保存→編集→履歴→保管→復元は前リリースで成功との報告。機械による本人ログイン検証とは区別する。
- 新ブランチ：`feature/emu-knowledge-lab-completion`。追加PR [#196](https://github.com/Wertask11/emu-realtime/pull/196) はdraft・未マージ。実装コミット `e25d5668f0bc2dc5481f7b49635deab75cc5394f`。Vercelの追加Previewビルドは成功、Renderの追加版は未デプロイ。
- 最新Render `/api/knowledge-lab/config`：HTTP200、`enabled:true`、`reason:null`、AI false、releaseCommit e978e01（最新証拠JSON）。Vercel Lab HTMLはHTTP200。旧版公開4画面×6幅を実際のHTTPS応答で表示確認した。200のHTMLだけで機能の稼働をPASSにしていない。
- RenderのAIキー登録はFounder報告済み。Codex側もキーready・ネットワークenforcedとなり、実モデル一覧・生成・埋め込みAPIの成功まで確認した。キー再登録や同じ通信設定を再度要求する必要はない。
- Founderが共有したFirebase管理鍵は使用・保存していない。交換が必要。既存のFirebaseプロジェクト設定は emusch-2a111。FIREBASE_PROJECT_IDの省略自体は異常ではない。

## B. 25項目判定

「実装」はコードがあること、「ローカル」はエミュレーター/UIでの証拠、「本番」は追加版の証拠。模擬Gemini成功を本番利用可能としない。

|#|完成条件|実装ファイル|自動/ローカル検証|追加版Production|
|---|---|---|---|---|
|1|経験知投稿|service.js / lab.js|投稿・公開・編集・下書き・権限PASS|未公開。旧版はFounder確認、11:31 UTCでは既存版復帰|
|2|独立分類10軸|taxonomy.js / model.js / taxonomy-migration.js|旧49ID保持、97種、同義語、曖昧jobを推測しないPASS|未公開|
|3|複数条件検索|model.js / service.js / lab.js|AND/OR/完全/部分/除外/URL/5順/0件PASS|未公開|
|4|実際の意味検索|semantic.js / gemini.js|実Gemini埋め込み・日本語5例の期待結果1位、同意撤回/取り下げ除外PASS。大量・実利用者投稿での品質は未検証|未公開|
|5|2〜3分野掛け合わせ|service.js / ai-service.js|手動比較、実投稿からの自動候補取得・不足表示PASS|未公開|
|6|AIが実経験知を分析|gemini.js / ai-service.js|実APIが保存済み架空ケースを2／3分野で分析PASS。実在ユーザーの経験を分析した証拠ではない|追加版未公開|
|7|AI参照元|gemini.js / lab.js|実生成2回の全引用を照合、元タイトル・引用・参照日時を実UI表示PASS。架空ID/引用拒否の回帰もPASS|未検証|
|8|仮説と検証の区別|verification.js / model.js / lab.js|未検証AI、自己申告結果、実確認記録、偽メタデータ拒否PASS|未検証|
|9|研究保存/編集|service.js / lab.js|手動/AI由来、人の編集・手動継続PASS|未公開。旧版Founder確認|
|10|研究履歴|service.js / lab.js|本人/Owner専用、過去AI出典と生成内容のUI表示PASS|未公開。旧版Founder確認|
|11|保管/復元|service.js / lab.js|保存→更新→保管→再ログイン→閲覧→復元→編集PASS|未公開。旧版Founder確認|
|12|実践結果|service.js / activity.js|結果追記、自己申告表示・重複防止PASS|未公開|
|13|研究→知識|service.js / derived_links / lab.js|本人同意、非公開参照保護、元研究保持PASS|未公開|
|14|書き手登録/投稿|writers.html / service.js / lab.js|募集CTA→実エミュレーターAuth→プロフィール→投稿PASS|追加版未公開|
|15|募集→図書館|router.js / service.js / lab.js|既存回答→本人確認→明示公開→検索→編集・重複防止PASS|旧版Founder確認、追加版未検証|
|16|Passport/星空活動|activity.js / integration.js / star-activity.js|canonical Passport/活動重複防止、既存星/NFT/EMUER不変PASS|追加欄の実ネイティブUI・6幅・実別ユーザー切替PASS。本番は未検証|
|17|Owner管理|router.js / lab.js|Owner一覧・分類・通報・注目・非公開/復元UI、一般ユーザー拒否PASS|未検証|
|18|利用分析|analytics.js / router.js / lab.js|実成功イベント、重複防止、転換、0件分野、PIIなしPASS|未計測・未検証|
|19|AI使用量/費用管理|ai-budget.js / ai-service.js / lab.js|実分析4,851＋疎通11トークン、埋め込み7 RPC（トークン不明）、失敗3試行と停止・キャッシュ計測PASS。無料枠申告、課金有効化なし|本番未検証・請求書未確認|
|20|PC/スマホ|Lab各HTML / lab.js|375/390/412/768/1024/1366、通常/模擬AI/実生成結果のUI PASS|追加版未公開|
|21|既存Emu/SchoolPark維持|root最小hook / integration.js|既存Emu/ガイド/バックエンド回帰、SchoolPark主要5画面×6幅、Room1の4領域、City DEMO保存PASS。全本番操作は未検証|診断/通信修正後の既存版復旧を確認。既存全本番機能PASSとはしない|
|22|Rules/権限安全|既存firestore.rules / router.js|ローカルRules・API・本人性・一般ユーザー拒否PASS|11:31 UTCに旧版の安全検査成功。本番14領域の匿名検査成功。追加版32領域/認証済み他人の本番権限/Rules全文は未検証|
|23|Production実動作|追加PRとVercel/Render|公開ゲート未通過|FAIL：追加未公開/既存版復帰|
|24|募集ページ公開|knowledge-lab-writers.html|ローカル表示・CTA・FAQ・利用条件PASS|旧版公開ページの表示を6幅で確認。追加版登録は未検証|
|25|営業資料|completion-outreach-draft.md / 各公開ページ|3対象、初投稿、FAQ、X/Instagram/TikTok/note/DM/mail/運営手順作成|下書き。追加版の本番写真・動画未制作|

## C. AIの実装状況

APIはGoogle Gemini v1beta。実検証は `gemini-3.5-flash-lite` と `gemini-embedding-001` で成功。分析の実応答modelVersionも一致。2分野・3分野で保存済みローカル架空ケースを分析し、出典を照合して保存・履歴・保管復元まで確認した。本番でのOwner設定・利用確認は残る。`gemini-test-flash` は模擬テスト専用。`gemini-2.5-flash-lite` は一覧に載っても実生成404だったため、利用可能と扱わない。

外部AIへは同意した公開本文/題名/元ID/分野だけ。非公開・下書き・過去の未同意データを送らない。作者名・UID・Passportをプロンプトに送らない。無料枠の提供元による改善利用/人の確認の可能性を説明し、投稿者・利用者の同意を分離する。秘密文字列フィルターは完全匿名化を保証しない。

本文最大3,000文字/元知識、全体12,000文字、2〜6件。入力超過・不足・同意なし・架空引用・途中出力・枠超過は採用しない。参照範囲と原文引用を表示。AIの推論の正しさは未保証で、人が確認・編集する。

分析10/日・1Passport3、埋め込み60RPC/日・1Passport15、同時2、25秒×一時障害の再試行最大1回。内部索引は1日15RPCまで。リトライも枠消費。404等の恒久的拒否は再試行せず、モデル設定の確認を案内。公式料金表で分析モデルの無料枠を確認し、Founderの未課金申告に従って実行。有料契約/課金設定/有料フォールバックなし。実分析4,851＋疎通11トークン、埋め込み7RPC（トークン未報告）を記録した。請求書は未確認。

## D. 検索

日本語語句/分類は無料のサーバー索引・NFKC・Intl.Segmenter。意味検索は実埋め込みを受け取る構成で、Firestoreの全文/意味検索能力を装わない。20件ページ、URL条件共有、20,000文書/64MiBの明示上限。新規/編集は索引・意味キューへ、非公開/保管/撤回は現在の正本を照合して除外。過去jobは根拠付きOwner移行のみ。既存全公開投稿の語句索引は再利用、外部AIは作者同意があるものだけ。

実Geminiの文書・クエリ埋め込みで日本語5例の期待結果が1位となり、実ブラウザーでも結果・元本文の根拠を確認した。少数の架空ケースによる検証であり、本番投稿全体の品質・20,000件負荷は未検証。模擬ベクトルの順位だけを実API成功の証拠にしていない。

## E. Passport/星空/EMUER

7種の活動をPassport/種類/対象で一度だけ記録。別ログインでも重複しない。採用改善案は本人・投稿者の正規Passport照合、不明な旧データは保留。私用本文・人物名を活動へ写さない。保管後も過去活動を保持し、自己申告の実践を検証済みとしない。

既存星空に本人専用の活動欄を併設。**既存sp_stars、NFT発行、Quest実績、EMUER報酬額・上限・予算・二重付与防止を変更していない。** 星空欄の追加は本番未検証。既存ネイティブ議論/Passport/Good/Changeの追加版UI回帰結果も証拠欄で確認する。

## F. 管理/計測

既存Owner判定を再利用し、一般ユーザー操作をサーバーとRulesで拒否。分類・書き手・公開状態・通報・注目・確認記録・移行・保存数集計・AI停止。指標の定義は `completion-operations.md` と `analytics.js` に記載。本文/人物名/検索語をログへ保存せず、過去の行動を推定しない。テストと本番は別プロジェクト。

AI管理は回数/成功/エラー/キャッシュ/取得済みトークン/入力文字数/未報告成功、待機/索引/送信制限件数を表示する。率は実回数から読む。Googleの請求明細連携はなく、未取得費用を請求確認済みとしない。

## G. GitHub/デプロイ

ブランチ `feature/emu-knowledge-lab-completion`。最新main e978e01をマージし、32領域を保持して競合を解消。追加PR [#196](https://github.com/Wertask11/emu-realtime/pull/196) はdraft、実装コミット e25d5668f0bc2dc5481f7b49635deab75cc5394f。PR #195は再利用実装の正本で、追加は新PR。公開ゲート不足のため追加main反映・Productionデプロイを行わない。Vercel/Renderの最新基準はe978e01。Preview URLは https://emu-realtime-qzrq-git-feature-emu-knowledge-cd2aa0-school-park.vercel.app/knowledge-lab.html 。Vercelビルド成功をGitHub状態で確認したが、11:35 UTCの実接続は通信プロキシのCONNECT403で止まり、アプリ応答/表示は未検証。新ホストを設定案へ追加した。ローカルをPreviewと呼ばない。

## H. Firestore/Privacy

新しい派生領域：AI生成・キャッシュ・使用量・分散ロック・ベクトル/キュー・活動/集計・指標/転換・確認記録・派生リンク・保存集計。既存 `knowledge_lab_.*` サーバー専用namespaceに含める。Rules/インデックスファイルの追加変更なし。本文/報酬の破壊的移行なし。分類移行・初期登録・索引/保存集計は明示操作・再実行可能。

Privacyに外部AIの任意同意、無料枠での提供元利用、非公開除外、Ownerアクセス、撤回後の新送信停止を最小補足。著作権/既存Termsを全面改変していない。最新Google条件の確認と法律専門家の確認は未実施。外部AI側に渡した内容の完全削除は保証しない。

Rules検査は安全ゲートであり、IAM/管理API/ネットワーク/クォータ/後片付け障害でも停止する。一時停止の原因は未特定で、11:31 UTCには旧版が復帰している。一般ユーザーへの開放や認証回避で通していない。正常/失敗の再検査には5分の有界キャッシュを設け、短時間の繰り返し書き込みを防ぐ。検査自体にFirestore費用/無料枠負荷がある。固定 `security-probe` は既存でもユーザー指定を拒否していた。追加版では乱数IDのcreate専用にし、作成が成功した文書だけを後片付けする。衝突時は既存文書を上書き/削除せず安全ゲートを閉じる。

## I. 営業資料

`completion-outreach-draft.md` に3対象の説明、書き手1枚資料、初投稿型、FAQ、X/Instagram/TikTok/note、個人DM・団体メールとProduction撮影手順。紹介/募集/ガイド/問い合わせページへのURLあり。実操作動画は未制作。LOCAL/MOCKスクリーンショットを本番写真と偽らない。Founder手順は `completion-operations.md`。

## J. Founderの必要操作

1. 共有したFirebase管理鍵を交換し、Render再デプロイ後に古い鍵を失効する。値をチャットへ貼らない。
2. 安全検査の停止が再発した場合のみ、Render Logsの失敗段階/エラー**名・コードだけ**を確認する。11:31 UTCには旧版は復帰済み。秘密値を貼らない。
3. Codexのキー登録・通信設定は完了し、実API成功まで確認済み。再設定不要。Renderの本番モデル設定・無料枠確認は公開ゲート通過後に行い、課金を有効化しない。
4. 公開ゲート通過後、必要なOwnerログイン、無料枠/モデル確認、本人の本番保存・検索・AI操作確認を行う。

Rules全文の再貼り付けを現時点で一律要求していない。今回ファイル差分なしだが、現在の公開状態は検証が必要。

## K. 最終確認

「当初構想の完成形になったか」：**NO（正式公開基準）**。実Geminiの分析・引用・実意味検索・保存・保護までローカルで成功したが、追加版Preview/Production、追加版32領域の本番安全検査・本人操作は未完了。FounderがAIを含む全機能の正式完成として営業できる状態とは判定しない。未確認をPASSとしない。

## テストと証拠

- Backend全体：349 PASS、Emu+ガイド：174 PASS。
- Lab/API/Rules/追加回帰：今回107 PASS（直前99件＋今回8件）、最終再実行の失敗0、skip0。既存Backend349・Emu/ガイド174の証拠と合わせ630件。今回はLab107件を再実行し、変更していない349＋174件まで再実行したとは主張しない。初回は106 PASS／1 FAIL（並行編集のエミュレーターRPC INVALID_ARGUMENT）。期待値を弱めず単独16件、全体107件の再実行でPASS。実API成功は別の証拠として記録。
- 実ネイティブUI+エミュレーター：募集→ログイン→書き手→回答公開→検索/保存/通報→2/3分野→3更新/履歴→保管→再ログイン→復元/編集→Owner各一覧/注目/公開停止/復元。
- AI UI：モデル操作→作者同意→自動元知識→模擬分析/引用→保存/再分析→手動継続→過去AI分析/引用履歴。意味検索は模擬ベクトル。6幅で横はみ出しなし。
- `90/min` の既存制限は維持。ブラウザで実429とretryAfterMsを確認し、待機後200を確認。上限を増やしてテストを通していない。
- 証拠は `/workspace/outputs/knowledge-lab-completion/`。Production現在状態は `production-current-config.json`、通常UIは `browser/`、模擬AI UIは `mock-ui/`。旧ceab本番写真は別ディレクトリに保持する。
- 旧版Productionの公開Lab/募集/紹介/ガイド4画面×6幅（24表示）は横はみ出しなし。Chromiumの直接TLSはローカルCA信頼エラーのため、Pythonの通常TLS検証を通した実HTTPS応答をChromiumへ転送して表示した。HTMLを書き換えず、認証/書き込みを遮断。証拠 `production-current-public/results.json` とProductionラベルの写真。旧版/公開表示だけであり、追加版や本人操作をPASSにしない。
- 実API用 `live-gemini.cjs` で、実モデル一覧→実分析→私用研究保存/履歴→実埋め込み→日本語検索が成功。追加で実3分野、5検索例、保管復元、同意撤回、他人アクセス拒否、Owner停止を確認。詳細・実使用量・失敗を [実Gemini検証](live-gemini-verification.md) に記録。
- 追加版Preview、Production本人ログイン、LINE/wallet/実送金、全SchoolPark UI、本番投稿全体での検索品質/大量負荷、最新外部規約の法的確認は未検証。実Geminiの少数ケースは検証済み。

## 変更ファイル一覧


### 変更

- `backend/knowledge-lab/model.js`
- `backend/knowledge-lab/router.js`
- `backend/knowledge-lab/service.js`
- `backend/knowledge-lab/taxonomy.json`
- `docs/knowledge-lab/architecture.md`
- `docs/knowledge-lab/operations.md`
- `docs/knowledge-lab/outreach.md`
- `docs/knowledge-lab/release-prerequisites.md`
- `docs/knowledge-lab/release-report.md`
- `frontend/public/Emu_room2/index.html`
- `frontend/public/index.html`
- `frontend/public/knowledge-lab-intro.html`
- `frontend/public/knowledge-lab-writers.html`
- `frontend/public/knowledge-lab.html`
- `frontend/public/knowledge-lab/availability.js`
- `frontend/public/knowledge-lab/integration.js`
- `frontend/public/knowledge-lab/lab.js`
- `frontend/public/privacy.html`
- `tools/knowledge-lab-tests/check.cjs`
- `tools/knowledge-lab-tests/fixture.cjs`
- `tools/knowledge-lab-tests/native-browser.py`
- `tools/knowledge-lab-tests/native-fixture.cjs`
- `tools/knowledge-lab-tests/release-browser.py`
- `tools/knowledge-lab-tests/release-responsive.py`
- `tools/knowledge-lab-tests/rules.test.cjs`
- `tools/tour-tests/reizo-tour.test.cjs`

### 新規

- `backend/knowledge-lab/activity.js`
- `backend/knowledge-lab/ai-budget.js`
- `backend/knowledge-lab/ai-service.js`
- `backend/knowledge-lab/analytics.js`
- `backend/knowledge-lab/gemini.js`
- `backend/knowledge-lab/saved-metrics.js`
- `backend/knowledge-lab/semantic.js`
- `backend/knowledge-lab/taxonomy-migration.js`
- `backend/knowledge-lab/taxonomy.js`
- `backend/knowledge-lab/verification.js`
- `backend/knowledge-lab/probe-transport.js`
- `docs/knowledge-lab/completion-architecture.md`
- `docs/knowledge-lab/completion-operations.md`
- `docs/knowledge-lab/completion-outreach-draft.md`
- `docs/knowledge-lab/completion-report.md`
- `docs/knowledge-lab/live-gemini-verification.md`
- `docs/knowledge-lab/evidence/live-gemini-2026-10-15.json`
- `frontend/public/knowledge-lab-ai.html`
- `frontend/public/knowledge-lab/recruitment.js`
- `frontend/public/knowledge-lab/star-activity.js`
- `tools/knowledge-lab-tests/completion-ai.test.cjs`
- `tools/knowledge-lab-tests/completion-circulation.test.cjs`
- `tools/knowledge-lab-tests/safety-guard.test.cjs`
- `tools/knowledge-lab-tests/probe-transport.test.cjs`
- `tools/knowledge-lab-tests/completion-model.test.cjs`
- `tools/knowledge-lab-tests/completion-semantic.test.cjs`
- `tools/knowledge-lab-tests/completion-storage.test.cjs`
- `tools/knowledge-lab-tests/completion-ui-fixture.cjs`
- `tools/knowledge-lab-tests/completion-ui.py`
- `tools/knowledge-lab-tests/live-gemini.cjs`
- `tools/knowledge-lab-tests/provider-errors.test.cjs`
- `tools/knowledge-lab-tests/platform-fixture.cjs`
- `tools/knowledge-lab-tests/platform-browser.py`

## 公開前の残件

- 管理用秘密鍵の交換。侵害の発生は未確認だが、共有した鍵の継続使用は避ける。
- P1公開ゲート：追加版の本番統合が未検証。実Gemini・実意味検索のローカル検証は成功。旧Productionの停止は通信修正後に再検査成功。
- 必須：本番の同意済み知識によるAI操作、検索品質・参照元・無料枠設定を確認。
- 必須：追加版Previewと本番の正規ログイン後の保存/運営/回帰確認。
- P2：本番の追加活動欄/新指標/最新Google条件の確認。
- P3：20,000文書負荷、長期指標蓄積、実動画の撮影。

## 継続検証で追加した証拠

実ネイティブUIとAuth/Firestoreエミュレーターで、公開2投稿→私用研究/自己申告結果→星空活動表示、別の実エミュレーターログインへの切替で前の活動を消し本人の0件を表示、SchoolParkのhome/Quest/Guild/library/park 5画面×6幅、Room1の4領域と保存済み4データの取得、City DEMOの明示チェックイン→記録済み表示を確認した。38枚のLOCAL写真、ページ例外0、Productionへの書き込みなし。ナビゲーションには既存遷移関数を使い、投稿/研究/City記録は実UI操作。Cityの実店舗訪問・決済・報酬・3D全操作を確認した証拠ではない。結果は `outputs/knowledge-lab-completion/platform/results.json`。

検証ドライバーは非同期の元知識取得完了と描画完了を待つよう修正した。Room1見出しは既存仕様では固定のRoom1なので、選択した各リテラシーの実項目を検証する。これらはアプリ機能修正ではなく検証手順の修正。

この継続検証当初は旧Production ceab38eで `RULES_NOT_VERIFIED` が再発し、CodexのGemini設定も未適用だった。その後の本番復旧は次節、設定反映後の実API成功は冒頭と実Gemini検証報告を現在の正本とする。

## 本番の診断・通信修正完了（全機能完成とは別）

- PR [#197](https://github.com/Wertask11/emu-realtime/pull/197)：MERGED、main63fd3ee、失敗/後片付け/ネットワークの安全な診断・有界再検査。
- PR [#198](https://github.com/Wertask11/emu-realtime/pull/198)：MERGED、main/Production `e978e01650416ae0e01ae860399e495680fdd373`、2領域/4リクエスト、失敗後中断、直接IPv4/TLS検証/接続再利用、プロキシ維持、想定外応答の例外保護。
- Render実応答で`enabled:true` / `safetyCheck.status:verified` / `transport:ipv4-https` / failure:null。初回確認00:18 UTC、キャッシュ5分経過後の新しい確認時刻00:24 UTCでも成功。JSTでは2026-10-15午前の確認。
- VercelのProduction経由でconfig/taxonomy/search HTTP200。既存49分類・公開検索結果を取得。公開読取だけで、ユーザーデータを変更していない。証拠は `outputs/knowledge-lab-safety-hotfix/transport-production-*.json`。
- 通信診断修正の検証は574 PASS。追加版へマージ後は99 Lab/Rules +349 Backend +174 Emu/ガイド =622 PASS・失敗0・skip0。旧2保護テストは共通5保護テストに統合し、二重計上しない。
- マージ後に追加版の実ブラウザフローも再実行しPASS、ページ例外0。Gene/APIの模擬UI証拠を実API成功と扱わない。
- PR #196は引き続きdraft・未マージ。最新の実装マージコミットは19315b27b90bc5ffa2a111ab7193ec276bfd4d83（報告更新コミットは別途GitHubのheadを参照）。現在の本番復旧でAIを含む全25項目READYとはしない。
- その後Codexはrevision10でキーready・ネットワークenforcedとなり、実API成功まで確認した。キー再設定は不要。管理鍵交換確認、本番の正規Owner操作・同意済み本番知識による品質、追加版Preview/Production統合は残条件。
