# Emu for SchoolPark 統合ナビゲーション 実装・検証報告

2026-11-02 / branch: `feat/unified-emu-navigation` / base: `6b0d03c1eb5bf1f7ddf9b6ee6b003fc24eeb723f`

> 本書は実装・ローカル検証完了時点の記録です。その後、オーナーからPR作成・mainマージ・本番反映の明示的な承認を受けています。以後の反映状況はPRとデプロイ履歴を参照してください。

**コード変更・ローカル検証まで完了。本番デプロイ、mainへのマージ、Productionデータへの書き込みは実施していません。**

## 1. 調査した現行仕様と実装方針

- 作業開始時の未コミット変更はなし。最新main（PR #264、Knowledge Text案内更新）を取得し、専用ブランチを作成。既存Knowledge Textカードを維持した。
- 旧構成は親のEmuナビと、別の全画面iframe `schoolpark/dao.html` 内のSchoolParkナビ。認証・Passport・課金・クエスト操作の本体は親側と既存APIにあり、表示を統合しても再実装する必要はなかった。
- ホームの宿題・年内目標への導線は「知識を試す」へ移設。他の集計・カードは既存のクエスト／知恵／Passportで確認できる。
- 公園のゲームは既存 `spOpenPlay` がプラン／見学回数を判定。エレベーターは既存ページとlocalStorageで状態を保持していた。入口だけをCityへ移した。
- 貢献画面のローダーにはギルドの信用スコア計算が含まれ、Treasury関連の記録にはクエスト予算・報酬との共用があった。画面専用部分だけを除去し、共通計算・取引記録を維持した。
- 公開議論の一覧は削除できる一方、Room3とSocket通信はProの対話にも共用される。共用本体・過去の結論を保持し、公開の一覧／立てる導線を撤去した。
- 実装前に変更予定・削除対象・移設先・保持対象・リスク・実装順を報告済み。Cityの新入口と新ナビから既存画面に到達できることを確認してから、旧画面を取り除いた。
- Productionは未ログイン状態の実画面・メニューを390／1280pxで参照。本人ログイン後の操作はProductionで実施せず、隔離したAuth／Firestoreエミュレーターで確認した。

## 2. 実装した変更

1. 主要ナビを **知識を読む → 知識を探す → 知識を試す → 知恵ライブラリ → City** に統一。PCの左ナビ、タブレット、スマホの下ナビ、メニューを同じ構成にした。ブランド切替のプルダウンは撤去。
2. プロフィール・冷蔵庫くんは共通の既存ヘッダーを使用。旧切替メニューにあった問い合わせも、プロフィールから開けるように維持。ログイン／Passport／設定／決済の処理を再実装していない。
3. 「知識を試す」にギルド／クエストの2カードを追加。Knowledge Lab／Knowledge Textと同じ `.emu-knowledge-pair > .eth-card`、余白・ボタン配置・700px以下の1列表示を再利用。カードの閲覧だけでは参加しない。
4. 知恵ライブラリは既存の `sp_wisdom` と引用サブコレクション、詳細展開、既存ローダーを使用。知識→実践→知恵カードの流れを維持。
5. 既存のゲーム・エレベーターへCityから到達できる4カードを追加。City共通カード・アクセス判定を利用。
6. `emu-theme.css` にブランド・強調・背景・フォーカスの役割を集約。ブランド色はみかん色、白文字の主要ボタンは濃いオレンジ。警告／成功／エラー／ギルド分類は区別を保持。
7. 初回から選んだ活動画面を直接開き、別画面のガイドが一瞬始まらないようにした。活動画面に戻るボタンを設置。二重になっていた画面見出しを整理。新旧の互換入口は既存画面へ案内する。
8. 冷蔵庫くん／チュートリアルの登録・案内を新構成へ更新。既存の進捗キー・保存方式・キャラクター・会話処理は維持。説明書のFAQは共通データを読み、二重管理を解消した。
9. Labの公開議論へのボタンは撤去。研究から考えを持ち寄る導線は既存のギルド議題フォームへ接続し、投稿確定は本人の操作に残した。

## 3. 削除した画面・専用処理

- Emu：一日シェア、公開議論の一覧・立てる導線・専用iframe／状態／イベント連携。
- SchoolPark：ホーム、公園・広場、貢献、Treasuryのテンプレート・専用ローダー・不要な表示計算・旧ナビ。
- 一日シェアの専用API実装を撤去。旧 `/api/ichinichi/*` はDBを参照・変更せず410 `FEATURE_RETIRED` を返す。
- 公開議論の日次削除ジョブ・起動時削除処理を撤去し、過去の議論データを消さない。
- 廃止した公開議論の報酬UI用グローバルフックと読み込みを撤去。既存の報酬記録・精算APIは保持。
- `ichinichi.html`／`discussion.html` は `/?view=practice`、旧 `play.html` は `/?view=city` への互換案内に置換。機能本体は残していない。

**共用のため維持したもの**：Pro対話が使うRoom3本体とSocket通信、知識一覧／星空に読まれる `discussion_conclusions`、過去の報酬・利用枠記録、信用スコア計算。`?emuDiscussion=1` の互換入口は、既存の本人向け対話APIで予定を確認してから開き、予定がなければ既存の「対話の予定」を案内する。公開の議論一覧は再作成しない。バックエンドの対話・契約・権限は変更していない。

## 4. Cityへ移した入口と確認結果

| 入口 | 使用する既存ページ | 結果 |
|---|---|---|
| ECHO FIELD | `/Emu_room2/echo-field.html` | 既存プラン判定経由で開き、ゲーム本体を表示 |
| 林檎の方程式 | `/ringo-game.html` | 既存プラン／見学回数判定を維持して表示 |
| 日常の神々 | `/daily-gods/index.html` | 既存ページを表示 |
| エレベーター | `/schoolpark/south-elevator.html` | 保存済みバッジ・隠し階状態を維持して表示 |

ゲーム本体、元URL、保存データ形式は変更していない。エレベーターの `sp_elev_badges`／`sp_elev_secret_unlocked` を同じまま利用できることを確認した。アクセス拒否・ログイン切替時には開かないこともテストした。

## 5. 維持したデータ・機能

- 投稿・検索・Knowledge Lab・Knowledge Text・下書き・公開経験知。
- ギルドの参加、投票資格、信用スコア、クエストの参加・報告・知恵カード・完走・報酬処理。
- 知恵カードの詳細・引用、Passport履歴、EMUER・予算・取引記録。
- ログイン、アカウントID、Wallet、Passport、プラン価格・枠・公式パス、Stripe、運営管理、Firestore Rules。
- ゲーム／エレベーターの本体と状態、冷蔵庫くんの会話・既存チュートリアル進捗。

DB移行・履歴削除・ユーザーデータ初期化は行っていない。重要な既存認証／課金／クエスト関数と、Rules・対話API・ゲーム本体の変更前後一致を自動テストでも確認した。

## 6. テストと証拠

| 検証 | 結果 |
|---|---|
| `cd backend && npm test` | **418件成功** |
| 関連フロント・共通処理・新ナビのNodeテスト | **122件成功** |
| 既存Cityブラウザ統合テスト | **8件成功**（閲覧・チェックイン・往復・ログアウト・別アカウント・遅延応答） |
| `node tools/knowledge-lab-tests/check.cjs` | 構文・JSON・ID重複・ローカルリンク検証成功 |
| `node --check`（新ナビ／server）・`git diff --check` | 成功 |
| ネイティブUI＋実Auth／Firestore | **375／390／412／768／1280／1440／1920px成功** |
| 新ナビの閲覧だけで参加・投稿・引用・報酬が発生しない | 実レコードの前後比較で確認 |
| クエスト参加→3種類の報告→知恵カード→引用 | 既存処理で保存・API 200・ライブラリ表示を確認 |
| 既存投稿フォーム・Labキーワード検索 | 実Firestore保存・既存API成功 |
| 共有プロフィール・Passport・プラン表示・冷蔵庫くん | 既存ログインで表示。plusを本人向け課金APIから確認。実課金なし |
| ゲーム4入口・エレベーターの保存済み状態 | 実ブラウザで確認 |
| JavaScript例外・横はみ出し | 上記7幅でなし |

静的HTML／JavaScript構成で、frontendのbuild／lint／typecheckスクリプトは存在しないため、既存の構文・リンクチェックと実ブラウザ検証を使用した。

本番通信はテストから遮断。任意のギフト／ランキング連携は隔離fixtureで未接続のため503として記録される。これらを成功したように偽装していない。外部フォント・計測送信も遮断したため、スクリーンショットはローカルのフォールバックフォントを使用する。

### 既存mainでも発生する4件の失敗

Knowledge Labの旧APIテストは **12件成功・4件失敗**。同じ日時・同じ依存関係で、変更前のmain `6b0d03c` を別ディレクトリへ展開して実行し、**同じ12成功・同じ4失敗**を再現した。

該当：公開投稿の利用枠、下書きの枠、同時投稿の上限、削除／復元の枠。テストが旧UID基準の `plan_usage`／`plan_counts` を読み書きする一方、現行実装は11月1日以降Passport基準を使っている。今回はその権利・仕様・APIを変更していない。既存テストを現行の共有枠へ合わせる修正は残課題として分離する。

### 保存した検証成果物

`/workspace/outputs/unified-emu-20261102/`

- `production-baseline.json` と BEFORE画像：Productionの未認証状態の調査。
- `gateway-before-removal.json`：新入口から到達できた記録（初回は旧画面削除前に実行し、保存結果は再確認時に更新）。
- `browser-results.json`／`AFTER-*-practice.png`／`AFTER-*-quests.png`／`AFTER-*-wisdom.png`／`AFTER-*-city.png`：7画面幅。
- `first-entry-results.json`／`AFTER-City-play-entries.png`：初回Cityでクエストガイドが始まらないことと4入口。
- `interaction-results.json`／`INTERACTION-*.png`：ゲーム・保存状態・クエスト・知恵カード・引用。
- `compatibility-results.json`／`COMPAT-*.png`：プラン表示・新ガイド・投稿・Lab検索。
- `backend-tests.log`／`frontend-unit-tests.log`／`city-tests.log`：成功テスト。
- `lab-api-tests.log`／`lab-api-baseline-tests.log`：変更前後で同じ4失敗の比較。

再現手順は `tools/unified-navigation-tests/README.md`。

## 7. 変更ファイル一覧

- `backend/reizo/knowledge.js`
- `backend/retired-features.js`
- `backend/retired-features.test.js`
- `backend/server.js`
- `docs/unified-emu-navigation-2026-11-02.md`
- `frontend/public/discussion-reward-ui.js`
- `frontend/public/discussion.html`
- `frontend/public/emu-theme.css`
- `frontend/public/ichinichi.html`
- `frontend/public/index.html`
- `frontend/public/knowledge-lab.html`
- `frontend/public/knowledge-lab/integration.js`
- `frontend/public/knowledge-lab/lab.css`
- `frontend/public/knowledge-lab/lab.js`
- `frontend/public/membership-features.js`
- `frontend/public/play.html`
- `frontend/public/reizo/chat.js`
- `frontend/public/reizo/knowledge.js`
- `frontend/public/schoolpark/city-bridge.js`
- `frontend/public/schoolpark/city.css`
- `frontend/public/schoolpark/city.js`
- `frontend/public/schoolpark/dao.html`
- `frontend/public/schoolpark/tutorial.html`
- `frontend/public/tour/reizo-tour-pages.js`
- `frontend/public/unified-navigation.js`
- `frontend/public/wallet-success-ui.js`
- `tools/guild-tests/city.test.cjs`
- `tools/knowledge-lab-tests/native-fixture.cjs`
- `tools/reizo-tests/chat.test.cjs`
- `tools/tour-tests/reizo-tour.test.cjs`
- `tools/unified-navigation-tests/README.md`
- `tools/unified-navigation-tests/browser.py`
- `tools/unified-navigation-tests/city-entry.test.cjs`
- `tools/unified-navigation-tests/compatibility.py`
- `tools/unified-navigation-tests/firebase.json`
- `tools/unified-navigation-tests/first-entry.py`
- `tools/unified-navigation-tests/fixture.cjs`
- `tools/unified-navigation-tests/interactions.py`
- `tools/unified-navigation-tests/navigation.test.cjs`

主要な役割：`index.html`／`unified-navigation.js` が共通ナビ、`dao.html` が既存活動画面、Cityの3ファイルが入口、`emu-theme.css` が共通色、Lab integrationが既存機能への接続、Reizo／tour／tutorialが案内、server／retired-featuresが専用API・ジョブ撤去。残りは対応する検証コード。

## 8. 残課題・未確認事項と本番反映手順

- 本番の本人ログイン後の操作、実Wallet接続、Stripe実課金、実EMUER発行／受取、実際の二者対話、今回の実Gemini生成は実施していない。既存コード・権限は保持し、ローカルと既存バックエンドテストで検証した範囲を報告している。
- 上記の既存Lab APIテスト4件は、現行Passport共有枠に合わせるテスト修正が必要。今回の変更起因の失敗ではない。
- **Productionは未反映。現在公開中のサイトでは旧ナビのまま。** PR作成／mainマージ／本番デプロイは今回未実施。
- 反映する場合はコードレビュー後、フロントとバックエンドの双方をデプロイする。バックエンド反映も必要なのは、旧一日シェアAPIと議論の削除ジョブを停止するため。
- Firestore Rules公開、DB移行、契約変更、データ削除は不要。反映後に本人アカウントで5つの入口・既存記録・ゲーム状態・Passportを確認する。
