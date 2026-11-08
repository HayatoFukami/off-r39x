// DEV-DB-013: conservative source review aid, NOT a SQL parser or a substitute for PG17 tests.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
if (args.length !== 0 && (args.length !== 2 || args[0] !== "--root" || !args[1])) {
  process.stderr.write("USAGE node scripts/validate-generated-migrations.mts [--root <dir>]\n");
  process.exit(2);
}
const root = args[1] ? resolve(args[1]) : resolve(dirname(fileURLToPath(import.meta.url)), "..");
const directory = join(root, "packages/db/migrations");
let names: string[];
try {
  names = readdirSync(directory)
    .filter((name) => name.endsWith(".sql"))
    .sort();
} catch {
  process.stdout.write("FAIL migrations-missing\n");
  process.exit(1);
}
let failures = 0;
const seen = new Set<string>();
let aggregate = "";
for (const name of names) {
  const sql = readFileSync(join(directory, name), "utf8");
  const review = sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  aggregate += `\n${review}`;
  const report = (reason: string): void => {
    process.stdout.write(`FAIL ${reason} packages/db/migrations/${name}\n`);
    failures += 1;
  };
  const prefix = /^(\d+)_/.exec(name)?.[1];
  if (!prefix || seen.has(prefix)) report("migration-sequence");
  if (prefix) seen.add(prefix);
  if (/\b(?:DROP\s+(?:TABLE|SCHEMA|COLUMN|CONSTRAINT)|TRUNCATE|DELETE\s+FROM)\b/i.test(review)) {
    report("destructive-sql");
  }
  if (
    /\b(?:ALTER|CREATE|DROP)\s+(?:TABLE|SCHEMA|VIEW)\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?"?neon_auth"?(?:\.|\s|;)/i.test(
      review,
    )
  ) {
    report("provider-owned-ddl");
  }
  if (
    /\b(?:PASSWORD\s+'[^']+'|BYPASSRLS|SUPERUSER)\b/i.test(
      review.replace(/\bNO(?:SUPERUSER|BYPASSRLS)\b/gi, ""),
    )
  ) {
    report("unsafe-role-or-credential");
  }
}
for (const extension of ["pgcrypto", "btree_gist"]) {
  if (
    !new RegExp(`CREATE\\s+EXTENSION\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?"?${extension}"?`, "i").test(
      aggregate,
    )
  ) {
    process.stdout.write(`FAIL required-extension ${extension}\n`);
    failures += 1;
  }
}
if (names.length === 0) failures += 1;
if (failures > 0) process.exitCode = 1;
else
  process.stdout.write(
    `OK migration source review files=${names.length} (real DB review still required)\n`,
  );
