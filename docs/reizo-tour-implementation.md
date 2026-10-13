# SchoolPark・Emu 画面別ガイド 実装メモ

## 編集前の調査

- 開始時：ローカルmain `e1ee7f9`、未コミット変更なし。fetchした最新mainは `b8bc5a9f816f7120e6da7b9a248ad070943d82d8`。このコミットから `feature/reizo-tour` を作成。mainの内容は編集しない。
- リポジトリにAGENTS.mdなし。対象はemu-realtimeのみ。
- SchoolParkは `schoolpark/dao.html` の `Component.state.screen` と `draw()` がテンプレートを再描画。属性はテンプレートへ置き、draw後に親の連携処理へ通知する。
- SchoolParkの実際の順序は home/logs/experiments/library/park/members/treasury/city＝ホーム/ギルド/クエスト/知恵/公園/貢献/treasury/CITY。PCサイドバーとスマホ下部タブは同じ8項目。
- Emuは親index.htmlのbody classとshowEmuFeed/Requests/Ichinichi/Discussionで切替。「知識を読む」は `#emuKnowledgeFrame` 内のknowledge.html。ガイドは親と同一originのiframeの矩形・スクロール・再描画を追う。
- Room1の重複原因：親の `#emuRequestsPage .emu-room1-entry` に正しい入口があり、knowledge.htmlの `.left [data-command="room1"]` に古い入口が残る。後者はPCにもスマホにもCSSで表示され、親へemu-knowledge-commandを送る。古い表示要素だけ削除し、親のopenSpRoomと `/admin/room1/index.html` は維持する。
- サポートは `#emu-contact-panel` の既存 `switchContactTab` と `#w-tutorial-body`。問い合わせ本文・種別・バリデーション・submitContactは保持する。
- 冷蔵庫くんはdaoのaskReizo→親spReizoOpen。選択UIを挟み、チャット選択時に元のspReizoOpenへ接続する。
- tutorial.htmlの概要表に02公園/04ギルド/05知恵という旧順序が残る。表と説明ナビを現在の順序へ修正する。index.htmlの冷蔵庫くんFAQにも旧順序があり、こちらも修正する。
- フロントエンドは配信する静的HTML/JS/CSSで、専用build/lintスクリプトはない。既存Nodeテスト、JS/inline script構文検証と、外部通信を遮断したローカルChromiumで確認する。認証/Firebaseの実ユーザーデータは使わない。

## 変更予定

`frontend/public/tour/reizo-tour.js`（コントローラ）、`reizo-tour.css`（表示）、`reizo-tour-pages.js`（案内定義・ナビ連携・サポート）、index.html、knowledge.html、schoolpark/dao.html、schoolpark/tutorial.html。依存ライブラリの追加なし。

## 日本語案内文と進行条件

各行の説明はステップごとに一要点に分ける。すべて「次へ」だけで完了可能。個別データIDは進捗/ログに入れない。

| テンプレート | 確認する目印 | 見出しと本文（ステップ順） | 進行条件 |
| --- | --- | --- | --- |
| SchoolPark ホーム | home-main/menu/home-wisdom/home-quests/home-todo/fridge/support-btn | ホームの概要：知恵や進行中の仕事の概要を確認できます。／メニュー：ホーム、ギルド、クエスト、知恵、公園、貢献、treasury、CITYの順です。／生まれた知恵：経験から残った一文を読めます。／進行中のクエスト：仕事の内容や締切を一覧から確認できます。／自分の宿題：自分が取り組むことを確認する場所です。／冷蔵庫くん：画面のガイドと、質問するチャットを選べます。／困ったとき：サポートから問い合わせとガイドの再生へ進めます。 | 次へ。ナビ遷移は旧ガイドを一時保存し、新画面の初回ガイドへ。参加/完了操作は要求しない |
| ギルド | guild-intro/guild-list | ギルドとは：活動のまとまりと決めごとを見る場所です。／ギルド一覧：カードから活動とルールを確認できます。ここで参加する必要はありません。 | 次へのみ |
| ギルド詳細 | screen-heading/guild-detail | ギルドの詳細：活動や参加条件を確認できます。／決めごとの見方：ルールと議題を読んでから判断できます。投票や参加はこの案内の条件ではありません。 | 次へのみ。個別ギルドIDを保存しない |
| クエスト | quest-intro/quest-filter/quest-list | クエストとは：仕事や実験の内容を確認する場所です。／絞り込み：表示する種類を切り替えられます。／一覧から詳細へ：内容や期限を読んで検討できます。応募・参加は案内の条件ではありません。 | 次へ。絞り込みは既存ハンドラ後に状態が変わった場合のみ進む |
| クエスト詳細 | screen-heading/quest-detail | 内容を読む：概要と現場の資料を確認する画面です。／条件を確かめる：期限や報告の説明を読んでから判断してください。受ける・提出する必要はありません。 | 次へのみ。共通詳細テンプレートの進捗のみ |
| 知恵 | wisdom-intro/wisdom-tags/wisdom-list | 知恵とは：元の知識を実際に試し、残った一文を読む場所です。／分類で探す：タグで表示を絞れます。／カードを読む：必要なら詳細を開いて、経験の背景を読めます。引用や投稿は必須ではありません。 | 次へ。タグの実状態変更で進行可能 |
| 公園 | park-intro/park-map | 公園とは：遊びや活動の入口を見る場所です。／地図の見方：気になる場所を確認できます。移動や参加をしなくても案内を終えられます。 | 次へのみ |
| 公園の広場 | screen-heading/plaza-list | 広場の見方：活動の表示内容を確認できます。／一覧を読む：予定や挑戦を見られます。参加・投稿は必要ありません。 | 次へのみ |
| 貢献 | contribution-intro/contribution-list | 貢献とは：活動の記録を確認する場所です。／一覧の見方：知恵や完走、引用の記録を見られます。表示だけでは支払いは発生しません。 | 次へのみ |
| treasury | treasury-card/treasury-transactions/support-btn | treasuryとは：予算とお金の記録を確認する場所です。／取引の見方：表示された記録を読む案内です。送金・購入は行いません。／分からないとき：サポートから問い合わせできます。 | 次へのみ |
| CITY | screen-heading | CITYの入口：SchoolPark Cityへ広がる入口です。詳細な移動・購入・チェックインの案内は今回ありません。 | 次へのみ |
| 自分の宿題 | screen-heading/tasks-list | 自分の宿題：取り組むことを確認できます。／一覧の見方：締切やメモを読めます。追加・完了・削除はこの案内では行いません。 | 次へのみ |
| 年内目標 | screen-heading/year-goals | 年内目標：SchoolParkの目標と資料を読む場所です。／資料を読む：必要な箇所を確認してください。提出・編集は必要ありません。 | 次へのみ |
| Emu 知識を読む | knowledge-sort/knowledge-card/emu-tabs | 一覧の見方：並び替えて知識を探せます。／カードを読む：本文はカード内で読めます。長い本文は続きを読むから確認できます。／画面の切り替え：知識を読む、知識を探す、一日シェア、議論の4画面です。保存・投稿は案内の条件ではありません。 | 次へ。既存並び替えの選択状態が変われば進行可能 |
| Emu 知識を探す | request-intro/request-list/room1-entry | 知識を探す：まだ答えがない困りごとを確認する場所です。／募集を読む：内容を読んで、自分に合うものを探せます。募集や回答を出す必要はありません。／Room1の入口：分野別の学習コンテンツはここから開けます。案内は次へだけでも完了できます。 | 次へのみ。Room1を押した場合は既存の部屋遷移に任せ、途中位置を保存して閉じる |
| Emu 一日シェア | share-frame/emu-tabs | 一日シェアとは：日々のシェアを読む画面です。／次の画面へ：下部または左のタブで移れます。投稿や＋ボタンの操作は不要です。 | 次へのみ |
| Emu 議論 | discussion-frame/emu-tabs | 議論とは：開催中の議論を確認する画面です。／画面の切り替え：読むだけでも大丈夫です。発言やルーム作成は案内の条件ではありません。 | 次へのみ |

サポートから対象画面へ移動する場合は既存ナビを使い、アクセス拒否・データ不在なら安全な説明を表示する。初回案内を出すための認証回避や、レコード自作は行わない。

## 実装結果・変更ファイル

SchoolPark 13種類、Emu 4種類、計17種類の画面テンプレートを登録した。案内文と進行条件は上の表に対応し、表示する最終文言の定義は `frontend/public/tour/reizo-tour-pages.js` にある。既存ホームの指標は累積なので、「今週の概要」という説明は使わず「ホームの概要」とした。

| ファイル | 変更内容 |
| --- | --- |
| frontend/public/tour/reizo-tour.js | 外部依存のない共通コントローラ、状態保存、スポットライト、位置更新、キーボード操作、安全な待機・再開 |
| frontend/public/tour/reizo-tour.css | ガイドとカタログに限定したスタイル。既存画面のCSSは維持 |
| frontend/public/tour/reizo-tour-pages.js | 17種類の案内、既存ナビとの接続、冷蔵庫くんの選択、ガイド・動画カタログ |
| frontend/public/index.html | JS/CSS読込、最小限の目印属性、既存サポートのチュートリアルタブ接続、FAQの旧順序修正 |
| frontend/public/knowledge.html | 読む画面の古いRoom1ボタンを削除。並び替えとカード見出しに目印を追加 |
| frontend/public/schoolpark/dao.html | 既存テンプレートへ目印を追加。draw後の通知。冷蔵庫くんの選択・Enter/Space対応 |
| frontend/public/schoolpark/tutorial.html | メニュー概要表と説明ナビの順序を修正 |
| tools/tour-tests/reizo-tour.test.cjs | 保存値の破損・プライバシー・保存不可・定義不正・Room1入口等の6件 |
| tools/tour-tests/make-fixture.cjs | 実テンプレート・既存UI処理を使ったLOCAL DUMMY親画面の生成。認証と取得データを代替 |
| tools/tour-tests/serve.py | 本番へのプロキシを持たないローカル静的テストサーバー |
| tools/tour-tests/browser.py | 5幅でのガイド、位置、再開、既存操作、Room1、フォーム等のChromium検証 |
| docs/reizo-tour-implementation.md | 編集前の調査・計画と最終報告 |

## 表示・状態・操作の仕様

- `window.ReizoTour` に register/start/next/back/skip/later/progress/resume/restart を提供。実画面の `data-tour` と同一origin iframeの表示領域を測る。
- 対象に約6pxの余白・角丸・枠を付け、周囲を暗くする。暗幕はpointer-events:none。吹き出しのボタンは44px以上。
- 吹き出しはmodeless dialog。Escであとで閉じる。フォーカスリング、読み上げ用見出し・status、reduced-motionに対応。開始元の冷蔵庫くん・カタログボタンへフォーカスを戻す。
- 未視聴テンプレートだけ自動表示。途中は自動割込みをせずサポートから再開。完了・スキップは明示的に再生するまで再表示しない。
- 「あとで閉じる」と画面遷移は途中位置を保存。「スキップ」はskipped。「完了」はdone。メニューで別画面へ移ると旧ガイドを閉じ、未視聴なら新画面の案内を開始する。
- 保存キーは `rk-tour-v1`。形式は `{version:1,tours:{"sp-home":{state:"in_progress",index:0}}}`。個人情報、フォーム値、本文、ウォレット、Quest/Guildの個別IDを含めない。未知バージョン・壊れた値を初期化し、他のアプリ用キーへ触れない。保存不可ならその場の案内を続け、保存できない旨を表示。
- nextだけで全案内を終えられる。クエストの絞り込み・知恵のタグ・知識の並び替えは、既存処理が実際に状態を変えた後だけ進行。クリックの停止・再実行をしない。
- 投稿・公開・参加・投票・決済・ウォレット接続を自動実行しない。フォーム、チャット、小部屋等の表示中は案内を一時停止する。
- requestAnimationFrame、ResizeObserver、DOM監視でスクロール・再描画・iframe読み込み・リサイズに追従。画面遷移で旧監視を解除。一時的に対象がなければ待機表示し、2.5秒後も不在なら説明して飛ばす。最終ステップ不在なら完了にする。
- サポートの途中一覧と全画面一覧から再開・再生・最初からを選べる。既存ナビで移動し、データ不在・入口利用不可なら説明を表示。ギルド詳細は既存カードの閲覧コールバックを使い、参加や投票はしない。
- サポートのタブ切替で問い合わせ入力とスクロールを保つ。案内を閉じると開始元がサポートならパネルを戻し、ボタンへフォーカスを戻す。

## PC・タブレット・スマホの確認

Python Playwrightと `/usr/bin/chromium` を使用した。各幅で17テンプレートを確認し、ボタン領域、吹き出しの画面内配置、対象との非重複、既存固定ナビとの配置を検査した。

| 幅・高さ | 配置・結果 |
| --- | --- |
| 1280×900 | 約330pxの吹き出し。対象の右・左・下・上の順で入る位置を選択。PASS、pageerror 0 |
| 768×1024 | 最大480px。対象と干渉する場合はシート配置へ。PASS、pageerror 0 |
| 412×915 | 幅−16pxのシート。固定ナビを避ける。PASS、pageerror 0 |
| 390×844 | 同上。PASS、pageerror 0 |
| 375×667 | 同上。下に置くと対象を覆う場合は上側へ移動、または高さを制限。PASS、pageerror 0 |

遅延600msの対象、2.5秒の対象不在、対象DOM置換、375↔768pxリサイズ、保存不可の追加検査も成功。スクリーンショットは `/workspace/outputs/reizo-tour/local-dummy-*.png` に保存した。すべてLOCAL DUMMYラベル付きで、実ユーザーの投稿・アカウントは使用していない。

## Room1・古い順序・既存操作

Room1の重複原因はknowledge.htmlの旧 `[data-command="room1"]` ボタンだった。この表示要素だけ削除し、関連する既存CSS・親のメッセージ処理は削除していない。

5幅で、読む画面には当該入口がなく、探す画面には `.emu-room1-entry` が1つ表示されることを確認。クリックは従来の `openSpRoom('/admin/room1/index.html','Room1')` に接続し、小部屋表示とiframeの従来srcを確認した。Room1内部の認証・API・学習データは変更せず、実アカウントでの学習操作は今回のローカル検証対象に含めていない。

旧順序を修正した場所は、tutorial.htmlの8項目概要表・説明ナビ、およびindex.htmlの冷蔵庫くんFAQ「昔のSchoolPark」の回答。実メニューは元から正しい8項目だったため変更していない。調査した対象4HTMLに旧番号・旧順序の説明は残っていない。該当箇所に旧順序を含む画像はなく、動画も未登録。

既存4HTMLの15個のinline styleブロックは変更前と同一。問い合わせの種別選択・検証・保存・確認・送信・成功表示、およびチャット開閉・送信、小部屋開閉の計15関数も変更前と同一であることを比較した。ブラウザではフォームの不正メール拒否、タブ切替での入力保持、送信成功、チャット質問・回答、冷蔵庫くんの選択を確認。フォーム送信はブラウザ内でローカル応答へ差し替え、Productionへ配送していない。

## テスト・lint・build

| 検証 | 結果 |
| --- | --- |
| `node --test tools/tour-tests/reizo-tour.test.cjs` | 6件成功、失敗・skip 0 |
| `node --test tools/emu-tests/*.test.cjs` | 161件成功。最終HTMLでも再実行して成功 |
| member/admin/year-goals/invite/balance/wallet/theme/i18n各 `tools/<suite>/*.test.cjs` | 合計429件成功。Emuと合わせて既存590件成功 |
| `python tools/tour-tests/browser.py --output /workspace/outputs/reizo-tour` | 5幅・17テンプレートとタイミング/再描画/保存/既存操作の検査が成功 |
| `node --check` 新規2JSと対象HTMLのclassic inline script | 新規2JS・inline 21個すべて成功。JSON-LDも解析成功 |
| `git diff --check` | 成功 |
| frontend専用lint/build | 実行スクリプトがない静的配信構成。新設せず、構文検査・既存テスト・実ブラウザで検証 |

追加で `node --test tools/guild-tests/*.test.cjs tools/wisdom-tests/*.test.cjs` も実行した。この196件は140件成功・56件失敗。変更前のHEADを `/tmp` へ展開して同条件で比較すると、140件成功・56件失敗で失敗項目もすべて同じ。今回追加された失敗は0件。

追加テストの残件には、Node Playwright用ブラウザが未取得のため起動不可、旧関数名を前提としたテスト、Firestoreローカル検証の権限拒否・既存アサーション不一致が含まれる。今回の範囲で既存認証やルールを変更して解消していない。**全既存テストが成功したという扱いにはしない。** 詳細の変更前後比較は `/workspace/outputs/reizo-tour/additional-baseline-results.json`、5幅の結果は同ディレクトリのbrowser-results.jsonに保存した。

ローカル起動手順：

```sh
cd /workspace/emu-realtime
python tools/tour-tests/serve.py
```

別セッションから `http://127.0.0.1:4180/__tour-fixture.html?brand=schoolpark` を開く。検証は別セッションで次を実行する。

```sh
cd /workspace/emu-realtime
python tools/tour-tests/browser.py --output /tmp/reizo-tour-evidence
node --test tools/tour-tests/reizo-tour.test.cjs
```

テストページは配信ディレクトリ外で生成し、正式なHTMLへダミー状態を追加していない。Python Playwrightとsystem Chromiumは現在のクラウド環境で利用可能。依存・lockfileの変更なし。

## プライバシー・動画・作業範囲

既存GAの初期化・configを維持し、ガイドを既存Analyticsへ送らない。新規コードにネットワーク送信はなく、ローカルhostnameでのみテンプレートID・ステップ番号・操作方式をconsole.debugする。問い合わせ本文・個人名・ユーザーID・コンテンツIDは含めない。未登録動画の再生イベントもない。

動画はSchoolPark/Emu × PC/スマホの4枠で「動画準備中」。提供されたProduction録画はなく、撮影もしていない。動画を公開する場合は、実操作の正式な録画を別途用意する必要がある。

ブランチ：`feature/reizo-tour`。基点：`b8bc5a9f816f7120e6da7b9a248ad070943d82d8`。変更はローカルの未コミット差分。mainへの変更・push・PR作成・マージ・デプロイなし。Firebase/Auth・Firestore Rules/スキーマ・バックエンド・報酬・決済・外部APIは編集していない。CamelliaとSchoolPark_homepageも編集していない。

本番の認証セッション・本番データの完全な回帰確認は未実施。共有用Preview URLは作成していない。今回の成果物は上記ローカル検証とソース差分までで、本番反映は行っていない。

`cloud-environment-onboarding:setup` に従い、上記の検証済みローカル起動手順をクラウド環境設定のstart_skillへ追記して下書き保存した。他の起動手順・ネットワーク・資格情報・依存設定は維持。下書きの保存は確認済みだが設定は未適用で、利用者が環境設定で内容を確認・保存して環境を公開すると適用される。アプリのProduction反映とは別の操作。

## 後続の本番反映依頼

上記の「未コミット・未反映」は初回実装報告時点の状態。2026-10-13に利用者から本番反映の指示を受け、最新origin/mainが同じ基点であることと、ガイド6件＋Emu161件の最終再検証が成功したことを確認した。実装差分をコミットし、GitHub PR経由でmainへ反映して、接続済みVercelのProductionデプロイと公開ファイルを確認する。認証・Firestore・バックエンド・決済の変更は含めない。

## 読み込みと案内のタイミング修正

初版は画面テンプレートの見出しが存在すると案内を開始していたため、SchoolParkの読み込みカバーが上に残っていても、背後の見出しへスポットライトを出していた。ギルド・クエスト一覧の取得前にも説明を開始でき、2.5秒の対象不在タイマーで未表示の項目を飛ばす可能性があった。

修正では次の両方を待つ。

- `spLoadingOverlay` と共通 `loadingOverlay` が非表示になり、ログイン復帰中の `ches-resuming` が解除されること。「準備完了」表示やopacity 0のフェード中も、カバーが実際に非表示になるまでは案内を出さない。
- SchoolParkの既存setStateで必要なデータが渡され、その画面のdrawが終わること。ホームは本人表示・知恵・クエスト・宿題、ギルド一覧はguilds、クエストはquests、知恵はwisdom等を確認する。ギルド詳細は既存 `curGuild.loading` がfalseになるまで待つ。未取得の初期空配列と、取得済みの空配列を区別する。

データ到着・描画完了の目印はComponent内の一時的なbooleanだけで、localStorage・Firestore・Analyticsへ保存しない。既存の取得処理、読み直し・認証・アクセス制御は変更しない。見出しだけで先に開始したり、固定秒数を経過しただけで準備完了としたりしない。

待機中はガイド・スポットライトを非表示にし、初回なら未視聴を保つ。待機中に他の画面へ移った場合も、その未表示のガイドを途中扱いにしない。表示中に読み込みカバーが出た場合は同じステップを保持して一時的に隠し、カバーが消えた後に同じステップを表示する。待機を対象不在として数えず、自動スキップやnextによる先送りも抑止する。取得済みで本当に対象がない場合は、従来の2.5秒スキップを維持する。

追加回帰：`python tools/tour-tests/timing.py --output /tmp/reizo-tour-timing-evidence`。LOCAL DUMMYの各データ到着を保留し、375pxと1280pxでカバー・フェード・復帰中、段階的な到着、3秒以上の遅延、途中ステップの一時非表示/復帰、ギルド一覧/詳細、クエストの未取得/拒否/取得済み空、別画面へ移動後の遅い到着を確認した。両幅で成功。通常の5幅・17ガイド回帰も成功し、Nodeは新規ガイド7件＋Emu161件の168件、年内目標35件が成功。変更JSとdao.htmlの構文・git diff --checkも成功。

このタイミング修正でも既存のdone/skipped/途中の進捗はリセットしない。以前見た案内を再確認する場合はサポートの「最初から見る」を使う。

## ホーム表示済みでも案内を待ち続ける条件の修正

「手動では表示できるが、自動表示だけ出ない」という報告は、初回案内を未視聴時だけ自動表示する仕様と区別する。前回の状態が途中・完了・スキップなら再読み込みでは自動表示しない。個別の本番ブラウザのlocalStorageは取得していないため、利用者の保存状態の詳細は断定しない。冷蔵庫くんの選択UIに、途中の場合はステップ数と「続きから再開」、完了・スキップの場合は保存状態と再生可能である旨を表示する。自動再表示や保存状態のリセットは追加しない。

別に、前のホーム開始条件がme/wisdom/questsに加えてtasksの取得も必須としていた問題を再現した。宿題の取得処理は通信失敗時にsetStateせず終了するため、メインの内容が描画済みでもtasksの目印が立たず、初回・手動の両方が無期限に非表示となり得た。ホームは本人表示・知恵・クエストの描画完了を待ち、独立した宿題取得は全ガイドの開始条件から外す。宿題の案内は既存のセクション見出しの役割を説明するので、一覧取得を進行の必須条件にしない。独立した宿題画面のデータ待ちや、読み込みカバー・主データの待ちは維持する。

`python tools/tour-tests/home-ready.py --output /tmp/reizo-tour-home-ready-evidence` で、実テンプレートの宿題だけを保留し、1848×960と375×667で初回表示、全7ステップ完了、完了/途中/スキップ保存時の自動非表示と冷蔵庫くんからの手動再生・進捗説明、カバー表示中・クエスト未到着時の待機を確認し、両幅で成功した。通常の5幅・17ガイド回帰、Node203件、変更JSの構文・git diff --checkも成功。前のコードでは、同じ宿題保留状態でメイン描画後も初回・手動の両方が出ないことを再現済み。認証・データ取得処理・Firestore・進捗の形式は変更しない。
