import { describe, expect, it } from "vitest";
import { defaultScenario, scenarioSchema } from "../../../../apps/web/src/mock/backend/scenario.ts";
import { SCENARIO_CONTROLS } from "../../../harness/browser/scenario-controls.ts";

// Keeps the /dev/scenarios control list used by the E2E (contract section 8.2) in sync with the S2 zod schema.

function leafPaths(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    leafPaths(child, prefix === "" ? key : `${prefix}.${key}`),
  );
}

function getAt(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (typeof acc !== "object" || acc === null) return undefined;
    return (acc as Record<string, unknown>)[key];
  }, value);
}

function withValue(path: string, next: unknown): unknown {
  const base = JSON.parse(JSON.stringify(defaultScenario())) as Record<string, unknown>;
  const keys = path.split(".");
  let cursor = base;
  for (const key of keys.slice(0, -1)) cursor = cursor[key] as Record<string, unknown>;
  const last = keys[keys.length - 1];
  if (last === undefined) throw new Error("empty path");
  cursor[last] = next;
  return base;
}

describe("TC-DEV-WEB-013-121 /dev/scenarios control list matches the S2 scenario schema (design section 8)", () => {
  it("covers every scenario switch (all leaves except version) exactly once", () => {
    const leaves = leafPaths(defaultScenario())
      .filter((path) => path !== "version")
      .sort();
    expect(SCENARIO_CONTROLS.map((c) => c.path).sort()).toEqual(leaves);
  });

  it("lists, for every select, exactly the values the schema accepts", () => {
    for (const control of SCENARIO_CONTROLS) {
      if (control.kind !== "select") continue;
      for (const value of control.values) {
        const result = scenarioSchema.safeParse(withValue(control.path, value));
        expect(result.success, `${control.path}=${value}`).toBe(true);
      }
      expect(
        scenarioSchema.safeParse(withValue(control.path, "__not_a_value__")).success,
        `${control.path} rejects an unknown value`,
      ).toBe(false);
      expect(control.values).toContain(getAt(defaultScenario(), control.path));
    }
  });

  it("treats latencyLongMs as an integer between 1 and 60000", () => {
    expect(scenarioSchema.safeParse(withValue("latencyLongMs", 1)).success).toBe(true);
    expect(scenarioSchema.safeParse(withValue("latencyLongMs", 60000)).success).toBe(true);
    expect(scenarioSchema.safeParse(withValue("latencyLongMs", 0)).success).toBe(false);
    expect(scenarioSchema.safeParse(withValue("latencyLongMs", 60001)).success).toBe(false);
    expect(scenarioSchema.safeParse(withValue("latencyLongMs", 1.5)).success).toBe(false);
  });
});
