import { afterEach, describe, expect, it } from "vitest";
import {
  type CheckResult,
  createFixtureRoot,
  type FileMap,
  importAtLine,
  removeFixtureRoot,
  runBoundaryCheck,
  withFiles,
} from "../../harness/fixture-repo.ts";

// DEV-DEP-006: scripts/check-import-boundaries.mts is the mechanical gate for the forbidden edges.
// Split from check-import-boundaries.test.ts: one file of ~100 spawn-per-case tests ran about 60 s in one worker,
// the limit of Vitest's worker RPC ("Timeout calling onTaskUpdate"). The cases are unchanged.
// Each test builds a throwaway repository in os.tmpdir() and runs the script with --root.

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) removeFixtureRoot(root);
});

function check(files: FileMap): CheckResult {
  const root = createFixtureRoot(files);
  roots.push(root);
  return runBoundaryCheck(["--root", root]);
}

function expectClean(result: CheckResult): void {
  expect(result.violations).toEqual([]);
  expect(result.status).toBe(0);
  expect(result.stdout).toMatch(/^OK/m);
}

function expectViolation(
  result: CheckResult,
  rule: string,
  file: string,
  line: number,
  specifier: string,
): void {
  expect(result.violations).toContain(`VIOLATION ${rule} ${file}:${line} ${specifier}`);
  expect(result.status).toBe(1);
}

const LINE = 3;
const imp = (specifier: string): string => importAtLine(LINE, `import "${specifier}";`);

describe("TC-DEV-WEB-012-001 mock-allowlist", () => {
  it.each([
    ["apps/web/src/other/x.ts", "@/mock/backend/db"],
    ["apps/web/src/api-client/provider.tsx", "../mock/backend/db"],
    ["apps/web/src/auth/session-provider.tsx", "@/mock/backend/mock-auth"],
    ["apps/web/src/config/site.ts", "../mock/backend/db"],
    ["apps/web/app/page.tsx", "@/mock/dev-ui/mock-mode-badge"],
    ["apps/web/app/(public)/cart/page.tsx", "@/mock/backend/db"],
    ["apps/web/app/not-found.tsx", "../src/mock/backend/db"],
    ["apps/web/next.config.ts", "./src/mock/backend/db"],
    ["apps/web/next.config.ts", "@/mock/backend/db"],
    // React Router entry points: only the root layout (the badge) and the dev routes may import mock code.
    ["apps/web/src/routes/root-layout.tsx", "@/mock/backend/db"],
    ["apps/web/src/routes/root-layout.tsx", "@/mock/dev-ui/scenario-panel"],
    ["apps/web/src/routes/root-error.tsx", "@/mock/dev-ui/mock-mode-badge"],
    ["apps/web/src/routes/route-table.tsx", "@/mock/dev-ui/scenario-panel"],
    ["apps/web/src/routes/public/cart.tsx", "@/mock/dev-ui/mock-mode-badge"],
    ["apps/web/src/routes/self/mypage-overview.tsx", "@/mock/backend/db"],
    ["apps/web/src/main.tsx", "@/mock/dev-ui/mock-mode-badge"],
    ["apps/web/src/main.tsx", "./mock/backend/db"],
    ["apps/web/vite.config.ts", "./src/mock/backend/db"],
    ["apps/web/vite.config.ts", "@/mock/backend/db"],
    // The Next.js allowances are withdrawn: app/dev/** and app/layout.tsx are no longer special.
    ["apps/web/app/dev/layout.tsx", "@/mock/dev-ui/mock-mode-badge"],
    ["apps/web/app/dev/scenarios/page.tsx", "@/mock/dev-ui/scenario-panel"],
    ["apps/web/app/layout.tsx", "@/mock/dev-ui/mock-mode-badge"],
  ])("rejects %s importing %s", (file, specifier) => {
    const result = check(withFiles({ [file]: imp(specifier) }));
    expectViolation(result, "mock-allowlist", file, LINE, specifier);
  });

  it.each([
    ["apps/web/src/api-client/index.ts", "@/mock/backend/mock-api"],
    ["apps/web/src/auth/index.ts", "../mock/backend/mock-auth"],
    ["apps/web/src/routes/dev/dev-layout.tsx", "@/mock/dev-ui/mock-mode-badge"],
    ["apps/web/src/routes/dev/scenarios.tsx", "@/mock/dev-ui/scenario-panel"],
    ["apps/web/src/routes/dev/mock-checkout.tsx", "@/mock/dev-ui/mock-checkout-screen"],
    ["apps/web/src/routes/dev/nested/extra.tsx", "@/mock/dev-ui/scenario-panel"],
    ["apps/web/src/routes/root-layout.tsx", "@/mock/dev-ui/mock-mode-badge"],
    ["apps/web/src/mock/backend/extra.ts", "./db"],
    ["apps/web/src/mock/dev-ui/extra.tsx", "../backend/db"],
    ["apps/web/src/mock/dev-ui/extra2.tsx", "@/mock/backend/db"],
  ])("allows %s importing %s", (file, specifier) => {
    expectClean(check(withFiles({ [file]: imp(specifier) })));
  });
});

describe("TC-DEV-DEP-006-005 AST-recognised specifier forms", () => {
  const featureFile = "apps/web/src/features/cart/bad.ts";

  it.each([
    ["template-literal dynamic import", "void import(`@/mock/backend/db`);"],
    [
      "dynamic import with import attributes",
      'void import("@/mock/backend/db", { with: { type: "json" } });',
    ],
  ])("rejects %s in features", (_name, statement) => {
    const result = check(withFiles({ [featureFile]: importAtLine(LINE, statement) }));
    expectViolation(result, "features-no-mock", featureFile, LINE, "@/mock/backend/db");
  });

  it("reports the line of the specifier for a multi-line dynamic import", () => {
    const source = "// filler 1\nvoid import(\n  `@/mock/backend/db`\n);\nexport const used = 1;\n";
    const result = check(withFiles({ [featureFile]: source }));
    expectViolation(result, "features-no-mock", featureFile, LINE, "@/mock/backend/db");
  });

  it.each([
    [
      "apps/web/src/other/x.ts",
      'const db = require("@/mock/backend/db");',
      "mock-allowlist",
      "@/mock/backend/db",
    ],
    [
      "apps/web/src/other/x.ts",
      'import db = require("@/mock/backend/db");',
      "mock-allowlist",
      "@/mock/backend/db",
    ],
    [
      "apps/web/src/presentation/components/bad.tsx",
      'type T = typeof import("@/features/cart/cart-store");',
      "presentation-no-upward",
      "@/features/cart/cart-store",
    ],
    [
      "packages/domain/src/bad.ts",
      'const fs = require("node:fs");',
      "domain-no-external",
      "node:fs",
    ],
  ])("rejects %s with %s", (file, statement, rule, specifier) => {
    const result = check(withFiles({ [file]: importAtLine(LINE, statement) }));
    expectViolation(result, rule, file, LINE, specifier);
  });

  it.each([
    ["line comment", "// void import(`@/mock/backend/db`);", "apps/web/src/features/cart/ok.ts"],
    ["block comment", '/* import "@/mock/backend/db"; */', "apps/web/src/features/cart/ok.ts"],
    [
      "string literal",
      "const s = 'import \"@/mock/backend/db\"';",
      "apps/web/src/features/cart/ok.ts",
    ],
    [
      "JSX text",
      'export const C = () => <p>import("@/mock/backend/db")</p>;',
      "apps/web/src/features/cart/ok.tsx",
    ],
    [
      "allowed edge via template literal",
      "void import(`@/api-client/port`);",
      "apps/web/src/features/cart/ok.ts",
    ],
  ])("does not flag %s", (_name, statement, file) => {
    const result = check(withFiles({ [file]: importAtLine(LINE, statement) }));
    expectClean(result);
    expect(result.stdout).not.toMatch(/^WARNING /m);
  });
});

describe("TC-DEV-DEP-006-006 unresolvable dynamic import is a warning, not a violation", () => {
  const lazy = "apps/web/src/features/cart/lazy.ts";
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the fixture source must contain a literal interpolation
  const lazyTemplate = "export const load = (n: string) => import(`@/mock/${n}`);";

  function expectWarningThenOk(result: CheckResult, warning: string): void {
    expectClean(result);
    const lines = result.stdout.split(/\r?\n/);
    const warnAt = lines.indexOf(warning);
    const okAt = lines.findIndex((l) => l.startsWith("OK"));
    expect(warnAt).toBeGreaterThanOrEqual(0);
    expect(warnAt).toBeLessThan(okAt);
  }

  it("warns for an interpolated template literal and still exits 0", () => {
    const result = check(withFiles({ [lazy]: importAtLine(LINE, lazyTemplate) }));
    expectWarningThenOk(result, `WARNING unresolved-dynamic-import ${lazy}:${LINE}`);
  });

  it("warns for a non-literal import(expr)", () => {
    const result = check(
      withFiles({ [lazy]: importAtLine(LINE, "export const load = (p: string) => import(p);") }),
    );
    expectWarningThenOk(result, `WARNING unresolved-dynamic-import ${lazy}:${LINE}`);
  });

  it("warns for a non-literal require(expr) in a .cjs file", () => {
    const file = "apps/web/src/lib/dyn.cjs";
    const result = check(
      withFiles({ [file]: importAtLine(LINE, "const m = require(process.env.X);") }),
    );
    expectWarningThenOk(result, `WARNING unresolved-dynamic-import ${file}:${LINE}`);
  });

  it("keeps the warning and reports real violations with exit 1 and no OK line", () => {
    const result = check(
      withFiles({
        [lazy]: importAtLine(LINE, lazyTemplate),
        "apps/web/src/other/x.ts": imp("@/mock/backend/db"),
      }),
    );
    expectViolation(result, "mock-allowlist", "apps/web/src/other/x.ts", LINE, "@/mock/backend/db");
    expect(result.stdout.split(/\r?\n/)).toContain(
      `WARNING unresolved-dynamic-import ${lazy}:${LINE}`,
    );
    expect(result.stdout).not.toMatch(/^OK/m);
  });
});

describe("TC-DEV-DEP-006-007 JS-family files are scanned", () => {
  it.each([
    [
      "apps/web/src/presentation/components/legacy.js",
      'import "@/mock/backend/db";',
      "presentation-no-upward",
      "@/mock/backend/db",
    ],
    [
      "apps/web/src/features/cart/widget.jsx",
      'import "@/mock/backend/db";',
      "features-no-mock",
      "@/mock/backend/db",
    ],
    [
      "apps/web/app/x.mjs",
      'import "../src/mock/backend/db";',
      "mock-allowlist",
      "../src/mock/backend/db",
    ],
    [
      "apps/web/next.config.mjs",
      'import "./src/mock/backend/db";',
      "mock-allowlist",
      "./src/mock/backend/db",
    ],
    ["apps/web/src/lib/old.cjs", 'const pg = require("pg");', "web-no-db", "pg"],
  ])("rejects %s", (file, statement, rule, specifier) => {
    const result = check(withFiles({ [file]: importAtLine(LINE, statement) }));
    expectViolation(result, rule, file, LINE, specifier);
  });
});
