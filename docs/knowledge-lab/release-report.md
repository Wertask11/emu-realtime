# Emu Knowledge Lab 実装・公開判定

調査基点: `412a4d8fea5928dc9ca12c2839e6e448fd8cc5aa`。作業ブランチ: `feature/emu-knowledge-lab`。Camelliaは変更対象外。

**公開判定: NOT READY。本番へのマージ・公開は保留。** コードとローカル検証を本番公開済みとは扱わない。公開前に、専用Rules・インデックスの手動反映、Previewの確認、Renderの公開フラグ、必要なPrivacy補足の適用確認が必要。

## 1. 実装した機能

知識図書館、6分類軸、文字の部分一致による複数条件検索、URL共有、新着／関連度／更新順、20件ずつの表示、0件時の誘導、保存知識、経験知の投稿・編集・下書き・非公開化・削除保管・復元、書き手プロフィール、公開募集・紹介・投稿ガイド、手動の掛け合わせ比較、研究ノートの保存・更新・公開、既存の知識募集／回答、通報、Owner管理、分類追加・変更・非表示・統合、既存投稿への分類付与、公開停止・復旧、活動集計、冷蔵庫くんのガイド。

## 2. 既存機能の変更

「知識を探す」にLabの入口を追加。既存「知識を届ける」に経験知フォームへの選択肢を追加。Good／Changeは既存の処理を共有し、独自の付与処理を作らない。普通の投稿・編集・予約公開後に派生索引を更新する。公開を取り下げた投稿は本文・画像・経験メタデータを公開領域から除去し、既存実績のため反応履歴だけを保持する。既存4ナビとRoom1の4領域は維持。

## 3–4. 新規ファイル・変更ファイル

新規:

- `backend/knowledge-lab/model.js`, `service.js`, `router.js`, `taxonomy.json`
- `frontend/public/knowledge-lab.html`, `knowledge-lab-writers.html`, `knowledge-lab-intro.html`, `knowledge-lab-guide.html`
- `frontend/public/knowledge-lab/lab.js`, `lab.css`, `integration.js`, `availability.js`, `lab-og.svg`, `lab-og.png`
- `firebase.knowledge-lab.json`
- `tools/knowledge-lab-tests/fixture.cjs`, `lab.test.cjs`, `rules.test.cjs`, `check.cjs`, `browser.py`, `native-fixture.cjs`, `native-browser.py`
- `docs/knowledge-lab/architecture.md`, `operations.md`, `outreach.md`, `legal-addendum-draft.md`, 本報告

既存変更:

- `backend/server.js`: Router登録、予約公開後の索引接続
- `frontend/public/index.html`: 入口、既存リアクションの共有、投稿索引接続、取り下げ記録の非表示
- `frontend/public/knowledge.html`: 経験知フォームへの入口
- `frontend/vercel.json`: 新APIの既存Renderへの転送
- `firestore.rules`: 専用領域とサーバー管理フィールドの保護
- `firestore.indexes.json`: 公開書き手の研究一覧用インデックス
- `tools/tour-tests/reizo-tour.test.cjs`: Lab差分だけを取り除いた既存コードの同一性検査

## 5. Firestore

公開本文の正本は既存 `posts`。非公開・下書きは `knowledge_lab_private_posts`、削除保管は `knowledge_lab_archived_posts`。公開を取り下げると本文や出典は公開領域へ残さず、反応・Quest実績のため内容のない記録を残す。元の内容は保護領域から復元可能。過去の実績・残高は削除しない。

新規専用領域: writers, notes, saved, reports, taxonomy, history, audit, operations, post_control, limits, system, search（各 `knowledge_lab_` 接頭辞）。研究は元投稿IDを保存し、現在の公開状態を再検証する。移行による既存本文の書き換えは行わない。索引だけを派生データとして作成する。

## 6. Rules

`knowledge_lab_.*` を既存の包括許可から除外し、直接のクライアント読み書きを拒否。既存Ownerも操作は検証済みAPIを経由する。投稿のLab分類・帰属をクライアントが偽造できないようにする。Labの編集・削除はAPIの版確認を使用。既存のGood／Changeは維持し、別ログインでも同じPassportから自己評価できないよう確認する。取り下げた投稿へ新しい反応は付けられない。

公開フラグが有効でも、サーバーは14の専用領域で匿名読み取り・書き込みが拒否されることを確認してから動作する。確認用記録は内容のない予約IDで、確認後に削除する。現在の本番Rulesがこの版であるという確認は未実施。

## 7. 検索方式

Firestoreの全文検索を装わず、派生した検索文書をサーバーでNFKC正規化して部分一致検索。本文、タイトル、タグ、構造化経験の記述を対象にする。同じ軸内はOR、軸間はAND。許可された全対象で整列し、20件ずつ返す。見学は既存と同じ新着20件。出力する本文は正本から再取得し、非公開・削除・変更を再確認する。

索引128件ずつ、正本25件ずつ。最大20,000件・JSON換算64MiB、検索文書1件64KiB。上限超過を切り捨てて完全検索と表示しない。通常60秒ごとに更新分を取得し、1時間ごと・再作成後に全体を確認する。形態素検索・曖昧検索・意味による類似度は提供しない。有料検索サービスは契約していない。

## 8. AI

自動AI生成は**未実装・利用不可**。利用可能なAI API／予算を確認できないため、有料契約やキー追加をしていない。比較は実際の分類・本文を表示し、問いの定型文を明示する。仮説・実践案・結果は利用者が手動で記入して保存する。AIが生成した事実や架空の出典を表示しない。

## 9. 書き手登録

既存認証→既存Passport ID→経験分野・表示名・自己紹介→明示的な公開選択→経験知投稿。新しい認証方式を追加しない。既存ユーザーの再登録は不要。非公開保存したプロフィールは同じIDで再開可能。本名・勤務先・連絡先・資格は必須ではなく、経歴・資格は自己申告。公開プロフィールから投稿・研究にアクセス可能。

## 10. 管理

既存 `requireOwner` と同じ検証済みウォレット権限。書き手数・直近7日新規・経験知・分野別・研究・募集・未回答・通報を集計。分類管理、既存知識の分類修正、古い情報の確認、公開停止・復旧、通報対応メモ・状態の保存を実装。非公開記録を本人の意思に反して公開する操作は提供しない。操作履歴は専用領域に保存。

## 11. Passport・星空・EMUER・Quest・Guild

所有権は検証済みUIDからPassport IDを取得する。別ログインの連携は既存の引換券を使用。星空と貢献は既存Passportへ接続し、他人の非公開Passportを表示しない。投稿は既存 `posts`、募集・回答は既存コレクション。投稿・募集・回答枠は既存の月間利用カウンターを共有。報酬額・上限・トレジャリー・二重付与防止を変更しない。研究の実践導線は元知識とノートを既存ギルド議題へ引き継ぎ、Quest化は既存の運営権限に従う。

## 12. テスト

最終値は下の検証追記を参照。既存バックエンド349件、Emuの既存Node回帰164件、ガイド10件がPASS。LabのAuth/Firestoreエミュレーター検証は保存・所有権・競合・利用枠・検索・研究・募集・通報・管理・削除復元・別ログイン連携を実施。Rulesは匿名・一般利用者・Ownerの直接アクセス拒否、既存投稿・Good／Change互換、自己評価拒否を確認。

新しい認証ユーザー・データは許可されたローカルエミュレーター内だけに作成。本番ユーザーを作成せず、本番利用者のデータを書き換えていない。構文・JSON・ID重複・ローカルリンク・差分空白も確認。

## 13. PC／スマホ

375/390/412/768/1024/1366pxで図書館・研究所・マイライブラリー・プロフィール・募集・投稿モーダルを実Chromiumで確認。横スクロールなし。新規相当の登録→下書き→編集公開→保存→0件検索→比較→研究保存→結果追記→募集を操作。実際のEmu画面にSDK・既存認証処理を接続し、Lab入口・Good／Change・議論への引き継ぎ・Passport・既存ライブラリーを検証。画像は検証用画面で、Productionの写真ではない。

現在のProduction入口は375px/1366pxで読み取り確認（HTTP 200）。LINE・実ウォレット・本番の課金／オンチェーン操作は未検証。新機能のProduction確認は未実施。

## 14. 残件

- 公開前必須: 専用Rulesとインデックスの反映確認、Preview確認、Renderフラグ、Privacy補足の手続き確認、公開後の動作確認。
- P0/P1を本番でゼロと確認した宣言はまだ行わない。エミュレーターの安全性テストと本番の確認を区別する。
- 自動AI生成は提供しない。実ウォレット／LINE／支払い／チェーンは既存コードと自動回帰で保持するが、本番実操作は未検証。
- 索引には容量上限がある。大規模化した場合、別の検索基盤を検討する。架空の検索精度・利用数は報告しない。

## 15–19. URL

Preview・PR・commitは検証追記に記載する。

- Production（既存）: https://schoolpark-emu.vercel.app/
- 書き手募集（公開後予定）: https://schoolpark-emu.vercel.app/knowledge-lab-writers.html
- Knowledge Lab（公開後予定）: https://schoolpark-emu.vercel.app/knowledge-lab.html

予定URLを、現在利用できる営業URLとして扱わない。

## 20. Founderの運営業務

公開ゲート確認→分類・索引初期化→書き手募集→投稿・未回答の確認→分類整理→研究の参照・仮説確認→通報対応→古い情報の更新確認→使用量確認。`operations.md` に画面操作と障害・ロールバック手順、`outreach.md` に一般／経験者／企業向け説明とSNS紹介文・実画面の撮影手順を用意した。

## 21. 費用・運用負担

新しい有料契約、AI契約、課金は追加していない。既存Firestoreの読み書き、Render/Vercel使用量は増える可能性がある。初回索引・再確認は投稿数に比例した読み書き。通常は差分キャッシュと20件の正本確認、管理はcount集計。操作回数・保存数・文字数・索引容量に上限がある。詳細は `operations.md`。正確な月額費用は利用数・既存プランに依存し、推測値を実測として提示しない。

## 22. 完了条件の判定

以下はローカル実装・検証と公開状態を分けた判定。

| 完了条件 | 判定 | 根拠・制限 |
|---|---|---|
| Labへのアクセス | PASS（ローカル） | 実ブラウザで表示 |
| 知識図書館 | PASS（ローカル） | 実データ保存・再取得 |
| 分野・業種・ジャンル検索 | PASS（ローカル） | 管理可能な分類IDとフィルター |
| 複数条件検索 | PASS（ローカル） | 全索引の条件・ページング検証 |
| 掛け合わせ研究所 | PASS（手動） | 実在する元知識を比較 |
| 研究保存・更新 | PASS（ローカル） | Firestore再取得・更新・権限検証 |
| 経験知投稿 | PASS（ローカル） | 既存postsに保存・既存操作接続 |
| 書き手登録 | PASS（ローカル） | 公開同意・非公開再開 |
| 募集ページ公開 | 未検証 | 本番未反映 |
| 知識募集 | PASS（ローカル） | 既存コレクション・枠を使用 |
| 既存Emu連携 | PASS（検証範囲） | 入口・Good/Change・議論・ライブラリー |
| Room1維持 | PASS（コード・回帰） | 4領域と入口を保持 |
| Passport連携 | PASS（エミュレーター） | 既存コード・実ログイン・引換券 |
| 権限制御 | PASS（エミュレーター） | 他人／一般／匿名の拒否 |
| 管理運営 | PASS（ローカル） | Owner API・集計・分類・通報・公開制御 |
| スマホ | PASS（Chromium） | 375/390/412px、横スクロールなし |
| PC | PASS（Chromium） | 768/1024/1366px |
| 既存主要機能 | PASS／未検証 | 自動回帰PASS、外部認証・チェーン等は実操作未検証 |
| 本番反映後の確認 | 未検証 | 公開ゲート待ち |
| 営業用公開URL | 未検証 | 本番未公開 |
| 運営手順書 | PASS | operations/outreachを作成 |
| 自動AI掛け合わせ | FAIL（未実装） | API・予算未確認。手動機能とは明確に区別 |

**Founderが今日から正式な書き手募集・営業・宣伝を始められるか: NOT READY。** 検証用画面を本番の完成画面として宣伝しない。専用Rules・インデックス・Preview・公開設定・必要な告知を確認し、本番での確認を終えてからREADYと判定する。

## 最終検証・URL追記

- 実装commit: `7009778337d1ac5c6721879ab986da3dba6cd5e2`
- PR: https://github.com/Wertask11/emu-realtime/pull/195 （Draft、未マージ）
- Preview: https://emu-realtime-qzrq-git-feature-emu-knowledge-lab-school-park.vercel.app/knowledge-lab.html
- Vercelビルド: SUCCESS。実装commitに対するGitHub status/checkで確認。
- Previewの実ブラウザ: **未確認**。この環境のプロキシがCONNECTをHTTP 403で拒否。該当Previewホストだけを環境設定ドラフトへ追加した。設定の確認・保存・Publishまでは接続許可の適用済みと扱わない。
- 自動テスト: backend 349 / Emu回帰164 / ガイド10 / Lab実Auth・Firestore 16 / Rules 4、計543件PASS。失敗・skipなし。
- 最新画面幅確認: 375/390/412/768/1024/1366px、主要6画面、横スクロールなし・pageerrorなし。登録から募集までの保存・再取得を確認。
- 実Emu接続: 本番と分離した同じ版のSDK、既存completeCommonFlow、実エミュレータートークンを使用。入口、保存、別ユーザーからの既存Good/Change、議論入力、Passport、既存ライブラリーPASS。pageerrorなし。Analyticsへの外部リクエストは検証で遮断。
- Rules・インデックスの本番反映: ユーザーの手動反映確認待ち。
- Render: `KNOWLEDGE_LAB_ENABLED=true` の設定確認待ち。現在の環境にRender設定変更の接続はない。
- main: `412a4d8fea5928dc9ca12c2839e6e448fd8cc5aa` のまま。本番公開・新機能の本番動作確認は未実施。

代表画像は[evidence](evidence/)に保管。すべて検証用エミュレーターの画面で、Production写真ではない。現在の本番入口は別途読み取り確認したが、新機能の本番画像として使用していない。

**公開判定は引き続きNOT READY。** 未検証の状態で本番へ反映しないという依頼条件を優先する。専用Rules・インデックス・Preview接続／確認・Renderフラグ・必要なPrivacy適用を確認してから、PRの公開ゲートを再判定する。
