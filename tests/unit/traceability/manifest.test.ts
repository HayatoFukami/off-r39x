import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// TC-TST-TRC-001-001: structural check of the manifest (SPEC-170 §9, §76, TST-E2E-004).
const testsDir = fileURLToPath(new URL("../../", import.meta.url));
const manifest = JSON.parse(
  readFileSync(join(testsDir, "traceability", "test-manifest.json"), "utf8"),
) as { test_cases: Record<string, unknown>[] };

const REQUIRED_FIELDS = [
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
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules" || name === "test-results") return [];
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(test|spec)\.ts$/.test(name) ? [full] : [];
  });
}

describe("TC-TST-TRC-001-001 test-manifest.json", () => {
  const cases = manifest.test_cases;

  it("has unique Test Case IDs in the TC-<rule>-NNN format", () => {
    const ids = cases.map((c) => c.test_case_id as string);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^TC-[A-Z0-9]+(-[A-Z0-9]+)*-\d{3}$/);
  });

  it("carries every field of the SPEC-170 §9 contract with at least one upstream rule", () => {
    for (const c of cases) {
      for (const field of REQUIRED_FIELDS) expect(c, String(c.test_case_id)).toHaveProperty(field);
      expect((c.upstream_rule_ids as string[]).length).toBeGreaterThan(0);
      expect(c.sensitivity_class).toBe("synthetic");
    }
  });

  it("keeps UI-mock and scaffold cases non-critical with empty API / DB coverage", () => {
    for (const c of cases) {
      expect(c.critical).toBe(false);
      expect(c.api_operation_ids).toEqual([]);
      expect(c.db_constraint_names).toEqual([]);
      expect(c.fault_points).toEqual([]);
      expect(c.concurrency_seed).toBeNull();
    }
  });

  it("is joinable with runtime results: every ID appears in a test title", () => {
    const sources = sourceFiles(testsDir).map((f) => readFileSync(f, "utf8"));
    for (const c of cases) {
      const id = c.test_case_id as string;
      expect(
        sources.some((s) => s.includes(id)),
        id,
      ).toBe(true);
    }
  });
});
