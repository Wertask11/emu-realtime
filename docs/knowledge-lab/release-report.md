# Emu Knowledge Lab 最終修正・公開判定（2026-10-14）

## A. 総合判定

**NOT READY（Production公開条件待ち）。コード修正とローカル検証は完了。本番公開・本番実操作は未完了。**

最新mainを取得し `412a4d8fea5928dc9ca12c2839e6e448fd8cc5aa` を確認。既存 `feature/emu-knowledge-lab` / PR #195を使用。修正版の正確なcommitはPRのheadRefOidを参照する。本番へのマージ/デプロイはRules・索引・必要な設定が確認できるまで実施しない。

## B. 修正結果

| 不具合 | 修正内容 | 検証 | 判定 |
|---|---|---|---|
| C-2 同一Passport報酬 | 正規FB/wallet連携・verified account・逆引きの一致を検査。回答・Rulesの採用/申請・報酬承認・旧pendingの署名発行に適用。不明/矛盾は保留 | 実Auth/Firestore emulator。自己拒否と正常回答/採用/冪等報酬を確認 | PASS（ローカル） |
| C-3 研究保管 | 保管専用一覧、本人/Owner詳細、本人復元。復元はprivate、編集再開可能。他人へ配信しない | UIで作成/更新/保管/再ログイン/詳細/復元/編集/再保存 | PASS（ローカル） |
| C-4 研究履歴 | 本人/Owner限定APIと有界ページングUI。旧版・新版・時刻・revision・更新者を記録。旧形式も閲覧 | 3回更新、本人/Owner取得、他人拒否、保管/復元時の履歴 | PASS（ローカル） |
| C-5 回答から公開投稿 | 回答者自身が内容を確認し公開同意。既存投稿枠、元requestId/answerId、安定した投稿ID、重複防止。元回答は保持 | 実既存回答UI→フォーム→同意→公開→検索→編集。原回答/参照維持と他人拒否 | PASS（ローカル） |
| 追加：募集後の復帰 | SchoolParkへログイン着地する場合も実着地promise/覆い終了後、明示したLab URLに限りEmuへ戻す | 実募集CTA→既存認証処理→writerへの自動復帰 | PASS（ローカル） |

同一wallet、同一Passport/別wallet・ログイン、古い正常データ、不明/矛盾、別Passportの正常回答/採用/報酬、重複防止をテスト。逆引きのSPIDとversionはサーバーだけが設定し、正規FB連携から検証する。過去のクライアント作成情報を確認済みとして採用しない。既存の報酬額/枠/トレジャリー/繰越/契約を変更せず、旧疑わしい報酬は読み取り検出し、削除/回収/送金しない。

## C. GitHub・差分

- ブランチ：`feature/emu-knowledge-lab`
- PR：https://github.com/Wertask11/emu-realtime/pull/195
- main：`412a4d8fea5928dc9ca12c2839e6e448fd8cc5aa`。未マージ。
- 修正：backend/identity.js、verified-platform.js、emuer-v2/router.js、knowledge-lab/service.js / router.js、server.js、firestore.rules、Lab HTML/JS/integration。
- 新規：release.test.cjs、release-browser.py、release-responsive.py、release-prerequisites.md。
- 資料：legal-addendum-draft.md、本報告、検証証拠を更新。
- **今回 `frontend/public/index.html` は変更していない**。既存4ナビ/Room1を維持。Camelliaは変更なし。削除ファイルなし。

## D. Firestore

本番Rulesとインデックスは正規の読み取り接続がなく未取得・未確認。Founderの手動Rules運用を維持する。

- ファイル：リポジトリ直下 `firestore.rules` と `firestore.indexes.json`。
- Rules SHA256：`84e46a1220a596a82d7534579f88f5d96d564c19200adb795bf1ddb4d927f69e`。
- 索引SHA256：`38cd93abe5b8dada553774e96d3e3d56640e93b5bcbbf29c0e76d73455558030`。
- 索引：knowledge_lab_notes / COLLECTION / visibility ASC・authorSchoolParkId ASC・__name__ ASC。今回さらに別の複合索引は追加していない。本番READY未取得。
- 資料：[本人操作・差分・反映確認・ロールバック](release-prerequisites.md)。
- データ移行：一括移行/削除/初期化なし。正規ログイン/Passport連携時に、小文字名義の逆引きと検証済みPassport帰属/versionを追加・更新。元の名義・UID・実績を移さない。
- 研究更新は旧履歴形式を保持してnext/actor/actionを追加。履歴の公開範囲は現在のノート公開設定で広げない。
- 回答の投稿化は既存postsへ保存し、サーバー所有メタデータへ元募集/回答/同意時刻を保持する。

## E. テスト

| 対象 | 成功 | 失敗 | skip |
|---|---:|---:|---:|
| backend既存 | 349 | 0 | 0 |
| Emu既存Node | 164 | 0 | 0 |
| 冷蔵庫くん/ガイド | 10 | 0 | 0 |
| Lab既存Auth/Firestore | 16 | 0 | 0 |
| Lab既存Rules | 4 | 0 | 0 |
| 今回追加の再発防止 | 18 | 0 | 0 |
| **合計** | **561** | **0** | **0** |

テストは実ローカルAuth/Firestoreで、本番ユーザー作成/本番データ操作/実送金なし。正常報酬PASSはpending作成・冪等性の確認で、チェーン上の実送金完了を意味しない。既存wallet/LINEの本番ログイン、支払い、チェーン操作は未実施。全リポジトリの全スイート成功という意味ではない。

実ブラウザ：

- 募集の実CTA→同じ版のFirebase SDKをエミュレーターへ接続→既存completeCommonFlow→Passport→書き手登録→投稿。
- 別利用者の既存回答フォーム/Rules→本人公開フォーム→分類/同意/公開→検索/保存/通報。
- 2/3分野候補→比較→手動研究→3更新→私的履歴→保管→再ログイン→復元→編集保存。
- Owner：書き手/投稿/研究/募集/通報、分類追加、注目、公開停止/復旧、旧報酬の読み取り確認。
- 既存：Good/Change、議論入力引き継ぎ、Passport、既存マイライブラリー。
- 375/390/412/768/1024/1366px：Lab主要5画面・投稿modal・履歴と、募集/紹介/ガイドの実静的ページ。横スクロール/コントロールはみ出しなし。投稿のfocus→Tab→Escape成功。
- pageerrorなし。ローカル写真をProduction写真として扱わない。

構文/JSON/ID/リンク/差分空白検査成功。フロントは静的配信で専用buildコマンドなし。Vercelの修正版Previewビルドはpush後のGitHub statusで別途確認する。

回帰の限界：一日シェアの本番投稿、Room1全教材、Quest/Guild実践完了、City、星空、実LINE/wallet/チェーン、Production Owner操作は未検証。既存コード/自動回帰だけで本番PASSにはしない。

## F. Preview・Production

- Preview alias：https://emu-realtime-qzrq-git-feature-emu-knowledge-lab-school-park.vercel.app/knowledge-lab.html
- ネットワークのCONNECT403は解消。現在HTTP302でVercel SSOに転送される。閲覧保護を回避していない。
- PreviewはProduction Firebase/Renderを共有。新規保存の検証はローカル代替で分離し、Preview自体は実操作未検証。
- Production：https://schoolpark-emu.vercel.app/
- Lab（未公開）：https://schoolpark-emu.vercel.app/knowledge-lab.html
- 募集（未公開）：https://schoolpark-emu.vercel.app/knowledge-lab-writers.html
- 書き手：募集CTA `/?lab=writer`。
- 投稿：Labの「経験知を届ける」、または `/?lab=library&compose=1`。
- 研究所（未公開）：`/knowledge-lab.html?view=research`。
- 現本番はLab/募集/API404。Vercel/Render修正版は未反映。
- Renderフラグ/本番Rules/索引の確認に必要な設定接続は、この環境にない。
- 新API configにはRenderが供給するreleaseCommitを返す。今後本番公開後に実稼働SHAとmainを照合できる。値がない場合は不明とする。

## G. Founderに必要な操作

1. 修正版Rulesを手動反映し、公開中の版を確認する。索引を作成しREADYを確認する。
2. 正規のRender権限で公開フラグ/デプロイ設定を確認する。全公開条件が揃うまでは無効のまま。
3. Privacy補足案の文面/掲示方法を確認する。既存規約を全面改変していない。専門家による法的確認済みとは報告しない。
4. 本番確認で本人の既存アカウントへログインする。安全な範囲で必要な記録の内容/公開範囲を本人が決める。

詳細はrelease-prerequisites.md。正規の読み取り/設定接続を環境へ用意できる場合は、同じ確認をこちらが実施する。秘密情報をチャットへ貼らない。

## H. 営業開始判定

| 項目 | 現在のProduction |
|---|---|
| 書き手募集開始 | NO（募集404） |
| 書き手登録 | NO（新導線未公開） |
| 経験知投稿 | NO（Lab未公開） |
| 読者検索/閲覧 | NO（Lab図書館未公開） |
| 知識掛け合わせ | NO（手動研究未公開） |
| 研究保存/更新 | NO（Lab API未公開） |
| Founder管理 | NO（新管理API未公開） |
| 既存SchoolPark/Emu全本番動作 | UNVERIFIED |

コード上の修正PASSと営業READYは区別する。現時点では正式募集/営業を開始できると報告しない。Rules・索引・設定の確認後、承認された本番反映と本人ログイン確認を完了して再判定する。
