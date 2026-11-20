import { once } from "node:events";
import { createServer } from "node:net";
import { createDatabase } from "@off-r39x/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../apps/api/src/api/app.ts";
import { bootstrap } from "../../apps/api/src/bootstrap/index.ts";
import { syntheticApiEnv } from "../harness/config/api-env.ts";
import { createMemoryStore } from "../harness/rate-limit/memory-store.ts";

const PORT = "18932";
// Harness-only doubles (TC-INF-SEC-007-006/007): the database package is stubbed so no database is
// needed; createApp is the real one wrapped in a spy that records its dependencies.
vi.mock("@off-r39x/db", async (get) => {
  const real = await get<typeof import("@off-r39x/db")>();
  return {
    ...real,
    createDatabase: vi.fn(() => ({ pool: {}, close: vi.fn(async () => {}) })),
    createPrincipalRepository: vi.fn(() => ({})),
    createCurrentProfileRepository: vi.fn(() => ({})),
    checkReadiness: vi.fn(async () => ({ ready: false })),
  };
});
vi.mock("../../apps/api/src/api/app.ts", async (get) => {
  const real = await get<typeof import("../../apps/api/src/api/app.ts")>();
  return { ...real, createApp: vi.fn((dependencies) => real.createApp(dependencies)) };
});

afterEach(() => {
  vi.mocked(createApp).mockClear();
  vi.mocked(createDatabase).mockClear();
});

async function attempt(env: Record<string, string | undefined>) {
  let runtime: ReturnType<typeof bootstrap> | undefined;
  let failure: unknown;
  try {
    runtime = bootstrap(env, { rateLimitStore: createMemoryStore() });
  } catch (error) {
    failure = error;
  } finally {
    // Pre-implementation the server starts; never leave it running.
    if (runtime) {
      if (!runtime.server.listening) await once(runtime.server, "listening");
      await runtime.close();
    }
  }
  return { runtime, failure };
}

describe("bootstrap wiring of the list cursor key (INF-SEC-007)", () => {
  it("TC-INF-SEC-007-006 a missing or malformed cursor key or version stops bootstrap before any resource is created", async () => {
    const cases: Record<string, Record<string, string | undefined>> = {
      "missing key": { LIST_CURSOR_HMAC_KEY: undefined },
      "33-byte key": { LIST_CURSOR_HMAC_KEY: Buffer.alloc(33, 13).toString("base64") },
      "version 0": { LIST_CURSOR_HMAC_KEY_VERSION: "0" },
    };
    for (const [name, overrides] of Object.entries(cases)) {
      const { failure } = await attempt(syntheticApiEnv({ PORT, ...overrides }));
      expect((failure as Error | undefined)?.message, name).toBe("Invalid server configuration");
      expect(createDatabase, name).not.toHaveBeenCalled();
      expect(createApp, name).not.toHaveBeenCalled();
      // No server was started: the port is free.
      await new Promise<void>((resolve, reject) => {
        const probe = createServer();
        probe.once("error", reject);
        probe.listen(Number(PORT), "127.0.0.1", () => probe.close(() => resolve()));
      });
    }
  });

  it("TC-INF-SEC-007-007 bootstrap passes the decoded cursor key and version to createApp", async () => {
    const env = syntheticApiEnv({ PORT, LIST_CURSOR_HMAC_KEY_VERSION: "4" });
    const { failure } = await attempt(env);
    expect(failure).toBeUndefined();
    expect(createApp).toHaveBeenCalledTimes(1);
    const passed = vi.mocked(createApp).mock.calls[0]?.[0] as unknown as {
      listCursorKey?: { version: number; key: Uint8Array };
    };
    expect(passed.listCursorKey?.version).toBe(4);
    const key = Buffer.from(passed.listCursorKey?.key ?? []);
    expect(key.equals(Buffer.from(env.LIST_CURSOR_HMAC_KEY as string, "base64"))).toBe(true);
    for (const name of ["RATE_LIMIT_HMAC_KEY", "OBS_CORRELATION_HMAC_KEY"])
      expect(key.equals(Buffer.from(env[name] as string, "base64")), name).toBe(false);
  });
});
