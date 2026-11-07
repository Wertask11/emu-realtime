# 冷蔵庫くんに頼む Phase 2 — 横断探索

2026-11-07。既存の5 EMUER台帳決済・永続ジョブ・worker・返却を拡張する。Knowledge Labの製品コード・モデル・投稿UI・AI分析・Rules・既存プラン権利は変更しない。独立したサービスは追加しない。

## 実装と公開を分ける

各アダプターの実装は、AI送信する資料の許諾や本番での接続確認を意味しない。追加資料のタイトル・短い説明のレビュー一覧をFounderへ提示済み。未確認の範囲の承認文書作成・連携ONは行わない。既存の公式5ギルドは従来の許諾を利用できる。

| 領域 | 読み取り元 | 限界・必要な確認 |
|---|---|---|
| 公開知識・Knowledge Lab | 既存ready検索索引、正規rawPost/publicPost | 投稿者のaiUseConsent.allowed=trueと今回用途の個別レビューが両方必要。研究ノートの独立検索は同意形式がないため未接続。公開投稿として残された研究は投稿の条件を満たす場合のみ |
| Knowledge Text | room1_contentsの公開タイトル・要約 | 本文全量は送らない。今回用途の権利・許諾確認待ち |
| Guild | 公式5定義、sp_guilds公開説明 | 非公開の上書きがあれば公式定義へ黙って代替しない。参加者は読まない |
| Quest | sp_questsの公開OPEN/RUNNING | 参加条件は公開説明と遷移先で確認。個別の参加資格や報酬獲得を保証しない |
| City | liveの公式ショップ商品 | 在庫・注文期限・公開価格を再確認。取引/配送先/出店者個人情報は読まない |
| EMUER | 既存付与・交換実装を根拠とする短い公式案内 | 現行規則を説明するだけで新規付与・換金・送金を行わない |
| Passport・星空 | 既存公開仕様の短い公式案内 | ログインと公的本人確認を混同しない。任意の本人実績は件数のみ別経路で読み、AIに送らない |
| 遊び・体験 | 既存City入口を根拠とする公式案内 | ECHO FIELD・林檎の方程式・日常の神々・エレベーターを作り直さない |
| 使い方・プラン | 既存ガイド、共通membership-policy、統合ナビ | ガイドの元ファイル変更でレビューを失効させる。新たな権利を約束しない |

Camelliaは対象外。各取得は固定フィールド射影・1領域24候補まで（Labは正規投稿16件まで）。全データベースの網羅的検索とは呼ばない。

## 探索・意味比較

1. 自由入力をローカルで目的と固定の公開テーマに分類する。氏名等の任意語をGoogleへ送らない。
2. 必要な有効領域から並列取得。公開範囲、閲覧権限、投稿者AI許諾、運営の今回用途レビュー、有効期限、送信内容ハッシュを確認。
3. 同義語・概念と局所的な関連語で候補を2段階に絞り、領域の偏りと重複を抑え最大12件にする。
4. Geminiが固定目的/テーマと確認済み公開資料の意味を比較し、複数領域の候補・比較・手動の次の行動を選択する。埋め込みAPIは追加しない。既存Lab意味検索APIの予算/計測への書き込みも行わない。
5. 仮参照番号をサーバーで実在資料・正規URLへ復元する。自由なURL、未知ID、未提供の自動行動は拒否する。
6. 読み込み失敗・対象資料なし・無効領域を結果に表示する。生成前と履歴閲覧時に権利/資料を再確認し、撤回された根拠に依存する提案も除く。

これは上限付き候補探索＋Geminiによる意味比較であり、全領域の無制限な自律エージェント/ベクトル索引ではない。固定テーマにない細かな意図、24件を超える全件比較、独立した公開研究ノート検索は制限として残る。取得は領域ごと6.5秒上限、生成は既存45秒上限。追加の推論ループはない。1依頼5,000予約トークンとcountTokensによる入力削減、使用量不明時の停止を維持する。

## 同意・本人情報

見積もりにsearchProfile、scopeSnapshot、contextPermissionsを保存する。決済時にサーバーの最新プロファイル指紋、searchConsentVersion、支払い/AI送信同意を照合する。範囲・本人情報参照の可否が変われば古い見積もりは課金前に拒否する。古いPhase 1見積もり/既払ジョブを横断用途へ変換しない。

追加の `POST /api/economy/context` は既存Firebase認証、SchoolPark ID、Plus/Pro・資格の検証を使う読み取り専用API。許可する本文はbalanceConsent/achievementsConsentのbooleanだけ。他人のUID/SPID等は拒否する。本人情報の参照は任意チェック後だけで、残高はローカルの予算内商品選定、実績は本人への件数表示に限定する。生年月日、住所、ウォレット、Passport ID、残高・実績をGemini/分析へ送らない。画面のアカウント切替で同意と本人用表示を消す。

公式の公開情報でも許諾確認は別。新レビューは既存emuer_v2_agent_source_approvalsへ次を保存する（クライアントから拒否する既存Rulesを継承）。

```
purpose: explorer-cross-20261107-v1
piiReviewed: true
aiUseApproved: true
rightsVerified: true
contentHash: sha256(JSON.stringify([title, summary]))
validUntilMs: 運用確認期限
originHash: 公式案内の場合に元コードのハッシュ
authorPermissionConfirmed: 投稿者の許諾が別途確認された公式資料の場合のみtrue
```

Lab投稿者の明示拒否を運営フラグで上書きしない。旧公式ギルド5件の既存purposeは互換性のため保持する。本文/権利の変更後に一括再承認しない。

## 配備・停止・復旧

全フラグは未設定でOFF。まずコードを配備し、資料の承認と読み取り動作を確認してから必要な領域だけONにする。

- `ECONOMY_CROSS_DOMAIN_ENABLED=true`
- `ECONOMY_SOURCE_KNOWLEDGE_LAB`, `ECONOMY_SOURCE_KNOWLEDGE_TEXT`, `ECONOMY_SOURCE_GUILD`, `ECONOMY_SOURCE_QUEST`, `ECONOMY_SOURCE_CITY`, `ECONOMY_SOURCE_EMUER`, `ECONOMY_SOURCE_PASSPORT`, `ECONOMY_SOURCE_ACTIVITIES`, `ECONOMY_SOURCE_SERVICE` は領域ごとtrue
- `ECONOMY_PRIVATE_BALANCE_ENABLED`、`ECONOMY_PRIVATE_ACHIEVEMENTS_ENABLED` は本人用読み取りも提供する場合のみtrue

横断機能だけの停止はECONOMY_CROSS_DOMAIN_ENABLED=false。新規見積もりは従来の公式ギルド用途に戻る。未実行の横断ジョブは再解釈せず返却する。workerを止めて返却を妨げない。既に支払われた履歴は個別領域フラグ・許諾・元資料を再確認して読み取りを継続する。特定領域の緊急停止は当該SOURCEフラグをfalse（過去の根拠も非表示）。

価格5 EMUER、20/3/2、100,000予約トークン/日、既存7日試験開始日時、プラン/資格、Gemini Free、商品交換枠、台帳と返却履歴は変更しない。コードロールバック前に横断をOFFにして既払横断ジョブを安全に返却/完了させる。未知のジョブを古いworkerで処理させない。DB削除/Rules公開/課金設定変更は不要。

## 検証の区別

ローカル台帳/実Auth・Firestoreエミュレーター/モデルHTTP fixtureでの複数領域の支払い→結果と、実Geminiの開発用読み取り推論は別の検証である。実Gemini試験は既存許諾済み5ギルドからLEARN/WEB3、2行動、比較を返した（501 tokens、2,437ms、5,000枠内）。本番台帳・注文は作成していない。複数領域の実資料送信と追加の本番5 EMUER試験は許諾/個別承認待ち。実Android/iPhoneの性能は未測定。

画面検証は375/390/412/768/1280/1440/1920px。実行結果、ソース接続状態、PR・マージ・本番反映は最終追記で区別する。
