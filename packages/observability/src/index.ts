import { z } from "zod";

export const EVENT_NAMES = [
  "http.request.completed",
  "auth.verification.completed",
  "authorization.decision.completed",
  "db.transaction.completed",
  "db.transaction.retry_scheduled",
  "payment.checkout.provider_call",
  "payment.confirmation.completed",
  "refund.provider_call",
  "webhook.stripe.received",
  "webhook.resend.completed",
  "ticket.issuance.completed",
  "qr.rotation.completed",
  "checkin.entry.completed",
  "karaoke.hold.completed",
  "goods.handoff.completed",
  "email.delivery.provider_call",
  "reconciliation.item.completed",
  "consistency_review.lifecycle.changed",
  "recovery.execution.completed",
  "security.fail_closed.triggered",
  "observability.audit.write_failed",
  "reliability.timeout.occurred",
  "reliability.retry.scheduled",
  "reliability.retry.attempted",
  "reliability.retry.exhausted",
  "reliability.retry_budget.exhausted",
  "reliability.unknown_result.opened",
  "reliability.unknown_result.resolved",
  "reliability.stuck.detected",
  "reconciliation.run.started",
  "reconciliation.run.completed",
  "recovery.automatic.completed",
] as const;
const safe = z.string().regex(/^[A-Za-z0-9_./:-]{1,128}$/);
const optionalSafe = safe.nullable().optional();
const uuid = z.uuid().nullable().optional();
const fp = z
  .string()
  .regex(/^[0-9a-f]{32}$/)
  .nullable()
  .optional();
const context = z
  .object({
    service: z.enum(["WEB", "API", "EMAIL_WORKER", "RECONCILIATION_WORKER", "RECOVERY"]),
    environment: z.enum(["production", "staging", "development", "test"]),
    actor_type: z.enum([
      "GUEST",
      "AUTHENTICATED_USER",
      "STAFF",
      "ADMINISTRATOR",
      "SYSTEM_WORKER",
      "SCHEDULED_RECONCILIATION",
      "EXTERNAL_PROVIDER",
      "INFRASTRUCTURE_OPERATOR",
    ]),
    deployment_ref: optionalSafe,
    actor_ref: optionalSafe,
  })
  .strict();
const event = z
  .object({
    event_name: z.enum(EVENT_NAMES),
    level: z.enum(["DEBUG", "INFO", "WARN", "ERROR"]),
    result: z.enum(["SUCCESS", "REJECTED", "FAILED", "PENDING", "NOOP"]),
    is_retry: z.boolean(),
    request_id: uuid,
    operation_id: optionalSafe,
    operation_execution_id: uuid,
    target_type: optionalSafe,
    target_ref: optionalSafe,
    failure_class: z
      .enum([
        "SUCCESS",
        "TEMPORARY_FAILURE",
        "PERMANENT_FAILURE",
        "UNKNOWN_RESULT",
        "CONFLICT_LOSER",
        "CONSISTENCY_FAILURE",
        "SECURITY_FAILURE",
      ])
      .nullable()
      .optional(),
    error_code: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{0,95}$/)
      .nullable()
      .optional(),
    duration_ms: z.number().int().nonnegative().nullable().optional(),
    attempt_number: z.number().int().positive().nullable().optional(),
    business_cause_ref: optionalSafe,
    transport_idempotency_fp: fp,
    provider: z.enum(["STRIPE", "RESEND", "NEON_AUTH", "NEON_DB"]).nullable().optional(),
    provider_event_ref: optionalSafe,
    provider_object_ref: optionalSafe,
    provider_idempotency_fp: fp,
    correlation_key_version: z.number().int().positive().optional(),
    consistency_review_ref: uuid,
    recovery_execution_id: uuid,
    query_name: optionalSafe,
    http_method: z
      .enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])
      .nullable()
      .optional(),
    http_route: z
      .string()
      .regex(/^\/[A-Za-z0-9_/:{}-]{0,127}$/)
      .nullable()
      .optional(),
    http_status: z.number().int().min(100).max(599).nullable().optional(),
  })
  .strict();
export type LoggerContext = z.input<typeof context>;
export type LogEvent = z.input<typeof event>;
export type LogSink = (jsonLine: string) => void | Promise<void>;
/** Only schema-parsed fields are serialized. Sink failures never escape. */
export function createLogger(
  input: LoggerContext,
  sink: LogSink = (line) => {
    process.stdout.write(`${line}\n`);
  },
): { log(event: LogEvent): void } {
  const parsed = context.safeParse(input);
  if (!parsed.success) throw new Error("Invalid log context");
  const base = parsed.data;
  return Object.freeze({
    log(inputEvent: LogEvent) {
      const parsedEvent = event.safeParse(inputEvent);
      if (!parsedEvent.success) throw new Error("Invalid log record");
      const value = parsedEvent.data;
      if (
        value.event_name === "http.request.completed" &&
        (!value.request_id || !value.http_method || !value.http_route || !value.http_status)
      )
        throw new Error("Invalid log record");
      if (value.operation_id && !value.operation_execution_id)
        throw new Error("Invalid log record");
      if (value.is_retry && !value.attempt_number) throw new Error("Invalid log record");
      const record = Object.assign(
        { timestamp: new Date().toISOString(), schema_version: 1 },
        base,
        value,
      );
      try {
        const result = sink(JSON.stringify(record));
        if (result) void Promise.resolve(result).catch(() => {});
      } catch {
        /* Logging is not business authority. */
      }
    },
  });
}
