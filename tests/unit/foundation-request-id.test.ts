// PR-S0-1b addendum T1: adoptableRequestId (apps/api/src/api/middleware/request-context.ts) decides
// whether an incoming X-Request-Id is a canonical UUID (SPEC-110 §17, v2.4.0). Synthetic data only.
// The function is read through a dynamic import so that this file type-checks before the export
// exists (the implementation commit adds it); a missing export fails the first test.
import { describe, expect, it } from "vitest";
import { z } from "zod";

type AdoptableRequestId = (value: string | undefined) => string | undefined;

const load = async (): Promise<AdoptableRequestId> => {
  const module = (await import(
    "../../apps/api/src/api/middleware/request-context.ts"
  )) as unknown as {
    adoptableRequestId?: AdoptableRequestId;
  };
  expect(typeof module.adoptableRequestId, "adoptableRequestId export").toBe("function");
  return module.adoptableRequestId as AdoptableRequestId;
};

const V4 = "00000000-0000-4000-8000-000000000081";
const V7 = "00000000-0000-7000-8000-000000000082";
const V1_VARIANT_B = "00000000-0000-1000-b000-000000000083";
const V8_VARIANT_A = "00000000-0000-8000-a000-000000000088";
const V5_VARIANT_9 = "00000000-0000-5000-9000-000000000089";

describe("TC-SEC-API-023-003 adoptableRequestId (SEC-API-023, OBS-COR-001, SPEC-110 §17)", () => {
  it("returns a canonical UUID (lower case, version 1-8, RFC variant) as it is", async () => {
    const adoptable = await load();
    for (const value of [V4, V7, V1_VARIANT_B, V8_VARIANT_A, V5_VARIANT_9])
      expect(adoptable(value), value).toBe(value);
  });

  it("every adopted value passes z.uuid() (the log and response schemas), so a parse never throws", async () => {
    const adoptable = await load();
    for (const value of [V4, V7, V1_VARIANT_B, V8_VARIANT_A, V5_VARIANT_9]) {
      const adopted = adoptable(value);
      expect(adopted, value).toBeDefined();
      expect(z.uuid().safeParse(adopted).success, value).toBe(true);
    }
  });

  it("returns undefined for a missing or empty value", async () => {
    const adoptable = await load();
    expect(adoptable(undefined)).toBeUndefined();
    expect(adoptable("")).toBeUndefined();
  });

  it("returns undefined for an upper-case or mixed-case value (it is not normalized)", async () => {
    const adoptable = await load();
    for (const value of [
      "0000000A-0000-4000-8000-000000000084",
      V4.toUpperCase(),
      "00000000-0000-4000-8000-00000000008A",
      "00000000-0000-4000-B000-000000000084",
    ])
      expect(adoptable(value), value).toBeUndefined();
  });

  it("returns undefined for nil, max, version 0, version 9, version f and a variant outside 8, 9, a, b", async () => {
    const adoptable = await load();
    for (const value of [
      "00000000-0000-0000-0000-000000000000",
      "ffffffff-ffff-ffff-ffff-ffffffffffff",
      "00000000-0000-0000-8000-000000000085",
      "00000000-0000-9000-8000-000000000085",
      "00000000-0000-f000-8000-000000000085",
      "00000000-0000-4000-0000-000000000086",
      "00000000-0000-4000-7000-000000000086",
      "00000000-0000-4000-c000-000000000086",
      "00000000-0000-4000-f000-000000000086",
    ])
      expect(adoptable(value), value).toBeUndefined();
  });

  it("returns undefined for a value of another shape or length", async () => {
    const adoptable = await load();
    for (const value of [
      `{${V4}}`,
      `urn:uuid:${V4}`,
      `${V4}0`,
      V4.slice(1),
      V4.replaceAll("-", ""),
      V4.replace("-", "_"),
      V4.replace("0000-4000", "000-04000"),
      `${V4}, ${V7}`,
      `${V4},${V7}`,
      "hostile",
      "00000000-0000-4000-8000-00000000008g",
    ])
      expect(adoptable(value), value).toBeUndefined();
  });

  it("returns undefined for a value with padding, line breaks or an injected header, even around a canonical UUID", async () => {
    const adoptable = await load();
    for (const value of [
      `${V4}\n`,
      `\n${V4}`,
      `${V4}\r\nX-Injected: 1`,
      `${V4}\r\n`,
      `${V4} `,
      `${V4} `,
      ` ${V4}`,
      `\t${V4}`,
      `${V4}\0`,
      `${V4}"`,
      `"${V4}"`,
      `${V4}\n${V7}`,
    ])
      expect(adoptable(value), JSON.stringify(value)).toBeUndefined();
  });

  it("returns undefined for the quote and brace injection used in log-forging attempts", async () => {
    const adoptable = await load();
    expect(adoptable('x"},{"injected":"1')).toBeUndefined();
    expect(adoptable(`${V4}"},{"injected":"1`)).toBeUndefined();
  });
});
