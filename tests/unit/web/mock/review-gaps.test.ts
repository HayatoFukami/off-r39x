import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CartLine } from "../../../../apps/web/src/api-client/types.ts";
import { createBackend, dbFingerprint } from "../../../harness/mock-backend.ts";
import { EMAIL, GOODS } from "../../../harness/mock-seed.ts";

const towel = (quantity: number): CartLine => ({
  kind: "GOODS",
  goodsRef: GOODS.towel,
  quantity,
});

describe("TC-BR-ORD-014-110 duplicate cart lines never oversell (BR-ORD-014, SPEC-050 14A.1)", () => {
  it("does not drive inventory negative when two lines of one item exceed the remaining stock together", async () => {
    const backend = createBackend();
    await backend.signInAs(EMAIL.fresh);
    const before = dbFingerprint(backend);
    // Towel has 3 left; each line alone fits (2 <= 3) but together they need 4.
    let result: { kind: string } | null = null;
    try {
      result = await backend.api.purchase.startCartPurchase([towel(2), towel(2)], {
        idempotencyKey: "dup-1",
      });
    } catch {
      // Refusing the malformed cart outright is an acceptable way to protect the invariant.
    }
    if (result !== null && result.kind === "created") {
      throw new Error("a cart needing more stock than remains must not be created");
    }
    expect(dbFingerprint(backend)).toBe(before);
  });
});

const SOURCE_ROOTS = ["api-client", "auth", "mock"].map((d) =>
  join(import.meta.dirname, "../../../../apps/web/src", d),
);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : path.endsWith(".ts") ? [path] : [];
  });
}

describe("TC-DEV-TS-013-101 mock sources use only injected time, random and I/O (DEV-TS, SPEC-190 U6)", () => {
  const files = SOURCE_ROOTS.flatMap(sources);
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("finds the sources", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each([
    ["Date.now", /\bDate\.now\s*\(/],
    ["new Date()", /\bnew Date\(\s*\)/],
    ["Math.random", /\bMath\.random\s*\(/],
    ["console", /\bconsole\./],
    ["as unknown as", /as unknown as/],
    ["explicit any", /:\s*any\b|<any>|as any\b/],
    ["Hold TTL literal", /\b(?:hold|ttl)\w*\s*[:=]\s*(?:45|30|5)\b/i],
  ])("has no %s", (_name, pattern) => {
    const offenders = files.filter((f) => pattern.test(strip(readFileSync(f, "utf8"))));
    expect(offenders).toEqual([]);
  });

  it("confines randomUUID and setTimeout to their injectable defaults", () => {
    const hits = files
      .filter((f) => /\b(?:randomUUID|setTimeout)\b/.test(strip(readFileSync(f, "utf8"))))
      .map((f) => f.replaceAll("\\", "/").split("/").pop());
    expect(hits.sort()).toEqual(["ids.ts", "latency.ts"]);
  });
});
