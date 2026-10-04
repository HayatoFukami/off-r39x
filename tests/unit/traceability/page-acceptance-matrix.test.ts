import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// TC-E2E-003-001: TST-E2E-003 coverage matrix. Every SPEC-050 section 31 Page Acceptance item maps to at least one
// E2E Test Case, via the upstream rule ID `SPEC-050-31-<n>` in tests/traceability/test-manifest.json.
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const specsDir = join(repoRoot, "docs", "specs");
const specFile = readdirSync(specsDir).find((f) => f.startsWith("050-"));
const spec = readFileSync(join(specsDir, specFile ?? "missing"), "utf8");
const manifest = JSON.parse(
  readFileSync(join(repoRoot, "tests", "traceability", "test-manifest.json"), "utf8"),
) as { test_cases: { test_case_id: string; level: string; upstream_rule_ids: string[] }[] };

function sectionItems(): number[] {
  const start = spec.search(/^## 31\. /m);
  const rest = spec.slice(start + 1);
  const end = rest.search(/^## /m);
  const body = rest.slice(0, end === -1 ? undefined : end);
  return [...body.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]));
}

describe("TC-E2E-003-001 SPEC-050 section 31 coverage matrix (TST-E2E-003)", () => {
  const items = sectionItems();

  it("reads items 1..29 consecutively from the specification", () => {
    expect(items).toEqual(Array.from({ length: 29 }, (_, i) => i + 1));
  });

  for (let n = 1; n <= 29; n += 1) {
    it(`item ${n} is traced by at least one E2E Test Case`, () => {
      const cases = manifest.test_cases.filter(
        (c) => c.level === "E2E" && c.upstream_rule_ids.includes(`SPEC-050-31-${n}`),
      );
      expect(
        cases.map((c) => c.test_case_id),
        `SPEC-050-31-${n}`,
      ).not.toEqual([]);
    });
  }

  it("item 21 is traced by a journey case that runs on both the Mobile and the Desktop project", () => {
    const ids = manifest.test_cases
      .filter((c) => c.upstream_rule_ids.includes("SPEC-050-31-21"))
      .map((c) => c.test_case_id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "TC-SPEC-050-31-21-001",
        "TC-SPEC-050-31-21-002",
        "TC-SPEC-050-31-21-003",
      ]),
    );
  });

  it("no manifest case cites a section 31 item that does not exist", () => {
    for (const c of manifest.test_cases)
      for (const rule of c.upstream_rule_ids) {
        const m = /^SPEC-050-31-(\d+)$/.exec(rule);
        if (m) expect(Number(m[1]), c.test_case_id).toBeLessThanOrEqual(items.length);
      }
  });
});
