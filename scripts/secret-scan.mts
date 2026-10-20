// DEV-SEC-004 / DEV-WEB-013: scans source and web build output for secrets, raw QR tokens, the mock
// matrix seed and real PII. Matched values are NEVER printed: only the rule id, the path and the line.
// Runs under plain `node` (type stripping): erasable TypeScript syntax only, node: built-ins only.
// Usage: node scripts/secret-scan.mts [--root <dir>] [--build-dir <path>] [--require-build]
import { readdirSync, readFileSync, statSync, writeSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const USAGE =
  "USAGE node scripts/secret-scan.mts [--root <dir>] [--build-dir <path>] [--require-build]";
const DEFAULT_BUILD_DIR = "apps/web/.next";
const MAX_BYTES = 5 * 1024 * 1024;
const SOURCE_DIRS = ["apps", "packages", "scripts", "tests", "traceability"];
const EXCLUDED_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "test-results",
  "playwright-report",
  "blob-report",
  "generated",
  "coverage",
  "dist",
  "out",
]);
const SKIPPED_FILES = new Set(["pnpm-lock.yaml"]);

type Area = "source" | "build-static" | "build-server";

interface Scope {
  readonly area: Area;
  readonly inTests: boolean;
}

interface Rule {
  readonly id: string;
  readonly applies: (scope: Scope) => boolean;
  readonly detect: (line: string) => boolean;
}

interface Finding {
  readonly path: string;
  readonly line: number;
  readonly rule: string;
}

const everywhere = (): boolean => true;
const sourceOnly = (scope: Scope): boolean => scope.area === "source";

const RESERVED_DOMAINS = ["example.com", "example.org", "example.net"];

function isReservedDomain(domain: string): boolean {
  const lower = domain.toLowerCase();
  return (
    lower === "localhost" ||
    lower.endsWith(".invalid") ||
    lower.endsWith(".test") ||
    RESERVED_DOMAINS.some((reserved) => lower === reserved || lower.endsWith(`.${reserved}`))
  );
}

function hasRealEmail(line: string): boolean {
  const pattern = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})/g;
  for (const match of line.matchAll(pattern)) {
    if (!isReservedDomain(match[1] ?? "")) return true;
  }
  return false;
}

function passesLuhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    let digit = Number(digits.charAt(digits.length - 1 - i));
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

function hasCardNumber(line: string): boolean {
  for (const match of line.matchAll(/(?<!\d)(\d{4})([ -])(\d{4})\2(\d{4})\2(\d{4})(?!\d)/g)) {
    if (passesLuhn(`${match[1]}${match[3]}${match[4]}${match[5]}`)) return true;
  }
  return false;
}

const ENV_SECRET =
  /^(?:export\s+)?(?:SUPABASE_SERVICE_ROLE_KEY|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|RESEND_API_KEY|DATABASE_URL|QR_TOKEN_KEY\w*)\s*=\s*["']?([A-Za-z0-9_+/=.-]{8,})/;

function hasEnvSecret(line: string): boolean {
  const value = ENV_SECRET.exec(line)?.[1];
  return value !== undefined && !/^(?:changeme|x[x_.-]*)$/i.test(value);
}

const test = (pattern: RegExp) => (line: string) => pattern.test(line);

const RULES: readonly Rule[] = [
  {
    id: "stripe-key",
    applies: everywhere,
    detect: test(/\b(?:sk|rk)_(?:live|test)_[0-9A-Za-z]{10,}/),
  },
  { id: "webhook-secret", applies: everywhere, detect: test(/\bwhsec_[0-9A-Za-z]{10,}/) },
  { id: "resend-key", applies: everywhere, detect: test(/\bre_[0-9A-Za-z]{20,}/) },
  {
    id: "jwt",
    applies: everywhere,
    detect: test(/eyJ[A-Za-z0-9_-]{7,}\.eyJ[A-Za-z0-9_-]{7,}\.[A-Za-z0-9_-]{10,}/),
  },
  {
    id: "private-key",
    applies: everywhere,
    detect: test(/-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/),
  },
  {
    id: "database-url",
    applies: everywhere,
    detect: test(/postgres(?:ql)?:\/\/[^\s:@/]+:[^\s@/]+@/),
  },
  { id: "env-secret", applies: everywhere, detect: hasEnvSecret },
  {
    id: "raw-qr-token",
    applies: everywhere,
    detect: test(/\br39x1\.(?:ent|krk)\.[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/),
  },
  { id: "mock-seed-leak", applies: (scope) => !scope.inTests, detect: test(/mock-seed-\d+/) },
  {
    id: "mock-seed-field",
    applies: (scope) => scope.area === "build-server",
    detect: (line) => line.includes("mockMatrixSeed"),
  },
  { id: "real-email", applies: sourceOnly, detect: hasRealEmail },
  {
    id: "phone-number",
    applies: sourceOnly,
    detect: test(/(?<![\w-])0[789]0-?\d{4}-?\d{4}(?![\w-])/),
  },
  { id: "card-number", applies: sourceOnly, detect: hasCardNumber },
];

// ---- CLI ------------------------------------------------------------------------------------

interface Options {
  readonly root: string;
  readonly buildDir: string;
  readonly requireBuild: boolean;
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

function parseArgs(argv: readonly string[]): Options {
  let root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  let buildDir = DEFAULT_BUILD_DIR;
  let requireBuild = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--require-build") {
      requireBuild = true;
    } else if (arg === "--root" || arg === "--build-dir") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) usageExit(`ERROR ${arg} requires a value`);
      if (arg === "--root") root = resolve(value);
      else buildDir = value;
      i += 1;
    } else {
      usageExit(`ERROR unknown option ${arg ?? ""}`);
    }
  }
  let isDir = false;
  try {
    isDir = statSync(root).isDirectory();
  } catch {
    usageExit("ERROR root does not exist");
  }
  if (!isDir) usageExit("ERROR root is not a directory");
  return { root, buildDir, requireBuild };
}

// ---- scanning -------------------------------------------------------------------------------

function posix(path: string): string {
  return path.split("\\").join("/");
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function walk(dir: string, skip: (path: string, name: string) => boolean): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names.flatMap((name) => {
    const full = join(dir, name);
    if (isDirectory(full)) return skip(full, name) ? [] : walk(full, skip);
    return [full];
  });
}

const ALLOW_MARKER = /secret-scan:allow\s+([a-z0-9-]+)/g;

function scanFile(file: string, path: string, scope: Scope, findings: Finding[]): boolean {
  let buffer: Buffer;
  try {
    if (statSync(file).size > MAX_BYTES) return false;
    buffer = readFileSync(file);
  } catch {
    return false;
  }
  if (buffer.includes(0)) return false;
  const lines = buffer.toString("utf8").split(/\r?\n/);
  const rules = RULES.filter((rule) => rule.applies(scope));
  lines.forEach((text, index) => {
    const allowed = new Set([...text.matchAll(ALLOW_MARKER)].map((m) => m[1]));
    for (const rule of rules) {
      if (allowed.has(rule.id)) continue;
      if (rule.detect(text)) findings.push({ path, line: index + 1, rule: rule.id });
    }
  });
  return true;
}

function main(): void {
  const { root, buildDir, requireBuild } = parseArgs(process.argv.slice(2));
  const buildRoot = resolve(root, buildDir);
  const findings: Finding[] = [];
  let scanned = 0;
  const rel = (file: string): string => posix(relative(root, file));

  const rootFiles = readdirSync(root)
    .map((name) => join(root, name))
    .filter((full) => !isDirectory(full));
  const sourceFiles = [
    ...rootFiles,
    ...SOURCE_DIRS.flatMap((dir) =>
      walk(join(root, dir), (full, name) => EXCLUDED_DIRS.has(name) || resolve(full) === buildRoot),
    ),
  ];
  for (const file of sourceFiles) {
    if (SKIPPED_FILES.has(file.split(/[\\/]/).pop() ?? "")) continue;
    const path = rel(file);
    const scope: Scope = { area: "source", inTests: path.startsWith("tests/") };
    if (scanFile(file, path, scope, findings)) scanned += 1;
  }

  if (isDirectory(buildRoot)) {
    const areas: [string, Area][] = [
      [join(buildRoot, "static"), "build-static"],
      [join(buildRoot, "server", "app"), "build-server"],
    ];
    for (const [dir, area] of areas) {
      for (const file of walk(dir, () => false)) {
        if (scanFile(file, rel(file), { area, inTests: false }, findings)) scanned += 1;
      }
    }
  } else if (requireBuild) {
    process.stdout.write(`ERROR build-output-missing ${posix(buildDir)}\n`);
    process.exitCode = 1;
    return;
  } else {
    process.stdout.write(`SKIP build-output ${posix(buildDir)} not found\n`);
  }

  if (findings.length === 0) {
    process.stdout.write(`OK secret-scan files=${scanned}\n`);
    return;
  }
  const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  findings.sort((a, b) => compare(a.path, b.path) || a.line - b.line || compare(a.rule, b.rule));
  for (const f of findings) process.stdout.write(`FINDING ${f.rule} ${f.path}:${f.line}\n`);
  process.stdout.write(`FAIL secret-scan findings=${findings.length}\n`);
  process.exitCode = 1;
}

runCli(main);
