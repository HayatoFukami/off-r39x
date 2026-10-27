import type { Clock } from "@off-r39x/reliability";
import { TIMEOUTS } from "@off-r39x/reliability";
export interface WorkerJob {
  readonly cadenceMs: number;
  /** Handler owns its canonical operation key, DB item selection and state authority. */
  run(signal: AbortSignal): Promise<void>;
}
export interface Worker {
  tick(): Promise<void>;
  stop(): Promise<void>;
  ready(): boolean;
}
/** Persistent host calls tick; one batch at a time, with no overlapping invocation. */
export function createWorker(
  clock: Clock,
  jobs: readonly WorkerJob[],
  failure: () => void = () => {},
): Worker {
  if (
    jobs.some(
      (job) =>
        !Number.isSafeInteger(job.cadenceMs) || job.cadenceMs < TIMEOUTS.reconciliationItemMs,
    )
  )
    throw new Error("Invalid worker cadence");
  let stopping = false;
  let active: Promise<void> | undefined;
  const shutdown = new AbortController();
  const next = jobs.map(() => Number.NEGATIVE_INFINITY);
  const registered = [...jobs];
  return {
    ready: () => !stopping && registered.length > 0,
    async tick() {
      if (stopping || active) return;
      active = (async () => {
        for (const [index, job] of registered.entries()) {
          if (stopping) break;
          if (clock.now().getTime() < (next[index] ?? 0)) continue;
          next[index] = clock.now().getTime() + job.cadenceMs;
          try {
            await job.run(shutdown.signal);
          } catch {
            failure();
          }
        }
      })();
      try {
        await active;
      } finally {
        active = undefined;
      }
    },
    async stop() {
      stopping = true;
      shutdown.abort();
      await active;
    },
  };
}
/** Timeout aborts the item, then drains it before proceeding: never overlap timed-out writes. */
export async function processItems<T>(
  items: AsyncIterable<T>,
  handle: (item: T, signal: AbortSignal) => Promise<void>,
  signal: AbortSignal,
  failure: () => void = () => {},
): Promise<void> {
  for await (const item of items) {
    if (signal.aborted) break;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, TIMEOUTS.reconciliationItemMs);
    try {
      await handle(item, controller.signal);
      if (controller.signal.aborted) failure();
    } catch {
      failure();
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    }
  }
}
