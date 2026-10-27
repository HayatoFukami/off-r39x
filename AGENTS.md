# AGENTS.md

## 1. Current repository, not the planned system

- The Next.js UI mock remains on the old frontend contract. Backend foundation now includes Hono, PG17/Drizzle/pg, verified JWT Principal/Capability, provider adapters, and worker startup/shutdown. Business operations, the Neon Auth proxy, live provider compatibility, and production readiness are not implemented/proven; mock tests do not prove those contracts. See `docs/backend-foundation.md`.
- `README.md` is the setup overview; executable configuration wins for commands and current behavior. Business requirements remain owned by `docs/specs/` (`SPEC-000`–`SPEC-200`), not existing code or `docs/drafts/`.
- `.claude/agents/*.md` still contain obsolete claims that source/test directories do not exist. They are not canonical specifications or a required OpenCode orchestration scheme. `CLAUDE.md` only points here.

## 2. Setup and running the mock

Use Node **24.x** and **pnpm 12.3.4** (`package.json`). `scripts/*.mts` run with Node's native type stripping, not tsx/ts-node.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm dev                         # next dev; defaults to mock mode when flag is unset
pnpm build:mock                  # explicitly sets NEXT_PUBLIC_UI_MOCK=1
pnpm start:mock                  # built mock at http://127.0.0.1:3100
pnpm start:mock --port 3200       # no extra -- separator
```

- `apps/web/next.config.ts` supplies the dev-server default. Builds do **not** default to mock mode: use `build:mock` for UI verification. Non-mock API/auth factories currently throw (fail closed).
- Mock builds are refused when `VERCEL_ENV=production`; do not bypass that guard.
- `/dev/scenarios` controls mock outcomes. Mock data persists in browser localStorage (`r39x.mock.*`; cart: `r39x.cart.v1`); reset that origin's storage when reproducing from a clean state. Use synthetic data only.

## 3. Architecture and import boundaries

- `apps/web/app/` contains thin App Router shells; containers and logic live in `src/features/`, prop-driven views in `src/presentation/`. Japanese UI copy is centralized in `src/presentation/copy/ja.ts`; read the relevant `tests/contracts/*.md` before changing DOM, accessible names or port shapes.
- `apps/web/app/layout.tsx` mounts API/session providers and owns the **single `<main>`**. Pages must not introduce another main landmark.
- `packages/domain` exports TypeScript source directly (`src/index.ts`); Next transpiles it via `transpilePackages`. It must not import external packages or app/framework code.
- Features use API/auth ports, never `src/mock/` directly. Mock imports are allowed only in `src/api-client/index.ts`, `src/auth/index.ts`, `app/dev/**`, mock internals, and the root layout's `MockModeBadge`. Presentation must not import features, mock implementations or provider hooks. Exact exceptions are enforced by `scripts/check-import-boundaries.mts`.
- Canonical business flow is `Browser → Railway Hono API → Neon PostgreSQL` (`SPEC-010`); the legacy Next.js UI mock is a separate surface. Browser/Web never query the Business DB directly; Hono owns business mutation/authorization and Neon Auth owns identity. Do not treat client IDs, roles, prices or payment results as authority.
- For backend work, preserve verified-provider payment confirmation (never browser redirects), external calls outside DB transactions, and reconciliation instead of blind retries after unknown outcomes (`SPEC-070`, `SPEC-150`). Entry/Karaoke QR purposes stay separate and check-in atomic/single-use (`SPEC-080`).

## 4. Implementation workflow

- Follow `SPEC-190 §33` for change classification/required suites, `§35` for test-first implementation, `§37–38` for verification/review and `§39` for completion evidence. Do not infer required coverage from a passing unit suite alone.
- Changed behavioral source must map to Canonical Rule IDs in `traceability/rule-code-map.json`; tests need Test Case IDs and `tests/traceability/test-manifest.json` entries (`SPEC-170 §9, §81`). Run `pnpm validate:traceability` after either changes.
- Fixtures, provider doubles and fault injection belong under `tests/fixtures` or `tests/harness`, not production code. The explicitly gated UI mock is the exception (`SPEC-190` DEV-WEB-010–013).

## 5. Verification commands and traps

After setup, the specified order is **lint → typecheck → applicable SPEC-170 gates → build** (`SPEC-180 §43`). Current root scripts:

```sh
pnpm lint                        # biome check, not a separate ESLint/Prettier setup
pnpm typecheck                   # recursive workspace checks
pnpm check:boundaries            # separate gate, not included in lint
pnpm validate:traceability       # separate gate, not included in typecheck
pnpm validate:migrations         # static review aid, not a real PG17 migration test
pnpm test:unit                   # Vitest unit AND security projects, Node environment
pnpm test:backend                # foundation tests, real PG17 and TEST_DATABASE_URL/TEST_DATABASE_CA required
pnpm build:backend               # bundles all three server processes without runtime Secrets
pnpm test:e2e                    # Playwright UI-mock suite; builds and starts its own server
pnpm build:mock                  # UI-mock build; standard non-mock command is pnpm build
pnpm secret-scan --require-build # run after build to require and inspect build output
```

Focused checks from the repository root (test paths are relative to `tests/`):

```sh
pnpm --filter @off-r39x/web typecheck
pnpm --dir tests exec vitest run --config vitest.config.mts unit/web/presentation/money.test.ts
pnpm --dir tests exec playwright test e2e/cart-page.spec.ts --project=desktop-chromium --workers=1
pnpm --dir tests exec playwright install chromium  # if the browser binary is missing
```

- Playwright reserves `127.0.0.1:3100`, refuses an existing server, and rebuilds `apps/web/.next`; do not run alongside `start:mock` or another build/E2E run. Default projects are desktop/mobile Chromium, workers=2, timezone=UTC, retries=0. Windows loopback stalls are documented; use `--workers=1` for diagnosis, not retries to erase a failure.
- Use `gotoHydrated`/`waitForHydration` from `tests/harness/browser/hydration.ts` before interactive assertions; navigation completing does not mean React is ready.
- E2E is the auxiliary `e2e-ui-mock` suite, not real DB/API/provider coverage or SPEC-170 G8. Tests needing constraints, locks or transaction races require real PostgreSQL; provider contract tests require nonproduction credentials.
- Backend DB tests require disposable PostgreSQL 17 at port 5432, verified test TLS with a synthetic CA, UTC, and a setup identity able to install test roles. Missing DB settings fail rather than skip. Run from the repository root; see `docs/backend-foundation.md`. Unbundled server source has no build-bound migration hash and cannot become Ready.
- Both runners have retries=0. Do not skip/quarantine critical tests or rewrite expectations to match a spec-violating implementation. Report unexecuted checks with reasons and release impact, never as passed.
- Secret scan covers root files, `.github/`, `apps/`, `packages/`, `scripts/`, `tests/`, `traceability/`, plus `.next/static/**` and `.next/server/**`. Pass `--build-dir dist --require-build` for bundled backend output. `OK` is a pattern scan of that scope, not a complete secret or bundle audit. Never put real secrets, raw QR, credentials, webhook bodies or unnecessary PII in source, fixtures, logs, screenshots or reports. Synthetic email domains must be reserved (`example.com`, `.test`, `.invalid`, etc.).

## 6. Git policy

- Commit specification revisions before their dependent implementation. Do not mix unrelated existing changes into task commits.

## 7. Specification changes and unresolved contracts

- Read `docs/specs/000-specification-governance.md` first, then the target Canonical Owner, its `depends_on`, and user-requested specs (`SPEC-000 §21`). Select required owners via `SPEC-190 §33`; do not load every spec unconditionally.
- The latest explicit user requirement takes precedence (`SPEC-000 §8`). If it changes specified behavior, update affected Canonical Owners **before implementation**, preserving frontmatter and applying the correct SemVer change. Do not silently change specs in an ordinary implementation task or promote existing code behavior into requirements.
- For conflicts/gaps not already authorized by the user's requested spec change, stop affected work and propose a UCR in `SPEC-000 §15.2` format. Do not invent states, APIs, Capabilities, schemas or recovery commands. Repository/workflow-only gaps may be resolved under DEV-AI-003 with the decision recorded.
- A UCR is not an implementation contract until incorporated into the Canonical Owner's body. Check current status there; `UCR-130-005` is `DEFERRED_NONBLOCKING`—do not proactively add its suggested indexes.
- API/Operation IDs and recovery contracts come from `SPEC-110` (notification recovery: `SPEC-120`), Capability semantics from `SPEC-060`, administrative handoff from `SPEC-130`; use those owners rather than copying UCR proposals.
