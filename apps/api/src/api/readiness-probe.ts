// SPEC-180 INF-HLT-005 / INF-HLT-004, SPEC-140 SEC-ABU-018: the readiness snapshot. A background
// probe runs the readiness checks (database, store, configuration) at most every 30 seconds, one run
// at a time. `/internal/health/ready` only reads the snapshot, so any number of health requests costs
// no database or store call. The store item of the same run feeds `r39x_rate_limit_store_ready`.
import type { RateLimitMetrics } from "@off-r39x/observability";

/** INF-HLT-005: the probe runs at most this far apart. */
export const READINESS_MAX_INTERVAL_MS = 30_000;
/** INF-HLT-005: a probe that has not succeeded for this long has stopped; the process is not ready. */
export const READINESS_STALE_AFTER_MS = 90_000;

export interface ReadinessCheckResult {
  /** Every readiness check passed. */
  readonly ready: boolean;
  /** The rate limit store item of the same run (connection and script execution with a write). */
  readonly storeReady: boolean;
}

export interface ReadinessProbeOptions {
  readonly check: () => Promise<ReadinessCheckResult>;
  readonly metrics: Pick<RateLimitMetrics, "storeReady">;
  /** Defaults to, and may not exceed, 30 seconds. */
  readonly intervalMs?: number;
  /** Defaults to, and may not exceed, 90 seconds after the last successful run. */
  readonly staleAfterMs?: number;
  /** Test seams. */
  readonly now?: () => number;
  readonly setTimer?: (run: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
}

export interface ReadinessProbe {
  /** Runs one probe now, or joins the run in progress. Never rejects. */
  probeNow(): Promise<void>;
  /** Reads the snapshot only; never runs a check. False before the first successful run. */
  isReady(): boolean;
  stop(): void;
}

/**
 * Starts the probe: one run immediately, then one per interval. Runs never overlap (a slow run is
 * not stacked up), and a failing or throwing check is recorded as not ready, never thrown.
 */
export function startReadinessProbe(options: ReadinessProbeOptions): ReadinessProbe {
  const intervalMs = options.intervalMs ?? READINESS_MAX_INTERVAL_MS;
  if (!Number.isFinite(intervalMs) || intervalMs <= 0 || intervalMs > READINESS_MAX_INTERVAL_MS)
    throw new Error("Readiness probe interval must be within 30 seconds");
  const staleAfterMs = options.staleAfterMs ?? READINESS_STALE_AFTER_MS;
  if (
    !Number.isFinite(staleAfterMs) ||
    staleAfterMs <= 0 ||
    staleAfterMs > READINESS_STALE_AFTER_MS
  )
    throw new Error("Readiness snapshot staleness must be within 90 seconds");
  const now = options.now ?? (() => Date.now());
  const setTimer =
    options.setTimer ??
    ((run, ms) => {
      const handle = setInterval(run, ms);
      handle.unref();
      return handle;
    });
  const clearTimer = options.clearTimer ?? ((handle) => clearInterval(handle as NodeJS.Timeout));
  let snapshot: ReadinessCheckResult | undefined;
  let lastSuccessAt: number | undefined;
  let inFlight: Promise<void> | undefined;
  let stopped = false;

  const probeNow = (): Promise<void> => {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      let result: ReadinessCheckResult;
      try {
        result = await options.check();
      } catch {
        result = { ready: false, storeReady: false };
      }
      if (stopped) return;
      snapshot = result;
      if (result.ready) lastSuccessAt = now();
      try {
        options.metrics.storeReady(result.storeReady);
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
    isReady(): boolean {
      if (!snapshot?.ready || lastSuccessAt === undefined) return false;
      return now() - lastSuccessAt <= staleAfterMs;
    },
    stop() {
      stopped = true;
      clearTimer(handle);
    },
  });
}
