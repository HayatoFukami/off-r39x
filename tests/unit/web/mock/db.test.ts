import { describe, expect, it } from "vitest";
import {
  createMockDb,
  DB_STORAGE_KEY,
  dbStateSchema,
} from "../../../../apps/web/src/mock/backend/db.ts";
import { buildSeed } from "../../../../apps/web/src/mock/backend/seed.ts";
import { createFakeClock, createMemoryStorage } from "../../../harness/mock-backend.ts";
import { HOUR_MS, NOW_ISO } from "../../../harness/mock-seed.ts";

describe("TC-DEV-WEB-013-103 mock DB persistence with an injectable storage (design section 4)", () => {
  it("uses the documented storage key", () => {
    expect(DB_STORAGE_KEY).toBe("r39x.mock.db.v1");
  });

  it("seeds and persists on the first load, then returns the same content", () => {
    const storage = createMemoryStorage();
    const db = createMockDb({ storage, clock: createFakeClock() });
    const first = db.load();
    expect(first.kind).toBe("ready");
    expect(storage.getItem(DB_STORAGE_KEY)).not.toBeNull();
    const second = createMockDb({ storage, clock: createFakeClock() }).load();
    expect(second).toEqual(first);
  });

  it("matches buildSeed(now) for the injected clock", () => {
    const storage = createMemoryStorage();
    const loaded = createMockDb({ storage, clock: createFakeClock() }).load();
    expect(loaded).toEqual({ kind: "ready", state: buildSeed(NOW_ISO) });
  });

  it("is JSON-serializable, carries version 1 and validates against dbStateSchema", () => {
    const state = buildSeed(NOW_ISO);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
    expect(state.version).toBe(1);
    expect(dbStateSchema.safeParse(state).success).toBe(true);
  });

  it("returns a deep copy: mutating the loaded state does not change the storage", () => {
    const storage = createMemoryStorage();
    const db = createMockDb({ storage, clock: createFakeClock() });
    const loaded = db.load();
    if (loaded.kind !== "ready") throw new Error("expected ready");
    const before = storage.getItem(DB_STORAGE_KEY);
    (loaded.state as { version: number }).version = 99;
    expect(storage.getItem(DB_STORAGE_KEY)).toBe(before);
    const again = db.load();
    expect(again.kind).toBe("ready");
  });

  it("shifts every seed time with the clock (relative seed, DEV-REL-001)", () => {
    const base = JSON.stringify(buildSeed(NOW_ISO));
    const later = JSON.stringify(buildSeed("2027-06-15T09:30:00Z" as typeof NOW_ISO));
    expect(later).not.toBe(base);
    // Same clock -> same seed (no randomness inside the seed).
    expect(JSON.stringify(buildSeed(NOW_ISO))).toBe(base);
  });

  it("rejects saving an invalid state and leaves the storage untouched", () => {
    const storage = createMemoryStorage();
    const db = createMockDb({ storage, clock: createFakeClock() });
    const loaded = db.load();
    if (loaded.kind !== "ready") throw new Error("expected ready");
    const before = storage.getItem(DB_STORAGE_KEY);
    const writes = storage.writes.length;
    expect(() => db.save({ ...loaded.state, extra: 1 } as never)).toThrow();
    expect(() => db.save({ ...loaded.state, version: 2 } as never)).toThrow();
    expect(storage.getItem(DB_STORAGE_KEY)).toBe(before);
    expect(storage.writes.length).toBe(writes);
  });

  it("persists a valid saved state", () => {
    const storage = createMemoryStorage();
    const db = createMockDb({ storage, clock: createFakeClock() });
    const loaded = db.load();
    if (loaded.kind !== "ready") throw new Error("expected ready");
    db.save(loaded.state);
    expect(db.load()).toEqual({ kind: "ready", state: loaded.state });
  });
});

describe("TC-DEV-WEB-013-104 corrupted DB is an explicit error, never a silent empty or reseed", () => {
  const valid = JSON.stringify(buildSeed(NOW_ISO));
  const parsed = JSON.parse(valid) as Record<string, unknown>;
  const missing: Record<string, unknown> = { ...parsed };
  const droppedKey = Object.keys(parsed).find((key) => key !== "version");
  if (droppedKey !== undefined) delete missing[droppedKey];

  it.each([
    ["not json", "{oops"],
    ["an empty string", ""],
    ["a primitive", "7"],
    ["null", "null"],
    ["an array", "[]"],
    ["an empty object", "{}"],
    ["a wrong version", JSON.stringify({ ...parsed, version: 2 })],
    ["an unknown top-level key", JSON.stringify({ ...parsed, injected: { password: "x" } })],
    ["a missing top-level key", JSON.stringify(missing)],
  ])("reports corrupted for %s and never writes", (_name, raw) => {
    const storage = createMemoryStorage();
    storage.seedRaw(DB_STORAGE_KEY, raw);
    const result = createMockDb({ storage, clock: createFakeClock() }).load();
    expect(result.kind).toBe("corrupted");
    if (result.kind === "corrupted") expect(typeof result.message).toBe("string");
    expect(storage.writes).toEqual([]);
    expect(storage.getItem(DB_STORAGE_KEY)).toBe(raw);
  });

  it("stays corrupted on every later load (no silent self-heal)", () => {
    const storage = createMemoryStorage();
    storage.seedRaw(DB_STORAGE_KEY, "{oops");
    const db = createMockDb({ storage, clock: createFakeClock() });
    expect(db.load().kind).toBe("corrupted");
    expect(db.load().kind).toBe("corrupted");
    expect(storage.writes).toEqual([]);
  });

  it("rejects a nested unknown key (schema is strict at every level)", () => {
    const state = buildSeed(NOW_ISO) as unknown as Record<string, unknown>;
    const mutated = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
    // Add an unknown key to the first object found one level down.
    const nested = Object.values(mutated).find(
      (v) => Array.isArray(v) && typeof v[0] === "object" && v[0] !== null,
    ) as Record<string, unknown>[] | undefined;
    expect(nested, "seed must contain at least one array of records").toBeDefined();
    if (nested?.[0]) nested[0].__unexpected = true;
    const storage = createMemoryStorage();
    storage.seedRaw(DB_STORAGE_KEY, JSON.stringify(mutated));
    expect(createMockDb({ storage, clock: createFakeClock() }).load().kind).toBe("corrupted");
  });

  it("recovers only through an explicit reset() that reseeds relative to the clock", () => {
    const storage = createMemoryStorage();
    storage.seedRaw(DB_STORAGE_KEY, "{oops");
    const clock = createFakeClock();
    const db = createMockDb({ storage, clock });
    expect(db.load().kind).toBe("corrupted");
    clock.advance(2 * HOUR_MS);
    const state = db.reset();
    expect(state).toEqual(buildSeed(clock.now()));
    expect(db.load()).toEqual({ kind: "ready", state });
  });
});
