// DEV-DEP-006: mechanical gate for forbidden import edges.
// Runs under plain `node` (type stripping): erasable TypeScript syntax only. Imports are extracted with the
// TypeScript AST, so `typescript` (root devDependency) is required; everything else is `node:` built-ins only.
// Usage: node scripts/check-import-boundaries.mts [--root <dir>]
// Known limitations:
//   - Files directly under packages/* are not scanned (only packages/*/src).
//   - Under apps/*, only app/, src/ and the files directly in apps/<app>/ are scanned; other subdirectories
//     (for example apps/web/scripts/**) are not.
//   - Unresolvable dynamic import() / require() (interpolated template, non-literal argument) is reported as
//     a WARNING only and is not a violation.
//   - .cts and .d.* files are not scanned.
//   - Wiring this script into CI is outside the scope of this script.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

interface Violation {
  readonly rule: string;
  readonly file: string;
  readonly line: number;
  readonly specifier: string;
}

interface ImportRef {
  readonly specifier: string;
  readonly line: number;
}

interface Extraction {
  readonly refs: ImportRef[];
  readonly unresolved: number[];
}

interface Warning {
  readonly file: string;
  readonly line: number;
}

const SOURCE_EXT = /\.(ts|tsx|mts|js|jsx|mjs|cjs)$/;
const DECL_EXT = /\.d\.[mc]?ts$/;
const WEB = "apps/web";

function parseRoot(argv: readonly string[]): string {
  const index = argv.indexOf("--root");
  if (index >= 0) {
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      process.stderr.write("--root requires a directory\n");
      process.exit(2);
    }
    return resolve(value);
  }
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

function posix(path: string): string {
  return path.split("\\").join("/");
}

function listDirs(dir: string): string[] {
  try {
    return readdirSync(dir).filter((name) => statSync(join(dir, name)).isDirectory());
  } catch {
    return [];
  }
}

function isSourceFile(name: string): boolean {
  return SOURCE_EXT.test(name) && !DECL_EXT.test(name);
}

function walk(dir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names.flatMap((name) => {
    if (name === "node_modules" || name === ".next") return [];
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return isSourceFile(name) ? [full] : [];
  });
}

// Source files directly under a directory (not recursive).
function topLevelSourceFiles(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((name) => isSourceFile(name) && statSync(join(dir, name)).isFile())
      .map((name) => join(dir, name));
  } catch {
    return [];
  }
}

function collectSourceFiles(root: string): string[] {
  const roots: string[] = [];
  const files: string[] = [];
  for (const app of listDirs(join(root, "apps"))) {
    roots.push(join(root, "apps", app, "app"), join(root, "apps", app, "src"));
    files.push(...topLevelSourceFiles(join(root, "apps", app)));
  }
  for (const pkg of listDirs(join(root, "packages"))) {
    roots.push(join(root, "packages", pkg, "src"));
  }
  return [...roots.flatMap(walk), ...files].sort();
}

function scriptKindOf(file: string): ts.ScriptKind {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (file.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (/\.(js|mjs|cjs)$/.test(file)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function extractImports(file: string, text: string): Extraction {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKindOf(file));
  const refs: ImportRef[] = [];
  const unresolved: number[] = [];
  const lineOf = (node: ts.Node): number =>
    sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const addLiteral = (literal: ts.Node): void => {
    if (ts.isStringLiteralLike(literal)) {
      refs.push({ specifier: literal.text, line: lineOf(literal) });
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
        addLiteral(node.moduleSpecifier);
      }
    } else if (ts.isImportEqualsDeclaration(node)) {
      const ref = node.moduleReference;
      if (ts.isExternalModuleReference(ref) && ts.isStringLiteral(ref.expression)) {
        addLiteral(ref.expression);
      }
    } else if (ts.isImportTypeNode(node)) {
      if (ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
        addLiteral(node.argument.literal);
      }
    } else if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
      if (isDynamicImport || (isRequire && node.arguments.length >= 1)) {
        const first = node.arguments[0];
        if (first !== undefined && ts.isStringLiteralLike(first)) {
          addLiteral(first);
        } else {
          unresolved.push(lineOf(node));
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { refs, unresolved };
}

// Returns the repo-relative path of the import target (extension stripped), or null for bare specifiers.
function resolveTarget(root: string, file: string, specifier: string): string | null {
  let absolute: string;
  if (specifier.startsWith("@/") && posix(relative(root, file)).startsWith(`${WEB}/`)) {
    absolute = join(root, WEB, "src", specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    absolute = resolve(dirname(file), specifier);
  } else {
    return null;
  }
  return posix(relative(root, absolute)).replace(/\.(tsx?|mts|m?js|json)$/, "");
}

function isUnder(path: string, dir: string): boolean {
  return path === dir || path.startsWith(`${dir}/`);
}

const PRESENTATION_ALLOWED_API = new Set([
  `${WEB}/src/api-client/port`,
  `${WEB}/src/api-client/types`,
]);
const PRESENTATION_ALLOWED_AUTH = new Set([`${WEB}/src/auth/port`, `${WEB}/src/auth/continuation`]);

function presentationViolates(target: string): boolean {
  if (isUnder(target, `${WEB}/src/features`) || isUnder(target, `${WEB}/src/mock`)) return true;
  if (isUnder(target, `${WEB}/src/api-client`)) return !PRESENTATION_ALLOWED_API.has(target);
  if (isUnder(target, `${WEB}/src/auth`)) return !PRESENTATION_ALLOWED_AUTH.has(target);
  return false;
}

function mockImportAllowed(rel: string, target: string): boolean {
  if (isUnder(rel, `${WEB}/src/mock`)) return true;
  if (rel === `${WEB}/src/api-client/index.ts` || rel === `${WEB}/src/auth/index.ts`) return true;
  if (isUnder(rel, `${WEB}/app/dev`)) return true;
  // DEV-WEB-012: the root layout may only mount the MockModeBadge.
  return rel === `${WEB}/app/layout.tsx` && target === `${WEB}/src/mock/dev-ui/mock-mode-badge`;
}

function isWebDbBare(specifier: string): boolean {
  return /^(drizzle-orm|pg|@off-r39x\/db)(\/|$)/.test(specifier);
}

function classify(root: string, file: string, ref: ImportRef): string | null {
  const rel = posix(relative(root, file));
  const { specifier } = ref;
  const target = resolveTarget(root, file, specifier);

  if (target !== null && isUnder(target, "tests")) return "production-no-tests";
  if (target === null && /^@off-r39x\/tests(\/|$)/.test(specifier)) return "production-no-tests";

  if (isUnder(rel, "packages/domain/src") && target === null) return "domain-no-external";

  if (isUnder(rel, WEB)) {
    if ((target !== null && isUnder(target, "packages/db")) || isWebDbBare(specifier)) {
      return "web-no-db";
    }
  }

  if (target !== null && isUnder(target, `${WEB}/src/mock`)) {
    if (isUnder(rel, `${WEB}/src/presentation`)) return "presentation-no-upward";
    if (isUnder(rel, `${WEB}/src/features`)) return "features-no-mock";
    return mockImportAllowed(rel, target) ? null : "mock-allowlist";
  }

  if (target !== null && isUnder(rel, `${WEB}/src/presentation`) && presentationViolates(target)) {
    return "presentation-no-upward";
  }
  return null;
}

interface WorkspacePackage {
  readonly name: string;
  readonly manifest: string;
  readonly deps: readonly string[];
}

const DEFAULT_WORKSPACE_PATTERNS = ["apps/*", "packages/*", "tests"];
const EXACT_DIR = /^[A-Za-z0-9._@-]+(\/[A-Za-z0-9._@-]+)*$/;

function failWorkspace(reason: string, detail: string): never {
  process.stderr.write(`ERROR pnpm-workspace.yaml: ${reason} ${detail}\n`);
  process.exit(2);
}

function isSafeDir(path: string): boolean {
  return EXACT_DIR.test(path) && path.split("/").every((seg) => seg !== "." && seg !== "..");
}

// Minimal parser for the `packages:` list of pnpm-workspace.yaml. Fails closed (exit 2) on anything else.
function readWorkspacePatterns(root: string): string[] {
  const file = join(root, "pnpm-workspace.yaml");
  if (!existsSync(file)) return DEFAULT_WORKSPACE_PATTERNS;
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return failWorkspace("unreadable file", file);
  }
  const patterns: string[] = [];
  let found = false;
  let inPackages = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/(^|\s)#.*$/, "");
    if (line.trim() === "") continue;
    if (!/^[\s-]/.test(line)) {
      inPackages = false;
      if (/^packages\s*:/.test(line)) {
        if (!/^packages\s*:\s*$/.test(line)) {
          return failWorkspace("unsupported syntax", line.trim());
        }
        found = true;
        inPackages = true;
      }
      continue;
    }
    if (!inPackages) continue;
    const item = /^\s*-\s+(.+?)\s*$/.exec(line)?.[1];
    if (item === undefined) return failWorkspace("unsupported syntax", line.trim());
    const unquoted = item.replace(/^(["'])(.*)\1$/, "$2");
    const pattern = unquoted.replace(/^\.\//, "").replace(/\/$/, "");
    const base = pattern.endsWith("/*") ? pattern.slice(0, -2) : pattern;
    if (!isSafeDir(base)) return failWorkspace("unsupported pattern", pattern);
    patterns.push(pattern);
  }
  if (!found) return failWorkspace("missing packages", file);
  return patterns;
}

function readWorkspacePackages(root: string, patterns: readonly string[]): WorkspacePackage[] {
  const manifests = [
    ...new Set(
      patterns.flatMap((pattern) =>
        pattern.endsWith("/*")
          ? listDirs(join(root, pattern.slice(0, -2))).map((d) =>
              join(root, pattern.slice(0, -2), d, "package.json"),
            )
          : [join(root, pattern, "package.json")],
      ),
    ),
  ];
  const packages: WorkspacePackage[] = [];
  for (const manifest of manifests) {
    let json: unknown;
    try {
      json = JSON.parse(readFileSync(manifest, "utf8"));
    } catch {
      continue;
    }
    if (typeof json !== "object" || json === null) continue;
    const record = json as Record<string, unknown>;
    if (typeof record.name !== "string") continue;
    const deps = [
      "dependencies",
      "devDependencies",
      "peerDependencies",
      "optionalDependencies",
    ].flatMap((key) => {
      const section = record[key];
      return typeof section === "object" && section !== null ? Object.keys(section) : [];
    });
    packages.push({ name: record.name, manifest: posix(relative(root, manifest)), deps });
  }
  return packages;
}

function findCycles(packages: readonly WorkspacePackage[]): Violation[] {
  const byName = new Map(packages.map((p) => [p.name, p]));
  const state = new Map<string, "visiting" | "done">();
  const stack: string[] = [];
  const seen = new Set<string>();
  const violations: Violation[] = [];

  const visit = (name: string): void => {
    state.set(name, "visiting");
    stack.push(name);
    for (const dep of byName.get(name)?.deps ?? []) {
      if (!byName.has(dep)) continue;
      const depState = state.get(dep);
      if (depState === "visiting") {
        const cycle = [...stack.slice(stack.indexOf(dep)), dep];
        const key = [...cycle.slice(0, -1)].sort().join("|");
        if (!seen.has(key)) {
          seen.add(key);
          const first = byName.get(cycle[0] ?? dep);
          violations.push({
            rule: "workspace-cycle",
            file: first?.manifest ?? "",
            line: 0,
            specifier: cycle.join("->"),
          });
        }
      } else if (depState === undefined) {
        visit(dep);
      }
    }
    stack.pop();
    state.set(name, "done");
  };

  for (const pkg of packages) {
    if (!state.has(pkg.name)) visit(pkg.name);
  }
  return violations;
}

function main(): void {
  const root = parseRoot(process.argv.slice(2));
  const patterns = readWorkspacePatterns(root);
  const packages = readWorkspacePackages(root, patterns);
  const violations: Violation[] = [];
  const warnings: Warning[] = [];

  for (const file of collectSourceFiles(root)) {
    const rel = posix(relative(root, file));
    const { refs, unresolved } = extractImports(file, readFileSync(file, "utf8"));
    for (const ref of refs) {
      const rule = classify(root, file, ref);
      if (rule !== null) {
        violations.push({ rule, file: rel, line: ref.line, specifier: ref.specifier });
      }
    }
    for (const line of unresolved) warnings.push({ file: rel, line });
  }
  violations.push(...findCycles(packages));

  for (const w of warnings) {
    process.stdout.write(`WARNING unresolved-dynamic-import ${w.file}:${w.line}\n`);
  }
  if (violations.length === 0) {
    process.stdout.write("OK import boundaries\n");
    return;
  }
  for (const v of violations) {
    process.stdout.write(`VIOLATION ${v.rule} ${v.file}:${v.line} ${v.specifier}\n`);
  }
  process.exitCode = 1;
}

main();
