# Knowledge Lab 本番本人確認の追記（2026-10-15）

## 最新判定

**中核機能の本番確認：PASS。25項目すべての本番実証という厳密な総合判定：CONDITIONAL READY。** 下の未実施を完了と読み替えない。

以前の `completion-report.md` にある「PR #196未マージ」「追加版未公開」「AI無効」は開発途中の履歴であり、現在の本番状態ではない。PR #196と、その後の修正 #206〜#210はmainへ反映済み。新しいプラン枠・SchoolPark収益案は、今回の本人確認の後に追加された別変更である。

## 本人による本番操作

Founderの本人アカウントで操作し、この会話で次の回答を得た。CodexがFounderとしてログインしたり、共有されたBearerを使用した記録ではない。研究本文・トークン・鍵は証拠ファイルへ保存しない。

- 前段：書き手プロフィール保存、下書き→公開、研究保存→編集→履歴→保管→復元について「①、②、③全部できた」。
- 自分の公開投稿一覧の修正後：「自分の投稿が表示された」。
- 保存数の再集計：「集計が完了した」。
- 今回、実際の公開経験知「整える」「教育に対する価値観・格差・ずれ」、分野「暮らし・人生」「教育」を選び、AI分析・出典表示・③への自動入力・自分用研究保存を実行。「分析・出典表示・研究保存までできた」。
- 続いて意味検索で「疲れをためずに生活のペースを取り戻したい」を検索。「関連する知識と根拠が表示された」。

これにより、実ユーザーの公開知識→実Gemini分析→引用確認→研究保存、および実Gemini埋め込みを使う日本語意味検索は、本番本人操作でも成功した。生成結果全文・応答トークン数は受領していないので、その値を推測しない。

## 機械的な本番確認

2026-10-15 08:06 UTCにHTTPS経由で `/api/knowledge-lab/config` を読み取った。

- enabled=true / reason=null
- safetyCheck.status=verified / failure=null
- aiAvailable=true / semanticAvailable=true
- Render releaseCommit=`8378031b754e5e86d9575c6f15cf37eb0dec15be`

これは可用性・保護検査の結果であり、本人操作の代替ではない。本人操作の結果は前節のとおり別に記録する。Vercel #210の配信ファイル照合と公開画面6幅は `navigation-header-improvements.md`、実Geminiのローカル引用検証は `citation-evidence-fix.md` / `live-gemini-verification.md` を参照。

## 25項目の現在地

実装の共通パスは `backend/knowledge-lab/`（以下B）、`frontend/public/knowledge-lab/`（以下F）、`tools/knowledge-lab-tests/`（以下T）。全件を本人が本番で操作したとの報告ではない。

|#|項目|実装・検証|本番確認|
|---|---|---|---|
|1|経験知投稿|B/service.js、F/lab.js、T/completion-storage.test.cjs|本人の下書き・公開・再表示成功|
|2|独立した分類軸|B/taxonomy.js・model.js、F/lab.js、facet-checkboxes-fix.md|公開画面6幅・本人分類操作。曖昧jobの自動推測なし|
|3|複数条件検索|B/model.js・service.js、T/completion-model.test.cjs、facet_controls.py|公開画面の分類検索確認。全組合せの本番負荷試験ではない|
|4|意味検索|B/semantic.js・gemini.js、実API日本語5例|今回本人が関連知識・根拠表示を確認|
|5|2〜3分野|B/ai-service.js・service.js、実API2/3分野|今回は2分野で成功。3分野の実API確認はローカル|
|6|実経験知のAI分析|B/gemini.js、T/completion-ai.test.cjs|今回実際の公開経験知で本人成功|
|7|参照元表示|B/gemini.jsの根拠ID・原文復元、citation-evidence.test.cjs|今回本人が出典表示を確認|
|8|仮説と検証の区別|B/verification.js、F/lab.js、T/completion-circulation.test.cjs|未検証仮説の表示配信。第三者確認の本番操作は未実施|
|9|研究保存・編集|B/service.js、F/lab.js、T/completion-ai.test.cjs|手動研究編集と今回AI研究保存を本人確認|
|10|履歴|B/service.js、T/completion-circulation.test.cjs|前段で本人確認|
|11|保管・復元|同上|前段で本人確認|
|12|実践結果追記|B/service.js・activity.js、T/completion-circulation.test.cjs|実際に試した結果の本番追記は未報告|
|13|研究から新知識|B/service.js・derived_links、F/lab.js|ローカル循環テスト成功。本番派生投稿は未報告|
|14|書き手登録・投稿|B/service.js、F/lab.js・recruitment.js|本人登録・プロフィール・投稿成功。初期10人達成とは主張しない|
|15|募集と図書館|B/router.js・service.js、F/integration.js|既存本番募集・回答一覧は表示。回答→公開への本番全工程は未報告|
|16|Passport・星空|B/activity.js、F/star-activity.js、T/completion-circulation.test.cjs|配信済み。本人の新しい活動が星空で見える最終操作は未報告|
|17|Owner管理|B/router.js・verification.js、T/rules.test.cjs|本人が分類・モデル・保存数集計を操作。各管理操作全部の本番実行ではない|
|18|利用状況|B/analytics.js、completion-operations.md|本人スクリーンで実集計表示。一部指標は実活動がまだ0件|
|19|AI使用量・費用|B/ai-budget.js・ai-service.js、各AIテスト|無料枠確認・モデル設定・有効状態。請求書との費用突合は未実施|
|20|PC・スマホ|F/lab.css・lab.js、navigation-header.py・各公開画面6幅|公開画面6幅と本人PC操作。全認証経路×全幅の本番実行ではない|
|21|既存機能|Emu/ガイド174回帰・ネイティブEmulatorブラウザ|本人の既存SchoolPark・Emu利用。LINE/Google/ウォレット/City等の全本番操作は未実施|
|22|Rules・権限|firestore.rules、B/router.js安全検査、T/rules.test.cjs|本番保護検査verified。他人の非公開内容は取得していない|
|23|本番動作|Vercel/Render公開、本人操作の上記記録|中核経路PASS。未実施の経路を含めて全件PASSにはしない|
|24|募集ページ|knowledge-lab-writers.html・recruitment.js、公開ブラウザ|公開済み。既存利用資格と投稿枠を説明|
|25|営業資料|completion-outreach-draft.md・completion-operations.md・公開ガイド・営業kit|公開機能を案内する文章へ更新。Production紹介・募集・ガイド画像と動画編集指示を納品。実操作動画は未制作|

## AI・検索・費用・データ

- 分析モデル `gemini-3.5-flash-lite`、意味検索 `gemini-embedding-001`。サーバーからGoogle Gemini APIを使用する。
- 投稿者のAI利用同意がある公開知識と、利用者の送信確認を必要とする。非公開本文・秘密鍵を送らない。
- AIは未検証仮説。引用はサーバーが選定した根拠IDに対して原文を復元し、さらに既存の厳密照合をする。存在しない出典は採用しない。
- 分析はPassportごと3回/日・全体10回/日、埋め込み全体60回/日など現行上限を維持。無料枠超過時の有料フォールバックなし。
- 意味検索は実埋め込み。語句・10軸・AND/OR・除外・並べ替え・ページ送りは既存の検索モデルと組み合わせる。編集・取り下げ・同意撤回は正本で再確認し、非公開を結果へ出さない。
- 本番の大量データ性能や全検索品質を、この少数ケースから保証しない。

## 今回の範囲と残り

元の設計を縮小した判定ではなく、未実施の証拠を区別した記録。とくに実践結果→派生投稿→星空の実際の本人利用は残る。営業用の文章・Production公開ページ画像・動画編集指示は `completion-outreach-draft.md` へ納品済み。実操作動画の撮影・編集は未実施。新しいプラン保持枠・購入画面は `docs/business/membership-capabilities-release.md` に分離し、この本番確認で適用済みとは扱わない。

最終質問「当初構想の全機能が25項目すべて本番で実証された完成形か」：**UNVERIFIED**。実装・ローカル検証・中核本番の証拠はあるが、表の未報告を推定で埋めない。サービスが使えないという判定ではない。
