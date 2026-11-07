# 冷蔵庫くんに頼む — Plus・Pro限定の公開設定

2026-11-07 Founder指示。既存#281の台帳払い・ジョブ・返却を維持する。

## 提供条件

- 新規依頼は実効プランplus/proだけ。Free/Lightと7日Lightギフトは対象外。
- 環境設定へguest/lightを書いても許可プランを拡張できない。料金5 EMUER、本人3/日、全体20/日、同時2、100,000予約tokens/日、5,000/件、初期7日間は維持。
- 会員プランをクライアントから受け取らず、見積・新規支払い・AI実行前にサーバーの会員情報をfreshで読む。公式パスの実効plusは既存の判定を維持し、当該Passportのパス判定キャッシュも読み直す。他機能の通常のキャッシュ動作/契約権利は変えない。
- 年齢・提供地域・プロバイダー条件はprivate eligibilityで運営確認済みの人だけ。Plus/Proやログインを成人確認へ代用しない。自己申告入力やクライアントによる登録は不可。
- アカウント切替中の古い通信は破棄し、新しい本人の残高・履歴を再読込する。切替による残高の空欄固定や古い同意画面の残留を防ぐ。
- 降格・期限切れ後も本人の過去の取引履歴は確認できる。新規依頼を拒否し、支払後に実行資格を失った場合は既存の返却処理を行う。
- 初期資料は運営公式5ギルドの名称・短い説明のみ。FounderがAI利用権/許諾を確認。内容ハッシュ/目的/期限/公開性/PII確認を維持し、未承認の投稿・教材・参加者・非公開資料は送らない。

## 本番設定

`ECONOMY_EXPLORER_PLANS=plus,pro`。既存の他attestationを事実に基づいて設定し、7日開始日時は実際の公開準備/開始時刻を記録する。private商品はprice EMUER5/termsVersion explorer-20261107-v3を照合。実際の許諾・資格が成立するまで商品はdraft、受付はfalse。

2026-11-07、Cloud Billing GETは200/billingEnabled:false、Service Usageは200。3.5 Flash Liteの無料effectiveLimitは15RPM/入力250,000TPM/500RPD。新規カード・有料契約・有料fallbackを使わない。

共有クォータの設定値と現在使用量は区別する。既存Labは同じ3.5モデル、チャットは既定3.1モデルでRenderキーを共有する。Labの既存200,000tokens/JST日とExplorer専用枠を混同しない。運用中はOwnerの専用usage/worker/provider-safetyとAI Studioのプロジェクト/モデル別実使用量を確認する。quota APIはlive残量を返さない。管理APIの再照会で無料モード/上限設定の変化も確認する。

429/モデル不可/不明使用量で新規受付停止、既払失敗は元の台帳へ全額返却。返却未確定は返却待ち。試験後/障害時の新規停止は受付falseまたは当該商品draft。既払依頼・返却が残る間はworkerを維持し、レコードを消さない。

## 検証とリリース

- `npm --prefix backend test`
- 専用demo Auth/Firestoreで `node --test --test-concurrency=1 tools/economy-tests/integration.test.cjs tools/economy-tests/rules.test.cjs`
- フロント/ガイド回帰と、`tools/economy-tests/browser.py`、`reizo-browser.py`、`plus-pro-browser.py`。
- browser.pyはローカル台帳で1回支払う。100の初期残高を前提とするreizo-browser.pyの前にはfixtureを再起動する。共有本番DBでは実行しない。
- tourの保存/互換性ガードは、entitlementのfreshオプションに関する3か所だけをapproved manifestで正確に除外し、ほかの契約・認証実装の一致確認を維持する。新しい実動作テストで失効/降格/旧見積拒否/返却/パスキャッシュを検証する。

本番の1回最大5 EMUER試験の対象はFounder指定の「俺たちの青春」。本人の成人・地域等の資格も運営確認済みとの回答を受領。表示名だけで選ばず、信頼されたアカウント/Owner/相互Passportリンクで一意に照合する。キー・UID・SPID・トークンは報告へ載せない。実ログインなしで本人になりすますトークンを発行しない。

この文書は提供仕様・運用手順であり、本番決済成功の証拠ではない。公開SHA/部署/実試験結果はPRと作業の最終報告で区別する。Knowledge Labの製品コード・Rules・報酬・既存プラン権利は今回変更しない。

## 見積400エラーの修正

本番の親画面の`emuAuthHeaders`は`Content-Type`を返す。依頼画面が小文字の同名ヘッダーを追加すると、ブラウザが`application/json, application/json`へ結合し、ExpressがJSON本文を解析できず見積が`INVALID_INPUT`で拒否されていた。`Headers`へ変換して`set`することで、認証情報を維持しながらヘッダーを一つに正規化する。決済や認可の条件は変更しない。

ブラウザfixtureも本番の認証ヘルパー関数を読み込む。`headers-browser.py`は分離環境で修正前の400と修正後の200/5 EMUER見積を比較し、どちらも支払いを送らない。`browser.py`と`reizo-browser.py`は同じ認証ヘルパーで既存の台帳決済・二重送信防止・アカウント切替を検証する。本番の見積失敗時点では依頼/決済は0件。実Geminiを伴う本番受入試験は別途本人操作の後、保存された支払い・結果・履歴で判定する。
