import { describe, expect, it } from "vitest";
import { startReadinessProbe } from "../../apps/api/src/api/readiness-probe.ts";

/** A timer the test drives by hand; `tick` runs every registered tick. */
function manualTimer() {
  const callbacks: Array<() => void> = [];
  return {
    setTimer: (run: () => void, ms: number) => {
      expect(ms).toBeLessThanOrEqual(30_000);
      callbacks.push(run);
      return callbacks.length;
    },
    clearTimer: () => {},
    tick: () => {
      for (const run of callbacks) run();
    },
  };
}

describe("readiness probe timing and recording (SPEC-180 INF-HLT-004 / INF-HLT-005)", () => {
  it("TC-RLM-009-117 the probe runs on its own timer at most every 30 seconds, with no request involved; an interval above 30 seconds is refused", async () => {
    let runs = 0;
    const timer = manualTimer();
    const probe = startReadinessProbe({
      check: async () => {
        runs += 1;
        return { ready: true, storeReady: true };
      },
      metrics: { storeReady: () => {} },
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
      now: () => 1,
    });
    // The first run starts at once, before any timer tick.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runs).toBe(1);
    timer.tick();
    expect(runs).toBe(2);
    await new Promise((resolve) => setTimeout(resolve, 0));
    timer.tick();
    expect(runs).toBe(3);
    probe.stop();
    expect(() =>
      startReadinessProbe({
        check: async () => ({ ready: true, storeReady: true }),
        metrics: { storeReady: () => {} },
        intervalMs: 30_001,
        setTimer: timer.setTimer,
        clearTimer: timer.clearTimer,
      }),
    ).toThrow("within 30 seconds");
  });

  it("TC-RLM-009-118 a failing check (database or store) is recorded as not ready and the store gauge as 0; recovery is 1; the probe never throws", async () => {
    let result: { ready: boolean; storeReady: boolean } | "throws" = {
      ready: true,
      storeReady: true,
    };
    const gauge: boolean[] = [];
    const timer = manualTimer();
    const probe = startReadinessProbe({
      check: async () => {
        if (result === "throws") throw new Error("connection refused");
        return result;
      },
      metrics: { storeReady: (value: boolean) => gauge.push(value) },
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
      now: () => 1,
    });
    await probe.probeNow();
    result = { ready: false, storeReady: false };
    await probe.probeNow();
    expect(probe.isReady()).toBe(false);
    result = "throws";
    await expect(probe.probeNow()).resolves.toBeUndefined();
    expect(probe.isReady()).toBe(false);
    result = { ready: true, storeReady: true };
    await probe.probeNow();
    expect(probe.isReady()).toBe(true);
    expect(gauge).toEqual([true, false, false, true]);
    probe.stop();
  });

  it("TC-RLM-009-119 probes never overlap, and a stopped probe records nothing more", async () => {
    let release: (() => void) | undefined;
    let runs = 0;
    const gauge: boolean[] = [];
    const timer = manualTimer();
    const probe = startReadinessProbe({
      check: () =>
        new Promise((resolve) => {
          runs += 1;
          release = () => resolve({ ready: true, storeReady: true });
        }),
      metrics: { storeReady: (value: boolean) => gauge.push(value) },
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
      now: () => 1,
    });
    timer.tick();
    timer.tick();
    expect(runs).toBe(1);
    probe.stop();
    release?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(gauge).toEqual([]);
    expect(probe.isReady()).toBe(false);
  });
});
