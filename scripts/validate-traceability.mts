// DEV-TRC-001 .. 003 / SPEC-170 section 76: mechanical traceability gate (read-only).
// Runs under plain `node` (type stripping): erasable TypeScript syntax only, node: built-ins only.
// Usage: node scripts/validate-traceability.mts [--root <dir>]
import { existsSync, readdirSync, readFileSync, statSync, writeSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const USAGE = "USAGE node scripts/validate-traceability.mts [--root <dir>]";
const MANIFEST_PATH = "tests/traceability/test-manifest.json";
const MAP_PATH = "traceability/rule-code-map.json";
const DEFERRED_UCR = "UCR-130-005";

const CASE_FIELDS = [
  "test_case_id",
  "level",
  "suite",
  "upstream_rule_ids",
  "system_invariant_ids",
  "api_operation_ids",
  "db_constraint_names",
  "preconditions",
  "fixture_ids",
  "clock_instant",
  "concurrency_seed",
  "fault_points",
  "expected_http",
  "expected_domain_postconditions",
  "expected_db_postconditions",
  "expected_provider_postconditions",
  "expected_observability",
  "sensitivity_class",
  "critical",
] as const;

const CHECK_ORDER = [
  "manifest-json",
  "manifest-version",
  "case-field-missing",
  "case-id-format",
  "case-id-duplicate",
  "case-no-upstream",
  "ui-mock-case",
  "critical-case-incomplete",
  "id-not-in-tests",
  "test-not-in-manifest",
  "skipped-test",
  "unknown-upstream-id",
  "deferred-ucr",
  "map-json",
  "map-schema",
  "map-rule-duplicate",
  "map-path-missing",
  "map-path-invalid",
  "map-test-unknown",
  "map-rule-untested",
  "map-deferred-ucr",
  "source-unmapped",
] as const;

type CheckId = (typeof CHECK_ORDER)[number];

interface Violation {
  readonly check: CheckId;
  readonly subject: string;
  readonly detail: string;
}

type Json = Record<string, unknown>;

const violations: Violation[] = [];

function report(check: CheckId, subject: string, detail = ""): void {
  violations.push({ check, subject, detail });
}

function posix(path: string): string {
  return path.split("\\").join("/");
}

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

class CliExit extends Error {
  readonly code: number;
  constructor(code: number) {
    super("exit");
    this.code = code;
  }
}

function runCli(run: () => void): void {
  try {
    run();
  } catch (error) {
    if (!(error instanceof CliExit)) throw error;
    process.exitCode = error.code;
  }
}

function usageExit(message: string): never {
  writeSync(2, `${message}\n${USAGE}\n`);
  throw new CliExit(2);
}

function parseRoot(argv: readonly string[]): string {
  let root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg !== "--root") usageExit(`ERROR unknown option ${arg ?? ""}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--"))
      usageExit("ERROR --root requires a directory");
    root = resolve(value);
    i += 1;
  }
  let isDir = false;
  try {
    isDir = statSync(root).isDirectory();
  } catch {
    usageExit("ERROR root does not exist");
  }
  if (!isDir) usageExit("ERROR root is not a directory");
  return root;
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

function walk(
  dir: string,
  accept: (name: string) => boolean,
  skipDirs: ReadonlySet<string>,
): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names.flatMap((name) => {
    const full = join(dir, name);
    let isDir: boolean;
    try {
      isDir = statSync(full).isDirectory();
    } catch {
      return [];
    }
    if (isDir) return skipDirs.has(name) ? [] : walk(full, accept, skipDirs);
    return accept(name) ? [full] : [];
  });
}

function listDirs(dir: string): string[] {
  try {
    return readdirSync(dir).filter((name) => statSync(join(dir, name)).isDirectory());
  } catch {
    return [];
  }
}

// ---- manifest -------------------------------------------------------------------------------

interface ManifestCase {
  readonly id: string | undefined;
  readonly subject: string;
  readonly record: Json;
}

function loadManifest(root: string): { cases: ManifestCase[]; count: number } | undefined {
  const file = join(root, ...MANIFEST_PATH.split("/"));
  const json = existsSync(file) ? readJson(file) : undefined;
  if (!isRecord(json)) {
    report("manifest-json", MANIFEST_PATH);
    return undefined;
  }
  const testCases = json.test_cases;
  if (json.manifest_version !== 1 || !Array.isArray(testCases)) {
    report("manifest-version", MANIFEST_PATH);
    return undefined;
  }
  const cases: ManifestCase[] = [];
  testCases.forEach((entry: unknown, index) => {
    if (!isRecord(entry)) {
      report("case-field-missing", `#${index}`, "not-an-object");
      return;
    }
    const id = typeof entry.test_case_id === "string" ? entry.test_case_id : undefined;
    cases.push({ id, subject: id ?? `#${index}`, record: entry });
  });
  return { cases, count: testCases.length };
}

const CASE_ID_FORMAT = /^TC-[A-Z0-9]+(-[A-Z0-9]+)*-\d{3}$/;
const INVARIANT_PREFIX = /^(INV|SEC|REL|OBS|AUD)-/;

function nonEmpty(value: unknown): boolean {
  return Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null;
}

function checkCases(cases: readonly ManifestCase[]): void {
  const seen = new Map<string, number>();
  for (const { id, subject, record } of cases) {
    const missing = CASE_FIELDS.filter((field) => !(field in record));
    if (missing.length > 0) report("case-field-missing", subject, missing.join(","));
    if (id === undefined) continue;
    seen.set(id, (seen.get(id) ?? 0) + 1);
    if (!CASE_ID_FORMAT.test(id)) report("case-id-format", id);

    const upstream = isStringArray(record.upstream_rule_ids) ? record.upstream_rule_ids : [];
    if (upstream.length === 0) report("case-no-upstream", id);

    if (record.suite === "e2e-ui-mock") {
      const bad =
        record.critical !== false ||
        nonEmpty(record.api_operation_ids) ||
        nonEmpty(record.db_constraint_names);
      if (bad) report("ui-mock-case", id);
    }
    if (record.critical === true) {
      const hasInvariant = nonEmpty(record.system_invariant_ids);
      if (!hasInvariant && !upstream.some((rule) => INVARIANT_PREFIX.test(rule))) {
        report("critical-case-incomplete", id);
      }
    }
    if (upstream.includes(DEFERRED_UCR)) report("deferred-ucr", id);
  }
  for (const [id, count] of seen) if (count > 1) report("case-id-duplicate", id);
}

// ---- test sources ---------------------------------------------------------------------------

const TITLE_START = /^(?:test\.describe(?:\.(?:serial|parallel))?|test|it|describe)\(/;
const TITLE_ID = /\bTC-[A-Z0-9]+(?:-[A-Z0-9]+)*-\d{3}\b/g;
const SKIP_MARKER =
  /^(?:(?:it|test|describe|test\.describe(?:\.(?:serial|parallel))?)\.(?:skip|fixme|only|todo)\(|xit\(|xdescribe\()/;

function checkTestSources(root: string, manifestIds: ReadonlySet<string> | undefined): void {
  const files = walk(
    join(root, "tests"),
    (name) => /\.(test|spec)\.(ts|tsx|mts)$/.test(name),
    new Set(["node_modules", "test-results"]),
  ).sort();
  const titled = new Set<string>();
  for (const file of files) {
    const rel = posix(relative(root, file));
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((raw, index) => {
      const line = raw.trim();
      if (SKIP_MARKER.test(line)) report("skipped-test", `${rel}:${index + 1}`);
      if (!TITLE_START.test(line)) return;
      const text = line.endsWith("(") ? `${line} ${(lines[index + 1] ?? "").trim()}` : line;
      for (const match of text.matchAll(TITLE_ID)) titled.add(match[0]);
    });
  }
  if (manifestIds === undefined) return;
  for (const id of manifestIds) if (!titled.has(id)) report("id-not-in-tests", id);
  for (const id of titled) if (!manifestIds.has(id)) report("test-not-in-manifest", id);
}

// ---- upstream IDs ---------------------------------------------------------------------------

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function checkUpstreamIds(root: string, cases: readonly ManifestCase[]): void {
  const specsDir = join(root, "docs", "specs");
  if (!existsSync(specsDir)) return;
  const specFiles = walk(specsDir, (name) => name.endsWith(".md"), new Set());
  const specNumbers = new Set(
    specFiles.map((file) => /^(\d{3})-/.exec(file.split(/[\\/]/).pop() ?? "")?.[1] ?? ""),
  );
  const text = specFiles.map((file) => readFileSync(file, "utf8")).join("\n");
  const known = new Map<string, boolean>();
  const isKnown = (id: string): boolean => {
    const cached = known.get(id);
    if (cached !== undefined) return cached;
    const anchor = /^SPEC-(\d{3})-/.exec(id);
    const found =
      anchor !== null
        ? specNumbers.has(anchor[1] ?? "")
        : new RegExp(`(?<![A-Za-z0-9-])${escapeRegExp(id)}(?![A-Za-z0-9])`).test(text);
    known.set(id, found);
    return found;
  };
  for (const { id, record } of cases) {
    if (id === undefined || !isStringArray(record.upstream_rule_ids)) continue;
    for (const upstream of record.upstream_rule_ids) {
      if (upstream === DEFERRED_UCR) continue;
      if (!isKnown(upstream)) report("unknown-upstream-id", id, upstream);
    }
  }
}

// ---- rule-code map --------------------------------------------------------------------------

interface MapEntry {
  readonly ruleId: string;
  readonly codePaths: readonly string[];
  readonly testCaseIds: readonly string[];
}

function loadMap(root: string): MapEntry[] | undefined {
  const file = join(root, ...MAP_PATH.split("/"));
  const json = existsSync(file) ? readJson(file) : undefined;
  if (json === undefined) {
    report("map-json", MAP_PATH);
    return undefined;
  }
  if (!isRecord(json) || json.schema_version !== 1 || !Array.isArray(json.entries)) {
    report("map-schema", MAP_PATH, "root");
    return undefined;
  }
  const entries: MapEntry[] = [];
  json.entries.forEach((entry: unknown, index) => {
    const problems: string[] = [];
    if (!isRecord(entry)) {
      report("map-schema", MAP_PATH, `entries[${index}]`);
      return;
    }
    const ruleId = entry.rule_id;
    const codePaths = entry.code_paths;
    const testCaseIds = entry.test_case_ids;
    if (typeof ruleId !== "string" || ruleId.length === 0) problems.push("rule_id");
    if (!isStringArray(codePaths) || codePaths.length === 0) problems.push("code_paths");
    if (!isStringArray(testCaseIds)) problems.push("test_case_ids");
    if (typeof entry.notes !== "string") problems.push("notes");
    if (problems.length > 0) {
      report("map-schema", MAP_PATH, `entries[${index}].${problems.join(",")}`);
      return;
    }
    entries.push({
      ruleId: ruleId as string,
      codePaths: codePaths as string[],
      testCaseIds: testCaseIds as string[],
    });
  });
  return entries;
}

function isInvalidPath(path: string): boolean {
  return (
    path.startsWith("/") ||
    /^[A-Za-z]:/.test(path) ||
    path.includes("\\") ||
    path.split("/").includes("..")
  );
}

function checkMap(
  root: string,
  entries: readonly MapEntry[],
  cases: readonly ManifestCase[] | undefined,
): void {
  const counts = new Map<string, number>();
  const caseIds = new Set(cases?.flatMap((c) => (c.id === undefined ? [] : [c.id])));
  const upstreamRules = new Set(
    cases?.flatMap((c) =>
      isStringArray(c.record.upstream_rule_ids) ? c.record.upstream_rule_ids : [],
    ),
  );
  for (const entry of entries) {
    counts.set(entry.ruleId, (counts.get(entry.ruleId) ?? 0) + 1);
    for (const path of entry.codePaths) {
      if (isInvalidPath(path)) report("map-path-invalid", entry.ruleId, path);
      else if (!existsSync(join(root, ...path.split("/")))) {
        report("map-path-missing", entry.ruleId, path);
      }
    }
    if (cases !== undefined) {
      for (const id of entry.testCaseIds) {
        if (!caseIds.has(id)) report("map-test-unknown", entry.ruleId, id);
      }
      if (!upstreamRules.has(entry.ruleId)) report("map-rule-untested", entry.ruleId);
    }
    if (entry.ruleId === DEFERRED_UCR) report("map-deferred-ucr", entry.ruleId);
  }
  for (const [ruleId, count] of counts) if (count > 1) report("map-rule-duplicate", ruleId);
}

function checkSourceCoverage(root: string, entries: readonly MapEntry[]): void {
  const covered = entries.flatMap((e) =>
    e.codePaths.filter((p) => !isInvalidPath(p)).map((p) => p.replace(/\/+$/, "")),
  );
  const roots: string[] = [join(root, "scripts")];
  for (const app of listDirs(join(root, "apps"))) {
    roots.push(join(root, "apps", app, "app"), join(root, "apps", app, "src"));
  }
  for (const pkg of listDirs(join(root, "packages")))
    roots.push(join(root, "packages", pkg, "src"));
  const files = roots.flatMap((dir) =>
    walk(
      dir,
      (name) => /\.(ts|tsx|mts)$/.test(name) && !name.endsWith(".d.ts"),
      new Set(["node_modules", ".next"]),
    ),
  );
  for (const file of files) {
    const rel = posix(relative(root, file));
    if (!covered.some((path) => rel === path || rel.startsWith(`${path}/`))) {
      report("source-unmapped", rel);
    }
  }
}

// ---- main -----------------------------------------------------------------------------------

function main(): void {
  const root = parseRoot(process.argv.slice(2));

  const manifest = loadManifest(root);
  if (manifest !== undefined) checkCases(manifest.cases);
  const manifestIds =
    manifest === undefined
      ? undefined
      : new Set(manifest.cases.flatMap((c) => (c.id === undefined ? [] : [c.id])));
  checkTestSources(root, manifestIds);
  if (manifest !== undefined) checkUpstreamIds(root, manifest.cases);

  const entries = loadMap(root);
  if (entries !== undefined) {
    checkMap(root, entries, manifest?.cases);
    checkSourceCoverage(root, entries);
  }

  if (violations.length === 0) {
    process.stdout.write(
      `OK validate-traceability cases=${manifest?.count ?? 0} rules=${entries?.length ?? 0}\n`,
    );
    return;
  }
  const order = (check: CheckId): number => CHECK_ORDER.indexOf(check);
  const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  violations.sort(
    (a, b) =>
      order(a.check) - order(b.check) ||
      compare(a.subject, b.subject) ||
      compare(a.detail, b.detail),
  );
  for (const v of violations) {
    const detail = v.detail === "" ? "" : ` ${v.detail}`;
    process.stdout.write(`VIOLATION ${v.check} ${v.subject}${detail}\n`);
  }
  process.stdout.write(`FAIL validate-traceability violations=${violations.length}\n`);
  process.exitCode = 1;
}

runCli(main);
