# SchoolPark City v0.1

調査・実装基準: `main` の `1d9a67a9ac40b91dca46292f34a3a39a4f3c867a`。
2026-09-29 に再取得して同じ先端であることを確認。ブランチは
`codex/schoolpark-city-v0-1`。main へのマージ、本番データ変更、デプロイは行わない。

## 1. 既存構造と追加位置

| 領域 | 実装・呼び出し関係 | Cityでの扱い |
|---|---|---|
| アプリ本体 | Vercelの `frontend/public/index.html`。Firebase AuthとSchoolParkの入場判定後、`openSpDao` → `spDaoFrame` | 変更なし。既存の関数をCity bridgeから呼ぶ |
| 01〜07 | `schoolpark/dao.html` のテンプレート、`Component.state.screen`、`app.go`。01広場、02ギルド、03クエスト、04知恵、05公園、06メンバー・貢献、07会計 | ナビ定義の末尾に08 CITY。既存画面を再生成しない |
| PC / スマホ | 700px未満は横スクロールする下部タブ、700〜1099pxはtablet、1100px以上はPC。サイドバーは開閉可能 | 既存タブ幅・スクロール保持処理を変更しない |
| Passport | `spPassportLoad` → 既存 `SPID.resolve` → `backend/identity.js`。サーバー発行の `SP-XXXX-XXXX-XXXX-XXXX` | City専用IDを発行しない |
| ログイン | Google・メールはFirebase、LINE・Walletは既存サーバー経由。UID → `sp_auth_links/fb:{uid}` → SPID。既存アドレスはaliasesとして利用 | Bearerトークン検証後、サーバーがUIDからSPIDを解決 |
| 入場 | `backend/schoolpark-access.js`。9/21 JSTから公式パス先行、10/1 JSTから一般公開。`paid_users`と連携済み名義を `entitlement.holdsOfficialPass` で確認 | 同じ判定をサーバーで再利用。CityのデータAPIは一般公開後もログイン必須 |
| Quest | `SpQuestStore`、`spDaoLoadQuests`、`app.openExp`、`sp_quests` と子のcommits/logs。完了承認は `backend/quest-completion.js` | 一覧・実在IDの詳細へ遷移。完了・周回・報酬処理は既存のまま |
| Guild | `SpGuildStore`、`sp_guilds`、`sp_guild_members/{guild}/joins・supports`、`spGuildOpen` | `learn` / `connect` / `web3` を参照。複製しない |
| 星空 | `_emuSendStarCounts`。Firestoreの投稿、改善採用、議論結論、承認済みQuest、`sp_stars`とPolygon上の保有NFTを集計 | 既存実績を読む。City DEMOを獲得Starへ変換しない |
| 星空キャッシュ | `emu_star_cache_v3` はUIDを照合した表示用の控え。Source of Truthではない | City活動をlocalStorageへ保存しない |
| Emu | `chesHubGo('emu')` による既存ブランド切替 | Spot詳細から「Emuに残す」。既存トップへ移動し、投稿は本人が行う |
| EMUER / 証明書 | `backend/emuer-v2`、`sp_quest_certificates`、`sp_stars`、`contracts-v2`のQuest Star契約。既存完了キー・周回とmint制御 | 変更なし。Cityから残高、報酬、承認、mintを書き込まない |
| サーバー | Renderの `backend/server.js`、Admin SDK、既存Auth・rateLimit | 独立Express routerを1か所mount |

`backend/identity.js` とテスト、`quest-completion.js` とテスト、アクセス判定、
`docs/schoolpark-id.md`、Rules・indexes、Quest Star契約を確認してから実装した。
着手前に実Productionをブラウザで開き、既存ログイン後のSchoolPark広場、
番号ナビとクリーム・濃緑・カードの見た目を確認した。
再開後のProduction確認では既存ロゴ入口が表示されることを確認した。
未マージのCityがProductionで動作した、という意味ではない。

## 2. 体験

08 CITYから独立モジュールを遅延読み込みする。HOMEには
SchoolPark City / Decentralized Mixed Reality / 分散型複合現実と、
「現実も、仮想も、学びのフィールドになる。」を表示する。
入口はREAL・VIRTUAL・QUEST・MY CITY。

| Spot | 種類 / 状態 | 体験例 | Guild | checkInType |
|---|---|---|---|---|
| BOOK SPOT / `demo-book` | REAL / DEMO | 知らない分野の本を1冊開こう | learn | demo |
| CAFE SPOT / `demo-cafe` | REAL / DEMO | 30分、自分の問いを探究しよう | connect | demo |
| SchoolPark Lab / `schoolpark-lab` | VIRTUAL / DEMO | SchoolPark Cityを探索してみよう | web3 | virtual-entry |

Spotは `spotId, name, description, type, category[], locationType, image,
questId, guildId, checkInType, status` を持つ。拡張用の `destination` と
体験のヒント `experience` も持つ。画像はnull、カテゴリーは文字列配列。
運営がレビューできる静的catalogueをサーバーに置き、一般ユーザー向け更新APIは設けない。

3件の `questId` はnull。既存の正式Questとして承認されていないDEMO例を
勝手に実在Questへ紐付けると、条件・完了・報酬の意味が変わるためである。
独自Questシステムは作らず、既存Quest一覧へ接続する。
将来、運営が正式なIDを設定したときは、既存一覧で実在を確認して詳細へ遷移できる。
Quest / Guild側にはCityから来た場合だけ「Cityへ戻る」を出す。

REALは現地訪問の証明ではなく操作のDEMO。GPSを取得しない。
VIRTUALは「このVirtual Spotに入る」という明示操作の記録。
いずれもURLを開くだけでは記録しない。

## 3. 保存先・API・セキュリティ

保存先は `sp_identities/{spid}/city_checkins/{YYYY-MM-DD}__{spotId}`。
既存のIdentity文書は変更せず、その子にCityのイベントだけを保存する。
Passport、Quest、Guild、Starのマスターや実績を複製しない。

記録は `schema: schoolpark-city-checkin-v1`, `kind: city.checkin`,
`passportId`, `actorKind: human`, `agentId: null`, `spotId`, `locationType`,
`checkInType`, `isDemo`, `verification`, `questId`, `guildId`, `day`, `occurredAt`。
REALのverificationは `demo-only`、VIRTUALは `explicit-entry`。
時刻はサーバーのepoch ms、日付はJST。クライアント時刻は受け付けない。

| API | 動作 |
|---|---|
| GET `/api/schoolpark/city/spots` | 認証・入場資格・有効Passport確認後、3件のcatalogue |
| GET `/api/schoolpark/city/me` | 同じ確認後、本人SPIDの記録を新しい順に最大50件。51件読み、続きがあるとき `hasMore` |
| POST `/api/schoolpark/city/checkins` | `spotId` と `checkInType` だけを許可。本人SPID・JST日・Spotの固定キーでtransaction create |

- 既存 `requireFirebaseUser` でトークンを検証し、accountは改めて読み直す。
- ownerフラグ、UID、Passport ID、agent、報酬、承認、任意timestamp等の入力を受け付けない。
- 同じSpot・同じPassport・同じJST日は、連携済みの別ログインから同時に押しても1件。
- 一覧上限、1分60回のAPI制限、1分10回の書込制限。rateLimitは既存のプロセス内方式。
- 応答はallowlistで投影。UID・ウォレット・KYC・権限・auth linksを返さない。
- 読取障害は503。障害を「記録0件」や権限ありとして扱わない。
- ログイン・SchoolPark IDの切替で画面内記録と共有候補を破棄し、古い非同期応答を無視。
- Quest・Guild・Emu・Passportへ遷移する前にも既存アクセス判定を確認。
- 表示文字列をHTMLエスケープし、共有は公開Spot名・DEMO表記・一般トップURLのみ。

### Firestore Rules / indexes / migration

**変更なし。migrationなし。** 既存 `sp_identities/{spid}` の許可は
子のcity_checkinsへ伝播しない。また既存の再帰catch-allは
最上位collectionが `sp_identities` のパスを除外している。
したがって子の記録はクライアント直接アクセス不可。認可済みAdmin SDK APIだけが扱う。
この性質を匿名・本人・他人・ownerのRulesエミュレータテストで確認する。
`occurredAt` 単独orderByのため、新しい複合indexは不要。

## 4. MY CITYと既存活動

- 本人のPassport ID、最近50件に含まれる訪問SpotのCollection、日時付き履歴。
- Quest実績は既存 `spCompletedQuests` の承認済み周回から表示。Founderは除外。
- 限定Starは既存 `/quest-completions/stars/mine` を参照。
- Quest Star・証明書・その他NFTは既存Passport / 星空へ接続して確認する。
- Guildは既存の定義と参加・応援コレクションを共有読み口から参照し、現在のPassport名義で判定。ログイン前のUIラベルを流用せず、新しい会員DBも作らない。
- 記録なしと読込失敗を区別。後者は更新操作を用意する。
- MyCity共有は確認画面の後にWeb Share API。非対応時はコピーに切り替える。
  公開プロフィールURLは作らず、共有にPassport IDも含めない。
- MY AGENTS / ExplorerはComing Soon。City Itemも未実装と明記。

Cityイベントは将来の星空表示へ接続できるが、v0.1では既存Star数に加算しない。
DEMO操作を実際の訪問証明や獲得実績と混同させないためである。

## 5. 性能と既存ファイル差分

初期SchoolPark起動ではCityのJS・CSS・catalogue・MyCityを取得しない。
08を開いた後だけ約32KB（非圧縮）の独立JS/CSSを読み込む。
追加のランタイム依存や3Dライブラリはない。
catalogueは画面内5分、MyCityは1分の控え。要求中の重複をまとめる。
書込成功でMyCityの控えを無効化し、書込前に始まった応答の上書きを防ぐ。
既存Questの5分キャッシュと共有読み口を再利用する。

DAO全体の再描画時もCityのDOMを保持する。既存データ更新で画面状態や
チェックイン中のボタンが消えたり、City APIが再送されるのを防ぐ。
通信には15秒のタイムアウトを置く。

既存ファイルの差分は `dao.html` が29行追加・2行置換、`server.js` が3行追加。
`index.html` は変更なし。任意のPassport内ショートカット追加は外し、08ナビからCityへ入り、Cityから既存Passportを開く構成にした。
既存巨大ファイルの全面再生成・大幅削除・整形は行わない。

## 6. 検証

| 対象 | 基準main | Cityブランチ |
|---|---|---|
| backend全テスト | 190成功 | 205成功（City新規15を含む） |
| Rules全テスト | 19成功 / 1失敗 / 4skip | 24成功 / 同じ1失敗 / 同じ4skip |
| 既存画面テスト9ファイル | 94成功 / 14失敗 | 94成功 / 同じ14失敗 |
| Cityブラウザテスト | なし | 8成功 |
| City専用Rules | なし | 5成功（Rules全体に含む） |

既存画面テストは変更なしのmainを別worktreeに展開し、同じChromium環境で
再実行して失敗名の集合が完全一致することを確認。追加失敗はない。
既存Rulesの失敗は `quest.test.cjs:63` の通常Questログ作成がRule1112で拒否されるもの。
既存画面テストの失敗は `firebase-ready.test.cjs` 9件（旧関数文字列の切り出し）、
`flow.test.cjs` 4件と `passport-loading.test.cjs` 1件（fixture不足など）。
無関係な既存実装・テストの修正は混ぜない。

ブラウザ検証はChromium 153の実レンダリングとクリック操作。
本番と同じ `dao.html` / City JS / CSS / Express routerを使い、
Firebase認証・外部親画面API・Firestoreは隔離fixtureへ接続した。
Productionログイン・外部決済・実Firestoreへの書込を自動テストしたという意味ではない。

375 / 390 / 412 / 768 / 1440pxすべてで、01〜08、HOME、REAL / VIRTUAL一覧、
詳細、チェックイン・再押下、Quest / Guild遷移とCityへ戻る、
Emu / Passport呼出しと復帰、MyCity、共有プレビュー・キャンセル、広場へ戻るを確認。
body/document幅がviewportを超えず、横移動後も本体scrollX=0を確認。
ログアウトで個人表示が消え、別アカウントに引き継がれず、再ログインで保存記録を取得する。
読込失敗・古いアカウントの遅延応答・チェックインと履歴読取の競合も確認。

再実行:

```sh
cd backend && npm ci && npm test
```

```sh
cd tools/quest-tests
npm ci
npx firebase emulators:exec --only firestore --project demo-schoolpark-city 'node --test --test-concurrency=1 *.test.cjs'
```

```sh
npm ci --prefix tools/guild-tests
cd tools/guild-tests && npx playwright install chromium
cd ../..
node --test tools/guild-tests/city.test.cjs
```

任意で `CITY_CHROMIUM_PATH` にブラウザ実行ファイル、`CITY_QA_DIR` にスクリーンショット保存先、
`CITY_FONT_ROOT` にローカルのFontsourceフォントディレクトリを指定可能。
本作業環境ではPlaywright配布zip取得に失敗したため、テスト環境だけでnpm配布のChromiumを使用した。
この代替ブラウザ・フォントをアプリ依存には追加していない。

## 7. 反映順・未検証範囲・Phase 2

PRのレビュー・マージ後、RenderのCity API反映を確認してからVercelの08 CITYを確認する。
自動デプロイの順序が前後すると一時的にAPI 404となるため、画面は読込失敗として再試行を案内する。
Rules公開・index作成・migration・環境変数追加・コントラクト操作は不要。
APIと画面の反映後に、実アカウントで入場・チェックイン・再ログイン・既存機能を最終確認する。
未マージのため、この本番保存を伴うCityの一連の検証は未実施。

Phase 2: 正式なSpot管理と提携審査、署名・短寿命nonce付きQR等の現地検証、
外部Virtual Space / WebXR、正式な関連Quest割当、Cityイベントの星空表示、
履歴ページング、公開MyCityの同意・公開範囲、City Item、AgentのPermission/Policy/承認設計。
決済・配送・自動売買・秘密鍵委任・EMUER新仕様追加はv0.1に含めない。
将来のAgentは同じPassport配下のactorとして扱い、本人の鍵をAIへ渡さない。

**総合判定: PASS WITH NOTES。** Cityの新規テストは成功。
既存main由来の失敗と、レビュー・マージ後に必要な本番確認を上記のとおり残す。
