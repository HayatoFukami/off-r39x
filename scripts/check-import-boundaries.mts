// DEV-DEP-006: mechanical gate for forbidden import edges.
// Runs under plain `node` (type stripping): erasable TypeScript syntax only, node: built-ins only.
// Usage: node scripts/check-import-boundaries.mts [--root <dir>]
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

const SOURCE_EXT = /\.(ts|tsx|mts)$/;
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
    return SOURCE_EXT.test(name) && !name.endsWith(".d.ts") ? [full] : [];
  });
}

function collectSourceFiles(root: string): string[] {
  const roots: string[] = [];
  for (const app of listDirs(join(root, "apps"))) {
    roots.push(join(root, "apps", app, "app"), join(root, "apps", app, "src"));
  }
  for (const pkg of listDirs(join(root, "packages"))) {
    roots.push(join(root, "packages", pkg, "src"));
  }
  return roots.flatMap(walk).sort();
}

// Replaces comments with spaces (newlines kept) so line numbers stay stable.
function stripComments(source: string): string {
  let out = "";
  let i = 0;
  let quote: string | null = null;
  while (i < source.length) {
    const ch = source.charAt(i);
    const next = source.charAt(i + 1);
    if (quote !== null) {
      out += ch;
      if (ch === "\\") {
        out += next;
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i += 1;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      out += ch;
      i += 1;
    } else if (ch === "/" && next === "/") {
      while (i < source.length && source.charAt(i) !== "\n") {
        out += " ";
        i += 1;
      }
    } else if (ch === "/" && next === "*") {
      out += "  ";
      i += 2;
      while (i < source.length && !(source.charAt(i) === "*" && source.charAt(i + 1) === "/")) {
        out += source.charAt(i) === "\n" ? "\n" : " ";
        i += 1;
      }
      out += "  ";
      i += 2;
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}

function extractImports(source: string): ImportRef[] {
  const text = stripComments(source);
  const patterns = [
    /\b(?:import|export)\b[^;'"`]*?\bfrom\s*(["'])([^"'\n]+)\1/g,
    /\bimport\s*(["'])([^"'\n]+)\1/g,
    /\bimport\s*\(\s*(["'])([^"'\n]+)\1\s*\)/g,
  ];
  const found = new Map<number, ImportRef>();
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const specifier = match[2];
      if (specifier === undefined) continue;
      const at = match.index + match[0].lastIndexOf(specifier);
      const line = text.slice(0, at).split("\n").length;
      found.set(at, { specifier, line });
    }
  }
  return [...found.values()];
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

function readWorkspacePackages(root: string): WorkspacePackage[] {
  const manifests = [
    ...listDirs(join(root, "apps")).map((d) => join(root, "apps", d, "package.json")),
    ...listDirs(join(root, "packages")).map((d) => join(root, "packages", d, "package.json")),
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
  const violations: Violation[] = [];

  for (const file of collectSourceFiles(root)) {
    const refs = extractImports(readFileSync(file, "utf8"));
    for (const ref of refs) {
      const rule = classify(root, file, ref);
      if (rule !== null) {
        violations.push({
          rule,
          file: posix(relative(root, file)),
          line: ref.line,
          specifier: ref.specifier,
        });
      }
    }
  }
  violations.push(...findCycles(readWorkspacePackages(root)));

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
