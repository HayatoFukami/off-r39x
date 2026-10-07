import type { ApiPort } from "../../apps/web/src/api-client/port.ts";
import type { Read, UtcInstant } from "../../apps/web/src/api-client/types.ts";
import type { AuthPort } from "../../apps/web/src/auth/port.ts";
import type { Clock } from "../../apps/web/src/mock/backend/clock.ts";
import { createMockDb, type MockDb, type MockStorage } from "../../apps/web/src/mock/backend/db.ts";
import type { IdGenerator } from "../../apps/web/src/mock/backend/ids.ts";
import type { Sleep } from "../../apps/web/src/mock/backend/latency.ts";
import { createMockApi } from "../../apps/web/src/mock/backend/mock-api.ts";
import { createMockAuth } from "../../apps/web/src/mock/backend/mock-auth.ts";
import {
  defaultScenario,
  type Scenario,
  saveScenario,
} from "../../apps/web/src/mock/backend/scenario.ts";
import { NOW_ISO, TEST_PASSWORD } from "./mock-seed.ts";

// Test-only harness for the UI mock (tests/contracts/s2-mock-backend.md). Everything is injected:
// no real clock, no random, no timers, no network. Never imported from production code.

export type StorageOp = { op: "set" | "remove"; key: string };

export type MemoryStorage = MockStorage & {
  readonly writes: StorageOp[];
  dump(): Record<string, string>;
  seedRaw(key: string, value: string): void;
};

export function createMemoryStorage(): MemoryStorage {
  const map = new Map<string, string>();
  const writes: StorageOp[] = [];
  return {
    writes,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      writes.push({ op: "set", key });
      map.set(key, value);
    },
    removeItem: (key) => {
      writes.push({ op: "remove", key });
      map.delete(key);
    },
    dump: () => Object.fromEntries(map),
    seedRaw: (key, value) => {
      map.set(key, value);
    },
  };
}

export type FakeClock = Clock & { set(iso: string): void; advance(ms: number): void };

export function createFakeClock(iso: string = NOW_ISO): FakeClock {
  let ms = Date.parse(iso);
  const format = (value: number): UtcInstant =>
    new Date(value).toISOString().replace(".000Z", "Z") as UtcInstant;
  return {
    now: () => format(ms),
    set: (next) => {
      ms = Date.parse(next);
    },
    advance: (delta) => {
      ms += delta;
    },
  };
}

export type CounterIds = IdGenerator & { count(): number };

/** Deterministic canonical UUIDs. The f0000000 prefix never collides with seed ids. */
export function createCounterIds(): CounterIds {
  let n = 0;
  const gen = (): string => {
    n += 1;
    return `f0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  };
  return Object.assign(gen, { count: () => n });
}

export type SleepRecorder = Sleep & { readonly calls: number[] };

export function createSleepRecorder(): SleepRecorder {
  const calls: number[] = [];
  const sleep = (ms: number): Promise<void> => {
    calls.push(ms);
    return Promise.resolve();
  };
  return Object.assign(sleep, { calls });
}

export type ScenarioPatch = Partial<Omit<Scenario, "cart" | "auth">> & {
  cart?: Partial<Scenario["cart"]>;
  auth?: Partial<Scenario["auth"]>;
};

export type Backend = {
  storage: MemoryStorage;
  clock: FakeClock;
  ids: CounterIds;
  sleep: SleepRecorder;
  api: ApiPort;
  auth: AuthPort;
  db: MockDb;
  setScenario(patch: ScenarioPatch): void;
  signInAs(email: string): Promise<void>;
  signOut(): Promise<void>;
};

export function mergeScenario(base: Scenario, patch: ScenarioPatch): Scenario {
  return {
    ...base,
    ...patch,
    cart: { ...base.cart, ...patch.cart },
    auth: { ...base.auth, ...patch.auth },
  };
}

export function createBackend(
  opts: { storage?: MemoryStorage; clock?: FakeClock; ids?: CounterIds } = {},
): Backend {
  const storage = opts.storage ?? createMemoryStorage();
  const clock = opts.clock ?? createFakeClock();
  const ids = opts.ids ?? createCounterIds();
  const sleep = createSleepRecorder();
  const api = createMockApi({ storage, clock, sleep, idGenerator: ids });
  const auth = createMockAuth({ storage, clock, idGenerator: ids });
  const db = createMockDb({ storage, clock });
  let scenario = defaultScenario();
  saveScenario(storage, scenario);
  return {
    storage,
    clock,
    ids,
    sleep,
    api,
    auth,
    db,
    setScenario(patch) {
      scenario = mergeScenario(scenario, patch);
      saveScenario(storage, scenario);
    },
    async signInAs(email) {
      const result = await auth.signIn({ email, password: TEST_PASSWORD });
      if (result.kind !== "signed_in") {
        throw new Error(`harness sign-in failed: ${result.kind}`);
      }
    },
    async signOut() {
      await auth.signOut();
    },
  };
}

/** Unwraps Read<T>.ok or fails the test with the unexpected kind. */
export function okData<T>(read: Read<T>): T {
  if (read.kind !== "ok") {
    throw new Error(`expected Read.ok but got ${read.kind}`);
  }
  return read.data;
}

/** A stable JSON of the whole mock DB, to prove that nothing changed. */
export function dbFingerprint(backend: Backend): string {
  const loaded = backend.db.load();
  if (loaded.kind !== "ready") {
    throw new Error("expected a ready DB");
  }
  return JSON.stringify(loaded.state);
}
