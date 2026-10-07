import { describe, expect, it } from "vitest";
import { applyLatency } from "../../../../apps/web/src/mock/backend/latency.ts";
import { defaultScenario } from "../../../../apps/web/src/mock/backend/scenario.ts";
import { createSleepRecorder } from "../../../harness/mock-backend.ts";

describe("TC-DEV-REL-001-101 applyLatency uses the injected sleep (DEV-REL-001)", () => {
  it("never calls sleep when the latency is none", async () => {
    const sleep = createSleepRecorder();
    await applyLatency(sleep, { ...defaultScenario(), latency: "none" });
    expect(sleep.calls).toEqual([]);
  });

  it("calls sleep exactly once with latencyLongMs when the latency is long", async () => {
    const sleep = createSleepRecorder();
    await applyLatency(sleep, { ...defaultScenario(), latency: "long", latencyLongMs: 4321 });
    expect(sleep.calls).toEqual([4321]);
  });

  it("awaits the sleep before resolving", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let done = false;
    const pending = applyLatency(() => gate, { ...defaultScenario(), latency: "long" }).then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(done).toBe(false);
    release();
    await pending;
    expect(done).toBe(true);
  });
});
