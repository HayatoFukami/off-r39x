import { Client, type Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { idempotencyStoreRig, readJson } from "../harness/api/transport-idempotency-store-rig.ts";
import { prepareFoundationDatabase } from "../harness/db/foundation.ts";
import {
  effectRows,
  insertProfile,
  installSyntheticBusiness,
  openRuntimePools,
  recordCount,
  recordRows,
  ref,
  resetRecords,
} from "../harness/db/idempotency.ts";

// PR-S0-3d C1 (SPEC-110 section 18.1 API-IDM-006 / 007, SPEC-170 section 28 items 1, 2 and 4,
// TST-IDM-002 / 005): the HTTP surface of the claim primitive through a harness-only route, with the
// real Transport Idempotency middleware (S0-3c), the real respond() mapping and a real PostgreSQL 17.
// A replay rebuilds its answer from the Domain row's current state and never returns a stored body;
// another body under the same key is 409 IDEMPOTENCY_KEY_REUSED; X-Request-Id plays no part. The route
// lives in tests/harness only and is not in the production route table. Operation-specific replay
// statuses belong to each Operation's PR. Synthetic data only.

const url = process.env.TEST_DATABASE_URL;
const caPath = process.env.TEST_DATABASE_CA;
if (!url || !caPath) throw new Error("Real PG17 requires TEST_DATABASE_URL and TEST_DATABASE_CA");

const PROFILE = ref(0xf1);

let admin: Client;
let runtime: Awaited<ReturnType<typeof openRuntimePools>>;
let rig: ReturnType<typeof idempotencyStoreRig>;

beforeAll(async () => {
  admin = new Client({ connectionString: url });
  await admin.connect();
  await prepareFoundationDatabase(admin);
  await installSyntheticBusiness(admin);
  await insertProfile(admin, PROFILE);
  runtime = await openRuntimePools(url as string, caPath as string, 1);
  rig = idempotencyStoreRig({ pool: runtime.pools[0] as Pool, principalProfileRef: PROFILE });
});
afterAll(async () => {
  await runtime?.close();
  await admin?.end();
});
beforeEach(async () => {
  await resetRecords(admin);
  rig.lines.length = 0;
});

interface Success {
  data: { ref: string; label: string };
  meta: { request_id: string };
}
interface Failure {
  error: { code: string; retryable: boolean; details: unknown };
}

describe("TC-API-IDM-007-001 replay is rebuilt from the current state and a different body is 409 (real PostgreSQL 17)", () => {
  it("TC-API-IDM-007-001 first 201, the same key and body 200 with the current state of the row, another body under the key 409 IDEMPOTENCY_KEY_REUSED, and only {201, 200, 409} appear", async () => {
    const KEY = "synthetic-idem-key-api-raw-marker-0001";
    const cause = ref(0xf11);
    const statuses: number[] = [];
    const texts: string[] = [];
    const send = async (label: string) => {
      const response = await rig.post(cause, { key: KEY, body: { label } });
      statuses.push(response.status);
      const { text, json } = await readJson(response);
      texts.push(text);
      return { status: response.status, json };
    };

    const first = await send("synthetic-label-a");
    expect(first.status).toBe(201);
    const created = (first.json as Success).data;
    expect(created.label).toBe("synthetic-label-a");
    expect(await effectRows(admin)).toHaveLength(1);
    expect(await recordCount(admin)).toBe(1);

    // Between the first request and the retry the Domain row changes (an unrelated update).
    await admin.query("UPDATE synthetic_business.effects SET label = 'synthetic-label-b'");

    // The same key and the same body: 200, rebuilt from the row's current state, not the stored first answer.
    const replay = await send("synthetic-label-a");
    expect(replay.status).toBe(200);
    expect((replay.json as Success).data).toEqual({ ref: created.ref, label: "synthetic-label-b" });
    expect(await recordCount(admin)).toBe(1);

    // The same key with another body: 409, with the fixed envelope and without any detail.
    const reused = await send("synthetic-label-c");
    expect(reused.status).toBe(409);
    expect((reused.json as Failure).error).toMatchObject({
      code: "IDEMPOTENCY_KEY_REUSED",
      retryable: false,
      details: null,
    });

    // Domain state is unchanged by the 409 and by the replay.
    expect(await effectRows(admin)).toEqual([
      { public_ref: created.ref, cause_key: cause, label: "synthetic-label-b" },
    ]);
    expect(await recordCount(admin)).toBe(1);
    expect(new Set(statuses)).toEqual(new Set([201, 200, 409]));

    // DB-IDM-001: the raw key and the bodies are in no record column, no answer and no log line.
    const recordText = JSON.stringify(
      (await admin.query("SELECT row_to_json(r) AS j FROM app.idempotency_records r")).rows,
    );
    for (const haystack of [recordText, rig.lines.join("\n")]) {
      expect(haystack).not.toContain(KEY);
      expect(haystack).not.toContain("synthetic-label");
    }
    for (const text of texts) expect(text).not.toContain(KEY);
    // A record keeps references only: the effect's public reference, never a response body.
    expect((await recordRows(admin))[0]).toMatchObject({
      result_ref_type: "SYNTHETIC_EFFECT",
      result_refs: [created.ref],
    });
  });
});

describe("TC-TST-IDM-002-001 X-Request-Id and a different key do not create a second effect (real PostgreSQL 17)", () => {
  it("TC-TST-IDM-002-001 a retry that changes only X-Request-Id is a 200 replay with one effect; another key for the same cause also leaves one effect; no column holds a request id", async () => {
    const KEY = "synthetic-idem-key-api-reqid-0001";
    const cause = ref(0xf21);
    const body = { label: "synthetic-label-a" };
    const REQUEST_ID_1 = "00000000-0000-4000-8000-0000000000e1";
    const REQUEST_ID_2 = "00000000-0000-4000-8000-0000000000e2";

    const first = await rig.post(cause, { key: KEY, body, requestId: REQUEST_ID_1 });
    expect(first.status).toBe(201);
    const created = ((await readJson(first)).json as Success).data;

    const retry = await rig.post(cause, { key: KEY, body, requestId: REQUEST_ID_2 });
    expect(retry.status).toBe(200);
    expect(((await readJson(retry)).json as Success).data).toEqual(created);
    expect(await effectRows(admin)).toHaveLength(1);
    expect(await recordCount(admin)).toBe(1);

    // Another key, same Business Cause: the Domain UNIQUE keeps one effect (the record does not decide it).
    const otherKey = await rig.post(cause, {
      key: "synthetic-idem-key-api-reqid-0002",
      body,
      requestId: REQUEST_ID_1,
    });
    expect(otherKey.status).toBe(200);
    expect(((await readJson(otherKey)).json as Success).data.ref).toBe(created.ref);
    expect(await effectRows(admin)).toHaveLength(1);

    // request_id is neither an input of the digest nor stored: no column has it, no value contains it.
    const columns = (
      await admin.query(
        "SELECT attname FROM pg_attribute WHERE attrelid = 'app.idempotency_records'::regclass AND attnum > 0 AND NOT attisdropped",
      )
    ).rows.map((row) => row.attname as string);
    expect(columns.filter((name) => /request_id|requestid|correlation/.test(name))).toEqual([]);
    const recordText = JSON.stringify(
      (await admin.query("SELECT row_to_json(r) AS j FROM app.idempotency_records r")).rows,
    );
    expect(recordText).not.toContain(REQUEST_ID_1);
    expect(recordText).not.toContain(REQUEST_ID_2);
    expect(await recordCount(admin)).toBe(2);
  });
});
