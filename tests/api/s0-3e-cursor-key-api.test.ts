import { listDataSchema, listQuerySchema } from "@off-r39x/api-contract";
import { expect, it } from "vitest";
import { z } from "zod";
import { createApp } from "../../apps/api/src/api/app.ts";
import { validateQuery } from "../../apps/api/src/api/middleware/query.ts";
import {
  type CursorKey,
  defineListCursor,
  readListCursor,
  requireListCursorKey,
} from "../../apps/api/src/api/pagination.ts";
import { successResponse } from "../../apps/api/src/api/respond.ts";
import { syntheticCursorKey } from "../harness/pagination.ts";

const REF = "00000000-0000-4000-8000-0000000000a1";
const TIMESTAMP = "2026-11-20T00:00:00.000000Z";
const KEY = syntheticCursorKey(13, 1);
const cursorDef = defineListCursor({
  operationId: "API-ADM-ORD-001",
  keys: z.tuple([z.string()]),
});
const querySchema = listQuerySchema({});

type Deps = { listCursorKey?: CursorKey };
function build(deps: Deps) {
  const app = createApp({
    webOrigin: "https://web.example.test",
    ready: async () => true,
    ...deps,
  });
  const reads: unknown[] = [];
  const listQuery = validateQuery(querySchema);
  // Harness-only list route: the guard takes the key through requireListCursorKey for every request.
  app.get("/api/v1/test/list", listQuery, (c) => {
    const key = requireListCursorKey((deps as Deps).listCursorKey);
    const query = listQuery.read(c);
    const position = readListCursor(cursorDef, key, query);
    reads.push(position);
    const next = cursorDef.encode(key, { keys: [TIMESTAMP], publicRef: REF }, query);
    key.key.fill(0); // a handler zeroing its copy must not change the key of later requests
    return successResponse(c, listDataSchema(z.strictObject({})), {
      items: [],
      page: { next_cursor: next, has_more: true },
    });
  });
  const get = (query: string) =>
    app.request(`/api/v1/test/list${query}`, { headers: { Origin: "https://web.example.test" } });
  return { get, reads };
}

it("TC-API-QRY-005-001 without a cursor key a list route fails closed with 503; with one it pages and the key is copied", async () => {
  const valid = cursorDef.encode(KEY, { keys: [TIMESTAMP], publicRef: REF }, {});
  const without = build({});
  for (const query of ["", `?cursor=${valid}`]) {
    const res = await without.get(query);
    expect(res.status, query).toBe(503);
    const body = await res.json();
    expect(body.error, query).toMatchObject({
      code: "TEMPORARY_UNAVAILABLE",
      retryable: true,
      details: null,
    });
    expect(body.error.request_id, query).toBe(res.headers.get("X-Request-Id"));
    expect(res.headers.get("Cache-Control"), query).toBe("no-store");
    expect(JSON.stringify(body), query).not.toContain(valid);
  }
  expect(without.reads).toEqual([]);

  const withKey = build({ listCursorKey: KEY });
  const first = await withKey.get("");
  expect(first.status).toBe(200);
  const next = (await first.json()).data.page.next_cursor as string;
  expect(next).toEqual(expect.any(String));
  const second = await withKey.get(`?cursor=${next}`);
  expect(second.status).toBe(200);
  expect(withKey.reads).toEqual([undefined, { keys: [TIMESTAMP], publicRef: REF }]);
  expect(Buffer.from(KEY.key).equals(Buffer.alloc(32, 13))).toBe(true);
});
