import { afterEach, describe, expect, it, vi } from "vitest";
import { startReadinessProbe } from "../../apps/api/src/api/readiness-probe.ts";
import {
  createRateLimitMetrics,
  evaluateStoreReadyAlert,
} from "../../packages/observability/src/index.ts";
import { RATE_LIMIT_CLASS_IDS } from "../../packages/security/src/index.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("r39x_rate_limit_store_ready per instance (SPEC-160 §42, SPEC-180 INF-HLT-005)", () => {
  const make = (instance: string, clock: { now: number }) =>
    createRateLimitMetrics({
      environment: "test",
      classIds: RATE_LIMIT_CLASS_IDS,
      instance,
      now: () => clock.now,
    });

  it("TC-RLM-009-206 the series carries environment, instance and value; it is absent until the first probe result", () => {
    const clock = { now: 1_000 };
    const m = make("a1b2c3d4", clock);
    expect(m.snapshot().storeReady).toEqual([]);
    m.storeReady(true);
    expect(m.snapshot().storeReady).toEqual([
      { environment: "test", instance: "a1b2c3d4", value: 1 },
    ]);
    m.storeReady(false);
    expect(m.snapshot().storeReady).toEqual([
      { environment: "test", instance: "a1b2c3d4", value: 0 },
    ]);
  });

  it("TC-RLM-009-207 the value is computed at export: 0 once the last successful probe is older than 90 s, even when no probe ran since", () => {
    const clock = { now: 1_000 };
    const m = make("a1b2c3d4", clock);
    m.storeReady(true);
    clock.now += 90_000;
    expect(m.snapshot().storeReady[0]?.value).toBe(1);
    clock.now += 1;
    expect(m.snapshot().storeReady[0]?.value).toBe(0);
    m.storeReady(true);
    expect(m.snapshot().storeReady[0]?.value).toBe(1);
    // A failing probe is 0 at once.
    m.storeReady(false);
    expect(m.snapshot().storeReady[0]?.value).toBe(0);
  });

  it("TC-RLM-009-208 each process gets its own generated instance label (short, bounded), distinct per process", () => {
    const first = createRateLimitMetrics({ environment: "test", classIds: RATE_LIMIT_CLASS_IDS });
    const second = createRateLimitMetrics({ environment: "test", classIds: RATE_LIMIT_CLASS_IDS });
    first.storeReady(true);
    second.storeReady(true);
    const a = first.snapshot().storeReady[0]?.instance ?? "";
    const b = second.snapshot().storeReady[0]?.instance ?? "";
    expect(a).toMatch(/^[0-9a-f]{8}$/);
    expect(b).toMatch(/^[0-9a-f]{8}$/);
    expect(a).not.toBe(b);
    expect(() =>
      createRateLimitMetrics({ environment: "test", classIds: [], instance: "has space" }),
    ).toThrow();
  });

  it("TC-RLM-009-209 OBS-ALT-042 fires when any one of two instances is 0, when a stopped instance goes stale, and when every instance is missing", () => {
    const clock = { now: 1_000 };
    const one = make("aaaaaaaa", clock);
    const two = make("bbbbbbbb", clock);
    one.storeReady(true);
    two.storeReady(true);
    const series = () => [...one.snapshot().storeReady, ...two.snapshot().storeReady];
    expect(evaluateStoreReadyAlert(series())).toBe(false);
    // Only one instance reports 0; the other stays 1.
    two.storeReady(false);
    expect(series().map((entry) => entry.value)).toEqual([1, 0]);
    expect(evaluateStoreReadyAlert(series())).toBe(true);
    two.storeReady(true);
    expect(evaluateStoreReadyAlert(series())).toBe(false);
    // One instance stops probing: it is 0 after 90 s while the other (which keeps probing) is 1.
    clock.now += 60_000;
    one.storeReady(true);
    clock.now += 31_000;
    expect(series().map((entry) => entry.value)).toEqual([1, 0]);
    expect(evaluateStoreReadyAlert(series())).toBe(true);
    // No sample from any instance is a failure too.
    expect(evaluateStoreReadyAlert([])).toBe(true);
  });
});

describe("readiness probe clock (SPEC-180 INF-HLT-005)", () => {
  it("TC-RLM-009-210 the 90 s staleness uses the monotonic clock: a wall clock moving backwards does not keep a stopped probe ready, and moving forwards does not stale a live one", async () => {
    let monotonic = 10_000;
    vi.spyOn(performance, "now").mockImplementation(() => monotonic);
    let wall = 1_800_000_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => wall);
    const probe = startReadinessProbe({
      check: async () => ({ ready: true, storeReady: true }),
      metrics: { storeReady: () => {} },
      setTimer: () => 0,
      clearTimer: () => {},
    });
    await probe.probeNow();
    expect(probe.isReady()).toBe(true);
    // The wall clock goes back a day: the probe stopped 90.001 s ago on the monotonic clock.
    wall -= 86_400_000;
    monotonic += 90_001;
    expect(probe.isReady()).toBe(false);
    await probe.probeNow();
    expect(probe.isReady()).toBe(true);
    // The wall clock goes forward a day: only 10 s have elapsed on the monotonic clock.
    wall += 86_400_000;
    monotonic += 10_000;
    expect(probe.isReady()).toBe(true);
    probe.stop();
  });
});
