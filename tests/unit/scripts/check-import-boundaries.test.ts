import { afterEach, describe, expect, it } from "vitest";
import {
  type CheckResult,
  cleanFiles,
  createFixtureRoot,
  type FileMap,
  importAtLine,
  packageJson,
  REPO_ROOT,
  removeFixtureRoot,
  runBoundaryCheck,
  withFiles,
} from "../../harness/fixture-repo.ts";

// DEV-DEP-006: scripts/check-import-boundaries.mts is the mechanical gate for the forbidden edges.
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

describe("TC-DEV-DEP-006-001 clean fixture", () => {
  it("accepts a tree that only uses allowed edges", () => {
    expectClean(check(cleanFiles()));
  });

  it("ignores non-ts files and directories outside the scanned roots", () => {
    const result = check(
      withFiles({
        "apps/web/src/presentation/components/notes.md": 'import "@/mock/backend/db";\n',
        "apps/web/scripts/tool.ts": 'import "@/mock/backend/db";\n',
        "apps/web/scripts/tool.mjs": 'import "../src/mock/backend/db";\n',
        "apps/web/next-env.d.ts": 'import "@/mock/backend/db";\n',
        "apps/web/src/types/ambient.d.mts": 'import "@/mock/backend/db";\n',
      }),
    );
    expectClean(result);
    expect(result.stdout).not.toMatch(/^WARNING /m);
  });

  it("accepts import type and re-export forms of allowed edges", () => {
    expectClean(
      check(
        withFiles({
          "apps/web/src/features/cart/reexport.ts": [
            'export * from "../../presentation/components/card";',
            'export type { ApiPort } from "@/api-client/port";',
            "",
          ].join("\n"),
        }),
      ),
    );
  });
});

describe("TC-DEV-DEP-006-002 real repository root", () => {
  it("passes for the repository (explicit --root)", () => {
    const result = runBoundaryCheck(["--root", REPO_ROOT]);
    expect(result.violations).toEqual([]);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^OK/m);
    expect(result.stdout).not.toMatch(/^WARNING /m);
  });

  it("defaults --root to the parent of scripts/ regardless of cwd", async () => {
    const { tmpdir } = await import("node:os");
    const result = runBoundaryCheck([], tmpdir());
    expect(result.violations).toEqual([]);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^OK/m);
    expect(result.stdout).not.toMatch(/^WARNING /m);
  });
});

describe("TC-DEV-DEP-006-003 presentation-no-upward", () => {
  const file = "apps/web/src/presentation/components/bad.tsx";

  it.each([
    "../../features/cart/cart-store",
    "@/features/cart/cart-store",
    "@/api-client/index",
    "@/api-client/provider",
    "../../api-client/provider",
    "@/auth/index",
    "@/auth/session-provider",
    "@/mock/dev-ui/scenario-panel",
  ])("rejects %s", (specifier) => {
    const result = check(withFiles({ [file]: imp(specifier) }));
    expectViolation(result, "presentation-no-upward", file, LINE, specifier);
  });

  it("allows ports, view-model types, domain, packages and sibling presentation files", () => {
    const result = check(
      withFiles({
        [file]: [
          'import "@/api-client/port";',
          'import "@/api-client/types";',
          'import "@/auth/port";',
          'import "@/auth/continuation";',
          'import "../../api-client/port";',
          'import "@off-r39x/domain";',
          'import "react";',
          'import "./card";',
          'import "@/presentation/components/card";',
          "export const ok = 1;",
          "",
        ].join("\n"),
      }),
    );
    expectClean(result);
  });
});

describe("TC-DEV-DEP-006-004 features-no-mock", () => {
  const file = "apps/web/src/features/cart/bad.ts";

  it.each(["@/mock/backend/db", "../../mock/backend/db"])("rejects %s", (specifier) => {
    const result = check(withFiles({ [file]: imp(specifier) }));
    expectViolation(result, "features-no-mock", file, LINE, specifier);
  });

  it("allows features to import presentation, ports, provider and other features", () => {
    const result = check(
      withFiles({
        "apps/web/src/features/cart/ok.ts": [
          'import "@/presentation/components/card";',
          'import "../../presentation/components/card";',
          'import "@/api-client/port";',
          'import "@/api-client/provider";',
          'import "@/auth/port";',
          'import "../public/other";',
          "export const ok = 1;",
          "",
        ].join("\n"),
        "apps/web/src/features/public/other.ts": "export const other = 1;\n",
      }),
    );
    expectClean(result);
  });
});

describe("TC-DEV-DEP-004-001 domain-no-external", () => {
  const file = "packages/domain/src/bad.ts";

  it.each(["zod", "node:fs", "@off-r39x/web", "drizzle-orm", "react"])(
    "rejects %s",
    (specifier) => {
      const result = check(withFiles({ [file]: imp(specifier) }));
      expectViolation(result, "domain-no-external", file, LINE, specifier);
    },
  );

  it("allows relative imports only", () => {
    const result = check(
      withFiles({
        "packages/domain/src/nested/ok.ts": [
          'import "./sibling";',
          'import "../states";',
          "export const ok = 1;",
          "",
        ].join("\n"),
        "packages/domain/src/nested/sibling.ts": "export const s = 1;\n",
      }),
    );
    expectClean(result);
  });
});

describe("TC-DEV-REP-004-001 production-no-tests", () => {
  it.each([
    ["apps/web/src/lib/bad.ts", "../../../../tests/harness/clock"],
    ["apps/web/app/bad.ts", "../../../tests/fixtures/x"],
    ["apps/web/src/routes/bad.ts", "../../../../tests/fixtures/x"],
    ["packages/domain/src/bad.ts", "../../../tests/fixtures/x"],
  ])("rejects %s importing %s", (file, specifier) => {
    const result = check(
      withFiles({
        [file]: imp(specifier),
        "tests/harness/clock.ts": "export const c = 1;\n",
        "tests/fixtures/x.ts": "export const x = 1;\n",
      }),
    );
    expectViolation(result, "production-no-tests", file, LINE, specifier);
  });

  it("allows a sibling directory that merely has 'tests' in its name", () => {
    const result = check(
      withFiles({
        "apps/web/src/lib/ok.ts": [
          'import "./tests/helper";',
          'import "../tests-helper/z";',
          "export const ok = 1;",
          "",
        ].join("\n"),
        "apps/web/src/lib/tests/helper.ts": "export const h = 1;\n",
        "apps/web/src/tests-helper/z.ts": "export const z = 1;\n",
      }),
    );
    expectClean(result);
  });
});

describe("TC-DEV-DEP-002-001 web-no-db", () => {
  const file = "apps/web/src/lib/db.ts";

  it.each(["drizzle-orm", "drizzle-orm/pg-core", "pg", "@off-r39x/db", "@off-r39x/db/schema"])(
    "rejects %s",
    (specifier) => {
      const result = check(withFiles({ [file]: imp(specifier) }));
      expectViolation(result, "web-no-db", file, LINE, specifier);
    },
  );

  it("rejects a relative import that resolves into packages/db", () => {
    const specifier = "../../../../packages/db/src/index";
    const result = check(
      withFiles({
        [file]: imp(specifier),
        "packages/db/package.json": packageJson("@off-r39x/db"),
        "packages/db/src/index.ts": "export const db = 1;\n",
      }),
    );
    expectViolation(result, "web-no-db", file, LINE, specifier);
  });

  it("allows the domain package and unrelated bare packages", () => {
    const result = check(
      withFiles({
        "apps/web/src/lib/ok.ts":
          'import "@off-r39x/domain";\nimport "zod";\nexport const ok = 1;\n',
      }),
    );
    expectClean(result);
  });
});

describe("TC-DEV-DEP-005-001 workspace-cycle", () => {
  const cycleLine = /^VIOLATION workspace-cycle (\S+package\.json):0 (\S+)$/;

  function cycleViolations(result: CheckResult): { file: string; spec: string }[] {
    return result.violations.flatMap((line) => {
      const m = cycleLine.exec(line);
      return m ? [{ file: m[1] as string, spec: m[2] as string }] : [];
    });
  }

  it("reports a two-package cycle with line 0 and the cycle path", () => {
    const result = check(
      withFiles({
        "packages/a/package.json": packageJson("@off-r39x/a", ["@off-r39x/b"]),
        "packages/b/package.json": packageJson("@off-r39x/b", ["@off-r39x/a"]),
        "packages/a/src/index.ts": "export const a = 1;\n",
        "packages/b/src/index.ts": "export const b = 1;\n",
      }),
    );
    expect(result.status).toBe(1);
    const found = cycleViolations(result);
    expect(found.length).toBeGreaterThanOrEqual(1);
    const parts = (found[0] as { spec: string }).spec.split("->");
    expect(parts[0]).toBe(parts[parts.length - 1]);
    expect(new Set(parts)).toEqual(new Set(["@off-r39x/a", "@off-r39x/b"]));
  });

  it("reports a three-package cycle", () => {
    const result = check(
      withFiles({
        "packages/a/package.json": packageJson("@off-r39x/a", ["@off-r39x/b"]),
        "packages/b/package.json": packageJson("@off-r39x/b", ["@off-r39x/c"]),
        "packages/c/package.json": packageJson("@off-r39x/c", ["@off-r39x/a"]),
      }),
    );
    expect(result.status).toBe(1);
    const found = cycleViolations(result);
    expect(found.length).toBeGreaterThanOrEqual(1);
    const parts = (found[0] as { spec: string }).spec.split("->");
    expect(parts[0]).toBe(parts[parts.length - 1]);
    expect(new Set(parts)).toEqual(new Set(["@off-r39x/a", "@off-r39x/b", "@off-r39x/c"]));
  });

  it("allows an acyclic diamond of workspace dependencies", () => {
    const result = check(
      withFiles({
        "packages/a/package.json": packageJson("@off-r39x/a", ["@off-r39x/b", "@off-r39x/c"]),
        "packages/b/package.json": packageJson("@off-r39x/b", ["@off-r39x/d"]),
        "packages/c/package.json": packageJson("@off-r39x/c", ["@off-r39x/d"]),
        "packages/d/package.json": packageJson("@off-r39x/d"),
      }),
    );
    expectClean(result);
  });
});

describe("TC-DEV-DEP-005-002 workspace enumeration from pnpm-workspace.yaml includes tests", () => {
  const cycleLine = /^VIOLATION workspace-cycle (\S+package\.json):0 (\S+)$/;

  function expectCycleOver(result: CheckResult, expected: readonly string[]): void {
    expect(result.status).toBe(1);
    const specs = result.violations.flatMap((line) => {
      const m = cycleLine.exec(line);
      return m ? [m[2] as string] : [];
    });
    expect(specs.length).toBeGreaterThanOrEqual(1);
    const parts = (specs[0] as string).split("->");
    expect(parts[0]).toBe(parts[parts.length - 1]);
    expect(new Set(parts)).toEqual(new Set(expected));
  }

  const testsDependsOnDomain = {
    "tests/package.json": packageJson("@off-r39x/tests", ["@off-r39x/domain"]),
  };
  const domainDependsOnTests = {
    "packages/domain/package.json": packageJson("@off-r39x/domain", ["@off-r39x/tests"]),
  };

  it("detects a cycle through tests with pnpm-workspace.yaml present", () => {
    const result = check(
      withFiles({
        "pnpm-workspace.yaml":
          "packages:\n  - apps/*\n  - packages/*\n  - tests\nallowBuilds:\n  esbuild: false\n",
        ...testsDependsOnDomain,
        ...domainDependsOnTests,
      }),
    );
    expectCycleOver(result, ["@off-r39x/domain", "@off-r39x/tests"]);
  });

  it("falls back to apps/*, packages/*, tests when pnpm-workspace.yaml is missing", () => {
    const result = check(withFiles({ ...testsDependsOnDomain, ...domainDependsOnTests }));
    expectCycleOver(result, ["@off-r39x/domain", "@off-r39x/tests"]);
  });

  it("parses CRLF, comments and quoted entries, including an exact extra directory", () => {
    const result = check(
      withFiles({
        "pnpm-workspace.yaml":
          "packages:\r\n  # workspaces\r\n  - apps/*\r\n  - 'packages/*'\r\n  - \"tools/gen\" # extra\r\n",
        "tools/gen/package.json": packageJson("@off-r39x/gen", ["@off-r39x/domain"]),
        "packages/domain/package.json": packageJson("@off-r39x/domain", ["@off-r39x/gen"]),
      }),
    );
    expectCycleOver(result, ["@off-r39x/domain", "@off-r39x/gen"]);
  });

  it("accepts the acyclic tests -> domain graph", () => {
    expectClean(
      check(
        withFiles({
          "pnpm-workspace.yaml": "packages:\n  - apps/*\n  - packages/*\n  - tests\n",
          ...testsDependsOnDomain,
        }),
      ),
    );
  });

  it.each([
    ["recursive glob", 'packages:\n  - "packages/**"\n'],
    ["negation", 'packages:\n  - apps/*\n  - "!apps/legacy"\n'],
  ])("exits 2 with a pnpm-workspace.yaml error for an unsupported pattern (%s)", (_name, yaml) => {
    const result = check(withFiles({ "pnpm-workspace.yaml": yaml }));
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/pnpm-workspace\.yaml/);
    expect(result.stdout).not.toMatch(/^(OK|VIOLATION|WARNING)/m);
  });
});
