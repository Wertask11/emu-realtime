# スマホのメニュー入口を1つにする

2026-10-19。最新main `f75111c47a436927feea7cd317f00405ff7700fc` から `fix/mobile-single-switch` を作成。

スマホで3本線と「SchoolPark / Emu 切替」が同じメニューを開く重複を解消。「サービス名＋切替」を残し、同じメニューを開く旧アイコンをCSSで非表示にした。パスポート・お問い合わせ・ブランド切替の内容と処理、プロフィール・冷蔵庫くんは維持。PC・タブレットのサイドバー開閉ボタンは別の役割なので残す。

SchoolParkのチュートリアル対象を表示される切替へ引き継ぎ、冷蔵庫くんの「スマホは左上の☰」という案内を修正。進捗のID・保存状態、会話機能・保存、認証・Passport・報酬・参加条件・Rules・既存データは変更しない。SchoolParkのJavaScriptは公開済みmainと完全一致。

製品の変更は `service-header.css`、`schoolpark/dao.html` の表示クラス・案内対象、`tour/reizo-tour-pages.js` と `reizo/knowledge.js` の案内文だけ。テストの全ファイル比較にはこの表示クラスを明示し、他の比較を維持した。既存の検証サーバーが4210を使用中だったため、同じ隔離エミュレーターを使い、別ポート4211から最終コードを起動。検証用のPORTを指定できるようにしたが、接続先はlocalhostに固定。

## 検証

- 選定した中核・ギルド・報酬・案内・契約不変テスト：342 PASS / 0 FAIL。
- 構文・JSON・重複ID・ローカルリンク・diffチェック：PASS。
- 実Auth / Firestore Emulator / 現行Rules / Chromium、375・390・412・768・1280・1440・1920px：7幅PASS。
- 両サービスの旧アイコン非表示、スマホのメニュー入口が1つ、切替・Escape・フォーカス復帰、パスポート・問い合わせメニューの表示を確認。閲覧で未登録、参加と取消、ログイン/Passportの維持、報酬等不変、既存進捗・冷蔵庫くんも同じフローで確認。
- JavaScript例外0。未参加文書404、検証fixtureに未接続のランキングAPI等の既知のコンソール記録18件は残り、エラー完全0とは扱わない。
- 本番書き込みは実施していない。Previewビルド・本番公開の状態はPRに記録する。

[検証結果](evidence/single-switch-results.json) ／ [スマホSchoolPark](evidence/single-switch-schoolpark-390.png) ／ [スマホEmu](evidence/single-switch-emu-390.png)

画像は実Chromiumによる隔離環境の画面。LOCALと表示された合成テストデータであり、本番の投稿・参加実績ではない。
