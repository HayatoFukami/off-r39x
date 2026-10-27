import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CartLine } from "../../../../apps/web/src/api-client/types.ts";
import {
  type Backend,
  createBackend,
  dbFingerprint,
  okData,
} from "../../../harness/mock-backend.ts";
import { EMAIL, GOODS, OFFERING } from "../../../harness/mock-seed.ts";

const towel = (quantity: number): CartLine => ({
  kind: "GOODS",
  goodsRef: GOODS.towel,
  quantity,
});
const tshirt = (quantity: number): CartLine => ({
  kind: "GOODS",
  goodsRef: GOODS.tshirt,
  quantity,
});
const regular = (quantity: number): CartLine => ({
  kind: "ENTRY_TICKET",
  offeringRef: OFFERING.regular,
  quantity,
});

async function freshBackend(): Promise<Backend> {
  const backend = createBackend();
  await backend.signInAs(EMAIL.fresh);
  return backend;
}

/** A duplicate line is invalid input (API-PUR-CART-001 400 VALIDATION_FAILED): the promise rejects and nothing is written. */
async function expectDuplicateRefused(
  backend: Backend,
  lines: readonly CartLine[],
  key: string,
): Promise<void> {
  const before = dbFingerprint(backend);
  const ids = backend.ids.count();
  const orders = okData(await backend.api.self.listOrders()).length;
  await expect(
    backend.api.purchase.startCartPurchase(lines, { idempotencyKey: key }),
  ).rejects.toThrow(RangeError);
  expect(dbFingerprint(backend)).toBe(before);
  expect(backend.ids.count()).toBe(ids);
  expect(okData(await backend.api.self.listOrders()).length).toBe(orders);
}

describe("TC-BR-ORD-014-110 duplicate cart lines are invalid input, never evaluated in sequence (BR-ORD-014, FR-CRT-007, API-PUR-CART-001, TST-UNT-004)", () => {
  it("refuses duplicate Goods lines whose total exceeds the stock, whatever the total", async () => {
    // Towel has 3 left; 2 + 2 needs 4.
    await expectDuplicateRefused(await freshBackend(), [towel(2), towel(2)], "dup-a");
  });

  it("refuses duplicate Goods lines whose total fits the stock exactly (the former purchasable case)", async () => {
    await expectDuplicateRefused(await freshBackend(), [towel(2), towel(1)], "dup-fit-goods");
  });

  it("refuses a duplicate that is separated by a line of another item", async () => {
    await expectDuplicateRefused(await freshBackend(), [towel(2), tshirt(1), towel(2)], "dup-a2");
  });

  it("refuses duplicate Entry lines over the per-account limit and ones that fit it exactly", async () => {
    // Regular: limit 4, stock 10. 3 + 2 = 5 > 4, and 2 + 2 = 4 fits exactly.
    await expectDuplicateRefused(await freshBackend(), [regular(3), regular(2)], "dup-b1");
    await expectDuplicateRefused(await freshBackend(), [regular(2), regular(2)], "dup-fit-entry");
    await expectDuplicateRefused(await freshBackend(), [regular(4), regular(1)], "dup-b2");
  });

  it("refuses a duplicate even after a persisted purchase, and leaves that purchase as it was", async () => {
    const backend = await freshBackend();
    const pre = await backend.api.purchase.startCartPurchase([regular(1)], {
      idempotencyKey: "k-pre",
    });
    expect(pre.kind).toBe("created");
    await expectDuplicateRefused(backend, [regular(1), regular(1)], "dup-b3");
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
