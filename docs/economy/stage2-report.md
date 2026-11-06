# EMUER経済圏MVP 第2工程 完了報告

日付：2026-11-06。サービス：Emu for SchoolPark。ブランチ：`feat/emuer-economy-mvp-stage2-20261106`。

**実装・分離環境での検証を完了。本番受付はOFF。本番へデプロイ、mainへのマージ、Rules公開、本番データ変更、資産移転はしていない。** ウォレット払い・外部実交換まで完成したという判定ではない。

監査基準は指定の`2942e1b`。作業中にmainへ追加されたPR #275・#276（クエスト遷移と教材削除）は、専用ブランチに`0bc6b3d`まで取り込んだ。既存Passport 2.0作業ブランチは変更していない。

検証対象のコードcommit：`7f3f26ede5ac8b2f2c52243b3ee8c9589b58acdf`。報告書・証跡はその後の資料commitに収録する。コードはローカルの専用ブランチに保存。リモートへのpush、PR作成、Production公開は今回行っていない。

## A. 実装した機能

- 共通の「EMUER・サービス」画面。プロフィール・ウォレット・Lab・Text・Guild・Quest・Cityから同じ入口。旧Emu/SchoolPark切替を復活させていない。
- 本人認証と既存SchoolPark IDによる残高・提供条件・依頼・履歴の取得。ウォレット、未受取記録、利用可能額、受取署名拘束額、処理中の支払済み額を分離。
- SchoolPark Explorer：公開知識/Lab/Text/Guild/Quest/City公式商品を横断。ID・公開資料の根拠・既存画面へのリンク。購入・送金・契約・第三者への連絡はしない。
- Founder承認済み5 EMUER。サーバー商品設定と承認値・条件版を照合し、支払い直前の変更も拒否。料金確認→支払い同意とAI送信同意→台帳決済→永続ジョブという順序。
- 同一SchoolPark IDの本人3件/日・全体20件/日・同時2件。JST暦日。Cityの商品交換枠とは別。認証UID切替でも本人枠を引き継ぐ。
- 既存Mitemiruの台帳引落・おつり・返却・引渡しを再利用。台帳とqueued登録を単一トランザクションで確定。再送・再起動・失敗・返却待ち・結果保存後の復旧に対応。
- 新用途の許諾と個人情報確認を資料内容ハッシュで固定。公開撤回・編集・資格失効を表示時にも確認。古い索引から非公開コレクションへフォールバックすることも禁止。
- 依頼目的・結果の30日後の除去、取引・同意・状態遷移の監査記録保持。
- EMUER外部接続の能力判定とmock、将来の読み取り見積もりJSON Schema。移転制限で見積もり前に停止。
- 共通依存wsを同じ8系の8.21.3へ固定。ethers WebSocket RPCのローカル接続互換性を確認。

## B. 変更ファイル一覧

以下は取り込んだmainとの差分。main既存の教材削除などの変更を今回の新規実装として数えていない。

- `backend/economy/agent.js`
- `backend/economy/config.js`
- `backend/economy/economy.test.js`
- `backend/economy/external.js`
- `backend/economy/fixture.js`
- `backend/economy/quote.schema.json`
- `backend/economy/router.js`
- `backend/economy/service.js`
- `backend/economy/sources.js`
- `backend/economy/ws-compat.test.js`
- `backend/knowledge-lab/service.js`
- `backend/mitemiru.js`
- `backend/package-lock.json`
- `backend/package.json`
- `backend/server.js`
- `docs/economy/evidence/browser.json`
- `docs/economy/evidence/desktop-1280.png`
- `docs/economy/evidence/desktop-approval-1280.png`
- `docs/economy/evidence/emuer-stage2-audit-final.json`
- `docs/economy/evidence/emuer-stage2-syntax.json`
- `docs/economy/evidence/live-provider.json`
- `docs/economy/evidence/mobile-390.png`
- `docs/economy/evidence/mobile-result-390.png`
- `docs/economy/evidence/refund-pending-390.png`
- `docs/economy/evidence/tests.json`
- `docs/economy/operations.md`
- `docs/economy/service-product.example.json`
- `docs/economy/stage2-report.md`
- `frontend/public/admin/room1/index.html`
- `frontend/public/economy/app.js`
- `frontend/public/economy/entry.js`
- `frontend/public/economy/index.html`
- `frontend/public/economy/style.css`
- `frontend/public/index.html`
- `frontend/public/knowledge-lab.html`
- `frontend/public/privacy.html`
- `frontend/public/schoolpark/dao.html`
- `frontend/vercel.json`
- `tools/economy-tests/browser.py`
- `tools/economy-tests/firebase.json`
- `tools/economy-tests/fixture.cjs`
- `tools/economy-tests/integration.test.cjs`
- `tools/economy-tests/live-provider.cjs`
- `tools/economy-tests/package-lock.json`
- `tools/economy-tests/package.json`
- `tools/economy-tests/rules.test.cjs`

`backend/knowledge-lab/service.js`はrawPostに内部用のpublicOnly引数を加えただけで、既存呼出しの既定動作は保持。`backend/mitemiru.js`は内部サービス呼出しと台帳決済の追加ガード、読取残高取得を追加。新しい共通台帳は作っていない。

## C. API・データ構造

[運用資料](operations.md)に全経路、各collection、状態遷移、設定値を記載。

- API：`/api/economy/me`、`/quotes`、`/jobs`、`/jobs/:id`、`/external`、`/external/simulate`。すべて既存Firebase認証＋サーバー解決のSchoolPark IDを必要とする。
- 新しい制御文書は`emuer_v2_agent_*`。既存Rulesの直接クライアント拒否を継承。本番Rulesは変更していない。
- 決済・返却は既存`mitemiru_orders`と`emuer_v2_rewards`。商品交換usageは消費しない。
- 正常に探索完了した場合は空結果でも5 EMUER、処理失敗は全額返却。この条件は決済前に表示する。失敗した受付も当日の利用枠に残す。

## D. EMUER決済・返却の検証結果

| ケース | 結果 |
|---|---|
| 5 EMUER台帳支払い・queued登録 | 同一トランザクションで確定 |
| 同じ依頼の並行再送 | 注文・請求は1回 |
| 同じキーで異なるquote・同じquoteの別キー再利用 | 拒否 |
| 同意なし・資格なし・残高不足 | 実行・請求なし |
| RPC不通・未確定決済 | 決済待ち。期限後は課金しない |
| AI失敗・無効な出典 | 元台帳へ全額返却 |
| 返却障害 | 返却待ちを保持。復旧後、既存注文を照合して1回だけ返却 |
| worker中断・古い応答 | 再生成せず返却。古い応答は不採用 |
| 結果保存後の再起動 | AIを再実行せず引渡し処理だけ再開 |
| ログインUID切替 | 同じSchoolPark IDの利用枠を継承 |
| 別人の履歴・City購入APIからの迂回 | 拒否 |
| 既存City交換 | 既存回帰テスト合格。既存商品・交換条件・報酬計算を変更せず |

この表の支払い・返却は**分離Firestoreエミュレーター上の台帳処理**。本番のEMUER・ウォレット・Polygonは動かしていない。実オンチェーン返却の送信は未実装・未検証であり、この支払い経路は固定OFF。既存の「返却確認API」を返却送信機能として扱っていない。

## E. AIエージェントの実行結果

1. **実Firestore/Authエミュレーター＋provider mock**：公開知識、Lab、Text、Quest、公式商品を取得し、別の目的では既存公式Guildも取得。実在する各collectionと既存索引・権限判定を通した。資料はLOCALと明示した検証データ。人物情報・参加者名簿を含めず、非公開・編集済み・許諾失効した資料を不採用。
2. **実Gemini API**：`gemini-3.5-flash-lite`へ公開Guild説明だけを1回送信しHTTP 200。「学んだ知識を実際に試したい」という目的に、実在する`guild:learn`を返した。名称と根拠はリポジトリの公開定義と一致。[証跡](evidence/live-provider.json)。本番Firebaseや顧客データ、資産は使っていない。
3. 生成AIは許可済みの資料keyしか選べない。架空ID、勝手なURL、自由生成の追加主張を拒否し、名称・理由・根拠・遷移先をサーバーで復元する。候補がない場合は架空の情報を補わない。

## F. 外部交換mockの結果

`chainId:137, token:EMUER, amount:5`に対し、`mode:mock / outcome:blocked / reason:TRANSFER_RESTRICTED / quote:null / executable:false`。

模擬確認は入力→能力判定→移転制限での停止まで。交換成功の偽装、架空レート・市場価格、DEX承認、実送金、流動性提供、換金は行わない。自由移転・approveを許さない現EMUER v2と、一般的なDEX/Permit2/x402方式の非互換を維持する。

## G. テスト結果と未解決事項

| 検証 | 合格 | 失敗/skip |
|---|---:|---:|
| backend全体（新規22件＋ws互換1件を含む） | 460 | 0 / 0 |
| 実Firestore/Auth＋Rules拒否・復旧 | 12 | 0 / 0 |
| 既存Emu（analytics以外） | 220 | 0 / 0 |
| 既存Guild/City・統合ナビ・analytics | 49 | 0 / 0 |
| 既存Knowledge Lab・AI権限・出典 | 22 | 0 / 0 |
| 合計（自動テスト） | **763** | **0 / 0** |
| 変更HTML内の実行script構文確認 | 24 | 0 |
| Chromium画面幅 | 375/390/412/768/1280/1440/1920px | 横はみ出し・JS例外・console errorなし |
| 実Gemini API | 1回・HTTP 200 | 0 |

[件数証跡](evidence/tests.json)、[画面幅証跡](evidence/browser.json)、[構文確認](evidence/emuer-stage2-syntax.json)。新設のtest用依存もlockしてクリーンインストールした。静的フロントに一律のbuild/lintスクリプトはないため、実ブラウザ・既存テスト・JS構文確認で検証した。変更していないCityのビルド成果物を再生成していない。

スクリーンショット（すべて専用demoの残高・資料で、本番画面ではない）：

- [スマホ390px](evidence/mobile-390.png)
- [スマホの結果](evidence/mobile-result-390.png)
- [PC1280px](evidence/desktop-1280.png)
- [料金承認](evidence/desktop-approval-1280.png)
- [返却待ちの表示](evidence/refund-pending-390.png) — この1枚だけは表示確認用HTTP応答fixture。実返却の証拠は別のnativeテスト。

テストで検出して修正したもの：公開撤回時に履歴全体がエラーになる問題、共通入口再挿入によるクエスト再描画時のスクロール移動、workerがない状態での受付、古い索引からprivate領域へアクセスする可能性、支払い直前の価格変更、wsのhigh指摘。

初回の作業ディレクトリ・Chromium実行パス・Authエミュレーターaudience設定の不一致、および依存再インストール中の試験は、環境を正して再実行した。失敗テストをskipしたりセキュリティ条件を下げたりして合格にしていない。最終件数は完了した再実行分。

依存監査：**critical 0 / high 0 / moderate 8 / low 14**。ws 8.18.0のメモリ開示・DoS指摘を修正版8.21.3で解消し、clean installとethersのWebSocket RPC互換試験を通した。残る既存依存のmoderate/lowはゼロではなく、影響評価と別途更新検討が残る。[監査JSON](evidence/emuer-stage2-audit-final.json)。

未実施：本番Firebase書込み、本番有料依頼、実ウォレットからのPolygon支払・返却、実LINE/Googleでの再ログイン、本物のAndroid/iPhone実機試験、商用運用の外部法務確認。UID切替の枠継承はユニット、既存ログイン機能は既存回帰と実Firebase Authエミュレーターで検証した。

## H. 第3工程で必要な設定・承認

手順と設定場所は[operations.md](operations.md)。料金5と20/3/2の再承認は不要。

1. Geminiの18歳未満制限とサービス全体の利用対象、送信データ取扱い・規約の整合を確認する。確認前は新サービスの受付OFF。
2. 利用対象プランと確認済み対象者だけをサーバー管理の資格文書に登録する。自己申告・テスト資格を確認済みと扱わない。
3. 新AI用途の資料許諾と個人情報確認、現行データのハッシュ承認を行う。
4. 既存Lab/冷蔵庫くんを含む提供者の実予算・利用枠・料金と配分を確認する。Explorerの予算予約だけでプロジェクト全体の請求上限を保証しない。
5. 商品設定・必要なenv・worker・監視・停止/復旧手順を整備。未確認フラグを一括でtrueにして済ませない。
6. 第3工程の指示後にPR/Preview/通常デプロイと本番受入を行う。現時点で公開されたURLはない。今回の経済基盤はProductionへ反映していない。
7. ウォレット払いを加える場合はREFUND_ROLE、実際の返却送信・署名手段・ガス・確認数・照合を別途実装/実検証する。設定だけでこの経路をONにはできない。
8. 外部実交換は今回・第3工程のMVPでも対象外。現コントラクトの移転制限は解除しない。

## I. Production公開可否

**現時点では公開不可。** コードと分離検証は完了したが、提供条件・資格・資料の許諾・実予算・運用受入は本番で未確認。初期状態で有料受付OFFを維持している。

第3工程では、条件が成立した範囲の**未受取EMUER払いのみ**を公開候補にできる。ウォレット払い・外部実交換を完成済み/利用可能と宣伝しない。既存ログイン、Passport、公式パス、星空、EMUER付与、City公式ショップ、既存無料AIの動作・条件・記録は維持。入口と内部用の公開資料限定ガードは追加した。契約・Rules・コントラクトは変更していない。

第2工程の報告で停止し、第3工程の指示を待つ。
