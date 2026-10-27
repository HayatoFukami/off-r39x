import type { PaymentLookup, PaymentWebhookVerifier } from "@off-r39x/application";
import type { LogEvent } from "@off-r39x/observability";
import { TIMEOUTS, withDeadline } from "@off-r39x/reliability";
import Stripe from "stripe";

function client(secret: string, transport?: typeof fetch): Stripe {
  return new Stripe(secret, {
    timeout: TIMEOUTS.stripeMs,
    maxNetworkRetries: 0,
    // Node socket inactivity timeouts reset on trickling bytes. Use the SDK
    // Fetch transport plus an adapter-owned monotonic total deadline.
    httpClient: Stripe.createFetchHttpClient(transport ?? fetch),
  });
}
type Logger = { log(event: LogEvent): void };
function lookupFailure(error: unknown, logger?: Logger): { kind: "BLOCKED" | "TEMPORARY_FAILURE" } {
  const status = error instanceof Stripe.errors.StripeError ? error.statusCode : undefined;
  const kind =
    status && status >= 400 && status < 500 && ![408, 409, 429].includes(status)
      ? "BLOCKED"
      : "TEMPORARY_FAILURE";
  logger?.log({
    event_name: "security.fail_closed.triggered",
    level: "WARN",
    result: "FAILED",
    is_retry: false,
    provider: "STRIPE",
    failure_class: kind === "BLOCKED" ? "PERMANENT_FAILURE" : "TEMPORARY_FAILURE",
  });
  return { kind };
}
export function createStripeLookup(
  secret: string,
  logger?: Logger,
  transport?: typeof fetch,
): PaymentLookup {
  const request = <T>(operation: (sdk: Stripe) => Promise<T>) =>
    withDeadline(
      (signal) =>
        operation(
          client(secret, (url, init) =>
            (transport ?? fetch)(url, {
              ...init,
              signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal,
            }),
          ),
        ),
      TIMEOUTS.stripeMs,
    );
  return {
    async checkout(id) {
      if (!/^cs_[A-Za-z0-9_]+$/.test(id)) return { kind: "BLOCKED" };
      try {
        const value = await request((sdk) => sdk.checkout.sessions.retrieve(id));
        if (
          value.id !== id ||
          ![null, "open", "complete", "expired"].includes(value.status) ||
          !["paid", "unpaid", "no_payment_required"].includes(value.payment_status)
        )
          return lookupFailure(undefined, logger);
        return {
          kind: "FOUND",
          id: value.id,
          status: value.status,
          paymentStatus: value.payment_status,
        };
      } catch (error) {
        return lookupFailure(error, logger);
      }
    },
    async refund(id) {
      if (!/^re_[A-Za-z0-9_]+$/.test(id)) return { kind: "BLOCKED" };
      try {
        const value = await request((sdk) => sdk.refunds.retrieve(id));
        if (
          value.id !== id ||
          ![null, "pending", "requires_action", "succeeded", "failed", "canceled"].includes(
            value.status ?? null,
          )
        )
          return lookupFailure(undefined, logger);
        return { kind: "FOUND", id: value.id, status: value.status ?? null };
      } catch (error) {
        return lookupFailure(error, logger);
      }
    },
  };
}
/** Raw bytes only; verification never mutates provider or business state. */
export function createStripeWebhookVerifier(
  secret: string,
  webhookSecret: string,
  expectedMode: "live" | "test",
  logger?: Logger,
): PaymentWebhookVerifier {
  if (expectedMode !== "live" && expectedMode !== "test") throw new Error("Invalid webhook mode");
  const sdk = client(secret);
  return {
    verify(rawBody, signature) {
      try {
        if (!(rawBody instanceof Uint8Array) || typeof signature !== "string")
          throw new Error("Raw webhook bytes required");
        const event = sdk.webhooks.constructEvent(Buffer.from(rawBody), signature, webhookSecret);
        if (
          !/^evt_[A-Za-z0-9_]+$/.test(event.id) ||
          event.object !== "event" ||
          typeof event.type !== "string" ||
          !/^[a-z][a-z0-9_.]{1,127}$/.test(event.type) ||
          !Number.isSafeInteger(event.created) ||
          event.created < 0 ||
          typeof event.livemode !== "boolean" ||
          event.livemode !== (expectedMode === "live") ||
          !event.data ||
          !event.data.object ||
          typeof event.data.object !== "object" ||
          Array.isArray(event.data.object)
        )
          throw new Error("Invalid verified event");
        return { id: event.id, type: event.type, created: event.created, livemode: event.livemode };
      } catch {
        logger?.log({
          event_name: "security.fail_closed.triggered",
          level: "WARN",
          result: "REJECTED",
          is_retry: false,
          provider: "STRIPE",
          failure_class: "SECURITY_FAILURE",
        });
        return null;
      }
    },
  };
}
