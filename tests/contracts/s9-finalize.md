# S9 契約書（validate-traceability / secret-scan / mock ビルドscript / E2E 21）

テスト担当が定義した最終 slice の実装契約。コーディング担当は `scripts/**`（と `traceability/rule-code-map.json`）だけを変更する。ルート `package.json` はオーケストレーターが §1 のとおりに編集する。対応テスト:

- Vitest: `tests/unit/scripts/{validate-traceability,secret-scan,root-scripts,check-import-boundaries,serve-web-dist,generate-web-headers}.test.ts`、`tests/unit/traceability/page-acceptance-matrix.test.ts`
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

既存の `build`（`pnpm --filter @off-r39x/web build`）、`dev` は変更しない。`apps/web` の `build` は `vite build && node ../../scripts/generate-web-headers.mts`、`dev` は `vite`、`start` は無い（配信は `start:mock` だけ。§8）。root と `apps/web` のどの `build`・`dev`・`start` にも `VITE_UI_MOCK` / `NEXT_PUBLIC_UI_MOCK` を書かない。どの script にも `VITE_UI_MOCK=1 cmd` 形式（POSIX 限定）や `cross-env` を使わない。フラグは `mock-web.mts` だけが子プロセスの env に設定する（Windows / POSIX 共通）。フラグ無しの `pnpm build` は成功してよいが、実行時は `createApiPort` が fail closed する（既存。`tests/unit/web/ports/factories.test.ts`）。

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
- `source-unmapped` の対象: `apps/*/app/**`、`apps/*/src/**`、`packages/*/src/**`、`scripts/**` の `.ts` / `.tsx` / `.mts`（`*.d.ts`、`node_modules`、`.next`、`dist` は除く）。`tests/**` は対象外。`scripts/validate-traceability.mts` は走査対象に `app/` が無くても動き、フェーズMで変更しない。被覆は完全一致または**ディレクトリ境界の**前方一致（`apps/web/src` は `apps/web/src/x.ts` を覆うが `apps/web/src-extra` や `apps/web/src/su` 前方一致の `sub/` は覆わない。末尾の `/` は許容）。
- `rule-code-map.json` の完成: 現在の実リポジトリで未被覆なのは `apps/web/src/presentation/components/hydration-marker.tsx`（S3）と、本 slice で新設する `scripts/validate-traceability.mts` / `scripts/secret-scan.mts` / `scripts/mock-web.mts`。コーディング担当は、これらを適切な Rule ID（例: DEV-TRC-001 / DEV-TRC-003、DEV-SEC-004、DEV-WEB-011、hydration-marker は SPEC-050 §25 / TST-FLK-001 系のうち既存 case の upstream に含まれる ID）の entry へ追加し、`test_case_ids` は §6 の ID を使う。`map-rule-untested` を満たすため、entry の `rule_id` は紐づく case の upstream に含まれている必要がある（例: `DEV-TRC-001` → `TC-DEV-TRC-001-001`、`DEV-SEC-004` → `TC-DEV-SEC-004-001`、`DEV-WEB-011` → `TC-DEV-WEB-011-201`）。
- 実リポジトリは現時点で、manifest の upstream ID がすべて仕様書本文に literal で存在し、map の全 path が存在し、全 `rule_id` に一致する case がある（検証済み）。違反が出る場合は、`source-unmapped` の上記 1 件だけが想定される。

## 3. `scripts/secret-scan.mts`

`node scripts/secret-scan.mts [--root <dir>] [--build-dir <path>] [--require-build]`。`--root` の既定はリポジトリルート。`--build-dir` は root からの相対（既定 `apps/web/dist`）。

終了コード: 0 = finding なし、1 = finding あり、または `--require-build` で build 出力が無い、2 = 引数誤り（未知のオプション、値の欠落、root が存在しない。`USAGE` / `ERROR` の行を出す）。

出力（stdout）: finding ごとに `FINDING <rule-id> <root相対パス（/区切り）>:<行>`。同一 rule・同一行は 1 件。順序はパス昇順 → 行昇順 → rule-id 昇順で決定的。最終行は `FAIL secret-scan findings=<n>` または `OK secret-scan files=<走査したファイル数>`。**一致した値・その行の本文・値の先頭断片を stdout / stderr のどこにも出さない**（redaction）。build 出力が無い場合、`--require-build` なしでは `SKIP build-output <パス> not found` を出して続行し、ありでは `ERROR build-output-missing <パス>` を出して終了コード 1。

走査対象:

- ソース領域: `root` 直下のファイル（dotfile 含む。`.env*` も内容を走査する）、`.github/**`、`apps/**`、`packages/**`、`scripts/**`、`tests/**`、`traceability/**`。`apps/web/public/**` と `.github/workflows/**` を含む。
- 除外ディレクトリ（名前一致、どの階層でも）: `node_modules`、`.git`、`.next`（古い Next.js の生成物。source としては走査しない）、`test-results`、`playwright-report`、`blob-report`、`generated`、`coverage`、`dist`、`out`（ただし `--build-dir` で指定したものは build 出力として走査する）、および root 直下の `docs`、`reviews`、`ref`。`pnpm-lock.yaml` と NUL を含むバイナリ、5 MiB 超のファイルは走査しない。
- build 出力（`<build-dir>/**` の全ファイル。`assets/**`、`index.html`、`_headers`、public asset を含む）。`*.html` は静的 shell（area `build-shell`）、それ以外は `build-static`。ここには PII 系 rule（`real-email` / `phone-number` / `card-number`）を適用しない（vendor chunk の誤検出回避）。`mock-seed-field` は静的 shell（`*.html`）だけ、それ以外の値検出 rule は全ファイルに適用する。

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
| `mock-seed-field` | build 出力の `*.html`（静的 shell）のみ | 文字列 `mockMatrixSeed`（JS chunk ではプロパティ名として許可） |
| `real-email` | ソース領域 | メールアドレス形式（ローカル部と `@` とドメイン）のうち、domain が `example.com` / `example.org` / `example.net`（サブドメイン可）、`*.invalid`、`*.test`、`localhost` でないもの |
| `phone-number` | ソース領域 | `(?<![\w-])0[789]0-?\d{4}-?\d{4}(?![\w-])` |
| `card-number` | ソース領域 | 4 桁 ×4 を空白かハイフン 1 つで区切った 16 桁で Luhn が正しいもの |

許可の仕組み: 行内に `secret-scan:allow <rule-id>` を含む行は、**その行のその rule だけ**を許可する（別 rule や次の行には効かない）。それ以外の除外リストは設けない（fixture ディレクトリの丸ごと除外などはしない）。

## 4. `scripts/mock-web.mts`

`node scripts/mock-web.mts <build|start> [--port <1-65535>] [--dry-run]`。モック用のビルドと起動を、OS 非依存で行う。

- 子プロセスの env に `VITE_UI_MOCK=1` を設定する。`build` は `pnpm --filter @off-r39x/web build`、`start` は `node scripts/serve-web-dist.mts --port <port> --host 127.0.0.1`（`--port` 既定 3100、`cwd` は repo root、`process.execPath` と引数配列で起動し shell を使わない）。子の終了コードを返す。`build` は pnpm.cmd を解決するため `shell: true` で起動してよい。
- 親の環境の `APP_ENV` が `production` のときは拒否する: 終了コード 1、`ERROR mock-web-production ...` を stdout か stderr に出し、子を起動しない（DEV-WEB-011。本番 deploy 用 build でフラグを有効にしない）。`VERCEL_ENV` は見ない。`--dry-run` でも同じ検査を行う。
- `--dry-run`: 子を起動せず、stdout へ**ちょうど** `DRY-RUN mock-web <mode>` / `ENV VITE_UI_MOCK=1` / `COMMAND <上記コマンド>` の 3 行だけを出し、終了コード 0。他の環境変数の値は出さない。
- 引数誤り（mode 欠落・不明、未知のオプション、`--port` が整数でないか範囲外）は終了コード 2、`USAGE` を含む行を stderr か stdout に出す（`--dry-run` が付いていても同じ）。
- 本番ガードは `apps/web/vite.config.ts` の `assertUiMockNotInProductionBuild`（`VITE_UI_MOCK=1` かつ `APP_ENV=production` で build と dev server の起動を失敗させる。serve と build の両方で呼ぶ）。`TC-DEV-WEB-011-201` が `vite.config.ts` を子プロセスで読み込み（default export を `{ command, mode }` で呼ぶ）、`TC-DEV-WEB-011-204` が dev 既定（serve で未設定なら `VITE_UI_MOCK=1`、build では未設定のまま）を固定する。

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
| `TC-DEV-WEB-011-201`〜`204` | `tests/unit/scripts/root-scripts.test.ts` | 本番ガード（`vite.config.ts`）/ mock script entry / `mock-web.mts` / dev 既定 |
| `TC-STACK-008-001`〜`004` | `tests/unit/web/routes/route-table-static.test.ts` | s3-layout.md §13.1〜13.3 |
| `TC-STACK-008-101`〜`109` | `tests/unit/scripts/serve-web-dist.test.ts` | §8（108: `! Name` の意味、109: 別表記の URL） |
| `TC-STACK-008-201`〜`210` | `tests/unit/scripts/generate-web-headers.test.ts` | §8（208: asset の完全一致規則、209: build の失敗条件、210: Vite の既定命名） |
| `TC-STACK-008-301`〜`309` | `tests/e2e/static-hosting.spec.ts` | s3-layout.md §13（309: 実 build の asset 規則） |
| `TC-SEC-WEB-009-001`、`002` | `tests/e2e/no-store.spec.ts` | SEC-WEB-009（002: 別表記の URL） |
| `TC-E2E-003-001` | `tests/unit/traceability/page-acceptance-matrix.test.ts` | §6 |
| `TC-SPEC-050-31-21-001`〜`003` | `tests/e2e/journeys.spec.ts` | §5 |

テストデータはすべて合成。秘密らしい値は `tests/harness/script-fixtures.ts` が実行時に断片から組み立てるため、リポジトリ内に literal として存在せず、`secret-scan` が `tests/**` を走査しても自己検出しない。

## 8. 静的 SPA の build と配信（フェーズM。TC-STACK-008-*）

テスト: `tests/unit/scripts/serve-web-dist.test.ts`（101〜109）、`generate-web-headers.test.ts`（201〜210）、`tests/e2e/static-hosting.spec.ts`（301〜309）、`tests/e2e/no-store.spec.ts`（TC-SEC-WEB-009-001、002）。期待値の正は `tests/harness/web-dist.ts`。route 表と adapter の契約は `tests/contracts/s3-layout.md` §13。

### 8.1 `dist/_headers` の内容（v3。方式 A）

```
# Generated by scripts/generate-web-headers.mts. Do not edit.
/*
  Content-Security-Policy: default-src 'self'; script-src 'self'{ 'sha256-…'}; script-src-attr 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:{ <origin>}; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; frame-src 'none'; form-action 'self'; manifest-src 'self'; worker-src 'self' blob:; media-src 'self' blob:; upgrade-insecure-requests
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  X-Frame-Options: DENY
  Strict-Transport-Security: max-age=63072000; includeSubDomains
  Cross-Origin-Opener-Policy: same-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=()
  Cache-Control: no-store, private, max-age=0
  Pragma: no-cache

/assets/<hash 付きファイル名 1>
  ! Cache-Control
  ! Pragma
  Cache-Control: public, max-age=31536000, immutable

（同じ 4 行の規則が、dist/assets/ 直下の hash 付きファイルごとに、ファイル名の code unit 順に続く）
```

- コメント行の直下に `/*` を置く。規則は空行で区切る。LF、末尾の改行は 1 つ。`{ 'sha256-…'}` / `{ <origin>}` は 0 個以上の繰り返しで、無ければ placeholder を残さない。hash は src のない inline `<script>` 本文の SHA-256（base64）を重複なし・辞書順に並べる。origin は `SPONSOR_IMAGE_ALLOWED_ORIGINS` の正規化した origin（入力順）で、`img-src` だけに入る。`dist/assets/` が無い、または空のとき、内容は `/*` 規則だけになる。
- 根拠: CSP は SPEC-140 §21（SEC-WEB-003〜006、`connect-src` は API が未実装のため `'self'` だけ）、`X-Content-Type-Options`・`Referrer-Policy`（全 Production Web response で `no-referrer`、path ごとの値を設けない）・`X-Frame-Options`・`Strict-Transport-Security`・`Cross-Origin-Opener-Policy` は §22、`Permissions-Policy` は §22.1 の通常 page の値（camera を許可しない。staff scanner 用の `camera=(self)` は staff 画面の作業で足す）。no-store と Pragma は SEC-WEB-009（追加段落: content-hash 付きの静的 asset 以外の全応答に、request path の表記に依存せず適用する）なので、保護 prefix の規則は置かず `/*` に付ける。
- asset の規則は **実在する hash 付きファイルごとの完全一致**（`/assets/*` の前方一致にしない。前方一致だと存在しない asset や SPA fallback の応答も長期 cache になり、SEC-WEB-009 の「content-hash 付きの静的 asset 以外の全応答」を満たさない）。対象は `dist/assets/` 直下で名前が `^[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$`（Vite の既定 `[name]-[hash].<ext>`）に一致するファイルだけ。長期 cache の値 `public, max-age=31536000, immutable` と正規表現は仕様に規定がなく、本リポジトリの選択（DEV-AI-003）。`! Name` は同じ規則の set より先に、それまでに積んだ同名 header を外す（後続の規則には影響しない）。
- build の失敗条件（いずれも終了コード 1、`_headers` を書かず既存の `_headers` を変えない。`--check` でも比較の前に同じ検査を行う）: `ERROR html-404-present <相対path>`（`dist` 以下のどこかに大文字小文字を問わず `404.html`。Pages の SPA fallback を止めるため）、`ERROR asset-unhashed <相対path>`（`dist/assets/` 直下に hash 形式でないファイル、またはサブディレクトリ。複数あれば全件を 1 行ずつ）、`ERROR headers-rule-limit rules=<n>`（規則が 100 を超える。asset は最大 99 ファイル）、`ERROR headers-line-too-long line=<n>`（いずれかの行が 2,000 文字を超える。最初の 1 件の 1 始まりの行番号）。検査の順序は index-missing → origin → inline script → `404.html` → asset → 規則数 → 行長 → `--check` の比較または書き込み。エラー行に origin の値を出さない。
- 規則の順序: `/*` の後に asset の規則。Pages は規則の順序を公式に保証していない（OSS 実装は記述順）。実地確認は deploy の作業に残る。
### 8.2 secret-scan の build 出力

既定は `apps/web/dist`。`dist/**` の全ファイルを走査し、`*.html` に `mock-seed-field` を適用する（§3）。`apps/web/.next` は source としても build 出力としても走査しない。

### 8.3 一時的な赤の範囲（フェーズMの計画）

unit は C1〜C5、E2E は C1 から C6 の後まで、`build:mock` は C2〜C3d で赤になり得る。lint・typecheck・check:boundaries・validate:traceability は全コミットで緑を保つ。
