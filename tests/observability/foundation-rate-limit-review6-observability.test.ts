import { describe, expect, it } from "vitest";
import { startReadinessProbe } from "../../apps/api/src/api/readiness-probe.ts";

describe("readiness snapshot probe (SPEC-180 INF-HLT-005, SPEC-140 SEC-ABU-018)", () => {
  function manualTimer() {
    const callbacks: Array<() => void> = [];
    return {
      setTimer: (run: () => void) => {
        callbacks.push(run);
        return callbacks.length;
      },
      clearTimer: () => {},
      tick: () => {
        for (const run of callbacks) run();
      },
    };
  }

  it("TC-RLM-009-203 not ready before the first probe completes, ready after a success, not ready after a failure", async () => {
    let result = { ready: false, storeReady: false };
    const timer = manualTimer();
    const probe = startReadinessProbe({
      check: async () => result,
      metrics: { storeReady: () => {} },
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
      now: () => 1,
    });
    expect(probe.isReady()).toBe(false);
    await probe.probeNow();
    expect(probe.isReady()).toBe(false);
    result = { ready: true, storeReady: true };
    await probe.probeNow();
    expect(probe.isReady()).toBe(true);
    result = { ready: false, storeReady: true };
    await probe.probeNow();
    expect(probe.isReady()).toBe(false);
    probe.stop();
  });

  it("TC-RLM-009-204 reading the state never runs a check, and probes do not overlap: a slow check is not stacked by the interval", async () => {
    let calls = 0;
    let release: (() => void) | undefined;
    const timer = manualTimer();
    const probe = startReadinessProbe({
      check: () =>
        new Promise((resolve) => {
          calls += 1;
          release = () => resolve({ ready: true, storeReady: true });
        }),
      metrics: { storeReady: () => {} },
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
      now: () => 1,
    });
    expect(calls).toBe(1);
    for (let i = 0; i < 50; i += 1) {
      expect(probe.isReady()).toBe(false);
      timer.tick();
    }
    expect(calls).toBe(1);
    release?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (let i = 0; i < 50; i += 1) probe.isReady();
    expect(calls).toBe(1);
    probe.stop();
  });

  it("TC-RLM-009-205 a probe that stopped completing is not ready after 90 s; the store gauge comes from the same run as the readiness state", async () => {
    let now = 1_000;
    const gauge: boolean[] = [];
    const timer = manualTimer();
    const probe = startReadinessProbe({
      check: async () => ({ ready: true, storeReady: false }),
      metrics: { storeReady: (value: boolean) => gauge.push(value) },
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
      now: () => now,
    });
    await probe.probeNow();
    expect(probe.isReady()).toBe(true);
    expect(gauge).toEqual([false]);
    now += 90_000;
    expect(probe.isReady()).toBe(true);
    now += 1;
    expect(probe.isReady()).toBe(false);
    await probe.probeNow();
    expect(probe.isReady()).toBe(true);
    probe.stop();
  });
});
