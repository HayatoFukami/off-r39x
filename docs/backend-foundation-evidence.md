# バックエンド基盤の検証記録

作業ブランチ: `feat/backend-foundation`。起点: 最新取得時の `origin/dev` (`5fb7b15`)。正式仕様と `apps/web/` は変更していない。push・デプロイは実施していない。

検証日: 2026-10-27。共通基盤・DB・API・Provider/Worker・CI/Traceability を別コミットに分割し、最終手順と証拠を文書コミットへまとめた。

## Changed scope:

API / DB / Security / Email Adapter / Reliability / Observability / Infrastructure の基盤。個別業務処理は含まない。Neon Auth 中継・共有 Rate Limit の未確定部分を独自実装せず、未設定の runtime を Ready にしない。

## Canonical rules referenced:

`DEV-REP-*`, `DEV-DEP-*`, `DEV-API-*`, `DEV-AUTH-*`, `DEV-DB-*`, `DEV-REL-*`, `DEV-TRC-*`、`SEC-AUTH-*`, `SEC-AZ-*`, `SEC-API-*`、`AR-ROLE-012`、`DB-ARC-007/008`、`REL-DB-001/002/006/007`、`REL-TMO-003`、`OBS-LOG-*`, `OBS-COR-005`、`INF-DB-*`, `INF-HLT-*`, `INF-RWY-005`, `INF-WRK-003`, `INF-DEP-001`。具体的な Rule / TC / source の対応は `traceability/rule-code-map.json` に記録。

## Files changed:

- `apps/api/`: Hono middleware、共通 error、内部 health、runtime 配線・停止。
- `packages/auth/`, `packages/api-contract/`: JWT 検証、現在の Principal / Role / Capability、Zod / RPC 型。
- `packages/db/`: Drizzle schema、pg、限定 Directory、Migration、Transaction・readiness。
- `packages/{config,security,reliability,observability}/`: 起動設定、鍵・相関、deadline / retry registry、構造化 log。
- `packages/application/`, `packages/providers/`, `apps/*-worker/`: SDK 型から独立した port、Adapter、scheduler・停止基盤。
- `scripts/`, `infra/`, `.github/workflows/backend-foundation.yml`: import / trace / migration / secret gate、共通 bundle・OCI recipe・CI。
- `tests/`, `traceability/`, `README.md`, `AGENTS.md`: 検証・対応表・実行手順。

## Migrations:

`packages/db/migrations/0001_foundation.sql`。`pgcrypto` / `btree_gist`、`app.business_profiles` / `app.role_assignments` と named constraint を追加する初期 Migration。専用 identity と advisory lock を使用し、起動時の自動実行はしない。Migration journal は基盤 metadata。Provider 所有 table を変更しない。

実 Neon の Directory source mapping / version / grant は別途実環境で確認が必要。テスト内の合成 Provider table を Neon の物理契約と扱わない。

## Tests added/changed:

- `TC-COMMON-001〜012`: 設定、Secret reader、keyring、相関、logger、deadline。
- `TC-DB-FOUNDATION-001〜010`: 実 PG17 の Migration / 制約 / 権限 / TLS / retry / COMMIT 応答喪失 / deadline。
- `TC-DB-ARC-008-050`: 実 DB の bigint / 公開 UUID と署名済み JWT → Principal → API、Role 失効。
- `TC-SEC-AUTH-001-050`, `TC-SEC-AUTH-005-051`, `TC-DEV-AUTH-008-050`, `TC-AR-ROLE-012-050`, `TC-SEC-AZ-013-050`: JWT 否定・JWKS 障害と401の分離、現在の認可状態。
- `TC-FOUNDATION-RUNTIME-001〜022`: Provider double、unknown 結果、署名・livemode、Worker 非重複・失敗隔離・実 socket / 子 process 停止。
- `TC-DEV-API-003-050`, `TC-SEC-ABU-001-050` と tooling case: 共通 transport、未接続 enforcement の fail closed、静的 gate。

## Test groups executed:

以下はローカルで終了コード0。retry / skip による失敗の隠蔽なし。

| 検証 | 結果 |
|---|---|
| `pnpm install --frozen-lockfile` | 成功 |
| `pnpm lint` | エラー0、既存警告2件（template placeholder のテスト文字列） |
| `pnpm typecheck` | Web を含む全 workspace 成功 |
| `pnpm check:boundaries` | 成功 |
| `pnpm validate:traceability` | 641 cases / 203 rule entries、成功 |
| `pnpm validate:migrations` | 成功。SQL parser / 実 DB 検証の代替ではない |
| `tests/vitest.config.mts` の全 Unit / Security | 105 files / **2,301 tests 成功** |
| backend の API / DB / Integration（Unit / Security の重複を除く） | 5 files / **17 tests 成功** |
| `pnpm build:backend` | 3つの実行可能 bundle を生成 |
| `pnpm secret-scan --build-dir dist --require-build` | 499 files、検出0 |
| bundle の実 process smoke | 各 process の埋込 hash、live 200、未配置条件で ready 503、SIGTERM 正常終了0 |
| `git diff --check` | 成功 |

基盤専用テストは63件、既存テストを含む実行合計は **2,318件**。旧 UI mock の成功を実 API / Provider の証明には使用していない。

実 DB は隔離した PostgreSQL **17.11**、UTC、port 5432、合成 CA を使用。正常 CA と hostname 不一致拒否を production 接続 factory で確認した。COMMIT の検証では、実 server の `CommandComplete(COMMIT)` を test proxy が受け取った後に応答を破棄し、1回だけの確定・`commit_unknown`・接続破棄を確認した。

Worker の非協調 handler / pending health 接続は両 process とも約17.1秒で終了1、協調終了は終了0。後続 item / job の実行・偽の drain 成功はなかった。

## Security/reliability implications:

JWT の署名・issuer / audience / Ed25519 / 最大900秒と現在の DB Role を検証し、Client claim を権威にしない。Administrator は Staff を暗黙継承しない。JWKS の通信・解析障害は503、credential 不正は401。外部呼出しと DB Transaction を分離し、COMMIT / Provider の unknown を自動 replay しない。retry は明示された SQLSTATE のみ、2秒 / 3秒の総 budget を次 attempt の実行期限にも適用する。

## Traceability changes:

元の584 cases を保持して57 cases を追加。nested Provider source も import / source mapping 検査対象に追加した。対応表は実装 index であり、未実装機能の受入・全 Canonical Rule coverage を意味しない。

## Known non-implemented UCRs:

- `UCR-130-005`: deferred operational index。追加していない。
- `UCR-BACKEND-001`: SPEC-150 の lock timeout retry の矛盾を [基盤ガイド](backend-foundation.md) に報告。正式仕様は未変更。`55P03` の自動 retry 要件を満たしたとは報告しない。
- 既に Canonical 化された購入・受付・管理・復旧 operation family は今回の非対象であり、実装済みと扱わない。

## Verification exceptions:

- **未実装の業務機能:** 購入、予約、Checkout / 決済確定、返金、QR / Check-in、通知生成・永続化・claim / lease、個別 reconciliation / recovery、Role 変更、監査対象の業務 mutation。公開 RPC の業務 surface と Worker handler registry は空。
- **公開ブロッカー:** 実 Neon Auth の Directory / issuer / audience / JWKS、4認証方式、Auth 中継の Cookie / CSRF / redirect / Safari / 同一Subject連携、共有 multi-instance Rate Limit の選定・配線、非本番 Stripe / Resend smoke。独自の汎用 proxy・DB table・検索 API を発明して埋めていない。
- **未実行:** Docker image build（Docker daemon 不在）、リモート GitHub Actions、Railway / Neon deployment、staging / 全システム G1〜G10。ローカル成功だけで Production promotion を許可しない。
- **Web 検証の境界:** `apps/web/` を変更せず、Web build / Browser E2E は実行していない。バックエンド用 build を実行した。旧テストの「root build は Web のみ」「manifest は全件 mock」という2つの前提は初回 gate で失敗したため、mock の安全条件を保ったまま基盤追加に対応する検査へ更新し、修正後に全 Unit / Security を clean run した。
- 初回 typecheck は異なる Hono / Zod 版を跨ぐ test 型解決で heap 上限に到達した。backend の依存版を統一し、heap 上限緩和なしで全 workspace typecheck を成功させた。
- build 後の再 lint で生成 `dist/` まで検査される問題を検出したため、他の生成出力と同様に Biome 対象外とし回帰検査を追加した。`dist/` の Secret scan は引き続き必須。

**結論:** 基盤コードとローカルの接続・異常系検証を整備した。ただし、上記の未確定契約・実 Provider / deployment 検証が残るため、システム全体の完了・本番利用可能とは判定していない。
