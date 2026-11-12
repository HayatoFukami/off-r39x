// SPEC-180 INF-HLT-004 / SPEC-160 OBS-ALT-042: the rate limit store probe. It runs the same store
// check as readiness (connection + script execution) on its own timer, independent of request
// handling, and records the result in `r39x_rate_limit_store_ready`. A request-free period in
// which the store is unreachable is therefore still visible.
import type { RateLimitMetrics } from "@off-r39x/observability";

/** INF-HLT-004: the probe interval is at most 30 seconds. */
export const STORE_PROBE_MAX_INTERVAL_MS = 30_000;

export interface StoreProbeOptions {
  /** The readiness check (`limiter.assertReady`); rejects when the store is unusable. */
  readonly check: () => Promise<void>;
  readonly metrics: Pick<RateLimitMetrics, "storeReady">;
  /** Defaults to, and may not exceed, 30 seconds. */
  readonly intervalMs?: number;
  /** Test seams. */
  readonly setTimer?: (run: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
}
export interface StoreProbe {
  /** Runs one probe now (also used for the first sample). Never rejects. */
  probeNow(): Promise<void>;
  stop(): void;
}

/**
 * Starts the probe: one immediate sample, then one every `intervalMs`. Samples never overlap (a slow
 * check is not stacked up) and a check failure is recorded as 0, never thrown.
 */
export function startRateLimitStoreProbe(options: StoreProbeOptions): StoreProbe {
  const intervalMs = options.intervalMs ?? STORE_PROBE_MAX_INTERVAL_MS;
  if (!Number.isFinite(intervalMs) || intervalMs <= 0 || intervalMs > STORE_PROBE_MAX_INTERVAL_MS)
    throw new Error("Rate limit store probe interval must be within 30 seconds");
  const setTimer =
    options.setTimer ??
    ((run, ms) => {
      const handle = setInterval(run, ms);
      handle.unref();
      return handle;
    });
  const clearTimer = options.clearTimer ?? ((handle) => clearInterval(handle as NodeJS.Timeout));
  let inFlight: Promise<void> | undefined;
  let stopped = false;

  const probeNow = (): Promise<void> => {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      let ready = false;
      try {
        await options.check();
        ready = true;
      } catch {
        ready = false;
      }
      if (stopped) return;
      try {
        options.metrics.storeReady(ready);
      } catch {
        /* Recording is never authority. */
      }
    })().finally(() => {
      inFlight = undefined;
    });
    return inFlight;
  };

  const handle = setTimer(() => {
    void probeNow();
  }, intervalMs);
  void probeNow();
  return Object.freeze({
    probeNow,
    stop() {
      stopped = true;
      clearTimer(handle);
    },
  });
}
