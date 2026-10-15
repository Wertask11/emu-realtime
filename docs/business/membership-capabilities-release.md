# 合意したプラン枠・公式パス説明の実装と検証

2026-10-15 / [PR #214](https://github.com/Wertask11/emu-realtime/pull/214) / ブランチ `feat/membership-capabilities`。価格・機能枠・11月1日目標・JST暦月・既存公式パス方針はFounder合意済み。**この報告作成時点では今回の変更は未公開。既存Knowledge Labの本番確認とは別。**

## 利用者に変わること

- 無料：Labの下書き1件。11月1日から保存10・研究3。
- light：投稿は意図した月5件のまま、500円/月。下書き30、11月1日から保存100・研究30。
- plus：3,000円/月、投稿月30件、保存・下書き・研究各1,000。
- pro：10,000円/月、投稿件数の月次上限なし、その他主要枠はplus相当、規定の対話機会・初月返金保証。
- 保存・研究の上限を減らすのは11月1日0時JSTから。超過している既存記録も閲覧・編集・履歴・保管復元を維持し、削除しない。新規追加だけ制限する。
- 公開のプラン比較ページは役割・価格・主な枠の4カードを先に見せ、詳細表は開いて比較。マイライブラリーには現在数・現在枠・11月からの枠を表示する。
- 公式パス等で同等以上が使える場合、同じ段階の重複契約をサーバーで拒否。UIも選択対象から外す。既存の契約を勝手に解約・移動しない。
- 既存公式パスのplus相当と対象のSchoolPark参加資格、最初の5人への個別の約束は維持。新シリーズは価格・期間とも未決定、販売しない。

## 実装

|対象|ファイルと要点|
|---|---|
|価格・機能枠の正本|`backend/membership-policy.js`。Billing料金、利用枠APIとLabの保持枠が参照|
|契約と付与の本人性|`backend/identity.js` の双方向のサーバー管理リンク、`entitlement.js`。編集可能なアカウントSPIDを根拠にしない|
|Rulesの契約参照|`sp_identities.membershipSources` に強い契約・付与のUID参照先だけを保持。Rulesは契約/付与原本を毎回判定し、段のコピーを信頼しない|
|共有カウンター|11月からPassportごと。既存UID分を再実行可能なtransactionで加算、移行UIDマーカーで二重加算を防ぐ。マーカーはクライアント改変不可|
|初期化前の回避防止|11月以降、共有カウンターをクライアントから自己作成できない。サーバーの移行済み本人UIDのみ更新可。月をまたいだ画面は資格を再取得して初期化|
|契約の未使用枠|切り替えをまたぐ既存契約の未使用分を11月のtransitionCreditsへ一度だけ加算。12月へは再移行しない|
|課金履歴の保持|`billing.js` は確認済みの同一Passportの有効契約を照合。支払い変更/プラン変更/返金申請は元の契約UIDへ記録。複数有効契約は自動選択せず確認要求|
|Lab保持枠|`knowledge-lab/service.js` / `saved-metrics.js`。所有権、同時追加、冪等性、既存ノート編集と保管復元を維持|
|画面|`membership-plans.html` / `membership-features.js` / `membership.html` / `knowledge-lab/lab.js`。値をAPIから取得|
|購入前の入力保持|Labを破棄せず既存の会員オーバーレイを開く。閉じると入力を維持。遅れたログイン既定遷移も明示的Lab移動を上書きしない|
|告知と契約説明|`terms.html` / `tokushoho.html`。料金据え置き、時期、保持枠、既存データ、パス、AIの共通無料枠を明記|

## 検証済み

- `cd backend && npm test`：349 PASS。
- 既存Emu/ガイド回帰：174 PASS。追加のカウンターキーと遅延遷移の変更だけを既存の差分ガードへ明示し、他のコードを無視しない。
- 新規の方針・実Auth/Firestore Emulator・将来日付Rulesテスト：18 PASS。未来のRules分岐は、隔離したローカルRulesだけ日付を進めた条件として検証。本番Rulesの11月1日は変更していない。
- 既存LabのAI/意味検索/保存/循環API：39 PASS。providerはMOCKの回帰であり、今回新たに実Geminiを呼んだ証拠ではない。
- 月境界・Rules・既存ガイドの追加確認19件、および最終方針/entitlement/ガイド34件：PASS。重複を含むため、単純合計の別件数として水増ししない。
- 実ブラウザーで375 /390 /412 /768 /1024 /1366。公開比較と実エミュレーター認証済み会員画面、Lab使用枠、遅延ログイン遷移、プラン画面往復の入力保持を確認。証拠は `/workspace/outputs/membership-capabilities/`。LOCALと明記し、本番画面とは扱わない。
- 保存数競合の回帰で一度Emulatorの「Transaction is invalid or closed」が発生。同じ保存取引の読み取りを正式な `tx.getAll` に揃え、元の同時保存/解除テストを含む39件を再実行してPASS。失敗記録も残す。

## 本番反映の順序と残り

1. PR全差分・ビルド・Previewを確認。
2. Founderが新しい `firestore.rules` 全文をFirebaseに反映。Codexのこの環境には本番Admin設定用資格がなく、既存チャットの秘密鍵やBearerを使って反映しない。
3. Rules反映を確認してからmainへ反映し、Vercel/Renderの配信SHAと比較/利用枠の実応答を確認。
4. 公開した事前告知から15日以上を取る。11月1日に間に合わなければ、先に適用日・表示・Rulesを延期する。告知前の縮小を適用しない。
5. 実Stripeの申込・更新・解約・返金は、今回は実行していない。モックでの拒否・同一Passportのルーティングと、既存Webhook等の回帰を検証した。新価格/新Price ID/新パス/外部有料契約は作成していない。
6. 会員オーバーレイを開いて戻る入力保持は検証済み。Stripeへ実際に移動する前の未保存本文の端末保存/復帰機構や、購入転換の分析一式まで完成したとは主張しない。

本番のお客様台帳を読んだ一括dry-run、最初の5人の個別対象者の再認定、実決済は未実施。これらの実データを推測で作り直さない。

SchoolParkの別売上目標と提案は [月10万円・事業者/団体の企画支援案](2026-10-15-schoolpark-monthly-100k-proposal.md)。新しい5万円の商品の販売価格はまだFounder未承認。

## 反映準備の最新確認

- Founderから、commit `994174d23b0db0fbe0ebe5bfac61d857f7a03e7b` のRules全文をFirebaseへ公開したとの回答を受領。Rulesを再変更したものではない。
- 公開後、ProductionのLab設定は `enabled=true`、保護検査 `verified`、AI・意味検索とも利用可能。未ログインでの `/admin/ai`・`/me`・`/me/public-posts` はすべて401。これはアクセス保護の確認であり、配信済みRules全文の取得・ハッシュ照合ではない。
- PR #214のVercelビルド・Preview Commentsは成功、mainとの差分に競合なし。PreviewのHTTP確認は、この実行環境の通信先許可が未適用でCONNECT 403。アプリ側の403とは区別する。
- Previewホストの追加と再開手順をCodex環境設定へ保存。その後の編集設定には追加先が含まれ、未保存のdraft IDもなくなったことを確認。一方、稼働環境はrevision 10の古い許可リストのままで、実接続もCONNECT 403。設定の再保存を繰り返さず、新設定が適用された実行環境でPreview確認を再開する。
- この追記時点ではmain未反映。既存本番のRender SHAは `8378031b754e5e86d9575c6f15cf37eb0dec15be`。Rules反映済みとの回答を、今回の新コードがProduction配信済みという意味には使わない。

営業素材の公開文面・運営手順を最新の本番確認へ更新。紹介・募集・ガイドの390px /1366pxの本番公開画面6枚を取得し、横崩れ・ブラウザエラーなし。撮影記録は `docs/knowledge-lab/evidence/outreach-production-2026-10-15.json`。画像はモックではなく実HTTPS配信で、ログイン・書き込み・AI生成を行っていない。原稿・画像・動画編集指示のZIPを `/workspace/outputs/knowledge-lab-outreach/knowledge-lab-outreach-2026-10-15.zip` に納品。動画自体は未制作。
