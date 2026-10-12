import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanTraceFiles,
  createTree,
  e2eSpecSource,
  type FileMap,
  ID_E2E,
  ID_UNIT,
  manifestCase,
  manifestJson,
  mapEntry,
  mapJson,
  REPO_ROOT,
  type RunResult,
  removeTree,
  runScript,
  specDocs,
  unitTestSource,
  violationsOf,
  withoutFiles,
  withTrace,
} from "../../harness/script-fixtures.ts";

// scripts/validate-traceability.mts (SPEC-190 section 37 "traceability manifest validation", DEV-TRC-001 .. 003,
// SPEC-170 section 76 / TST-TRC-001 / TST-TRC-002 / TST-TRC-004 / TST-E2E-004).
// Contract: tests/contracts/s9-finalize.md section 2. Each test builds a throwaway repository in os.tmpdir()
// and runs the script with --root. Violation line format: `VIOLATION <check-id> <subject>[ <detail>]`.

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) removeTree(root);
});

function check(files: FileMap, extraArgs: readonly string[] = []): RunResult {
  const root = createTree(files, "r39x-trace-");
  roots.push(root);
  return runScript("validate-traceability.mts", ["--root", root, ...extraArgs]);
}

/** True when some VIOLATION line is `VIOLATION <check> <subject...>` (the subject may be followed by detail). */
function hasViolation(result: RunResult, checkId: string, subject: string): boolean {
  return violationsOf(result).some(
    (line) =>
      line === `VIOLATION ${checkId} ${subject}` ||
      line.startsWith(`VIOLATION ${checkId} ${subject} `),
  );
}

function expectViolation(result: RunResult, checkId: string, subject: string): void {
  expect(violationsOf(result), `${checkId} ${subject}`).not.toEqual([]);
  expect(hasViolation(result, checkId, subject), `${checkId} ${subject}\n${result.stdout}`).toBe(
    true,
  );
  expect(result.status).toBe(1);
  expect(result.stdout).toMatch(/^FAIL validate-traceability violations=\d+$/m);
  expect(result.stdout).not.toMatch(/^OK /m);
}

function expectClean(result: RunResult): void {
  expect(violationsOf(result)).toEqual([]);
  expect(result.status).toBe(0);
  expect(result.stdout).toMatch(/^OK validate-traceability cases=\d+ rules=\d+$/m);
}

const MANIFEST = "tests/traceability/test-manifest.json";
const MAP = "traceability/rule-code-map.json";

describe("TC-DEV-TRC-001-001 a consistent tree passes", () => {
  it("exits 0 with one OK line (cases and rules counted) and no VIOLATION line", () => {
    const result = check(cleanTraceFiles());
    expectClean(result);
    expect(result.stdout).toMatch(/^OK validate-traceability cases=2 rules=2$/m);
  });

  it("is read-only: it does not change any file of the tree", () => {
    const root = createTree(cleanTraceFiles(), "r39x-trace-");
    roots.push(root);
    const snapshot = (dir: string): Record<string, string> => {
      const out: Record<string, string> = {};
      const walk = (d: string): void => {
        for (const name of readdirSync(d)) {
          const full = join(d, name);
          if (statSync(full).isDirectory()) walk(full);
          else out[full] = readFileSync(full, "utf8");
        }
      };
      walk(dir);
      return out;
    };
    const before = snapshot(root);
    const result = runScript("validate-traceability.mts", ["--root", root]);
    expect(result.status).toBe(0);
    expect(snapshot(root)).toEqual(before);
  });
});

describe("TC-DEV-TRC-001-002 the real repository is consistent (default root and explicit --root)", () => {
  it("exits 0 for the repository when run without arguments from the repository root", () => {
    const result = runScript("validate-traceability.mts", []);
    expect(violationsOf(result)).toEqual([]);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^OK validate-traceability cases=\d+ rules=\d+$/m);
  });

  it("gives the same verdict with --root, from another working directory", () => {
    const result = runScript("validate-traceability.mts", ["--root", REPO_ROOT], {
      cwd: join(REPO_ROOT, "tests"),
    });
    expect(violationsOf(result)).toEqual([]);
    expect(result.status).toBe(0);
  });
});

describe("TC-DEV-TRC-001-003 the manifest structure (SPEC-170 section 9, TST-TRC-001, TST-TRC-002, TST-E2E-004)", () => {
  it("manifest-json: a missing manifest and an invalid JSON manifest are violations", () => {
    expectViolation(check(withoutFiles(cleanTraceFiles(), MANIFEST)), "manifest-json", MANIFEST);
    expectViolation(check(withTrace({ [MANIFEST]: "{ not json" })), "manifest-json", MANIFEST);
    expectViolation(check(withTrace({ [MANIFEST]: "[]" })), "manifest-json", MANIFEST);
  });

  it("manifest-version: manifest_version must be 1 and test_cases an array", () => {
    expectViolation(
      check(withTrace({ [MANIFEST]: JSON.stringify({ manifest_version: 2, test_cases: [] }) })),
      "manifest-version",
      MANIFEST,
    );
    expectViolation(
      check(withTrace({ [MANIFEST]: JSON.stringify({ manifest_version: 1, test_cases: {} }) })),
      "manifest-version",
      MANIFEST,
    );
  });

  it("case-field-missing: every one of the 19 SPEC-170 section 9 fields is required", {
    timeout: 120_000,
  }, () => {
    const fields = [
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
    ];
    for (const field of fields) {
      const record = manifestCase(ID_UNIT) as Record<string, unknown>;
      delete record[field];
      const result = check(
        withTrace({ [MANIFEST]: manifestJson([record, manifestCase(ID_E2E, e2ePatch())]) }),
      );
      expect(
        violationsOf(result).some(
          (line) =>
            line.startsWith(`VIOLATION case-field-missing ${ID_UNIT}`) && line.includes(field),
        ),
        `${field}\n${result.stdout}`,
      ).toBe(true);
      expect(result.status).toBe(1);
    }
  });

  it("case-id-format: the ID must be TC-<RULE>-NNN", () => {
    for (const bad of ["TC-FOO-1", "tc-foo-001-001", "FOO-001-001", "TC-FOO-001-0001"]) {
      const result = check(
        withTrace({
          [MANIFEST]: manifestJson([manifestCase(bad), manifestCase(ID_E2E, e2ePatch())]),
          "tests/unit/a.test.ts": unitTestSource(bad),
        }),
      );
      expectViolation(result, "case-id-format", bad);
    }
  });

  it("case-id-duplicate: two cases with the same ID", () => {
    const result = check(
      withTrace({
        [MANIFEST]: manifestJson([
          manifestCase(ID_UNIT),
          manifestCase(ID_UNIT, { preconditions: "second" }),
          manifestCase(ID_E2E, e2ePatch()),
        ]),
      }),
    );
    expectViolation(result, "case-id-duplicate", ID_UNIT);
  });

  it("case-no-upstream: a case needs at least one upstream Rule ID (TST-TRC-001)", () => {
    const result = check(
      withTrace({
        [MANIFEST]: manifestJson([
          manifestCase(ID_UNIT, { upstream_rule_ids: [] }),
          manifestCase(ID_E2E, e2ePatch()),
        ]),
      }),
    );
    expectViolation(result, "case-no-upstream", ID_UNIT);
  });

  it("ui-mock-case: an e2e-ui-mock case is non-critical with empty API and DB coverage (TST-E2E-004)", () => {
    const bads: Record<string, Record<string, unknown>> = {
      critical: { critical: true, system_invariant_ids: ["INV-010-01"] },
      api: { api_operation_ids: ["API-ORD-001"] },
      db: { db_constraint_names: ["uq_orders_x"] },
    };
    for (const [name, patch] of Object.entries(bads)) {
      const result = check(
        withTrace({
          [MANIFEST]: manifestJson([
            manifestCase(ID_UNIT),
            manifestCase(ID_E2E, { ...e2ePatch(), ...patch }),
          ]),
        }),
      );
      expect(hasViolation(result, "ui-mock-case", ID_E2E), `${name}\n${result.stdout}`).toBe(true);
      expect(result.status).toBe(1);
    }
  });

  it("critical-case-incomplete: a critical case names an Invariant / Security / Reliability / Observability rule (TST-TRC-002)", () => {
    const result = check(
      withTrace({
        [MANIFEST]: manifestJson([
          manifestCase(ID_UNIT, { critical: true, upstream_rule_ids: ["FOO-001"] }),
          manifestCase(ID_E2E, e2ePatch()),
        ]),
      }),
    );
    expectViolation(result, "critical-case-incomplete", ID_UNIT);

    const ok = check(
      withTrace({
        [MANIFEST]: manifestJson([
          manifestCase(ID_UNIT, {
            critical: true,
            upstream_rule_ids: ["FOO-001", "INV-010-01"],
            system_invariant_ids: ["INV-010-01"],
          }),
          manifestCase(ID_E2E, e2ePatch()),
        ]),
      }),
    );
    expect(hasViolation(ok, "critical-case-incomplete", ID_UNIT)).toBe(false);
  });
});

describe("TC-DEV-TRC-001-004 the manifest and the test sources are joined (TST-TRC-004, SPEC-170 section 76, DEV-TST-008)", () => {
  it("id-not-in-tests: a manifest ID that no test title contains", () => {
    const result = check(withTrace({ "tests/unit/a.test.ts": unitTestSource("TC-FOO-001-999") }));
    expect(hasViolation(result, "id-not-in-tests", ID_UNIT), result.stdout).toBe(true);
    expect(result.status).toBe(1);
  });

  it("id-not-in-tests: an ID that appears only in a comment is not a test", () => {
    const result = check(
      withTrace({
        "tests/unit/a.test.ts": `// ${ID_UNIT} is mentioned in a comment only\nimport { it } from "vitest";\nit("no id here", () => {});\n`,
      }),
    );
    expectViolation(result, "id-not-in-tests", ID_UNIT);
  });

  it("test-not-in-manifest: a test title with an ID that the manifest does not know", () => {
    const result = check(
      withTrace({ "tests/unit/extra.test.ts": unitTestSource("TC-FOO-001-777") }),
    );
    expectViolation(result, "test-not-in-manifest", "TC-FOO-001-777");
  });

  it("recognises titles wrapped onto the next line and test.describe", () => {
    const result = check(
      withTrace({
        "tests/unit/a.test.ts": [
          'import { describe, it } from "vitest";',
          "describe(",
          `  "${ID_UNIT} wrapped title",`,
          "  () => {",
          '    it("x", () => {});',
          "  },",
          ");",
          "",
        ].join("\n"),
        "tests/e2e/b.spec.ts": [
          'import { test } from "@playwright/test";',
          `test.describe("${ID_E2E} grouped", () => {`,
          '  test("inner", async () => {});',
          "});",
          "",
        ].join("\n"),
      }),
    );
    expectClean(result);
  });

  it("skipped-test: skip / fixme / only / todo markers are violations (no skipped tests are gating evidence)", () => {
    const markers = [
      'it.skip("x", () => {});',
      'test.skip("x", async () => {});',
      'test.fixme("x", async () => {});',
      'it.only("x", () => {});',
      'it.todo("x");',
      'xit("x", () => {});',
      'xdescribe("x", () => {});',
    ];
    for (const marker of markers) {
      const file = "tests/unit/skipped.test.ts";
      const result = check(
        withTrace({ [file]: `${unitTestSource(ID_UNIT).replace(/\n$/, "")}\n${marker}\n` }),
      );
      expect(
        violationsOf(result).some((line) => line.startsWith(`VIOLATION skipped-test ${file}:`)),
        `${marker}\n${result.stdout}`,
      ).toBe(true);
      expect(result.status).toBe(1);
    }
  });

  it("scans only test sources: node_modules and test-results are ignored", () => {
    const result = check(
      withTrace({
        "tests/node_modules/pkg/x.test.ts": unitTestSource("TC-ZZZ-001-001"),
        "tests/test-results/y.spec.ts": e2eSpecSource("TC-ZZZ-002-001"),
      }),
    );
    expectClean(result);
  });
});

describe("TC-DEV-TRC-001-005 upstream IDs are known and none is a deferred UCR (SPEC-170 section 76, DEV-TRC-002)", () => {
  it("unknown-upstream-id: when docs/specs exists, an upstream ID that no specification contains is a violation", () => {
    const result = check(
      withTrace({
        ...specDocs(),
        [MANIFEST]: manifestJson([
          manifestCase(ID_UNIT, { upstream_rule_ids: ["FOO-001", "NOPE-404"] }),
          manifestCase(ID_E2E, e2ePatch()),
        ]),
      }),
    );
    expect(hasViolation(result, "unknown-upstream-id", ID_UNIT), result.stdout).toBe(true);
    expect(
      violationsOf(result).some(
        (l) => l.startsWith("VIOLATION unknown-upstream-id") && l.includes("NOPE-404"),
      ),
    ).toBe(true);
    expect(result.status).toBe(1);
  });

  it("accepts IDs that appear in the specifications, and does not check them when docs/specs is absent", () => {
    expectClean(check({ ...cleanTraceFiles(), ...specDocs() }));
    expectClean(check(cleanTraceFiles()));
  });

  it("SPEC-NNN-<anchor> pseudo IDs need the spec file NNN to exist", () => {
    const withAnchor = (anchor: string): RunResult =>
      check({
        ...cleanTraceFiles(),
        ...specDocs(),
        [MANIFEST]: manifestJson([
          manifestCase(ID_UNIT, { upstream_rule_ids: ["FOO-001", anchor] }),
          manifestCase(ID_E2E, e2ePatch()),
        ]),
      });
    expectClean(withAnchor("SPEC-050-31-3"));
    expect(
      violationsOf(withAnchor("SPEC-999-31-3")).some(
        (l) => l.startsWith("VIOLATION unknown-upstream-id") && l.includes("SPEC-999-31-3"),
      ),
    ).toBe(true);
  });

  it("deferred-ucr: UCR-130-005 is never an upstream ID (even when the specification text mentions it)", () => {
    const result = check({
      ...cleanTraceFiles(),
      ...specDocs("UCR-130-005"),
      [MANIFEST]: manifestJson([
        manifestCase(ID_UNIT, { upstream_rule_ids: ["FOO-001", "UCR-130-005"] }),
        manifestCase(ID_E2E, e2ePatch()),
      ]),
    });
    expectViolation(result, "deferred-ucr", ID_UNIT);
  });
});

describe("TC-DEV-TRC-001-006 rule-code-map.json (DEV-TRC-001 .. 003, SPEC-190 section 34)", () => {
  it("map-json: a missing or invalid map is a violation", () => {
    expectViolation(check(withoutFiles(cleanTraceFiles(), MAP)), "map-json", MAP);
    expectViolation(check(withTrace({ [MAP]: "nope" })), "map-json", MAP);
  });

  it("map-schema: schema_version 1, an entries array, and string / array fields per entry", () => {
    expectViolation(
      check(withTrace({ [MAP]: JSON.stringify({ schema_version: 2, entries: [] }) })),
      "map-schema",
      MAP,
    );
    expectViolation(
      check(withTrace({ [MAP]: JSON.stringify({ schema_version: 1, entries: {} }) })),
      "map-schema",
      MAP,
    );
    const badEntries: Record<string, unknown>[] = [
      { code_paths: ["scripts/tool.mts"], test_case_ids: [ID_UNIT], notes: "" },
      { rule_id: "FOO-001", test_case_ids: [ID_UNIT], notes: "" },
      { rule_id: "FOO-001", code_paths: [], test_case_ids: [ID_UNIT], notes: "" },
      { rule_id: "FOO-001", code_paths: ["scripts/tool.mts"], notes: "" },
      { rule_id: "FOO-001", code_paths: ["scripts/tool.mts"], test_case_ids: [ID_UNIT] },
    ];
    for (const entry of badEntries) {
      const result = check(
        withTrace({ [MAP]: mapJson([entry, mapEntry("BAR-002", ["apps/web/app"], [ID_E2E])]) }),
      );
      expect(
        violationsOf(result).some((l) => l.startsWith("VIOLATION map-schema ")),
        `${JSON.stringify(entry)}\n${result.stdout}`,
      ).toBe(true);
      expect(result.status).toBe(1);
    }
  });

  it("map-rule-duplicate: a Rule ID appears in two entries", () => {
    const result = check(
      withTrace({
        [MAP]: mapJson([
          mapEntry("FOO-001", ["apps/web/src", "packages/domain/src", "scripts"], [ID_UNIT]),
          mapEntry("FOO-001", ["apps/web/app"], [ID_UNIT]),
        ]),
      }),
    );
    expectViolation(result, "map-rule-duplicate", "FOO-001");
  });

  it("map-path-missing: every code path exists in the tree (file or directory)", () => {
    const result = check(
      withTrace({
        [MAP]: mapJson([
          mapEntry(
            "FOO-001",
            [
              "apps/web/src/a.ts",
              "packages/domain/src",
              "scripts/tool.mts",
              "apps/web/src/gone.ts",
            ],
            [ID_UNIT],
          ),
          mapEntry("BAR-002", ["apps/web/app"], [ID_E2E]),
        ]),
      }),
    );
    expectViolation(result, "map-path-missing", "FOO-001");
    expect(
      violationsOf(result).some(
        (l) =>
          l.startsWith("VIOLATION map-path-missing FOO-001") && l.includes("apps/web/src/gone.ts"),
      ),
    ).toBe(true);
  });

  it("map-path-invalid: absolute paths, backslashes and .. segments are rejected", () => {
    for (const bad of [
      "/etc/hosts",
      "apps\\web\\src\\a.ts",
      "../outside.ts",
      "apps/web/../web/src/a.ts",
    ]) {
      const result = check(
        withTrace({
          [MAP]: mapJson([
            mapEntry("FOO-001", ["apps/web/src", "packages/domain/src", "scripts", bad], [ID_UNIT]),
            mapEntry("BAR-002", ["apps/web/app"], [ID_E2E]),
          ]),
        }),
      );
      expect(hasViolation(result, "map-path-invalid", "FOO-001"), `${bad}\n${result.stdout}`).toBe(
        true,
      );
      expect(result.status).toBe(1);
    }
  });

  it("map-test-unknown: every test_case_id exists in the manifest", () => {
    const result = check(
      withTrace({
        [MAP]: mapJson([
          mapEntry(
            "FOO-001",
            ["apps/web/src", "packages/domain/src", "scripts"],
            [ID_UNIT, "TC-FOO-001-404"],
          ),
          mapEntry("BAR-002", ["apps/web/app"], [ID_E2E]),
        ]),
      }),
    );
    expectViolation(result, "map-test-unknown", "FOO-001");
    expect(
      violationsOf(result).some(
        (l) => l.startsWith("VIOLATION map-test-unknown FOO-001") && l.includes("TC-FOO-001-404"),
      ),
    ).toBe(true);
  });

  it("map-rule-untested: the Rule ID is an upstream rule of at least one manifest case", () => {
    const result = check(
      withTrace({
        [MAP]: mapJson([
          mapEntry("FOO-001", ["apps/web/src", "packages/domain/src", "scripts"], [ID_UNIT]),
          mapEntry("BAR-002", ["apps/web/app"], [ID_E2E]),
          mapEntry("QUX-003", ["apps/web/app/page.tsx"], [ID_UNIT]),
        ]),
      }),
    );
    expectViolation(result, "map-rule-untested", "QUX-003");
  });

  it("map-deferred-ucr: UCR-130-005 is never a mapped Rule ID (DEV-TRC-002)", () => {
    const result = check(
      withTrace({
        [MAP]: mapJson([
          mapEntry("FOO-001", ["apps/web/src", "packages/domain/src", "scripts"], [ID_UNIT]),
          mapEntry("BAR-002", ["apps/web/app"], [ID_E2E]),
          mapEntry("UCR-130-005", ["apps/web/app/page.tsx"], [ID_UNIT]),
        ]),
      }),
    );
    expectViolation(result, "map-deferred-ucr", "UCR-130-005");
  });
});

describe("TC-DEV-TRC-001-007 every behavioural source file traces to a Rule (DEV-TRC-003)", () => {
  it("source-unmapped: a source file under apps/*/src, apps/*/app, packages/*/src or scripts that no code path covers", () => {
    const unmapped = [
      "apps/web/src/features/new-thing.ts",
      "apps/web/src/features/panel.tsx",
      "apps/web/app/extra/page.tsx",
      "packages/domain/src/more.ts",
      "scripts/another.mts",
    ];
    for (const file of unmapped) {
      // The map lists exact files only: a directory entry would legitimately cover the new file.
      const result = check(
        withTrace({
          [file]: "export const x = 1;\n",
          [MAP]: mapJson([
            mapEntry(
              "FOO-001",
              ["apps/web/src/a.ts", "packages/domain/src/index.ts", "scripts/tool.mts"],
              [ID_UNIT],
            ),
            mapEntry("BAR-002", ["apps/web/app/page.tsx"], [ID_E2E]),
          ]),
        }),
      );
      expect(hasViolation(result, "source-unmapped", file), `${file}\n${result.stdout}`).toBe(true);
      expect(result.status).toBe(1);
    }
  });

  it("accepts coverage by exact file, by directory prefix, and by a trailing-slash directory", () => {
    const result = check(
      withTrace({
        "apps/web/src/features/deep/nested/x.ts": "export const x = 1;\n",
        "scripts/other.mts": "export const x = 1;\n",
        [MAP]: mapJson([
          mapEntry(
            "FOO-001",
            ["apps/web/src/", "packages/domain/src", "scripts/tool.mts"],
            [ID_UNIT],
          ),
          mapEntry("BAR-002", ["apps/web/app", "scripts/other.mts"], [ID_E2E]),
        ]),
      }),
    );
    expectClean(result);
  });

  it("a path prefix is a directory boundary: apps/web/src does not cover apps/web/src-extra", () => {
    const result = check(withTrace({ "apps/web/src-extra/x.ts": "export const x = 1;\n" }));
    // src-extra is outside the scanned source roots, so it is neither mapped nor reported
    expectClean(result);
    const covered = check(
      withTrace({
        "apps/web/src/sub/x.ts": "export const x = 1;\n",
        [MAP]: mapJson([
          mapEntry("FOO-001", ["apps/web/src/su", "packages/domain/src", "scripts"], [ID_UNIT]),
          mapEntry("BAR-002", ["apps/web/app", "apps/web/src/a.ts"], [ID_E2E]),
        ]),
      }),
    );
    expect(hasViolation(covered, "source-unmapped", "apps/web/src/sub/x.ts")).toBe(true);
  });

  it("ignores declaration files, non-source files, node_modules and build output", () => {
    const result = check(
      withTrace({
        "apps/web/src/types.d.ts": "export {};\n",
        "apps/web/src/readme.md": "# notes\n",
        "apps/web/src/data.json": "{}\n",
        "apps/web/node_modules/pkg/index.ts": "export const x = 1;\n",
        "apps/web/.next/server/x.ts": "export const x = 1;\n",
        "apps/web/next.config.ts": "export default {};\n",
        "tests/unit/helper.ts": "export const x = 1;\n",
      }),
    );
    expectClean(result);
  });
});

describe("TC-DEV-TRC-001-008 CLI behaviour: exit codes, output and ordering", () => {
  it("exits 2 with a USAGE line on an unknown option, a missing --root value or a missing root directory", () => {
    for (const args of [["--bogus"], ["--root"], ["--root", join(REPO_ROOT, "no-such-dir-xyz")]]) {
      const result = runScript("validate-traceability.mts", args);
      expect(result.status, args.join(" ")).toBe(2);
      expect(result.output).toMatch(/USAGE|ERROR/);
      expect(violationsOf(result)).toEqual([]);
    }
  });

  it("reports every violation in one run (not only the first), in a deterministic order, and is repeatable", () => {
    const files = withTrace({
      "apps/web/src/new.ts": "export const x = 1;\n",
      "scripts/new.mts": "export const x = 1;\n",
      "tests/unit/extra.test.ts": unitTestSource("TC-FOO-001-777"),
    });
    const first = check(files);
    const second = check(files);
    const lines = violationsOf(first);
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(violationsOf(second)).toEqual(lines);
    expect(first.stdout.match(/^FAIL validate-traceability violations=(\d+)$/m)?.[1]).toBe(
      String(lines.length),
    );
    expect(first.status).toBe(1);
  });

  it("never prints test sources, JSON bodies or environment values", () => {
    const result = check(withTrace({ [MANIFEST]: '{ "SENTINEL_BODY_TEXT": ' }));
    expect(result.status).toBe(1);
    expect(result.output).not.toContain("SENTINEL_BODY_TEXT");
  });
});

function e2ePatch(): Record<string, unknown> {
  return { level: "E2E", suite: "e2e-ui-mock", upstream_rule_ids: ["BAR-002", "TST-E2E-004"] };
}
