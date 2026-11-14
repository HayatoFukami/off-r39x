// INF-DEP-001 / DEV-REP-001: no runtime configuration or credential is read at build time.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { computeMigrationSetHash } from "../packages/db/src/migrations.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outdir = resolve(root, "dist");
const migrationSetHash = await computeMigrationSetHash(root);
// DEV-RLM-003: the reviewed Lua bytes are embedded; the bundle never reads a script from disk.
const rateLimitScript = await readFile(
  resolve(root, "packages/rate-limit-redis/src/evaluate.lua"),
  "utf8",
);
await mkdir(outdir, { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: {
    "apps/api/server": "apps/api/src/bootstrap/server.ts",
    "workers/email-worker": "apps/email-worker/src/main.ts",
    "workers/reconciliation-worker": "apps/reconciliation-worker/src/main.ts",
  },
  outdir,
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  define: {
    __R39X_BUILD_MIGRATION_SET_SHA256__: JSON.stringify(migrationSetHash),
    __R39X_RATE_LIMIT_SCRIPT__: JSON.stringify(rateLimitScript),
  },
  external: ["pg-native"],
  banner: {
    js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
  sourcemap: false,
  metafile: false,
  logLevel: "warning",
});
await writeFile(resolve(outdir, "package.json"), '{"type":"module"}\n');
await writeFile(
  resolve(outdir, "backend-build.json"),
  `${JSON.stringify({ node_major: 24, migration_set_sha256: migrationSetHash }, null, 2)}\n`,
);
process.stdout.write("OK backend build (API, email-worker, reconciliation-worker)\n");
