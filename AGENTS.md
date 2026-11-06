# AGENTS.md

## 1. Current repository, not the planned system

- Only the UI mock (a Vite + React Router static SPA, output `apps/web/dist`) and pure domain types are implemented. Hono API, database, real auth, Stripe and Resend integrations are not implemented; mock tests do not prove those contracts.
- `README.md` is the setup overview; executable configuration wins for commands and current behavior. Business requirements remain owned by `docs/specs/` (`SPEC-000`–`SPEC-200`), not existing code or `docs/drafts/`.
- `.claude/agents/*.md` still contain obsolete claims that source/test directories do not exist. They are not canonical specifications or a required OpenCode orchestration scheme. `CLAUDE.md` only points here.

## 2. Setup and running the mock

Use Node **24.x** and **pnpm 12.3.4** (`package.json`). `scripts/*.mts` run with Node's native type stripping, not tsx/ts-node.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm dev                         # vite dev server; defaults to mock mode when the flag is unset
pnpm build:mock                  # explicitly sets VITE_UI_MOCK=1; output apps/web/dist
pnpm start:mock                  # serves apps/web/dist and dist/_headers (scripts/serve-web-dist.mts) at http://127.0.0.1:3100
pnpm start:mock --port 3200       # no extra -- separator
```

- `apps/web/vite.config.ts` supplies the dev-server default. Builds do **not** default to mock mode: use `build:mock` for UI verification. Non-mock API/auth factories currently throw (fail closed).
- Mock builds are refused when `APP_ENV=production` (this repository's choice to satisfy DEV-WEB-011; the spec does not name the variable); do not bypass that guard.
- `/dev/scenarios` controls mock outcomes. Mock data persists in browser localStorage (`r39x.mock.*`; cart: `r39x.cart.v1`); reset that origin's storage when reproducing from a clean state. Use synthetic data only.

## 3. Architecture and import boundaries

- `apps/web/src/routes/` contains the React Router route table and thin route modules; containers and logic live in `src/features/`, prop-driven views in `src/presentation/`. Japanese UI copy is centralized in `src/presentation/copy/ja.ts`; read the relevant `tests/contracts/*.md` before changing DOM, accessible names or port shapes.
- `apps/web/src/routes/root-layout.tsx` mounts API/session providers and owns the **single `<main>`**. Pages must not introduce another main landmark.
- `packages/domain` exports TypeScript source directly (`src/index.ts`); Vite bundles the TypeScript source directly. It must not import external packages or app/framework code.
- Features use API/auth ports, never `src/mock/` directly. Mock imports are allowed only in `src/api-client/index.ts`, `src/auth/index.ts`, `src/routes/dev/**`, mock internals, and the root layout's `MockModeBadge`. Presentation must not import features, mock implementations or provider hooks. Import `react-router` only from `src/routing/`, `src/routes/` and `src/main.tsx` (a convention, not enforced by the boundary script). Exact exceptions are enforced by `scripts/check-import-boundaries.mts`.
- Planned business data flow is `Browser → React SPA → Hono API → Supabase PostgreSQL` (`SPEC-010`). Browser/Web never query the Business DB directly; Hono owns business mutation/authorization, Supabase Auth owns authentication. Do not treat client IDs, roles, prices or payment results as authority.
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
pnpm test:unit                   # Vitest unit AND security projects, Node environment
pnpm test:e2e                    # Playwright UI-mock suite; builds apps/web/dist and serves it itself
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

- Playwright reserves `127.0.0.1:3100`, refuses an existing server, and rebuilds `apps/web/dist` and serves it with `scripts/serve-web-dist.mts`; do not run alongside `start:mock` or another build/E2E run. Default projects are desktop/mobile Chromium, workers=2, timezone=UTC, retries=0. Windows loopback stalls are documented; use `--workers=1` for diagnosis, not retries to erase a failure.
- `dist/_headers` puts the protective headers (no-store, Pragma, `Referrer-Policy: no-referrer`) on `/*`; only the exact paths of content-hashed files in `dist/assets/` detach no-store and Pragma with `!` and get a long immutable cache (they keep `Referrer-Policy: no-referrer`). Cloudflare Pages is expected (per the OSS asset server; unverified on Pages, Issue C) to match `_headers` against the URL pathname without percent-decoding, so a path rule cannot cover every spelling: do not reintroduce per-prefix protective rules or a `dist/404.html`.
- Use `gotoHydrated`/`waitForHydration` from `tests/harness/browser/hydration.ts` before interactive assertions; navigation completing does not mean React is ready.
- E2E is the auxiliary `e2e-ui-mock` suite, not real DB/API/provider coverage or SPEC-170 G8. Tests needing constraints, locks or transaction races require real PostgreSQL; provider contract tests require nonproduction credentials.
- Both runners have retries=0. Do not skip/quarantine critical tests or rewrite expectations to match a spec-violating implementation. Report unexecuted checks with reasons and release impact, never as passed.
- Secret scan covers root files, `.github/**`, `apps/`, `packages/`, `scripts/`, `tests/`, `traceability/`, plus the whole build output `apps/web/dist/**`. `OK` is not a full-bundle audit. Never put real secrets, raw QR, credentials, webhook bodies or unnecessary PII in source, fixtures, logs, screenshots or reports. Synthetic email domains must be reserved (`example.com`, `.test`, `.invalid`, etc.).

## 6. Git policy

- Commit specification revisions before their dependent implementation. Do not mix unrelated existing changes into task commits.

## 7. Specification changes and unresolved contracts

- Read `docs/specs/000-specification-governance.md` first, then the target Canonical Owner, its `depends_on`, and user-requested specs (`SPEC-000 §21`). Select required owners via `SPEC-190 §33`; do not load every spec unconditionally.
- The latest explicit user requirement takes precedence (`SPEC-000 §8`). If it changes specified behavior, update affected Canonical Owners **before implementation**, preserving frontmatter and applying the correct SemVer change. Do not silently change specs in an ordinary implementation task or promote existing code behavior into requirements.
- For conflicts/gaps not already authorized by the user's requested spec change, stop affected work and propose a UCR in `SPEC-000 §15.2` format. Do not invent states, APIs, Capabilities, schemas or recovery commands. Repository/workflow-only gaps may be resolved under DEV-AI-003 with the decision recorded.
- A UCR is not an implementation contract until incorporated into the Canonical Owner's body. Check current status there; `UCR-130-005` is `DEFERRED_NONBLOCKING`—do not proactively add its suggested indexes.
- API/Operation IDs and recovery contracts come from `SPEC-110` (notification recovery: `SPEC-120`), Capability semantics from `SPEC-060`, administrative handoff from `SPEC-130`; use those owners rather than copying UCR proposals.
