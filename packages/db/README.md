# Database foundation

Infrastructure-only foundation; no business workflows or job tables. `src/schema/`
(barrel `src/schema/index.ts`, published as `@off-r39x/db/schema`) exports Drizzle
bigint-mode tables; reviewed SQL lives in `migrations/`.

## Source layout

- `src/schema/app-schema.ts`: the only definition of the `app` PostgreSQL schema.
- `src/schema/common.ts`: column helpers only (internal ID, public ref, timestamptz).
  Helpers return a fresh column builder per call and never hide a Domain State
  column. Constraints and their explicit names stay in each table definition.
- `src/schema/identity.ts`: `business_profiles` and `role_assignments`.
- `src/schema/audit.ts`: `audit_events` (SPEC-160 §33). Append-only; `app_api_runtime` has INSERT only.
- `src/schema/public-content.ts`: `events`, `faq_items`, `announcements` and `sponsor_logos` (SPEC-100 §13.1–13.4).
- `src/schema/sales.ts`: `entry_ticket_offerings`, `karaoke_sales_configurations` and `goods` (SPEC-100 §15.1–15.3).
- `src/schema/goods.ts`: `goods_inventory`. It is in its own file because SPEC-100 Part IX (§38) owns it; it
  references `goods` from `sales.ts`.
- `src/audit-events.ts`: caller-transaction Audit writer (INSERT only, no RETURNING, no retry, per-operation change specs).
- `src/schema/index.ts`: the barrel. It re-exports `app` and the tables by name,
  unchanged, and exports no helper (`DEV-DB-001`). To add a table, put it in the
  file for its table domain (`SPEC-100 §55`) and add a named export to `index.ts`.
- The Drizzle declarations exist for types and queries. The source of truth for DDL
  is the hand-written SQL in `migrations/` (`SPEC-100 §57`, `DB-MIG-002`); this
  package does not use `drizzle-kit` today.
- `src/transaction.ts` is the generic transaction boundary: isolation, timeout,
  the `SPEC-150` retry policy, `commit_unknown` and advisory locks.
  `src/transactions/` is the planned home of business transaction modules: one
  use case per transaction, no external calls inside (`DEV-DB-010`), and the
  caller of `transaction()` (`DEV-DB-003`, `SPEC-100 §55`). Today it holds
  `src/transactions/profile.ts` (`readCurrentBusinessProfile` /
  `updateCurrentBusinessProfile`, the caller's own Profile for `API-AUTH-002` /
  `API-AUTH-004`).

## Migration numbering

1. Files are `packages/db/migrations/NNNN_<snake_case>.sql` (`DEV-REP-002`), with
   `NNNN` zero-padded to four digits because the runner applies files in filename
   order. Use the latest number on `dev` plus one (`SPEC-100 §59`).
2. One migration file per PR. Fix the number just before merging to `dev`; if
   another PR merged first, the later PR renumbers. The journal matches by filename
   and source hash, so never apply a migration that is not merged to `dev` to a
   shared database (staging and the like); a renamed file would fail with a source
   hash mismatch.
3. Never change a merged file, neither name nor bytes. Fix forward with a new
   numbered migration (`DB-MIG-005`; the runner fails on any journal mismatch).
   `0001_foundation.sql` also anchors repository-root discovery.
4. Order DDL for a new environment as in `SPEC-100 §59`. Name constraints and
   indexes with the `SPEC-100 §5` prefixes (`DB-ARC-007`). Annotate SQL-only DDL
   with the relevant `DB-*` or upstream Rule ID in an SQL comment (`SPEC-100 §57`).
   `0001_foundation.sql` predates this rule, has no such comments and is immutable,
   so it is an exception; the rule applies from the next migration on.
5. When a migration changes the schema, update `src/schema-contract.json` in the
   same commit and the matching Drizzle declarations in `src/schema/*.ts` in the
   same PR.
6. `pnpm validate:migrations` is a conservative aid. It requires a unique numeric
   prefix (and rejects destructive SQL and similar patterns) but checks neither the
   four-digit / snake_case form nor SQL correctness. Every migration still needs a
   diff review (`DEV-DB-013`) and the real PostgreSQL 17 migration test
   (`SPEC-170 §22`).

## Deployment boundaries

1. A privileged deployment identity runs `installBaselineRoles(client)` once.
   Role credentials are supplied by deployment tooling, not generated here.
   Configure database CONNECT/CREATE and `app_migrator` permissions externally.
2. Run `MIGRATION_DATABASE_URL=... pnpm --filter @off-r39x/db migrate` as a separate
   deployment command using a direct TLS connection
   authenticated as `app_migrator`. Runtime startup never runs migrations.
3. Supply a provider-contract-confirmed mapping to `installIdentityDirectory`.
   It validates types/uniqueness, projects only three columns and does not change
   provider tables. No Neon table names are assumed. Missing mapping is not ready.
4. Configure an environment marker as a deployment-managed PostgreSQL custom
   setting and pass its name and expected value to `checkReadiness`. Optional
   project/branch metadata settings must be externally confirmed, never inferred.
5. Package unchanged SQL at `/app/packages/db/migrations/` with OCI WORKDIR `/app`.
   Source commands may run from a repository subdirectory; migration resolution
   searches ancestors for that fixed source-controlled path, never environment
   input or the bundled entrypoint directory. All SQL sources are ordered by filename,
   hashed individually and checked against the applied journal as an exact prefix.
   Only pending migrations are applied; altered, missing or unknown history fails.
   Readiness requires the bundled set (filename byte order) to be an exact prefix of
   the journal ordered by version byte order; later journal rows and additional
   catalog objects are tolerated only when the journal is ahead, except a NOT NULL
   column without default, identity or generation added to a required table
   (SPEC-180 INF-HLT-006). It reads journal, catalog, journal outside a transaction and judges
   only when both journal reads agree, retrying within the SPEC-150 55P03 budget;
   an exhausted budget is a `release_schema_contract` failure.
   `computeMigrationSetHash()` returns
   the release set identity using sorted filename, NUL, source bytes, NUL.

`createDatabase` requires a runtime-role URL with no query overrides and verifies
TLS trust and hostname. Test harnesses alone use direct local non-TLS connections.
The principal repository is read-only, returns lossless string IDs and never
provisions profiles. `transaction` returns `commit_unknown` rather than replaying
an unacknowledged commit. Its callback must never call external providers.

The audit retention purge function and audit reader identity (SPEC-180 §22.6–22.7, §62),
provider mapping, credential issuance, deployment DB metadata,
business write repositories, and production provider evidence are intentionally
not supplied by this foundation. Readiness is an infrastructure check, not proof
that deferred business services are production-ready.

## Initial data seeding

`pnpm db:seed-initial-data` (`packages/db/src/seed-initial-data-cli.ts`, SPEC-180 §45.3) creates the
first Event and its Entry Ticket Offerings in an empty database. There is no Business API or migration
that creates them. Offerings are always created `SUSPENDED` with counters at 0, and the Event
`business_timezone` is `Asia/Tokyo`. Run it after the migration and the schema readiness check and
before the API deploy. The command takes the migration lock (`r39x:schema-migration`) itself; the
library functions `acquireMigrationLock` and `seedInitialData({ lock, ... })` let a migration job run
migrate, readiness and seed under one session lock. Running `db:migrate` and this command as two
processes is for development, tests and re-runs: the lock is released in between.

Environment variables (an `app_migrator` direct URL on port 5432 over TLS, as for `db:migrate`):

| Name | Meaning |
| --- | --- |
| `APP_ENV` | `production`, `staging`, `development` or `test` |
| `MIGRATION_DATABASE_URL` | Direct `app_migrator` URL: no query string, no `-pooler` host, port 5432 |
| `INITIAL_DATA_SEED_ACTOR_REF` | Stable non-secret identity for the Audit Event, `[A-Za-z0-9_:-]{1,128}` |
| `INITIAL_DATA_SEED_JSON` | The input JSON; read only when a row has to be created |

The input has the two keys `event` and `entry_ticket_offerings` (one or more). See
`packages/db/seed/initial-data.example.json` (synthetic values only). Unknown keys are rejected,
including `id`, `public_ref`, `event_id`, `sale_control_state`, `held_quantity`,
`committed_quantity`, `business_timezone`, `created_at` and `updated_at`. Timestamps need an offset.
Keep the real input in the protected GitHub Environment Secret of each environment; never share it
between staging and production and never put it in the repository, a log or a pull request. For a
local run: `export INITIAL_DATA_SEED_JSON="$(cat packages/db/seed/initial-data.example.json)"` (bash) or
`$env:INITIAL_DATA_SEED_JSON = Get-Content -Raw packages/db/seed/initial-data.example.json` (PowerShell).

The command never updates or deletes a row: it creates only when there is no Event (or the only Event
has no Offering), reports `NOOP` otherwise, and fails when two or more Events exist. stdout is exactly one
JSON result line (`outcome` is `CREATED`, `NOOP`, `FAILED` or `UNKNOWN_RESULT`); stderr holds the common
log lines. Exit codes: `0` CREATED or NOOP, `2` FAILED (fix the cause, run again), `3` UNKNOWN_RESULT
(the COMMIT result could not be determined; restore the connection and run the same command again).
Exit code `1` is an unexpected crash (no result line is guaranteed) and is handled like `3`: run again.
The package script runs `node --disable-warning=ExperimentalWarning src/seed-initial-data-cli.ts`, so the
Node type stripping warning does not reach stderr, which carries only JSON log lines; a direct `node`
call on an older Node 24.x prints that warning too. The CLI tests need PostgreSQL on port 5432
with TLS.
