# 冷蔵庫くんに頼む Phase 3 — 実行・成果物保存

2026-11-09。判定：**PARTIAL**。5種類の作業エンジンを実装したが、本番のQuest/City生成用途の資料許諾と、Phase 3の本人本番決済試験は未完了。コード・分離試験・実Gemini試験と、本番の有効化範囲を分けて報告する。新規の本番EMUER消費・返却・付与は行わない。

## 実装

| 作業 | 成果物 | 公開条件 |
|---|---|---|
| 知識投稿の準備 | 提案タイトル、5区分の本文構成・記入用下書き、参考資料 | 生成用途を確認した公式案内/公開知識が必要 |
| クエスト挑戦の準備 | 候補、条件確認、準備、実行チェックリスト、振り返り | 現行の許諾済み公開Questが必要。現在の本番では無効 |
| ギルド活動の準備 | 分野比較、目標、準備、行動計画、振り返り | 許諾済み公式Guildが必要 |
| Cityの利用支援 | 商品候補、価格/条件確認、交換前チェック、選択の記録 | 許諾済みの有効商品が必要。現在の本番では無効 |
| 探究・WIL | 目標、準備、実践計画、記録/振り返り・知識化テンプレート | 許諾済み案内/知識が必要。店舗等を新設・推測しない |

生成物はAIの提案・記入用下書きとして明示する。本人が体験したという文章や、未確認の技術的事実・店・資格を完成した事実として生成しない。現在の公式案内だけではコーヒー抽出の技術的事実や本人の実績は分からないため、確認・記入箇所を残す。資料で確認した情報は根拠欄で分離する。公開、参加、購入、交換、送金、Passport変更、成果物の外部送信は実行しない。

## 既存基盤との接続

既存actor/Plus・Pro判定、提供資格、quotes/jobs、Mitemiru台帳払い、worker、usage、返却を再利用。5 EMUER・20件/日・本人3件/日・同時2件・100,000予約tokens/日・5,000/件・無料枠・試験期間を変更しない。

新しい見積もりにtaskType・作業計画・workConsentVersionを含め、支払い同意・AI同意と新しい作業範囲への同意版を一致させる。料金確認時に許諾済み資料を事前取得し、資料不足は課金前に拒否。取得snapshotをworkerで再検証して使い、同じ領域の一覧を再走査しない。決済前・AI送信直前・成果物保存前にも公開/許諾/内容を確認する。

全体の既存状態はawaiting_payment→queued→running→result_saved→completedを維持。running内にplanning/collecting/working/validating/savingの状態・開始/完了時刻・安全なエラーコードを保存する。AI生成は1依頼1回、最大1,536出力tokens。正確なcountTokensと余裕256を含め、5,000予約内に収まるよう資料数を減らす。収まらなければ生成せず全額返却する。自由入力原文・本人の残高/実績・内部IDをGoogleへ送らず、既存の固定テーマ・目的と許諾済み資料、作業種類だけを送る。

同時依頼でFirestore SDKの競合再試行/応答喪失が起きた場合、本人とfingerprintが一致する保存済みジョブだけを再開する。枠や支払いを追加作成しない。quota超過はこの救済対象にせず、既存backoffを維持する。

## 成果物・API・Rules

- `emuer_v2_agent_artifacts/{jobId}`：ownerUid、spid、jobId、artifactType、title、content、references、sections、createdAt/updatedAt、status、revision、期限、探索範囲。
- `emuer_v2_agent_artifact_owners/{hash(uid)}/items/{jobId}`：本人用一覧の最小メタデータ。createdAtの単一索引で最新20件だけを取得。全件走査・一覧からの各本文/参照の再読込はしない。
- 成果物とresult_savedを同じlease検証付きトランザクションで確定する。成果物IDはjobId固定。再起動後は保存済み成果物を引き渡し、再生成しない。
- GET `/api/economy/artifacts`、GET/POST `/api/economy/artifacts/:id`。Firebase認証必須、uidとSchoolPark IDの両方で所有権を確認。POSTは明示的editConsentとrevisionによる競合検出。編集内容をAIへ送らない。
- 詳細は注文引渡し完了と現在の参照を確認。許諾撤回・改変・期限切れでは派生した本文/提案タイトルも非表示。編集済みでも同じ扱い。コピー時にも参照を再確認する。
- 本文は原則30日。既存terminalジョブの内容除去と同じ処理で成果物・一覧を除去。未解決の支払い/返却を削除しない。ユーザーには保存期間を表示する。
- 現行Rulesの`emuer_v2_.*`クライアント拒否を継承。匿名/本人/別人/Ownerの直接読書きをエミュレーターで拒否確認。**Rules・索引の本番公開は不要**。

新しい独立ログイン・Wallet・通貨・Lab下書きは作らない。既存のLINE/Google、Passport、会員契約を移行しない。成果物のownerUidは作成時のFirebase UIDで、別のUIDへの移管/復旧機能は今回追加していない。

## 資料レビュー

生成用途は探索用途とは別に、`artifactUseApproved`、`artifactPurpose=reizo-work-20261109-v1`、`artifactAllowedTasks`、確認日時・承認根拠を既存承認文書へ追加する。元のpurpose・内容ハッシュ・有効期限・投稿者同意を上書き/延長しない。

初期対象は [レビュー一覧](phase3-source-reviews-20261109.json) の公式案内4件と公式5Guild。既存のSchoolPark権利確認・元資料/内容ハッシュ・今回のFounder実装指示を根拠に、投稿準備/Guild計画/WILだけを対象とする。権利保有を確認した運営資料に限る純粋な登録builderを追加し、ユーザー投稿/Quest/City/不明なレビューからの自動付与を拒否する。

Knowledge Labの公開投稿2件に対するPhase 2のAI探索同意を、生成用途の承認へ転用しない。Knowledge Lab本体・UI・モデル・Rules・AI分析処理は変更しない。Claude/Museの最新mainの変更は取り込み、既存読取アダプターだけを使う。

## UI

既存の冷蔵庫くん・三択・浮動ウィンドウを維持。作業選択、料金前の実行計画、段階進捗、成果物ボタン、本人用一覧、プレビュー/編集、コピー、参照先、手動の投稿画面移動を追加。Labへの自動入力や公開を行わない。全表示はtextContent/フォーム値で扱い、生成HTMLを実行しない。アカウント変更時に編集画面と入力内容を消去し、古い応答を表示しない。

一覧は手動更新。新しい常時ポーリングは追加しない。既存の進捗確認は本人の未完了ジョブだけ・最大3分・非表示時停止を維持。現在の共有Firestore使用量はFirebase Consoleで監視するリンクを運営欄に用意し、50,000/日という確認済み上限と、ライブ残量をAPI取得できていない事実を明示する。以前の318読取を現在の残量として固定しない。

## 検証結果

**956件合格**（backend565、frontend331、専用Auth/Firestore/Rules/登録/Phase 3/レビュー32、Quest3、知恵25）。失敗/skip/TODOは0。詳細は [phase3-evidence.json](phase3-evidence.json) を参照。5種類の正常系・本人所有・編集競合・二重依頼・許諾撤回・429/503・保存時Firestore quotaエラー・再起動/応答喪失・30日内容除去を分離環境で検証する。既存Phase 2/City/Auth/Rules/Quest回帰と、375/390/412/768/1280/1440/1920pxを確認する。本番本人の追加決済ではない。

実Geminiと専用Auth/Firestoreエミュレーターを結合した1件も、デモ5 EMUER→実生成915tokens→本人専用保存→編集→再表示→同一依頼再送で生成1回に合格。本番EMUERではない。

実Geminiは本番Firebase/本番台帳から独立させ、公式公開案内とGuildだけを送信した。Guild計画1,191tokens、投稿準備1,152tokens、WIL1,047tokensで生成・検証に成功した。初期試験では自然な日本語の質問/引用した記入の型を誤拒否する問題と、参照指定の冗長な二重表現を修正した。架空ID・URL・本人の実施済み断定の拒否テストは維持した。途中の実API503は成功扱いせず、失敗停止・返却は分離試験として区別する。

## 公開・停止・残条件

既定`ECONOMY_PHASE3_ENABLED=false`。コードを配備後、worker/既存受付/無料枠/資料を確認してから、有効な資料がある作業だけを公開する。Phase 3をOFFにしてもPhase 2は継続。既払・保存済みのジョブと返却が終わるまでworkerを停止しない。料金やtrialStartを変更しない。

公開後のチェックはstatus、認証なしAPI拒否、静的ファイル、worker、資料の現行確認。本人のPhase 3本番決済・成果物保存を未実施のままPASSとしない。本番の新規5 EMUER試験には「俺たちの青春」1回最大5 EMUER・具体的作業のFounder承認が別途必要。

残条件：Quest/Cityの生成用途に使える具体的資料の権利/同意確認と登録、必要な領域別フラグ、本人本番受入試験。新規カード・Billing・有料モデル・料金・試験期限・台帳・Rulesを変更しない。全5種類が本番で使える状態になるまで最終判定はPARTIAL。

## 変更ファイル

- `backend/economy/agent.js`
- `backend/economy/config.js`
- `backend/economy/router.js`
- `backend/economy/search/registry.js`
- `backend/economy/service.js`
- `docs/economy/operations.md`
- `frontend/public/economy/app.js`
- `frontend/public/economy/index.html`
- `frontend/public/economy/style.css`
- `tools/economy-tests/fixture.cjs`
- `tools/economy-tests/rules.test.cjs`
- `backend/economy/artifacts.js`
- `backend/economy/tasks.js`
- `backend/economy/tasks.test.js`
- `docs/economy/phase3-evidence.json`
- `docs/economy/phase3-report.md`
- `docs/economy/phase3-source-reviews-20261109.json`
- `frontend/public/economy/artifacts.js`
- `tools/economy-tests/artifact-review.cjs`
- `tools/economy-tests/artifact-review.test.cjs`
- `tools/economy-tests/live-work.cjs`
- `tools/economy-tests/tasks-integration.test.cjs`
