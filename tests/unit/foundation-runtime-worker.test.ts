import { expect, it, vi } from "vitest";
import {
  reconciliationJob,
  withReconciliationLock,
} from "../../packages/application/src/reconciliation.ts";
import { createWorker, processItems } from "../../packages/application/src/worker.ts";

it("TC-FOUNDATION-RUNTIME-003 drains in-flight work and stops new batches [INF-RWY-005]", async () => {
  let finish: () => void = () => {};
  let calls = 0;
  let shutdown: AbortSignal | undefined;
  const worker = createWorker({ now: () => new Date(0) }, [
    {
      cadenceMs: 15_000,
      run: async (signal) => {
        shutdown = signal;
        calls++;
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
      },
    },
  ]);
  const first = worker.tick();
  await worker.tick();
  expect(calls).toBe(1);
  const stopped = worker.stop();
  expect(shutdown?.aborted).toBe(true);
  finish();
  await first;
  await stopped;
  await worker.tick();
  expect(calls).toBe(1);
  expect(worker.ready()).toBe(false);
});
it("TC-FOUNDATION-RUNTIME-004 empty registry cannot be ready [INF-WRK-003]", () => {
  expect(createWorker({ now: () => new Date(0) }, []).ready()).toBe(false);
});
it("TC-FOUNDATION-RUNTIME-005 item errors do not stop later items [REL-REC-002]", async () => {
  const seen: number[] = [];
  let failures = 0;
  async function* items() {
    yield 1;
    yield 2;
  }
  await processItems(
    items(),
    async (item) => {
      seen.push(item);
      if (item === 1) throw new Error("Synthetic");
    },
    new AbortController().signal,
    () => {
      failures++;
    },
  );
  expect(seen).toEqual([1, 2]);
  expect(failures).toBe(1);
});
it("TC-FOUNDATION-RUNTIME-006 item deadline aborts cooperatively [REL-TMO-003]", async () => {
  vi.useFakeTimers();
  try {
    let aborted = false;
    async function* items() {
      yield 1;
    }
    const running = processItems(
      items(),
      async (_item, signal) =>
        new Promise<void>((resolve) => {
          signal.addEventListener(
            "abort",
            () => {
              aborted = true;
              resolve();
            },
            { once: true },
          );
        }),
      new AbortController().signal,
    );
    await vi.advanceTimersByTimeAsync(15_000);
    await running;
    expect(aborted).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});
it("TC-FOUNDATION-RUNTIME-007 unregistered operation never calls lock adapter [INF-WRK-003]", async () => {
  const withLock = vi.fn();
  await expect(
    withReconciliationLock({ withLock }, "API-ADM-REC-006", new Set(), async () => {}),
  ).rejects.toThrow("Unregistered");
  expect(withLock).not.toHaveBeenCalled();
});
it("TC-FOUNDATION-RUNTIME-013 passes only canonical lock key through application port [INF-WRK-003]", async () => {
  let received = "";
  const locks = {
    async withLock<T>(key: string, run: () => Promise<T>) {
      received = key;
      return { acquired: true as const, value: await run() };
    },
  };
  expect(
    await withReconciliationLock(locks, "RECON.REFUND", new Set(["RECON.REFUND"]), async () => 7),
  ).toEqual({ acquired: true, value: 7 });
  expect(received).toBe("r39x:recon:RECON.REFUND");
});
it("TC-FOUNDATION-RUNTIME-014 lock contention does not invoke handler [INF-WRK-003]", async () => {
  const batch = vi.fn();
  const job = reconciliationJob(
    { withLock: async () => ({ acquired: false }) },
    "RECON.REFUND",
    new Set(["RECON.REFUND"]),
    15_000,
    batch,
  );
  await job.run(new AbortController().signal);
  expect(batch).not.toHaveBeenCalled();
});
