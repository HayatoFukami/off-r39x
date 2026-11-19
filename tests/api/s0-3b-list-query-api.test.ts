import { listDataSchema, listQuerySchema } from "@off-r39x/api-contract";
import { expect, it } from "vitest";
import { z } from "zod";
import { createApp } from "../../apps/api/src/api/app.ts";
import { validateQuery } from "../../apps/api/src/api/middleware/query.ts";
import { defineListCursor, readCursor } from "../../apps/api/src/api/pagination.ts";
import { successResponse } from "../../apps/api/src/api/respond.ts";
import { syntheticCursorKey } from "../harness/pagination.ts";

const REF = "00000000-0000-4000-8000-0000000000a1";
const TIMESTAMP = "2026-11-20T00:00:00.000000Z";
const K1 = syntheticCursorKey(0x11, 1);
const cursorDef = defineListCursor({
  operationId: "API-ADM-ORD-001",
  keys: z.tuple([z.string()]),
});
const querySchema = listQuerySchema({ state: z.enum(["CONFIRMED", "CANCELED"]).optional() });

function build() {
  const app = createApp({ webOrigin: "https://web.example.test", ready: async () => true });
  const handled: { limit: number; position: unknown }[] = [];
  // Harness-only route; the production app mounts no list Operation (plan A7). Order: validate, then
  // read the cursor with the validated filter as binding, then the handler.
  app.get("/api/v1/test/list", validateQuery(querySchema), (c) => {
    const { limit, cursor, ...binding } = c.get("validatedQuery") as z.output<typeof querySchema>;
    const position = readCursor(cursorDef, K1, cursor, binding);
    handled.push({ limit, position });
    return successResponse(c, listDataSchema(z.strictObject({})), {
      items: [],
      page: { next_cursor: null, has_more: false },
    });
  });
  const get = (query: string) =>
    app.request(`/api/v1/test/list${query}`, { headers: { Origin: "https://web.example.test" } });
  return { get, handled };
}

it("TC-API-QRY-001-002 list query: unknown, duplicate, out-of-range and tampered input is 400 VALIDATION_FAILED before the handler", async () => {
  const { get, handled } = build();

  const first = await get("");
  expect(first.status).toBe(200);
  expect((await first.json()).data.page).toEqual({ next_cursor: null, has_more: false });
  expect(handled).toEqual([{ limit: 30, position: undefined }]);
  handled.length = 0;

  const good = cursorDef.encode(K1, { keys: [TIMESTAMP], publicRef: REF }, { state: "CONFIRMED" });
  const tampered = `${good.slice(0, -2)}${good.endsWith("AA") ? "BB" : "AA"}`;
  const bad = [
    "?foo=1",
    "?sort=created_at",
    "?offset=0",
    "?order_by=x",
    "?limit=0",
    "?limit=101",
    "?limit=1&limit=2",
    "?cursor=",
    `?cursor=${tampered}`,
    `?state=CANCELED&cursor=${good}`,
  ];
  for (const query of bad) {
    const res = await get(query);
    expect(res.status, query).toBe(400);
    const body = await res.json();
    expect(body.error, query).toMatchObject({
      code: "VALIDATION_FAILED",
      retryable: false,
      details: null,
    });
    expect(body.error.request_id, query).toBe(res.headers.get("X-Request-Id"));
    expect(res.headers.get("Cache-Control"), query).toBe("no-store");
    const text = JSON.stringify(body);
    for (const echoed of ["created_at", "foo", tampered, good]) expect(text).not.toContain(echoed);
  }
  expect(handled).toEqual([]);

  const ok = await get(`?state=CONFIRMED&cursor=${good}`);
  expect(ok.status).toBe(200);
  expect(handled).toEqual([{ limit: 30, position: { keys: [TIMESTAMP], publicRef: REF } }]);
});
