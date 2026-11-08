import type { WorkerJob } from "./worker.ts";

/** SPEC-160 §9.1; subset applicable to automatic reconciliation. */
const canonicalReconciliationKeys: ReadonlySet<string> = new Set([
  "WORKER.KARAOKE.HOLD_EXPIRY",
  "RECON.ORDER.PREPARED",
  "RECON.CHECKOUT.UNKNOWN",
  "RECON.ORDER.AWAITING_PAYMENT",
  "RECON.ORDER.REVIEW_REQUIRED",
  "RECON.STRIPE_WEBHOOK",
  "RECON.REFUND",
  "RECON.ENTITLEMENT_COMPLETENESS",
  "RECON.TICKET_CHECKIN",
  "RECON.KARAOKE_RELATION",
  "RECON.GOODS_INVENTORY",
  "RECON.GOODS_HANDOFF",
  "RECON.NOTIFICATION_MISSING",
  "RECON.RESEND_UNKNOWN",
  "RECON.RESEND_WEBHOOK",
  "RECON.QR_KEY_MIGRATION",
]);

/** Infrastructure owns the dedicated session and lock lifetime. */
export interface AdvisoryLockPort {
  withLock<T>(
    key: string,
    run: () => Promise<T>,
  ): Promise<{ acquired: false } | { acquired: true; value: T }>;
}
export function reconciliationJob(
  locks: AdvisoryLockPort,
  key: string,
  canonicalKeys: ReadonlySet<string>,
  cadenceMs: number,
  batch: (signal: AbortSignal) => Promise<void>,
): WorkerJob {
  return {
    cadenceMs,
    async run(signal) {
      if (signal.aborted) return;
      await withReconciliationLock(locks, key, canonicalKeys, () => batch(signal));
    },
  };
}
/** The registry must supply an exact canonical key; no operation ID is manufactured here. */
export async function withReconciliationLock<T>(
  locks: AdvisoryLockPort,
  canonicalKey: string,
  allowedKeys: ReadonlySet<string>,
  run: () => Promise<T>,
): Promise<{ acquired: false } | { acquired: true; value: T }> {
  if (!canonicalReconciliationKeys.has(canonicalKey) || !allowedKeys.has(canonicalKey))
    throw new Error("Unregistered reconciliation operation");
  return locks.withLock(`r39x:recon:${canonicalKey}`, run);
}
