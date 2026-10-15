# Knowledge Lab 公開前の本人操作と確認

> これは初回PR #195の作業時の履歴資料です。現在の追加機能と公開状態は [completion-operations.md](completion-operations.md) を確認してください。

この文書はPR #195の修正版を公開するための手順。公開ゲートが未完了の間はmainへマージせず、Renderの `KNOWLEDGE_LAB_ENABLED` を有効にしない。

## 1. Firebase Rules（従来の手動運用）

対象プロジェクトは `emusch-2a111`。リポジトリ直下の `firestore.rules` をFirebaseコンソールのFirestore Database → ルールへ貼り付け、文法検査後に公開する。公開前の現在のRulesをコピーして保管する。

mainからの必要な差分：

- Knowledge Labの全専用コレクションを包括許可から除外。クライアントから直接アクセスさせず、検証済みサーバーAPIを使う。
- 既存postsのLabメタデータ・所有者・非公開本文をクライアントが偽造/上書きできないようにする。
- 知識回答・採用・懸賞申請で、サーバーの正規連携から確認できるPassportを比較する。同じPassport、または本人性が不明な場合は承認しない。
- `ches_wallets` のPassport帰属はサーバーだけが設定。既存の自分の名義登録を残し、`spid`・`passportBindingVersion` のクライアント作成/更新を許可しない。新しいサーバーの正規連携で確認したversion=1の情報だけを採用する。
- 既存Good/Change・通常投稿は維持し、連携名義での自己評価を拒否する。

**Rulesだけでなく修正版Renderコードも必要。** 正規ログイン・Passport発行/連携に伴い、既存のverified accountから小文字名義の逆引きとSPIDを追加/更新する。古い未確認の名義は、報酬を誤承認するより保留する。全データの削除や初期化はしない。

反映後：コンソールから公開中Rulesを取得して同ファイルと比較し、リリース報告のSHA256/commitに対応する版か確認する。可能なら正規の読み取り権限をクラウド環境へ設定してAPIで版を検証する。秘密鍵やトークンをチャットへ貼らない。

ロールバック：Labを停止し、既存の安定コードへ戻す。非公開Labデータがある状態で旧包括許可へRulesを戻さない。必要ならLabのdenyとSPID保護を維持したRulesを用意し、既存投稿/Good/Changeの回帰確認を行う。

## 2. インデックス

`firestore.indexes.json` の `knowledge_lab_notes`、COLLECTION scope、`visibility ASC / authorSchoolParkId ASC / __name__ ASC` を作成する。Firestoreコンソールで **有効（READY）** を確認する。エミュレーターの成功を本番索引READYの証明にしない。

追加した保管/履歴/回答一覧は既存の単一フィールド＋文書名順の有界取得を使い、今回さらに別の複合インデックスを追加していない。

## 3. Preview閲覧

Vercelはビルド成功だが、現在のPreviewはHTTP302でVercel SSOへ転送される。これはネットワークのCONNECT403とは別の閲覧保護。正規のVercelログイン、共有可能なPreview設定、またはVercelが提供する正式な閲覧認証で確認する。保護を迂回しない。

Previewは既存ProductionのFirebase/Renderを共有する。保存テストは許可されたローカルAuth/Firestoreエミュレーターで分離する。本番利用者のデータや新規アカウントをテスト用に作らない。

## 4. Renderと公開承認

Renderサービス `srv-d5q17tf5r7bs73fmu6tg` の環境変数/デプロイ状況を正規権限で確認する。このクラウド環境には現在Render設定用の認証がない。

公開条件を満たすまで `KNOWLEDGE_LAB_ENABLED` はfalse/未設定にする。安全性・索引・回帰・必要な告知・承認確認後に、PR #195をmainへ反映し、Vercel/Render両方のデプロイ完了を確認してから有効化する。規則を確認できない場合はAPI自体が `RULES_NOT_VERIFIED` で保存を拒否するが、これだけで全Rulesの監査が済んだとはしない。

## 5. Privacyと本番ログイン

`legal-addendum-draft.md` に、任意プロフィール・経験知・非公開/保管ノート・更新履歴・本人確認後の回答転載・運営アクセスの補足案がある。既存の著作権/利用許諾条項を維持する。文面と掲示方法はFounderが確認し、法律専門家の確認済みとは表示しない。

公開後の認証操作はFounder本人が行う。既存アカウントを使い、必要な検証記録は本人が内容と公開範囲を承認して作成する。本番の他人の記録・残高をテスト用に変更せず、実送金テストはしない。

## 6. 初期化と本番確認

既存Ownerで「知識を探す → Knowledge Lab → 運営管理」。分類初期登録は存在するIDを上書きしない。索引再確認は既存公開postsから派生索引を作り、正本を削除しない。完了状態readyを確認して検索する。

書き手登録、投稿、検索、保存、手動研究、履歴、保管、復元、管理、既存Emuの動作を確認する。各機能をローカル/Preview/Productionで区別して記録し、未確認をPASSにしない。

既存報酬の調査はOwnerの「既存報酬の本人性を確認」。20件ずつの読み取りだけで、同一Passport/本人性不明を検出する。削除・回収・送金はしない。署名発行前にも本人性を再確認し、疑わしい旧pendingレコードは保持したまま発行を拒否する。
