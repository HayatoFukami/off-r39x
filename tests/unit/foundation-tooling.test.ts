import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { getBuildMigrationSetHash } from "../../packages/config/src/index.ts";
import {
  createFixtureRoot,
  REPO_ROOT,
  removeFixtureRoot,
  runBoundaryCheck,
} from "../harness/fixture-repo.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) removeFixtureRoot(root);
});
function fixture(files: Record<string, string>): string {
  const root = createFixtureRoot(files);
  roots.push(root);
  return root;
}
function script(name: string, root: string, args: string[] = []) {
  return spawnSync(process.execPath, [join(REPO_ROOT, "scripts", name), "--root", root, ...args], {
    encoding: "utf8",
  });
}

it("TC-DEV-DEP-006-030 scans nested provider sources and rejects reverse dependencies", () => {
  const root = fixture({
    "packages/providers/stripe/src/index.ts": 'import "../../../../apps/api/src/api/app.ts";',
    "packages/application/src/index.ts": 'import "@off-r39x/db";',
    "apps/web/src/config/bad.ts": 'import "@off-r39x/config";',
  });
  const result = runBoundaryCheck(["--root", root]);
  expect(result.status).toBe(1);
  expect(result.stdout).toContain("adapter-no-transport");
  expect(result.stdout).toContain("application-no-adapters");
  expect(result.stdout).toContain("web-no-server");
});

it("TC-DEV-DB-013-001 rejects destructive and provider-owned migration changes", () => {
  const root = fixture({
    "packages/db/migrations/0001_invalid.sql": [
      "CREATE EXTENSION IF NOT EXISTS pgcrypto;",
      "CREATE EXTENSION IF NOT EXISTS btree_gist;",
      "DROP TABLE app.business_profiles;",
      "ALTER TABLE neon_auth.users ADD COLUMN unsafe text;",
    ].join("\n"),
  });
  const result = script("validate-generated-migrations.mts", root);
  expect(result.status).toBe(1);
  expect(result.stdout).toContain("destructive-sql");
  expect(result.stdout).toContain("provider-owned-ddl");
});

it("TC-DEV-SEC-004-020 scans bundled backend entrypoints without printing detected values", () => {
  const value = ["sk", "test", "synthetic1234567890"].join("_");
  const root = fixture({ "dist/workers/email-worker.js": `const secret = '${value}';` });
  const result = script("secret-scan.mts", root, ["--build-dir", "dist", "--require-build"]);
  expect(result.status).toBe(1);
  expect(result.stdout).toContain("FINDING stripe-key dist/workers/email-worker.js");
  expect(result.stdout).not.toContain(value);
});

it("TC-DEV-TRC-003-030 rejects unmapped nested provider source", () => {
  const root = fixture({
    "packages/providers/resend/src/index.ts": "export const value = 1;",
    "tests/traceability/test-manifest.json": JSON.stringify({
      manifest_version: 1,
      test_cases: [],
    }),
    "traceability/rule-code-map.json": JSON.stringify({ schema_version: 1, entries: [] }),
  });
  const result = script("validate-traceability.mts", root);
  expect(result.status).toBe(1);
  expect(result.stdout).toContain("source-unmapped packages/providers/resend/src/index.ts");
});

it("TC-INF-DEP-001-001 keeps three entrypoints in one secret-free Node24 build configuration", () => {
  const build = readFileSync(join(REPO_ROOT, "scripts/build-backend.mts"), "utf8");
  const container = readFileSync(join(REPO_ROOT, "infra/backend.Dockerfile"), "utf8");
  const biome = JSON.parse(readFileSync(join(REPO_ROOT, "biome.json"), "utf8"));
  expect(biome.files.includes).toContain("!**/dist");
  expect(build).toContain('target: "node24"');
  expect(build).not.toContain("process.env");
  expect(build).toContain("__R39X_BUILD_MIGRATION_SET_SHA256__");
  expect(getBuildMigrationSetHash()).toBeUndefined();
  for (const entry of [
    "apps/api/server",
    "workers/email-worker",
    "workers/reconciliation-worker",
  ]) {
    expect(build).toContain(`"${entry}"`);
  }
  expect(container).toContain("node:24-bookworm-slim@sha256:");
  expect(container).toContain("USER node");
  expect(container).not.toContain("ARG DATABASE");
});
