export interface Clock {
  now(): Date;
}
export const systemClock: Clock = Object.freeze({ now: () => new Date() });
export const TIMEOUTS = Object.freeze({
  authMs: 3000,
  jwksMs: 3000,
  poolAcquireMs: 2000,
  statementMs: 5000,
  readStatementMs: 10000,
  lockMs: 1000,
  transactionMs: 8000,
  stripeMs: 10000,
  resendMs: 10000,
  reconciliationItemMs: 15000,
  emailClaimLeaseMs: 120000,
  webhookSoftMs: 6000,
  webhookHardMs: 8000,
  manualRecoveryMs: 15000,
});
export class DeadlineError extends Error {
  constructor() {
    super("Operation deadline exceeded");
    this.name = "DeadlineError";
  }
}
export class OperationAbortedError extends Error {
  constructor() {
    super("Operation aborted");
    this.name = "OperationAbortedError";
  }
}
export async function withDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error("Invalid deadline");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: () => void = () => {};
  const interrupted = new Promise<never>((_, reject) => {
    onAbort = () => {
      controller.abort();
      reject(new OperationAbortedError());
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => {
      controller.abort();
      reject(new DeadlineError());
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      interrupted,
      Promise.resolve().then(() => {
        if (controller.signal.aborted) throw new OperationAbortedError();
        return operation(controller.signal);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}
export type DatabaseRetryState = "40001" | "40P01";
export function isDatabaseRetryable(error: unknown): error is { code: DatabaseRetryState } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "40001" || error.code === "40P01")
  );
}
export interface RetryPolicy {
  readonly initialMs: number;
  readonly multiplier: 2;
  readonly maxDelayMs: number;
  readonly maxAttempts: number;
  readonly maxElapsedMs: number;
  readonly jitter: "full";
}
const policy = (
  initialMs: number,
  maxDelayMs: number,
  maxAttempts: number,
  maxElapsedMs: number,
): RetryPolicy =>
  Object.freeze({
    initialMs,
    multiplier: 2,
    maxDelayMs,
    maxAttempts,
    maxElapsedMs,
    jitter: "full",
  });
export const RETRY_POLICIES = Object.freeze({
  "40001": policy(50, 400, 4, 2000),
  "40P01": policy(100, 800, 4, 3000),
  databaseConnection: policy(100, 500, 3, 3000),
  auth: policy(100, 500, 2, 7000),
  stripeCheckout: policy(500, 5000, 5, 30000),
  stripeRead: policy(250, 2000, 4, 15000),
  stripeRefund: policy(1000, 5000, 3, 20000),
  stripeWebhook: policy(5000, 300000, 6, 1800000),
  resendNotAccepted: policy(30000, 600000, 8, 2700000),
  resendUnknown: policy(30000, 1800000, 8, 14400000),
  recipientLookup: policy(30000, 900000, 10, 7200000),
  abandonedEmailClaim: policy(30000, 300000, 3, 900000),
  resendWebhook: policy(5000, 300000, 6, 1800000),
});
export const RESEND_LONG_PHASE_POLICY = Object.freeze({
  intervalMs: 3600000,
  jitterFraction: 0.1,
  maxProbes: 18,
  maxElapsedFromFirstCallMs: 79200000,
  safeCutoffMs: 82800000,
});
export function retryDelay(
  policy: RetryPolicy,
  retryNumber: number,
  random: () => number = Math.random,
): number {
  const value = random();
  if (
    !Number.isSafeInteger(retryNumber) ||
    retryNumber < 1 ||
    retryNumber >= policy.maxAttempts ||
    !Number.isFinite(value) ||
    value < 0 ||
    value >= 1
  )
    throw new Error("Invalid retry input");
  return (
    value * Math.min(policy.maxDelayMs, policy.initialMs * policy.multiplier ** (retryNumber - 1))
  );
}
