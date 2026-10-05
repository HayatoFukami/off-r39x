# S9 契約書（validate-traceability / secret-scan / mock ビルドscript / E2E 21）

テスト担当が定義した最終 slice の実装契約。コーディング担当は `scripts/**`（と `traceability/rule-code-map.json`）だけを変更する。ルート `package.json` はオーケストレーターが §1 のとおりに編集する。対応テスト:

- Vitest: `tests/unit/scripts/{validate-traceability,secret-scan,root-scripts}.test.ts`、`tests/unit/traceability/page-acceptance-matrix.test.ts`
- Playwright（mock mode、desktop / mobile の両 project）: `tests/e2e/journeys.spec.ts`
- ハーネス: `tests/harness/script-fixtures.ts`（tmpdir の一時ツリーと子プロセス実行。秘密らしい値は実行時に断片から組み立てる）

根拠: `docs/drafts/ui-mock-design.md`（S9 行、§12 コマンド）、SPEC-190 §34 / §37 / DEV-TRC-001〜003 / DEV-SEC-004 / DEV-WEB-011 / DEV-WEB-013 / DEV-REP-001、SPEC-170 §76 / TST-TRC-001・002・004 / TST-E2E-003・004 / TST-DAT-002・003・010、SPEC-050 §31、SPEC-140 SEC-QR-012・013。UI mock suite は補助 suite（G8 ではない）。manifest は `critical:false`、`api_operation_ids` / `db_constraint_names` は空。

## 1. ルート package.json に追加する script（オーケストレーター）

```json
"validate:traceability": "node scripts/validate-traceability.mts",
"secret-scan": "node scripts/secret-scan.mts",
"build:mock": "node scripts/mock-web.mts build",
"start:mock": "node scripts/mock-web.mts start"
```

既存の `build`（`pnpm --filter @off-r39x/web build`）、`dev`、`start` は変更しない。どの script にも `NEXT_PUBLIC_UI_MOCK=1 cmd` 形式（POSIX 限定）や `cross-env` を使わない。フラグは `mock-web.mts` だけが子プロセスの env に設定する（Windows / POSIX 共通）。フラグ無しの `pnpm build` は成功してよいが、実行時は `createApiPort` が fail closed する（既存。`tests/unit/web/ports/factories.test.ts`）。

## 2. `scripts/validate-traceability.mts`

`node scripts/validate-traceability.mts [--root <dir>]`。`--root` の既定はスクリプトの親ディレクトリ（リポジトリルート）。cwd に依存しない。読み取り専用（ファイルを変更しない）。

終了コード: 0 = 違反なし、1 = 違反あり、2 = 引数誤り（未知のオプション、`--root` の値欠落、root が存在しない）。2 のときは stderr か stdout に `USAGE` か `ERROR` を含む行を出し、`VIOLATION` 行は出さない。

出力（stdout）:

- 違反ごとに 1 行 `VIOLATION <check-id> <subject>[ <detail>]`。`<subject>` は空白を含まない（Test Case ID、Rule ID、または root からの `/` 区切り相対パス。`skipped-test` と `case-field-missing` 以外は下表）。全違反を 1 回の実行で出し、順序は決定的（check 実行順 → subject 昇順。同じ入力は同じ出力）。
- 違反ありの最終行 `FAIL validate-traceability violations=<n>`（n は VIOLATION 行数）。
- 違反なしの最終行 `OK validate-traceability cases=<manifestのcase数> rules=<mapのentry数>`。
- JSON 本文、テストソース、環境変数の値を出力しない。

check 一覧（`<subject>` / 条件）:

| check-id | subject | 違反条件 |
|---|---|---|
| `manifest-json` | `tests/traceability/test-manifest.json` | 存在しない、JSON として不正、トップレベルが object でない |
| `manifest-version` | 同上 | `manifest_version !== 1`、または `test_cases` が配列でない |
| `case-field-missing` | Test Case ID | SPEC-170 §9 の 19 項目（`test_case_id` + 18 項目）のどれかが欠落。detail に欠落 field 名 |
| `case-id-format` | Test Case ID | `^TC-[A-Z0-9]+(-[A-Z0-9]+)*-\d{3}$` に合わない |
| `case-id-duplicate` | Test Case ID | 同じ ID が 2 件以上 |
| `case-no-upstream` | Test Case ID | `upstream_rule_ids` が空（TST-TRC-001） |
| `ui-mock-case` | Test Case ID | `suite === "e2e-ui-mock"` で `critical !== false`、`api_operation_ids` / `db_constraint_names` が空でない（TST-E2E-004） |
| `critical-case-incomplete` | Test Case ID | `critical: true` で `system_invariant_ids` が空かつ upstream に `INV-` / `SEC-` / `REL-` / `OBS-` / `AUD-` で始まる ID が無い（TST-TRC-002） |
| `id-not-in-tests` | Test Case ID | manifest の ID が、`tests/` 配下の `*.test.ts` / `*.spec.ts` の**テストタイトル**に無い（コメントのみの出現は不可） |
| `test-not-in-manifest` | Test Case ID | テストタイトルにある ID が manifest に無い |
| `skipped-test` | `<相対パス>:<行>` | 行頭（空白を除く）が `it.skip(` / `test.skip(` / `describe.skip(` / `test.describe.skip(` / `.fixme(` / `.only(` / `.todo(` / `xit(` / `xdescribe(` の呼び出し |
| `unknown-upstream-id` | Test Case ID（detail に ID） | `docs/specs/` が存在するとき、upstream ID がどの仕様書本文にも現れない。`SPEC-NNN-<anchor>` 形式は `docs/specs/NNN-*.md` の存在だけを確認する。`docs/specs/` が無ければ検査しない |
| `deferred-ucr` | Test Case ID | upstream に `UCR-130-005`（DEV-TRC-002 / SPEC-170 §76） |
| `map-json` | `traceability/rule-code-map.json` | 存在しない / JSON 不正 |
| `map-schema` | 同上 | `schema_version !== 1`、`entries` が配列でない、entry の `rule_id`（非空文字列）/ `code_paths`（非空の文字列配列）/ `test_case_ids`（配列）/ `notes`（文字列）が不正 |
| `map-rule-duplicate` | Rule ID | 同じ `rule_id` が複数 entry |
| `map-path-missing` | Rule ID（detail にパス） | `code_paths` のパスが root 配下に存在しない（ファイルでもディレクトリでもよい） |
| `map-path-invalid` | Rule ID（detail にパス） | 絶対パス、`\` を含む、`..` セグメントを含む |
| `map-test-unknown` | Rule ID（detail に ID） | `test_case_ids` が manifest に無い |
| `map-rule-untested` | Rule ID | その `rule_id` を `upstream_rule_ids` に持つ manifest case が 1 件も無い |
| `map-deferred-ucr` | Rule ID | `rule_id` が `UCR-130-005` |
| `source-unmapped` | 相対パス | 下記の対象 source が、どの `code_paths` にも覆われない（DEV-TRC-003） |

走査の規則:

- テストタイトルの検出: 行頭（空白を除く）が `test(` / `it(` / `describe(` / `test.describe(` / `test.describe.serial(` で始まる行。その行が `(` で終わる場合は次の行も含める。その範囲から `\bTC-[A-Z0-9]+(?:-[A-Z0-9]+)*-\d{3}\b` を抽出する。より厳密な parser でもよいが、`tests/unit/scripts/validate-traceability.test.ts` の fixture と実リポジトリ（505 + 本 slice の追加 case）で同じ結果になること。`node_modules` と `test-results` は走査しない。
- `source-unmapped` の対象: `apps/*/app/**`、`apps/*/src/**`、`packages/*/src/**`、`scripts/**` の `.ts` / `.tsx` / `.mts`（`*.d.ts`、`node_modules`、`.next` は除く）。`apps/web/next.config.ts` と `tests/**` は対象外。被覆は完全一致または**ディレクトリ境界の**前方一致（`apps/web/src` は `apps/web/src/x.ts` を覆うが `apps/web/src-extra` や `apps/web/src/su` 前方一致の `sub/` は覆わない。末尾の `/` は許容）。
- `rule-code-map.json` の完成: 現在の実リポジトリで未被覆なのは `apps/web/src/presentation/components/hydration-marker.tsx`（S3）と、本 slice で新設する `scripts/validate-traceability.mts` / `scripts/secret-scan.mts` / `scripts/mock-web.mts`。コーディング担当は、これらを適切な Rule ID（例: DEV-TRC-001 / DEV-TRC-003、DEV-SEC-004、DEV-WEB-011、hydration-marker は SPEC-050 §25 / TST-FLK-001 系のうち既存 case の upstream に含まれる ID）の entry へ追加し、`test_case_ids` は §6 の ID を使う。`map-rule-untested` を満たすため、entry の `rule_id` は紐づく case の upstream に含まれている必要がある（例: `DEV-TRC-001` → `TC-DEV-TRC-001-001`、`DEV-SEC-004` → `TC-DEV-SEC-004-001`、`DEV-WEB-011` → `TC-DEV-WEB-011-201`）。
- 実リポジトリは現時点で、manifest の upstream ID がすべて仕様書本文に literal で存在し、map の全 path が存在し、全 `rule_id` に一致する case がある（検証済み）。違反が出る場合は、`source-unmapped` の上記 1 件だけが想定される。

## 3. `scripts/secret-scan.mts`

`node scripts/secret-scan.mts [--root <dir>] [--build-dir <path>] [--require-build]`。`--root` の既定はリポジトリルート。`--build-dir` は root からの相対（既定 `apps/web/.next`）。

終了コード: 0 = finding なし、1 = finding あり、または `--require-build` で build 出力が無い、2 = 引数誤り（未知のオプション、値の欠落、root が存在しない。`USAGE` / `ERROR` の行を出す）。

出力（stdout）: finding ごとに `FINDING <rule-id> <root相対パス（/区切り）>:<行>`。同一 rule・同一行は 1 件。順序はパス昇順 → 行昇順 → rule-id 昇順で決定的。最終行は `FAIL secret-scan findings=<n>` または `OK secret-scan files=<走査したファイル数>`。**一致した値・その行の本文・値の先頭断片を stdout / stderr のどこにも出さない**（redaction）。build 出力が無い場合、`--require-build` なしでは `SKIP build-output <パス> not found` を出して続行し、ありでは `ERROR build-output-missing <パス>` を出して終了コード 1。

走査対象:

- ソース領域: `root` 直下のファイル（dotfile 含む。`.env*` も内容を走査する）、`apps/**`、`packages/**`、`scripts/**`、`tests/**`、`traceability/**`。`apps/web/public/**` を含む。
- 除外ディレクトリ（名前一致、どの階層でも）: `node_modules`、`.git`、`.next`（build 出力は別扱い）、`test-results`、`playwright-report`、`blob-report`、`generated`、`coverage`、`dist`、`out`（ただし `--build-dir` で指定したものは build 出力として走査する）、および root 直下の `docs`、`reviews`、`ref`。`pnpm-lock.yaml` と NUL を含むバイナリ、5 MiB 超のファイルは走査しない。
- build 出力（`<build-dir>/static/**` と `<build-dir>/server/app/**` のみ。`cache` などは走査しない）。ここには PII 系 rule（`real-email` / `phone-number` / `card-number`）を適用しない（vendor chunk の誤検出回避）。

rule（rule-id: 検出）:

| rule-id | 対象 | 検出 |
|---|---|---|
| `stripe-key` | 全領域 | `\b(?:sk\|rk)_(?:live\|test)_[0-9A-Za-z]{10,}` |
| `webhook-secret` | 全領域 | `\bwhsec_[0-9A-Za-z]{10,}` |
| `resend-key` | 全領域 | `\bre_[0-9A-Za-z]{20,}` |
| `jwt` | 全領域 | `eyJ…\.eyJ…\.…`（各 10 文字以上の base64url 3 区間） |
| `private-key` | 全領域 | `-----BEGIN (…)?PRIVATE KEY-----` |
| `database-url` | 全領域 | `postgres(ql)?://<user>:<password>@` |
| `env-secret` | 全領域 | 行頭の `[export ]SUPABASE_SERVICE_ROLE_KEY` / `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `RESEND_API_KEY` / `DATABASE_URL` / `QR_TOKEN_KEY*` ＝ 値。値が空、`<…>`、`${…}`、`$VAR`、`changeme`、`xxx…` は許可（`.env.example` 想定）。値は `=` の直後（任意の引用符のあと）に `[A-Za-z0-9_+/=.-]` が 8 文字以上続くものだけを検出する |
| `raw-qr-token` | 全領域（tests 含む） | `\br39x1\.(?:ent\|krk)\.[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])`。仕様書の例示 `r39x1.ent.<43-char-base64url-random>` は一致しない |
| `mock-seed-leak` | `tests/**` を除く全領域と build 出力 | `mock-seed-\d+`（`tests/**` は合成入力として許可） |
| `mock-seed-field` | build 出力の `server/app/**` のみ | 文字列 `mockMatrixSeed`（static chunk ではプロパティ名として許可） |
| `real-email` | ソース領域 | メールアドレス形式（ローカル部と `@` とドメイン）のうち、domain が `example.com` / `example.org` / `example.net`（サブドメイン可）、`*.invalid`、`*.test`、`localhost` でないもの |
| `phone-number` | ソース領域 | `(?<![\w-])0[789]0-?\d{4}-?\d{4}(?![\w-])` |
| `card-number` | ソース領域 | 4 桁 ×4 を空白かハイフン 1 つで区切った 16 桁で Luhn が正しいもの |

許可の仕組み: 行内に `secret-scan:allow <rule-id>` を含む行は、**その行のその rule だけ**を許可する（別 rule や次の行には効かない）。それ以外の除外リストは設けない（fixture ディレクトリの丸ごと除外などはしない）。

## 4. `scripts/mock-web.mts`

`node scripts/mock-web.mts <build|start> [--port <1-65535>] [--dry-run]`。モック用のビルドと起動を、OS 非依存で行う。

- 子プロセスの env に `NEXT_PUBLIC_UI_MOCK=1` を設定する。`build` は `pnpm --filter @off-r39x/web build`、`start` は `pnpm --filter @off-r39x/web exec next start -p <port> -H 127.0.0.1`（`--port` 既定 3100）。子の終了コードを返す。pnpm.cmd を解決するため `shell: true` で起動してよい。
- 親の環境の `VERCEL_ENV` が `production` のときは拒否する: 終了コード 1、`ERROR mock-web-production ...` を stdout か stderr に出し、子を起動しない（DEV-WEB-011。本番 deploy 用 build でフラグを有効にしない）。`--dry-run` でも同じ検査を行う。
- `--dry-run`: 子を起動せず、stdout へ**ちょうど** `DRY-RUN mock-web <mode>` / `ENV NEXT_PUBLIC_UI_MOCK=1` / `COMMAND <上記コマンド>` の 3 行だけを出し、終了コード 0。他の環境変数の値は出さない。
- 引数誤り（mode 欠落・不明、未知のオプション、`--port` が整数でないか範囲外）は終了コード 2、`USAGE` を含む行を stderr か stdout に出す（`--dry-run` が付いていても同じ）。
- 既存の本番ガードは `apps/web/next.config.ts` の `assertUiMockNotInProductionBuild`（`NEXT_PUBLIC_UI_MOCK=1` かつ `VERCEL_ENV=production` で build を失敗させる）。調査の結果すでに存在するため、本 slice では変更不要。`TC-DEV-WEB-011-201` が `next.config.ts` を子プロセスで読み込んで回帰を固定する（現状でも通る回帰テスト）。

## 5. E2E 21（`tests/e2e/journeys.spec.ts`）

1 つのテストが `desktop-chromium` と `mobile-chromium` の両方で走る。テスト冒頭で project 名と viewport が一致することを assert する（Desktop は primary nav、Mobile は Drawer から遷移）。

- `TC-SPEC-050-31-21-001`: Guest → CTA で Entry → Cart 追加 → primary nav で Goods → Cart 追加 → Cart → 購入手続き（Login へ `continue=cart`、Order 0 件）→ Login → Cart が同じ内容で復帰 → mock Checkout（入力欄なし、Order は 1 件・`ENTRY_GOODS_PURCHASE`・`AWAITING_PAYMENT`）→「支払う（モック）」→ 購入状況は `AWAITING_PAYMENT`・成功文言なし・権利リンクなし → 状態再確認 → `CONFIRMED`・Entry と Goods の権利リンク・Order は 1 件のまま → マイページ → 注文履歴に同じ Order → Entry Ticket 詳細 → QR（Entry タイトル、合成 QR、seed が URL / DOM / storage に無い、Karaoke の語が無い）→ ログアウトで `/` に戻り Guest、`/mypage` は Login へ。pageerror / console.error なし。
- `TC-SPEC-050-31-21-002`: Guest → Karaoke → 日付 → 枠 → Cart 追加操作なし → Login（slot の intent）→ 同じ枠へ復帰（AVAILABLE）→ 購入 → mock Checkout（枠 HELD、Order 1 件・`KARAOKE_PURCHASE`）→ 支払う → `AWAITING_PAYMENT`・権利なし → 再確認 → `CONFIRMED`・枠 SOLD・予約リンク → 予約詳細 → QR（Karaoke タイトル、seed なし）→ ログアウト。
- `TC-SPEC-050-31-21-003`: Guest が Home / Entry / Karaoke（案内・日別・枠）/ Goods（一覧・詳細）/ お知らせ（一覧・詳細）/ Cart へ遷移し、各ページで h1 が 1 つ、Login へ飛ばされない、横スクロールなし。

これらは既存の実装に対して合格する受入・回帰テストである（失敗するテストを先に書く対象は §2〜§4 の script 群）。

## 6. §31 coverage matrix（TST-E2E-003）

`tests/unit/traceability/page-acceptance-matrix.test.ts`（`TC-E2E-003-001`）が `docs/specs/050-*.md` §31 の項目（1〜29）を読み、manifest の `level: "E2E"` の case が upstream に `SPEC-050-31-<n>` を持つことを各 n で検査する。これまで無かった項目 1, 2, 4, 13, 25, 28 には、実際にその内容を確認している既存 case（1: PUB-001-601 / PUB-002-611 / PUB-003-611 / KRK-001-611 / GDS-001-611、2: PUB-001-607 / PUB-002-612 / KRK-001-613 / KRK-002-614 / GDS-001-614 / TKT-001-505、4: TKT-001-502、13: KRK-003-661、25: CRT-001-503、28: CRT-001-509）へ upstream を追記した（テスト本体は変更していない）。項目 21 は上記 3 journey case。

## 7. Test Case ID 一覧

| ID | ファイル | 対象 |
|---|---|---|
| `TC-DEV-TRC-001-001`〜`008` | `tests/unit/scripts/validate-traceability.test.ts` | §2 |
| `TC-DEV-TRC-001-009` | `tests/unit/scripts/root-scripts.test.ts` | `validate:traceability` entry |
| `TC-DEV-SEC-004-001`〜`008` | `tests/unit/scripts/secret-scan.test.ts` | §3 |
| `TC-DEV-SEC-004-009` | `tests/unit/scripts/root-scripts.test.ts` | `secret-scan` entry |
| `TC-DEV-WEB-011-201`〜`203` | `tests/unit/scripts/root-scripts.test.ts` | 本番ガード / mock script entry / `mock-web.mts` |
| `TC-E2E-003-001` | `tests/unit/traceability/page-acceptance-matrix.test.ts` | §6 |
| `TC-SPEC-050-31-21-001`〜`003` | `tests/e2e/journeys.spec.ts` | §5 |

テストデータはすべて合成。秘密らしい値は `tests/harness/script-fixtures.ts` が実行時に断片から組み立てるため、リポジトリ内に literal として存在せず、`secret-scan` が `tests/**` を走査しても自己検出しない。
