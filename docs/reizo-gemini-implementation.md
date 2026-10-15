# 冷蔵庫くん Gemini会話追加・反映前報告

2026-10-15 / 状態：ローカル実装・模擬API検証済み。Production未反映、実Gemini未検証。

## 現状調査と基準コード

- 実アプリのSchoolParkと冷蔵庫くんは `Wertask11/emu-realtime` 内。`SchoolPark_homepage` は案内サイトであり、今回の実装対象ではない。
- GitHub連携で最新mainを確認：Emu `e978e01650416ae0e01ae860399e495680fdd373`、Camellia `02197e576494028c4e60988d5d3b914d7324e778`、ホームページ `5c0b5cd3ffda23cdb6e077560a069aeccda81075`。
- 通常の `git fetch` は環境のHTTPプロキシ接続失敗。EmuのローカルHEAD `63fd3ee` との差分が4ファイル・1コミットであることをGitHub Compareで確認し、その4ファイルを最新mainの内容で取得したソーススナップショットを基準に作業した。ローカルの同期コミット `09ac90e` はupstreamコミットそのものではない。成果物パッチには、この同期差分を含めない。
- 作業場所：`/workspace/work/reizo-gemini`、ローカルブランチ `feature/reizo-gemini`。元の3リポジトリの作業ブランチ、main、Productionは変更していない。

|調査事項|既存構造と今回の扱い|
|---|---|
|実装・呼び出し|`frontend/public/index.html` の `spReizoOpen/Close/Send/Ask`。SchoolParkのiframeから親画面の冷蔵庫くんへ接続。入口・開閉・キャラクター・背景処理を維持|
|会話UI|body直下の `spReizoPanel`、吹き出し、例の質問、自由入力欄が既に存在。新しいページや大型チャットを追加していない|
|会話ロジック|既存の明示的スキル → FAQのスコア照合 → 未回答時の問い合わせ案内。この最後の箇所へGeminiを追加|
|ルール・人格|FAQ本文・キーワード・照合結果をそのまま共有モジュールへ移動。「ぼく」「〜だよ」「🧊」に合わせた短いsystem instructionを追加|
|チュートリアル|`tour/reizo-tour.js`、`reizo-tour-pages.js` が現行案内。初回表示・保存・続きから再開・画面移動の本体を変更していない。旧マップ用の案内をAIの根拠に使っていない|
|画面説明|現行ガイド内のJSONデータをサーバーで読み、実際のガイドと同じ説明を使用。フォーマット変更で読めないとAIだけがフォールバックする|
|保存|既存会話はDOM内、既存スキルのタスク等は従来の保存処理。AI履歴は直近3往復だけをメモリに保持し、localStorage/Firestoreへ新規保存しない|
|Passport・認証|既存Firebase ID tokenと `requireFirebaseUser` を利用。ID・ウォレット・アカウント情報はGeminiへコンテキストとして送らない。既存認証ミドルウェアによるアカウント検証処理は従来どおり|
|PC・モバイル|既存の共通チャットとレスポンシブCSSを使用。SchoolPark側のナビ・画面名は既存iframeの画面IDから判定。個別コンテンツは読まない|

## Emu / Camelliaの比較

調査対象のEmu mainには、再利用できる稼働中のGemini provider実装がなかった。Knowledge Labのmainも `aiAvailable:false` であり、未公開の別ブランチを稼働済みと扱っていない。

Camelliaは `api/camellia/chat.ts` → `lib/conversation/gemini-server.ts` → サーバー側 `@google/genai` を使用。既定primaryは `gemini-3.8-flash`、障害回復用は `gemini-3.1-flash-lite`。`GEMINI_API_KEY` をサーバー環境変数で管理する。Firebase認証、10回/5分のインスタンス内制限、短い履歴、連絡先マスキング、エラー分類がある。provider-recoveryは500系/タイムアウト時だけ別モデルを試し、429では再試行しない。履歴は最大8件、現在入力1000文字、各履歴500文字程度。今日のCheckから最小限の気分を参照する設計も確認した。プロフィール名等のマスキング・外部履歴からローカル回答を除く処理もある。

今回、同じ安全な境界と制限方法をEmuのCommonJS/Expressへ合わせた。EmuへSDKを新規導入せずGemini REST APIをサーバーから1回呼ぶ。無料枠節約と単純な障害復帰を優先し、モデル切替の再試行は行わない。Camellia固有の気分・Memory・Tree等は取り込まない。調査したGemini経路にブラウザへモデルキーを渡す実装は見つからなかった。ただしデプロイ先の秘密値そのものは取得・確認していない。

## 変更ファイル

|ファイル|変更|
|---|---|
|`backend/server.js`|認証付き `/api/reizo` を既存サーバーへ登録|
|`backend/reizo/chat.js`|Gemini呼び出し、冷蔵庫くん人格、入力検証、マスキング、履歴制限、レート制限、障害分類|
|`backend/reizo/knowledge.js`|共有FAQと現行ガイドから最小限の機能説明・現在画面を生成|
|`frontend/public/reizo/knowledge.js`|既存FAQとスコア照合をそのまま移動し、ブラウザ・サーバーで共有|
|`frontend/public/reizo/chat.js`|ID token付き送信、画面IDの許可リスト、直近履歴、重複防止、15秒期限、ユーザー切替時の履歴破棄|
|`frontend/public/index.html`|既存スキル・FAQの後にAIを接続。待機状態の読み上げ、入力ラベル・1000文字上限、IME Enter対応、失敗時問い合わせ|
|`tools/reizo-tests/chat.test.cjs`|API認証・障害・機密情報マスキング・FAQ一致・現行ガイド参照テスト|
|`tools/reizo-tests/client.test.cjs`|履歴上限・認証切替・トークン取得タイムアウト・重複送信テスト|
|`tools/reizo-tests/browser.py`|既存実UIを使うPC・スマホのローカル検証|
|`tools/tour-tests/make-fixture.cjs`|既存テスト画面で共有FAQとAIクライアントを読み込む|
|`tools/tour-tests/reizo-tour.test.cjs`|意図したチャット変更だけを除外して、他の既存画面・処理の一致確認を維持|
|`docs/reizo-gemini-implementation.md`|本報告|

## 呼び出し・コスト・障害対応

- ブラウザ → 既存Render backendの `POST /api/reizo/chat` → Google Gemini REST。`GET /api/reizo/config` は有効状態だけを返す。
- 有効化にはサーバー側の `REIZO_GEMINI_ENABLED=true` と `GEMINI_API_KEY` が両方必要。未設定時は無効。
- 使用モデルの優先順位：`REIZO_GEMINI_MODEL` → `GEMINI_MODEL` → `gemini-3.1-flash-lite`。既存共有キー・同一Google Cloud Projectを使用できる。別キー・別プロジェクトの作成は不要。
- チュートリアル、明示的スキル、FAQはAPI消費ゼロ。自由会話だけを送る。
- 入力1000文字、直近6メッセージ×各500文字、知識の参照文約6500文字＋現在画面。履歴全件やアプリ全データを送信しない。出力表示700文字まで。
- 1ユーザー10回/5分、インスタンス全体30回/分、同時実行最大4件。同一ユーザーの多重呼び出しも防止。
- 429時は60秒、その他provider障害時は10秒のインスタンス内待機。無料枠超過時の再試行や課金自動有効化はない。
- 通信期限はサーバー12秒、ブラウザ15秒（token取得も含む）。応答待ちでも既存ルール・他画面を操作できる。
- 429、500系、ネットワーク障害、タイムアウト、空応答、安全ブロック、未設定、認証失敗時は固定案内＋問い合わせボタン。既存FAQとチュートリアルはそのまま利用可能。
- この制限はプロセス内のもの。複数インスタンスやEmu/Camelliaを横断する共通カウンターではなく、Google側の共有枠超過を完全には防げない。

## セキュリティと既存機能への影響

- キーはサーバーの `x-goog-api-key` ヘッダーだけに使用。ブラウザ・URL・ログ・Gitへキーを渡さない。
- 自動コンテキストは画面IDのみ。名前、メール、Passport情報、残高、ウォレット、投稿、DOM全文、非公開Firestore文書を収集しない。
- 送信本文・AI履歴の既知の本人識別情報、メール、電話、ウォレット、URL、典型的なキー・トークン等をサーバーでマスキングする。任意文章に書かれた個人情報を完全に検出できる保証はないため、公開前に既存のプライバシー案内との整合を確認する。
- ログイン切替・ログアウトでAI用履歴と保留通信を破棄。他ユーザーへ以前のAI会話を送らない。
- Geminiにfunction tools、Firestoreアクセス、EMUER付与、Quest完了、Passport変更、ウォレット処理を与えない。返答は `textContent` で表示し、HTMLとして実行しない。
- Passport/Quest/Guild/City/EMUER/認証の業務処理、Firestore Rules、DB schema、画面遷移、既存ガイド本体、キャラクター画像・レイアウトCSSは変更していない。

## 検証結果

- Backend既存349件：PASS、失敗0、skip0。
- Emu画面関連既存164件：PASS、失敗0、skip0。
- AI追加18件＋ガイド既存10件：PASS、失敗0、skip0。Node合計541件。
- 既存FAQの全データ・全キーワードについて旧コードとの回答一致を確認。「Questって何？」は既存FAQで回答し、APIを呼ばない。
- PC 1440×960・スマホ375×667：開閉、自由入力、模擬Gemini応答、現在画面home/quest、履歴、API429後のFAQ・問い合わせ、待機中のFAQと画面操作、IME、XSS対策、認証切替、SchoolPark→Emu、ガイド再生がPASS。ページ例外0。
- 既存ガイド：1280/768/412/390/375幅で各18ガイド・67ステップPASS。模擬データのみ、業務書き込み0。
- index.htmlの17個のclassic inline scriptと追加JSの構文、`git diff --check`：PASS。
- 初回ホーム案内の遅延読み込み・保存・再開テストも別途実行し、結果を添付ログに記録。

模擬Gemini返答は接続・表示・失敗時動作の検証であり、実モデルの回答品質の証明ではない。「冷蔵庫くん本人としての自然な回答」「存在しない機能を肯定しない」「複数ターンの相談品質」は実モデルでの確認が必要。Productionの実ユーザーでログイン・データ変更を伴うテストは行っていない。

## 公開前に残る作業

1. テスト用バックエンドで、Emu/Camelliaと共通の `GEMINI_API_KEY` をサーバー環境変数として利用可能にする。キーをチャットやGitへ貼らない。今回の作業環境には秘密値・外部認証がなく、実Geminiテストは実行できなかった。
2. `REIZO_GEMINI_ENABLED=true`、必要なら `REIZO_GEMINI_MODEL=gemini-3.1-flash-lite` を設定し、テスト環境へフロント・バックエンド両方を配置する。ブラウザの接続先は既存Render URLなので、別バックエンドで検証する場合はテスト用フロントだけでそのURLを置き換える。
3. 実モデルで、雑談、学びの相談、現在画面の質問、存在しない機能、履歴の流れを確認する。429等の模擬テストと実接続テストを区別して記録する。
4. この報告と結果を確認後、Productionへ反映し、実配信コード・有効フラグ・実応答・既存ログインと主要機能を確認する。現時点で完成条件の「本番でGemini会話できる」は未達。

不具合時は `REIZO_GEMINI_ENABLED=false` にしてAIだけを停止できる。既存ルール・ガイド・問い合わせは利用可能。画面変更も戻す場合は今回の変更をrevertする。DB移行や保存済み会話データの削除は不要。


## 本番反映時の追従・追加確認（2026-10-15）

本番反映の指示に従い、最新main `f9029d960d546dffdbff0f9188fb54c46f6c5c96` を保持してPR #199の競合を解消。Knowledge Labが追加した星空への活動配信・リアクション後の索引更新を両方残し、ガイドの全体一致テストでも両変更を明示的に検証する。

当初のEmu provider調査は `e978e016` 時点の記録。新mainにはKnowledge Lab用の保護されたGemini経路が追加されている。その公開条件との整合を取り、冷蔵庫くんのAI有効化にも既存の `GEMINI_FREE_TIER_CONFIRMED=true` と `GEMINI_CLIENT_ELIGIBILITY_CONFIRMED=true` を要求する。キーと `REIZO_GEMINI_ENABLED=true` だけでは公開しない。提供条件が適合していると運営が確認したという意味であり、デプロイ指示だけで確認済みとは扱わない。

競合解消・共通ゲート追加後、会話/クライアント/ガイド28テストがPASS・失敗0・skip0。今回のAPI再確認は、実Express Routerへリクエストを渡す方式で、待受ソケットを作らず認証・制限・障害処理を検証した。ガイド比較にはGitから事前取得した変更前ファイルを使用。旧版で成功した541件・ブラウザ検証と今回の追加確認を区別し、実Gemini検証や本番応答の成功とは報告しない。

本番設定の変更や秘密値の参照は行わない。反映後はフロント配信・バックエンドのreleaseCommit・ `/api/reizo/config` の応答を確認する。AIが停止中の場合も既存FAQ・チュートリアル・問い合わせを利用できる。

## Render接続後の既存方式との整合

Founder指定のRenderサービス `srv-d5q17tf5r7bs73fmu6tg`（My Workspace / emu-realtime）で `REIZO_GEMINI_ENABLED=true` を既存値へのマージで設定。秘密値・他の環境変数は変更しない。

本番mainには既に #202 が入り、Knowledge Labの追加client-eligibilityフラグ判定は削除されていた。一方 #199 の冷蔵庫くんには旧判定が残っていたため、同じ既存の `GEMINI_API_KEY` と `GEMINI_FREE_TIER_CONFIRMED=true`、および冷蔵庫くん専用スイッチで動く条件へ合わせる。新しい確認フラグを作成したり、実際に確認していない事実をtrueとして登録したりしない。
