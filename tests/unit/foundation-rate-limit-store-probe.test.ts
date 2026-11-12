import { describe, expect, it } from "vitest";
import {
  STORE_PROBE_MAX_INTERVAL_MS,
  startRateLimitStoreProbe,
} from "../../apps/api/src/api/store-probe.ts";
import { createRateLimitMetrics } from "../../packages/observability/src/index.ts";
import { RATE_LIMIT_CLASS_IDS } from "../../packages/security/src/index.ts";

const metrics = () =>
  createRateLimitMetrics({ environment: "test", classIds: RATE_LIMIT_CLASS_IDS });
const flush = () => new Promise((resolve) => setImmediate(resolve));

/** A manual timer so the test controls the interval without waiting for it. */
function manualTimer() {
  const state = { run: undefined as (() => void) | undefined, ms: 0, cleared: false };
  return {
    state,
    setTimer: (run: () => void, ms: number) => {
      state.run = run;
      state.ms = ms;
      return state;
    },
    clearTimer: () => {
      state.cleared = true;
    },
  };
}

describe("rate limit store probe (INF-HLT-004, OBS-ALT-042)", () => {
  it("TC-RLM-009-117 the probe runs the readiness store check on its own timer, at most every 30 seconds, with no request involved", async () => {
    const m = metrics();
    const timer = manualTimer();
    let checks = 0;
    const probe = startRateLimitStoreProbe({
      check: async () => {
        checks += 1;
      },
      metrics: m,
      ...timer,
    });
    expect(timer.state.ms).toBe(STORE_PROBE_MAX_INTERVAL_MS);
    expect(timer.state.ms).toBeLessThanOrEqual(30_000);
    await flush();
    expect(checks).toBe(1);
    expect(m.snapshot().storeReady).toEqual([{ environment: "test", value: 1 }]);
    timer.state.run?.();
    await flush();
    expect(checks).toBe(2);
    probe.stop();
    expect(timer.state.cleared).toBe(true);
  });

  it("TC-RLM-009-118 a failing store check is recorded as 0 and a recovered one as 1; the probe never throws", async () => {
    const m = metrics();
    const timer = manualTimer();
    let healthy = false;
    const probe = startRateLimitStoreProbe({
      check: async () => {
        if (!healthy) throw new Error("store unreachable");
      },
      metrics: m,
      ...timer,
    });
    await flush();
    expect(m.snapshot().storeReady).toEqual([{ environment: "test", value: 0 }]);
    healthy = true;
    timer.state.run?.();
    await flush();
    expect(m.snapshot().storeReady).toEqual([{ environment: "test", value: 1 }]);
    probe.stop();
  });

  it("TC-RLM-009-119 probes never overlap, an interval above 30 seconds is refused, and a stopped probe records nothing more", async () => {
    const m = metrics();
    const timer = manualTimer();
    let release: (() => void) | undefined;
    let checks = 0;
    const probe = startRateLimitStoreProbe({
      check: () =>
        new Promise<void>((resolve) => {
          checks += 1;
          release = resolve;
        }),
      metrics: m,
      ...timer,
    });
    timer.state.run?.();
    timer.state.run?.();
    await flush();
    expect(checks).toBe(1);
    probe.stop();
    release?.();
    await flush();
    expect(m.snapshot().storeReady).toEqual([]);
    expect(() =>
      startRateLimitStoreProbe({
        check: async () => {},
        metrics: m,
        intervalMs: 30_001,
        ...manualTimer(),
      }),
    ).toThrow();
    expect(() =>
      startRateLimitStoreProbe({
        check: async () => {},
        metrics: m,
        intervalMs: 0,
        ...manualTimer(),
      }),
    ).toThrow();
  });
});
