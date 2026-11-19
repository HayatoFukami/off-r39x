import { listDataSchema, listQuerySchema, pageQuery, successSchema } from "@off-r39x/api-contract";
import { describe, expect, it } from "vitest";
import { z } from "zod";

// PR-S0-3b C1: SPEC-110 section 12 / 48.3 (pageQuery, strict list query) and section 19 (list data
// envelope). Expected values come from the specification, not the implementation. The has_more /
// next_cursor consistency refine is a repository decision (plan A-6). Static only: no network,
// database or environment variables.

const stateQuery = () =>
  listQuerySchema({ state: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).optional() });
const issueCodes = (result: z.ZodSafeParseResult<unknown>) =>
  result.success ? [] : result.error.issues.map((issue) => issue.code);

describe("TC-API-QRY-001-001 list query schema is strict and follows pageQuery", () => {
  it("defaults limit to 30 and accepts 1..100", () => {
    const schema = stateQuery();
    expect(schema.parse({})).toEqual({ limit: 30 });
    expect(schema.parse({ limit: "1" })).toEqual({ limit: 1 });
    expect(schema.parse({ limit: "100" })).toEqual({ limit: 100 });
  });

  it.each(["0", "101", "1.5", "abc", ""])("rejects limit %j", (limit) => {
    expect(stateQuery().safeParse({ limit }).success).toBe(false);
    expect(pageQuery.limit.safeParse(limit).success).toBe(false);
  });

  it("bounds cursor to 1..512 characters", () => {
    const schema = stateQuery();
    expect(schema.safeParse({ cursor: "" }).success).toBe(false);
    expect(schema.safeParse({ cursor: "a".repeat(513) }).success).toBe(false);
    expect(schema.safeParse({ cursor: "a".repeat(512) }).success).toBe(true);
    expect(pageQuery.cursor.safeParse("").success).toBe(false);
    expect(pageQuery.cursor.safeParse("a".repeat(513)).success).toBe(false);
    expect(pageQuery.cursor.safeParse("a".repeat(512)).success).toBe(true);
    expect(pageQuery.cursor.safeParse(undefined).success).toBe(true);
  });

  it("checks the Operation's own filter enum", () => {
    expect(stateQuery().safeParse({ state: "DRAFT" }).success).toBe(true);
    expect(stateQuery().safeParse({ state: "draft" }).success).toBe(false);
  });

  it("rejects unknown keys with unrecognized_keys, including __proto__ as an own data property", () => {
    const schema = stateQuery();
    for (const key of ["foo", "sort", "order_by", "offset", "page"]) {
      const result = schema.safeParse({ [key]: "x" });
      expect(result.success, key).toBe(false);
      expect(issueCodes(result), key).toEqual(["unrecognized_keys"]);
    }
    const proto = Object.fromEntries([["__proto__", "x"]]);
    const result = schema.safeParse(proto);
    expect(result.success).toBe(false);
    expect(issueCodes(result)).toEqual(["unrecognized_keys"]);
  });
});

describe("TC-API-QRY-002-001 builder refuses sort, offset and column parameters", () => {
  it.each(["limit", "cursor", "sort", "order_by", "offset", "page"])(
    "throws at definition time when the shape defines %s",
    (key) => {
      expect(() => listQuerySchema({ [key]: z.string().optional() })).toThrow();
    },
  );

  it("accepts an Operation-defined mode enum (SPEC-110 48.3.4)", () => {
    const schema = listQuerySchema({
      order: z.enum(["CREATED_DESC", "USAGE_START_ASC"]).default("CREATED_DESC"),
    });
    expect(schema.parse({})).toEqual({ order: "CREATED_DESC", limit: 30 });
    expect(schema.parse({ order: "USAGE_START_ASC" })).toEqual({
      order: "USAGE_START_ASC",
      limit: 30,
    });
    expect(schema.safeParse({ order: "created_at desc" }).success).toBe(false);
  });
});

describe("TC-DEV-API-003-005 list data envelope", () => {
  const schema = successSchema(listDataSchema(z.strictObject({ ref: z.uuid() })));
  const meta = { request_id: "00000000-0000-4000-8000-000000000002" };
  const ok = (data: unknown) => schema.safeParse({ data, meta }).success;
  const page = (next_cursor: string | null, has_more: boolean) => ({ next_cursor, has_more });

  it("accepts consistent pages", () => {
    expect(ok({ items: [], page: page(null, false) })).toBe(true);
    expect(
      ok({
        items: [{ ref: "00000000-0000-4000-8000-0000000000a1" }],
        page: page("abc", true),
      }),
    ).toBe(true);
    expect(schema.parse({ data: { items: [], page: page(null, false) }, meta })).toEqual({
      data: { items: [], page: page(null, false) },
      meta,
    });
  });

  // has_more must equal (next_cursor !== null): repository decision A-6.
  it.each([
    ["has_more without a cursor", page(null, true)],
    ["a cursor without has_more", page("x", false)],
    ["an empty cursor", page("", true)],
    ["a 513-character cursor", page("a".repeat(513), true)],
  ])("rejects %s", (_label, p) => {
    expect(ok({ items: [], page: p })).toBe(false);
  });

  it("rejects extra keys and more than 100 items", () => {
    expect(ok({ items: [], page: { ...page(null, false), total: 0 } })).toBe(false);
    expect(ok({ items: [], page: page(null, false), total: 0 })).toBe(false);
    const item = { ref: "00000000-0000-4000-8000-0000000000a1" };
    expect(ok({ items: Array.from({ length: 101 }, () => item), page: page(null, false) })).toBe(
      false,
    );
    expect(ok({ items: Array.from({ length: 100 }, () => item), page: page(null, false) })).toBe(
      true,
    );
  });
});
