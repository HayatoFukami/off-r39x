// Test harness only: throwaway repository trees and a child-process runner for the S9 scripts
// (scripts/validate-traceability.mts, scripts/secret-scan.mts, scripts/mock-web.mts).
// Contract: tests/contracts/s9-finalize.md. Everything here is synthetic. Secret-looking values are
// ALWAYS assembled at run time from fragments, so that this file itself never contains a literal match
// of the scanner (the scanner scans tests/** in the real repository).
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const scriptPath = (name: string): string => join(REPO_ROOT, "scripts", name);

export type FileMap = Readonly<Record<string, string>>;

export function createTree(files: FileMap, prefix = "r39x-s9-"): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  writeTree(root, files);
  return root;
}

export function writeTree(root: string, files: FileMap): void {
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, ...rel.split("/"));
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, "utf8");
  }
}

export function removeTree(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

export interface RunResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly output: string;
  readonly lines: readonly string[];
}

export function runScript(
  script: string,
  args: readonly string[] = [],
  options: { cwd?: string; env?: Readonly<Record<string, string | undefined>> } = {},
): RunResult {
  const env: Record<string, string | undefined> = { ...process.env, ...(options.env ?? {}) };
  for (const [key, value] of Object.entries(env)) if (value === undefined) delete env[key];
  const result = spawnSync(process.execPath, [scriptPath(script), ...args], {
    cwd: options.cwd ?? REPO_ROOT,
    encoding: "utf8",
    timeout: 120_000,
    env: env as NodeJS.ProcessEnv,
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  return {
    status: result.status,
    stdout,
    stderr,
    output: `${stdout}\n${stderr}`,
    lines: stdout.split(/\r?\n/).filter((line) => line.length > 0),
  };
}

export const linesStarting = (result: RunResult, prefix: string): string[] =>
  result.lines.filter((line) => line.startsWith(prefix));
export const violationsOf = (result: RunResult): string[] => linesStarting(result, "VIOLATION ");
export const findingsOf = (result: RunResult): string[] => linesStarting(result, "FINDING ");

// ---- traceability fixture -----------------------------------------------------------------

export type Json = Record<string, unknown>;

/** A complete, valid Test Case record (SPEC-170 section 9). */
export function manifestCase(id: string, patch: Json = {}): Json {
  return {
    test_case_id: id,
    level: "Unit",
    suite: "unit",
    upstream_rule_ids: ["FOO-001"],
    system_invariant_ids: [],
    api_operation_ids: [],
    db_constraint_names: [],
    preconditions: "synthetic fixture",
    fixture_ids: [],
    clock_instant: null,
    concurrency_seed: null,
    fault_points: [],
    expected_http: null,
    expected_domain_postconditions: ["a postcondition"],
    expected_db_postconditions: [],
    expected_provider_postconditions: [],
    expected_observability: [],
    sensitivity_class: "synthetic",
    critical: false,
    ...patch,
  };
}

export const ID_UNIT = "TC-FOO-001-001";
export const ID_E2E = "TC-BAR-002-001";

export function manifestJson(cases: readonly Json[], extra: Json = {}): string {
  return JSON.stringify({ manifest_version: 1, notes: "synthetic", test_cases: cases, ...extra });
}

export function mapJson(entries: readonly Json[], extra: Json = {}): string {
  return JSON.stringify({ schema_version: 1, entries, ...extra });
}

export function mapEntry(
  ruleId: string,
  codePaths: readonly string[],
  ids: readonly string[],
): Json {
  return {
    rule_id: ruleId,
    code_paths: codePaths,
    test_case_ids: ids,
    notes: "implementation mapping only",
  };
}

export const unitTestSource = (id: string = ID_UNIT): string =>
  [
    'import { describe, it } from "vitest";',
    "",
    `describe("${id} a unit case", () => {`,
    '  it("works", () => {});',
    "});",
    "",
  ].join("\n");

export const e2eSpecSource = (id: string = ID_E2E): string =>
  [
    'import { test } from "@playwright/test";',
    "",
    `test("${id} a journey", async () => {});`,
    "",
  ].join("\n");

/** A consistent tree: every check of validate-traceability passes. No docs/specs directory exists. */
export function cleanTraceFiles(): Record<string, string> {
  return {
    "tests/traceability/test-manifest.json": manifestJson([
      manifestCase(ID_UNIT),
      manifestCase(ID_E2E, {
        level: "E2E",
        suite: "e2e-ui-mock",
        upstream_rule_ids: ["BAR-002", "TST-E2E-004"],
      }),
    ]),
    "tests/unit/a.test.ts": unitTestSource(),
    "tests/e2e/b.spec.ts": e2eSpecSource(),
    "traceability/rule-code-map.json": mapJson([
      mapEntry(
        "FOO-001",
        ["apps/web/src/a.ts", "packages/domain/src", "scripts/tool.mts"],
        [ID_UNIT],
      ),
      mapEntry("BAR-002", ["apps/web/app"], [ID_E2E]),
    ]),
    "apps/web/src/a.ts": "export const a = 1;\n",
    "apps/web/app/page.tsx": "export default function Page() { return null; }\n",
    "packages/domain/src/index.ts": "export const d = 1;\n",
    "scripts/tool.mts": "export const t = 1;\n",
  };
}

export function withTrace(extra: FileMap): Record<string, string> {
  return { ...cleanTraceFiles(), ...extra };
}

export function withoutFiles(files: FileMap, ...paths: string[]): Record<string, string> {
  const copy: Record<string, string> = { ...files };
  for (const path of paths) delete copy[path];
  return copy;
}

/** A docs/specs directory that defines the fixture rule IDs literally (for the upstream-ID checks). */
export const specDocs = (extraText = ""): Record<string, string> => ({
  "docs/specs/050-page.md": "# Page spec\n\nFOO-001 BAR-002 TST-E2E-004 SPEC-050 section 31\n",
  "docs/specs/170-test.md": `# Test spec\n\nTST-E2E-004 ${extraText}\n`,
});

// ---- secret-scan fixture ------------------------------------------------------------------

const at = "@";
const rand43 = "k3Jf9sLq2Zm8Vx1Bn7Cw4Dt6Gy0Hp5Rj3Ke8Ua2LcQ7"; // 43 chars of base64url alphabet
const rand24 = "A1b2C3d4E5f6G7h8I9j0K1L2";

/** Synthetic secret-looking values, assembled at run time. None of them is real. */
export const SAMPLE = {
  stripeLive: ["sk", "live", rand24].join("_"),
  stripeTest: ["sk", "test", rand24].join("_"),
  webhookSecret: ["whsec", rand24].join("_"),
  resendKey: ["re", rand24].join("_"),
  jwt: [
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
    "eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoic3ludGhldGljIn0",
    "c3ludGhldGljLXNpZ25hdHVyZS12YWx1ZQ",
  ].join("."),
  privateKeyHeader: ["-----BEGIN", "PRIVATE KEY-----"].join(" "),
  databaseUrl: ["postgres://app:hunter2hunter2", "db.internal:5432/app"].join(at),
  rawQr: ["r39x1", "ent", rand43].join("."),
  rawQrKaraoke: ["r39x1", "krk", rand43].join("."),
  envSecret: ["STRIPE_SECRET_KEY", "AbCdEfGh12345678"].join("="),
  email: ["taro.yamada", ["gmail", "com"].join(".")].join(at),
  phone: ["090", "1234", "5678"].join("-"),
  card: ["4242", "4242", "4242", "4242"].join(" "),
  cardNotLuhn: ["1234", "5678", "9012", "3456"].join(" "),
  matrixSeed: ["mock-seed", "12345678"].join("-"),
  matrixSeedField: ["mock", "MatrixSeed"].join(""),
} as const;

/** Values that a Test Double needs and that are reserved synthetic data. They never match any rule. */
export const SYNTHETIC_OK = {
  email: ["demo", "example.com"].join(at),
  emailOrg: ["someone", "example.org"].join(at),
  emailSub: ["x", "mail.example.net"].join(at),
  emailTest: ["y", "mailbox.test"].join(at),
} as const;

/** A tree with no finding: reserved-domain data, an empty env example, placeholder QR text. */
export function cleanScanFiles(): Record<string, string> {
  return {
    "package.json": JSON.stringify({ name: "fixture", private: true }),
    "apps/web/src/a.ts": `export const user = "${SYNTHETIC_OK.email}";\n`,
    "apps/web/public/mock/logo.svg": '<svg xmlns="http://www.w3.org/2000/svg"></svg>\n',
    "packages/domain/src/index.ts": "export const d = 1;\n",
    "scripts/tool.mts": "export const t = 1;\n",
    "tests/unit/a.test.ts": `// QR shape: r39x1.ent.<43-char-base64url-random>\nexport const e = "${SYNTHETIC_OK.emailOrg}";\n`,
    "traceability/rule-code-map.json": '{ "schema_version": 1, "entries": [] }\n',
    ".env.example":
      "STRIPE_SECRET_KEY=\nSTRIPE_WEBHOOK_SECRET=<set-in-vault>\nDATABASE_URL=${DATABASE_URL}\n",
  };
}

export function withScan(extra: FileMap): Record<string, string> {
  return { ...cleanScanFiles(), ...extra };
}
