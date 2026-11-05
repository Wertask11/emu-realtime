# SchoolPark Passport 2.0 作業報告 — 2026-11-05

> 現在のRC判定・ZKP除外・公式資料再確認は [final-release-readiness.md](final-release-readiness.md) を参照。この文書は前フェーズの記録を含みます。

> 初回フェーズの履歴です。完成フェーズの現在の実装・未解決事項・公開判定は [completion-report.md](completion-report.md) を参照してください。

**判定：開発用VC基盤を実装・検証。本番公開不可。本番への反映・push・mainマージ・Rules公開は行っていません。**

ブランチ `feat/passport-2-vc-20261105`。監査対象・実装の基点は最新main `8ac3dd3`（PR #270）。最終fetchでもorigin/mainが同じコミットであることを確認。監査結果と予定ファイルを利用者へ報告してから機能実装を開始しました。既存の未コミット変更はありませんでした。監査の詳細は [phase-0-audit.md](phase-0-audit.md)。

## 実装した範囲

| フェーズ | 実装・検証した内容 | 制限 |
|---|---|---|
| 0 | 固定SchoolPark ID/Firebase UID対応、既存ログイン・KYC・World ID・wallet・Rules・ログ・CI/デプロイを監査 | 既存の個人情報を取得して監査ログに転載することはしていません |
| 1 | VC2アカウント証明のIssuer/Verifier、版付きスキーマ/コンテキスト、Data Integrity署名、期限、署名付きまとめ失効リスト、固定信頼鍵、証明書一覧、提示先/目的/全開示内容の確認、拒否/承認/撤回履歴、失効/削除、端末鍵・紛失後の再発行方針 | 開発用。管理された本番署名鍵・運用基盤は未実装 |
| 2 | OpenID4VCI 1.0 Finalの限定発行フロー、OpenID4VP 1.0 Finalの要求/応答・所持者署名・同意・nonce/state/replay処理、独立SDKで検証 | 実ウォレット製品・外部本番検証サービスとの接続は未実施。一般向け外部提示の導線・登録運用は未完成 |
| 3 | 接続準備状態と、固定シナリオのモック（成功でも政府認証=false、VCなし） | デジタル庁の正式API/利用条件を直接確認できず、接続承認なし。政府認証の発行経路なし |
| 4 | 年齢条件/本人確認/City出店承認の属性・発行者・証明方式・追跡/失効の設計検討 | ZKP未実装。常にzkp=false。選択的開示も未対応と明示 |

新しい証明書は「SchoolParkの既存アカウントにアクセスできる」ことだけを表します。公的本人確認、運営KYC、年齢、World ID、公式パス、City出店資格、EMUERの権利とは区別しています。個人番号・氏名・生年月日・メール・LINE情報・ウォレットアドレス・SPID・UIDは証明書に含めません。

標準ライブラリ：Digital Bazaar VC / Data Integrity / ecdsa-rdfc-2019 / Multikey / Bitstring Status List、JOSE。独自暗号なし。W3C VC Data Model 2.0の限定プロファイルを署名・JSON-LD・構造・期限・状態と独立JSON Schemaで検証。正式な適合認証の取得や全オプション実装を意味しません。[規格・相互運用性](standards-and-interop.md) に具体的なプロファイルと未対応項目を記載しました。

## 個人情報・同意・データ

- 新規3コレクション `passport_v2_accounts` / `passport_v2_status` / `passport_v2_tickets` はサーバー専用。包括Rulesからも除外。未ログイン/本人/他人/運営の直接read/write/list/delete/ネスト書込みを拒否。
- 新画面にPostHog・client-errors・自動収集を読み込まず、エラーは固定コード。APIはno-store、クエリを受け付けず、秘密はURLへ載せません。解析不能JSONの本文やスタックも応答・ログへ出しません。
- 提示先は固定登録先。利用目的と証明書全体を見て承認した要求だけを受信・検証できます。拒否・期限切れ・撤回・再送・別の鍵・別の証明書は拒否。任意URLの取得/転送は行いません。
- 端末秘密鍵はWebCrypto非抽出鍵をIndexedDBへ保存。サーバーには保存しません。発行者鍵はsandboxプロセス内のみ。再起動で旧sandbox証明は無効になります。
- 同意履歴は直近50件。提示済み情報を相手から消すことはできない旨を表示。削除時は失効し、保存した証明書/鍵情報を削除。最小の失効記録は保持。物理削除の保持期間とTTL運用は本番前の未決事項です。
- 既存データ移行・削除なし。既存ID、認証、wallet、パス、課金、星空、City、EMUER、Questのロジックは変更していません。重要10モジュールは基点とバイト一致。既存server.jsへの変更は新APIのパーサー分離とmount/discovery、既存Passportには有効なsandboxでだけ見える入口を追加しました。

## テスト・証拠

| 検証 | 結果 |
|---|---|
| 変更前backend | 428/428成功 |
| 最終 `npm ci --prefix backend --ignore-scripts` / `npm test --prefix backend` | 448/448成功（新規20ケースを含む） |
| 既存Emuブラウザ/単体回帰 | 226/226成功。実行環境のChromiumを使用 |
| Firestore Rulesエミュレーター | 4ロール成功。既存catch-all経由・ネスト経由も拒否 |
| W3C VC2限定プロファイル/JSON Schema | 正常、改ざん、未承認属性/版、署名、期限、失効、信頼外鍵を検証 |
| 独立OpenWallet Foundation VCI SDK 0.9.2 | V1認識、well-known発見、コード/PIN交換、nonce、proofs.jwt、credentials応答まで成功 |
| 同VP SDK 0.9.2 + 実署名検証 | 要求/DCQL応答形式・state検査と、別途実署名/同意/失効/replay検証に成功 |
| 侵害/異常ケース | 別アカウント、偽造、所持者不一致、nonce/state/提示先変更、同時replay、撤回、PIN試行上限、端末鍵紛失、発行者鍵交代/信頼撤去、政府モックを検証 |
| 実ブラウザ（全て隔離エミュレーター） | 375/390/412/768/1280/1440/1920pxで発行・拒否・承認/検証・失効・戻る・ログイン維持を確認 |
| 新ページCSP | 375pxで実ヘッダー相当を適用し、発行から削除/戻るまで成功 |
| ビルド/構文/差分 | ブラウザ用バンドル再生成、server.js構文、git diff --check成功。静的frontendに独立typecheck/build/lintスクリプトなし |
| npm audit（runtime） | 基点と同じ23指摘：high 1 / moderate 10 / low 12。新しい指摘パッケージなし |

成果物：`/workspace/outputs/passport-v2-20261105/` の `browser-coverage.json`、`protected-files.json`、`dependency-audit-delta.json`、各テストログ、`certificates-{width}.png`。画面の証明書/IDは隔離エミュレーターで生成した検証用です。実Google/LINEアカウント、実ウォレット接続、実課金、公的本人確認、本番アカウントの操作は未実施です。

途中の試験で見つけて修正したもの：ブラウザ用ライブラリ解決、ESM/import.meta、Firestoreの二重配列制限（DCQLは応答時に構築）、完了済み同意が有効枠を消費する不具合、複数の発行者公開鍵を読み込む際の旧鍵保持。短時間の繰返し試験は意図したrate limitにも到達したため、幅ごとの分割実行と再現用スクリプトの待機を使いました。失敗ログを消して成功に見せることはしていません。

## 未対応・法務/運用確認・公開判定

| 優先度 | 残課題 / 対応条件 |
|---|---|
| 公開前必須 | 本番KMS/HSM署名アダプター、鍵の保護/ローテーション/事故・紛失対応、信頼公開鍵の配布/更新の運用 |
| 公開前必須 | 新Rulesのレビュー・公開、TTL/保持期間/削除運用、負荷・容量検証。今回これらの本番変更なし |
| 公開前必須 | 外部提示を行うなら実ウォレット製品/検証サービスとの互換性・同意導線・固定登録/信頼/保持契約・TLSを確認。SDK試験だけでは認定しません |
| 公的認証の前提 | デジタル庁の正しい正式仕様・現行利用条件・利用/接続承認・認証結果の検証。My Numberを取得しない構成を維持。法務確認は未了 |
| 別途要確認 | 元から存在するwsのhigh指摘（GHSA-58qx-3vcg-4xpx / GHSA-96hv-2xvq-fx4p）。依存としての指摘であり、この監査では本番の攻撃到達性は確定していません。既存wallet等を無断更新してはいません |
| 別途要確認 | 既存server.jsのwallet/transactionに関するログ、旧KYCの自由記述メモ。新VCへコピーせず、既存記録の削除もしていません。全システムの既存ログが個人情報を含まないという認定はできません |
| 将来実装 | ZKP/選択的開示。方式選定・独立監査・追跡防止/失効設計が必要。既存の自己申告やモックから認証済み証明は発行しません |

詳細：[構成](architecture.md) / [鍵・復旧・削除](operations-key-recovery.md) / [政府認証・ZKP](government-and-zkp.md) / [試験の再現](../../tools/passport-v2-tests/README.md)。本番では強制的にdisabledになる開発実装であり、「Passport 2.0を本番公開済み」「政府認証対応済み」「ZKP対応済み」とは案内できません。

## 変更ファイル

- `backend/package-lock.json`
- `backend/package.json`
- `backend/passport-v2/crypto.mjs`
- `backend/passport-v2/crypto.test.mjs`
- `backend/passport-v2/fixture-support.mjs`
- `backend/passport-v2/government.mjs`
- `backend/passport-v2/router.cjs`
- `backend/passport-v2/router.test.mjs`
- `backend/passport-v2/security.test.mjs`
- `backend/passport-v2/service.mjs`
- `backend/passport-v2/storage.cjs`
- `backend/server.js`
- `docs/passport-v2/architecture.md`
- `docs/passport-v2/government-and-zkp.md`
- `docs/passport-v2/operations-key-recovery.md`
- `docs/passport-v2/phase-0-audit.md`
- `docs/passport-v2/report.md`
- `docs/passport-v2/spec-source-hashes.json`
- `docs/passport-v2/standards-and-interop.md`
- `firestore.rules`
- `frontend/public/index.html`
- `frontend/public/passport-v2/contexts/account-v1.jsonld`
- `frontend/public/passport-v2/index.html`
- `frontend/public/passport-v2/schemas/account-v1.json`
- `frontend/public/passport-v2/style.css`
- `frontend/public/passport-v2/wallet.js`
- `frontend/public/passport-v2/wallet.js.LEGAL.txt`
- `frontend/vercel.json`
- `tools/passport-v2-tests/README.md`
- `tools/passport-v2-tests/browser.py`
- `tools/passport-v2-tests/build-wallet.cjs`
- `tools/passport-v2-tests/fixture.cjs`
- `tools/passport-v2-tests/rules.test.cjs`
- `tools/passport-v2-tests/use-system-chromium.cjs`
- `tools/passport-v2-tests/wallet-entry.mjs`
