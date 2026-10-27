# Database foundation

Infrastructure-only foundation; no business workflows or job tables. `schema.ts`
exports Drizzle bigint-mode tables; reviewed SQL lives in `migrations/`.

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
   input or the bundled entrypoint directory. `migrationIdentity()` returns the version and
   SHA-256 of source bytes. `computeMigrationSetHash()` returns the release set
   identity using sorted filename, NUL, source bytes, NUL.

`createDatabase` requires a runtime-role URL with no query overrides and verifies
TLS trust and hostname. Test harnesses alone use direct local non-TLS connections.
The principal repository is read-only, returns lossless string IDs and never
provisions profiles. `transaction` returns `commit_unknown` rather than replaying
an unacknowledged commit. Its callback must never call external providers.

Audit storage, provider mapping, credential issuance, deployment DB metadata,
business write repositories, and production provider evidence are intentionally
not supplied by this foundation. Readiness is an infrastructure check, not proof
that deferred business services are production-ready.
